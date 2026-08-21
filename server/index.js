/**
 * VisioNotes backend — thin Express server backed by Supabase.
 *
 * Uses the service_role key to bypass RLS (server is trusted).
 * Auth: verifies the user's Supabase JWT from the Authorization header,
 * then scopes all queries to that user's ID.
 */

import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { createClient } from "@supabase/supabase-js";
import { isMissingTableError, httpStatusFromError, publicErrorMessage } from "./errors.js";

// Fail fast on missing config. Without this, a missing key surfaces as a confusing
// error on the first query instead of at boot, when it is trivial to diagnose.
for (const key of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) {
  if (!process.env[key]) {
    console.error(`Missing required env var: ${key}. Copy .env.example and fill it in.`);
    process.exit(1);
  }
}

const app = express();

app.use(helmet());

// CORS is an allow-list, not a wildcard. This API is backed by a service-role key
// that bypasses RLS, so it should only ever be called by our own frontend.
// Requests with no Origin (curl, health checks, same-origin) are allowed through.
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "http://localhost:5173")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
      callback(new Error(`Origin not allowed: ${origin}`));
    },
  })
);

// Explicit body limit. Sized to the largest LEGITIMATE request, not to the longest
// imaginable session: replay frames now arrive in bounded chunks (see
// MAX_FRAMES_PER_CHUNK below, ~500KB worst case) instead of one whole-session
// payload, so the limit no longer has to grow with how long someone practises.
app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || "1mb" }));

// Blanket rate limit. The API is service-role backed, so unauthenticated floods cost
// real Supabase quota. Generous enough that normal practice never trips it.
app.use(
  rateLimit({
    windowMs: 60_000,
    limit: 120,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { error: "Too many requests, please slow down" },
  })
);

// Service-role client — full DB access, bypasses RLS
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Never hand raw Postgres/PostgREST text to a client — it leaks column names,
// constraint names, and schema shape. Log the real thing, return something generic.
function fail(res, status, publicMessage, realError) {
  if (realError) console.error(`[${status}] ${publicMessage}:`, realError);
  return res.status(status).json({ error: publicMessage });
}

// ---------------------------------------------------------------------------
// Auth middleware — verify Supabase JWT, extract user id
// ---------------------------------------------------------------------------
async function auth(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing or invalid Authorization header" });
  }
  const token = header.slice(7);
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) {
    return res.status(401).json({ error: "Invalid token" });
  }
  req.userId = data.user.id;
  next();
}

// A malformed :id reaches Postgres as an invalid uuid and comes back as a 500 with a
// leaked type error. Reject it here as the 400 it actually is.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requireUuid(req, res, next) {
  if (!UUID_RE.test(req.params.id)) {
    return res.status(400).json({ error: "Invalid session id" });
  }
  next();
}

app.use("/sessions", auth);
app.param("id", (req, res, next) => requireUuid(req, res, next));

// ---------------------------------------------------------------------------
// POST /sessions — start a new session
// ---------------------------------------------------------------------------
app.post("/sessions", async (req, res) => {
  const cameraMode = req.body.camera_mode || "side";
  if (!["side", "top_down"].includes(cameraMode)) {
    return res.status(400).json({ error: "camera_mode must be 'side' or 'top_down'" });
  }

  const { data, error } = await supabase
    .from("sessions")
    .insert({ user_id: req.userId, camera_mode: cameraMode })
    .select("id")
    .single();

  if (error) return fail(res, 500, "Could not start session", error);
  res.status(201).json({ session_id: data.id });
});

