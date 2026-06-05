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
import { createClient } from "@supabase/supabase-js";

const app = express();
app.use(cors());
app.use(express.json());

// Service-role client — full DB access, bypasses RLS
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

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

app.use("/sessions", auth);

// ---------------------------------------------------------------------------
// POST /sessions — start a new session
// ---------------------------------------------------------------------------
app.post("/sessions", async (req, res) => {
  const { data, error } = await supabase
    .from("sessions")
    .insert({
      user_id: req.userId,
      camera_mode: req.body.camera_mode || "side",
    })
    .select("id")
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json({ session_id: data.id });
});

// ---------------------------------------------------------------------------
// PATCH /sessions/:id — end a session
// ---------------------------------------------------------------------------
app.patch("/sessions/:id", async (req, res) => {
  const { data, error } = await supabase
    .from("sessions")
    .update({
      ended_at: req.body.ended_at || new Date().toISOString(),
      duration_seconds: req.body.duration_seconds,
      total_faults: req.body.total_faults,
    })
    .eq("id", req.params.id)
    .eq("user_id", req.userId)
    .select()
    .single();

  if (error) return res.status(error.code === "PGRST116" ? 404 : 500).json({ error: error.message });
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

  const rows = incoming.map((f) => ({
    session_id: req.params.id,
    fault_type: f.fault_type,
    hand: f.hand || null,
    timestamp_ms: f.timestamp_ms,
    value: f.value ?? null,
  }));

  const { error } = await supabase.from("fault_events").insert(rows);
  if (error) return res.status(500).json({ error: error.message });

  // Update total_faults count on the session
  const { count } = await supabase
    .from("fault_events")
    .select("*", { count: "exact", head: true })
    .eq("session_id", req.params.id);

  await supabase
    .from("sessions")
    .update({ total_faults: count })
    .eq("id", req.params.id);

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

  if (error) return res.status(500).json({ error: error.message });
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

  if (faultErr) return res.status(500).json({ error: faultErr.message });

  res.json({ ...session, fault_events: faults });
});

// ---------------------------------------------------------------------------
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`VisioNotes API listening on :${PORT}`));
