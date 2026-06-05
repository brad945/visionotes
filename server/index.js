/**
 * VisioNotes backend — thin Express server.
 *
 * Phase 3d: in-memory store (no DB yet).
 * Phase 3e will swap the store for Supabase.
 *
 * API contract (from PLAN.md):
 *   POST   /sessions            → start session
 *   PATCH  /sessions/:id        → end session
 *   POST   /sessions/:id/faults → batch-log faults
 *   GET    /sessions            → list user's sessions
 *   GET    /sessions/:id        → one session + fault_events
 */

import express from "express";
import cors from "cors";
import crypto from "node:crypto";

const app = express();
app.use(cors());
app.use(express.json());

// ---------------------------------------------------------------------------
// In-memory store (replaced by Supabase in 3e)
// ---------------------------------------------------------------------------
const sessions = new Map(); // id -> session object
const faultEvents = new Map(); // session_id -> array of fault objects

// Placeholder auth middleware — extracts a user id from the header.
// In 3e this becomes real Supabase JWT verification.
function auth(req, res, next) {
  const userId = req.headers["x-user-id"];
  if (!userId) return res.status(401).json({ error: "Missing x-user-id header" });
  req.userId = userId;
  next();
}

app.use("/sessions", auth);

// POST /sessions — start a new session
app.post("/sessions", (req, res) => {
  const id = crypto.randomUUID();
  const session = {
    id,
    user_id: req.userId,
    started_at: new Date().toISOString(),
    ended_at: null,
    duration_seconds: null,
    camera_mode: req.body.camera_mode || "side",
    total_faults: 0,
  };
  sessions.set(id, session);
  faultEvents.set(id, []);
  res.status(201).json({ session_id: id });
});

// PATCH /sessions/:id — end a session
app.patch("/sessions/:id", (req, res) => {
  const session = sessions.get(req.params.id);
  if (!session) return res.status(404).json({ error: "Session not found" });
  if (session.user_id !== req.userId) return res.status(403).json({ error: "Forbidden" });

  session.ended_at = req.body.ended_at || new Date().toISOString();
  session.duration_seconds = req.body.duration_seconds ?? session.duration_seconds;
  session.total_faults = req.body.total_faults ?? session.total_faults;
  res.json(session);
});

// POST /sessions/:id/faults — batch-log fault events
app.post("/sessions/:id/faults", (req, res) => {
  const session = sessions.get(req.params.id);
  if (!session) return res.status(404).json({ error: "Session not found" });
  if (session.user_id !== req.userId) return res.status(403).json({ error: "Forbidden" });

  const incoming = req.body.faults;
  if (!Array.isArray(incoming)) return res.status(400).json({ error: "faults must be an array" });

  const stored = faultEvents.get(req.params.id);
  for (const f of incoming) {
    stored.push({
      id: crypto.randomUUID(),
      session_id: req.params.id,
      fault_type: f.fault_type,
      hand: f.hand || null,
      timestamp_ms: f.timestamp_ms,
      value: f.value ?? null,
    });
  }
  session.total_faults = stored.length;
  res.status(201).json({ inserted: incoming.length });
});

// GET /sessions — list user's sessions
app.get("/sessions", (req, res) => {
  const userSessions = [...sessions.values()]
    .filter((s) => s.user_id === req.userId)
    .sort((a, b) => b.started_at.localeCompare(a.started_at));
  res.json(userSessions);
});

// GET /sessions/:id — one session + its fault events
app.get("/sessions/:id", (req, res) => {
  const session = sessions.get(req.params.id);
  if (!session) return res.status(404).json({ error: "Session not found" });
  if (session.user_id !== req.userId) return res.status(403).json({ error: "Forbidden" });

  res.json({ ...session, fault_events: faultEvents.get(req.params.id) || [] });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`VisioNotes API listening on :${PORT}`));