// ---------------------------------------------------------------------------
// PATCH /sessions/:id — end a session
// ---------------------------------------------------------------------------
app.patch("/sessions/:id", async (req, res) => {
  // duration_seconds is the only stat the client is allowed to report — it is wall
  // clock the server never observed. total_faults is deliberately NOT taken from the
  // body: it is derived from fault_events below, so a client cannot inflate its own
  // stats, and the two writers that used to race over this column are now one.
  const { duration_seconds } = req.body;
  if (
    duration_seconds !== undefined &&
    (!Number.isFinite(duration_seconds) || duration_seconds < 0 || duration_seconds > 86_400)
  ) {
    return res.status(400).json({ error: "duration_seconds must be between 0 and 86400" });
  }

  const { count, error: countErr } = await supabase
    .from("fault_events")
    .select("*", { count: "exact", head: true })
    .eq("session_id", req.params.id);

  if (countErr) return fail(res, 500, "Could not end session", countErr);

  const { data, error } = await supabase
    .from("sessions")
    .update({
      ended_at: new Date().toISOString(),
      duration_seconds,
      total_faults: count ?? 0,
    })
    .eq("id", req.params.id)
    .eq("user_id", req.userId)
    .select()
    .single();

  if (error) {
    if (error.code === "PGRST116") return res.status(404).json({ error: "Session not found" });
    return fail(res, 500, "Could not end session", error);
  }
  res.json(data);
});

// ---------------------------------------------------------------------------
// POST /sessions/:id/faults — batch-log fault events
// ---------------------------------------------------------------------------
app.post("/sessions/:id/faults", async (req, res) => {
  // Verify session belongs to user
  const { data: session, error: sessErr } = await supabase
    .from("sessions")
    .select("id")
    .eq("id", req.params.id)
    .eq("user_id", req.userId)
    .single();

  if (sessErr || !session) return res.status(404).json({ error: "Session not found" });

  const incoming = req.body.faults;
  if (!Array.isArray(incoming)) return res.status(400).json({ error: "faults must be an array" });

  // Bound the batch. The DB check constraints already reject bad fault_type/hand, but
  // they surface as a 500 with leaked Postgres text — validating here returns a real 400.
  const MAX_FAULTS = 5000;
  if (incoming.length > MAX_FAULTS) {
    return res.status(400).json({ error: `faults may not exceed ${MAX_FAULTS} entries` });
  }

  // Must stay in step with the CHECK constraint on fault_events.fault_type
  // (see supabase/migrations/003_more_fault_types.sql). Validating here turns a
  // bad type into a 400 naming the offending index instead of a 500 carrying
  // raw Postgres constraint text.
  const FAULT_TYPES = ["collapsed_wrist", "arm_posture", "flat_fingers", "back_posture"];
  const HANDS = ["left", "right"];

  for (const [i, f] of incoming.entries()) {
    if (!FAULT_TYPES.includes(f?.fault_type)) {
      return res.status(400).json({ error: `faults[${i}].fault_type is invalid` });
    }
    if (f.hand != null && !HANDS.includes(f.hand)) {
      return res.status(400).json({ error: `faults[${i}].hand is invalid` });
    }
    if (!Number.isFinite(f.timestamp_ms) || f.timestamp_ms < 0) {
      return res.status(400).json({ error: `faults[${i}].timestamp_ms must be a positive number` });
    }
    if (f.value != null && !Number.isFinite(f.value)) {
      return res.status(400).json({ error: `faults[${i}].value must be a number` });
    }
  }

  const rows = incoming.map((f) => ({
    session_id: req.params.id,
    fault_type: f.fault_type,
    hand: f.hand || null,
    timestamp_ms: Math.round(f.timestamp_ms),
    value: f.value ?? null,
  }));

  if (rows.length) {
    const { error } = await supabase.from("fault_events").insert(rows);
    if (error) return fail(res, 500, "Could not save faults", error);
  }

  // Keep total_faults in step with what is actually stored. PATCH /sessions/:id
  // recomputes the same way, so both paths agree no matter which lands last.
  const { count } = await supabase
    .from("fault_events")
    .select("*", { count: "exact", head: true })
    .eq("session_id", req.params.id);

  await supabase
    .from("sessions")
    .update({ total_faults: count ?? 0 })
    .eq("id", req.params.id)
    .eq("user_id", req.userId);

  res.status(201).json({ inserted: rows.length });
});

// ---------------------------------------------------------------------------
// GET /sessions — list user's sessions
// ---------------------------------------------------------------------------
app.get("/sessions", async (req, res) => {
  const { data, error } = await supabase
    .from("sessions")
    .select("*")
    .eq("user_id", req.userId)
    .order("started_at", { ascending: false });

  if (error) return fail(res, 500, "Could not load sessions", error);
  res.json(data);
});

// ---------------------------------------------------------------------------
// GET /sessions/:id — one session + its fault events
// ---------------------------------------------------------------------------
app.get("/sessions/:id", async (req, res) => {
  const { data: session, error: sessErr } = await supabase
    .from("sessions")
    .select("*")
    .eq("id", req.params.id)
    .eq("user_id", req.userId)
    .single();

  if (sessErr || !session) return res.status(404).json({ error: "Session not found" });

  const { data: faults, error: faultErr } = await supabase
    .from("fault_events")
    .select("*")
    .eq("session_id", req.params.id)
    .order("timestamp_ms", { ascending: true });

  if (faultErr) return fail(res, 500, "Could not load session", faultErr);

  res.json({ ...session, fault_events: faults });
});

// ---------------------------------------------------------------------------
// POST /sessions/:id/landmarks — store skeleton replay frames
// ---------------------------------------------------------------------------
// A session's replay arrives as a sequence of bounded chunks, not one payload —
// the client uploads while the session runs. `chunk_index` is that chunk's slot
// in the stream; the upsert key is (session_id, chunk_index), which makes a
// retried chunk overwrite itself instead of duplicating or interleaving frames.
// chunk_index defaults to 0, so a single-chunk client still behaves exactly like
// the old whole-array replace.
const MAX_FRAMES_PER_CHUNK = 600;
// 5000 chunks x 300 frames covers far more than the 24h duration cap. This only
// exists so a client cannot spray rows across an unbounded index space.
const MAX_CHUNK_INDEX = 5000;

app.post("/sessions/:id/landmarks", async (req, res) => {
  const { data: session, error: sessErr } = await supabase
    .from("sessions")
    .select("id")
    .eq("id", req.params.id)
    .eq("user_id", req.userId)
    .single();

  if (sessErr || !session) return res.status(404).json({ error: "Session not found" });

  // `?? {}` because Express 5 leaves req.body undefined when nothing was parsed —
  // a bodyless POST should be the 400 below, not a TypeError 500.
  const { frames, chunk_index: chunkIndex = 0 } = req.body ?? {};
  if (!Array.isArray(frames)) return res.status(400).json({ error: "frames must be an array" });

  // The client's chunk size is a throughput choice; THIS is the boundary. Without
  // it a client could still post a whole session in one request and 413 (or, worse,
  // squeak under the body limit and put a multi-megabyte row in one jsonb cell).
  if (frames.length > MAX_FRAMES_PER_CHUNK) {
    return res.status(400).json({ error: `frames may not exceed ${MAX_FRAMES_PER_CHUNK} per chunk` });
  }
  if (!Number.isInteger(chunkIndex) || chunkIndex < 0 || chunkIndex > MAX_CHUNK_INDEX) {
    return res.status(400).json({ error: `chunk_index must be an integer between 0 and ${MAX_CHUNK_INDEX}` });
  }

  // Shallow shape check only. Deep-validating 600 x 21 points per request costs
  // more than it protects: the column is jsonb and the only consumer is our own
  // replay renderer. `t` is checked because it is what the renderer sorts on.
  for (const [i, f] of frames.entries()) {
    if (!f || typeof f !== "object" || !Number.isFinite(f.t) || f.t < 0) {
      return res.status(400).json({ error: `frames[${i}].t must be a positive number` });
    }
  }

  const { error } = await supabase
    .from("landmark_frames")
    .upsert(
      { session_id: req.params.id, chunk_index: chunkIndex, frames },
      { onConflict: "session_id,chunk_index" }
    );

  // Table absent = the (optional) landmark_frames migration was never applied.
  // Say so plainly instead of logging a generic 500 the owner has to dig into.
  // See errors.js for why this matches TWO codes and not just the Postgres one.
  if (isMissingTableError(error)) {
    return fail(res, 501, "Replay storage is not set up on this server", error);
  }
  if (error) return fail(res, 500, "Could not save replay frames", error);
  res.status(201).json({ stored: frames.length, chunk_index: chunkIndex });
});

// ---------------------------------------------------------------------------
// GET /sessions/:id/landmarks — fetch skeleton replay frames
// ---------------------------------------------------------------------------
app.get("/sessions/:id/landmarks", async (req, res) => {
  const { data: session, error: sessErr } = await supabase
    .from("sessions")
    .select("id")
    .eq("id", req.params.id)
    .eq("user_id", req.userId)
    .single();

  if (sessErr || !session) return res.status(404).json({ error: "Session not found" });

  // Chunks are stitched back into one stream in index order. No row = no replay,
  // which is a normal state (a session saved before this feature, or one whose
  // replay upload failed), so it returns an empty list rather than a 404.
  const { data, error } = await supabase
    .from("landmark_frames")
    .select("frames")
    .eq("session_id", req.params.id)
    .order("chunk_index", { ascending: true });

  // Table absent (migration not applied) reads as "no replay", not as an outage.
  if (isMissingTableError(error)) return res.json({ frames: [] });
  if (error) return fail(res, 500, "Could not load replay frames", error);
  res.json({ frames: (data ?? []).flatMap((row) => row.frames ?? []) });
});

// ---------------------------------------------------------------------------
// DELETE /sessions/:id — delete a session (fault_events cascade via FK)
// ---------------------------------------------------------------------------
app.delete("/sessions/:id", async (req, res) => {
  const { data, error } = await supabase
    .from("sessions")
    .delete()
    .eq("id", req.params.id)
    .eq("user_id", req.userId)
    .select("id")
    .single();

  // PGRST116 = no row matched (wrong id or not the owner)
  if (error) {
    if (error.code === "PGRST116") return res.status(404).json({ error: "Session not found" });
    return fail(res, 500, "Could not delete session", error);
  }
  res.json({ deleted: data.id });
});

// ---------------------------------------------------------------------------
// Fallbacks — both return JSON. Express's defaults return HTML, which breaks every
// client that does `(await res.json()).error` and, for 5xx, prints a stack trace
// with absolute filesystem paths.
// ---------------------------------------------------------------------------
app.use((req, res) => res.status(404).json({ error: "Not found" }));

// eslint-disable-next-line no-unused-vars -- Express identifies error handlers by arity
app.use((err, req, res, next) => {
  if (/^Origin not allowed/.test(err?.message || "")) {
    return fail(res, 403, "Origin not allowed", err);
  }
  // Honour the status the error already carries. Express's built-in handler does
  // this for free; a custom one must do it explicitly, and this one did not —
  // so adding it turned every framework 4xx (malformed JSON = 400, unsupported
  // Content-Encoding = 415, oversized body = 413) into a 500. That is not just
  // a wrong number: the client retries a 500 and gives up on a 4xx, so it made
  // permanent client-side faults look like transient server outages.
  const status = httpStatusFromError(err);
  fail(res, status, publicErrorMessage(err, status), err);
});

// ---------------------------------------------------------------------------
// 3002, matching .env.example and web/src/api.js. The default only matters for a
// clone-and-run with no .env; it is worth nothing if the three places disagree.
const PORT = process.env.PORT || 3002;
app.listen(PORT, () => console.log(`VisioNotes API listening on :${PORT}`));
