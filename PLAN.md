# PLAN.md — VisioNotes Build Spec (Lean v1)

The detailed, evolving build spec. `CLAUDE.md` holds durable rules and points here. Read this fully before building. Do not deviate without explicit owner approval. **Update the "Progress" section as sub-phases complete.**

---

## Lean v1 — what we're building NOW

A vision form-coach web app: the user plays a real piano, the browser watches their hands/arms via webcam, detects posture faults in real time, and stores sessions so they can see history.

### INCLUDES (lean v1)
- Browser webcam capture + live hand/arm landmark tracking (MediaPipe JS)
- Real-time fault detection: collapsed wrist + arm posture (elbow angle), **per hand**
- User accounts (per-person history)
- Save each session + its fault events
- History view: past sessions + basic fault trends

### EXCLUDES (do NOT build — roadmap/later)
- ❌ LLM coaching / natural-language feedback
- ❌ RAG / pedagogy corpus
- ❌ Audio / MIDI / note detection
- ❌ Trained ML classifier (heuristics only for now)
- ❌ Per-finger key-press detection (occlusion wall — permanent)
- ❌ Gamification (streaks, scores, sound alerts), severity gradients — roadmap

---

## Architecture (three-tier) + WHY

```
User's Browser  (React + MediaPipe JS)
  • webcam capture, vision, fault detection — ALL client-side
  • video NEVER leaves the browser
        │  sends only small JSON (fault events + session summary)
        ▼
Backend (Express / Node)  ── store/retrieve ──▶  Supabase (Postgres + Auth)
  • THIN: persists results, serves history, gatekeeps auth
  • never receives or processes video
```

**Locked rationale (don't change):**
- **Vision runs 100% client-side in JS.** Python spike is retired; logic re-implemented in JavaScript. Why: privacy (no video upload), low latency (no per-frame round-trip), low bandwidth/cost.
- **Backend is thin** — storage + auth gatekeeper, not a vision processor.
- **Browser is untrusted** — backend owns all DB access; frontend never touches the DB directly.

## Stack (locked)
- Frontend: React + JS, MediaPipe Tasks API (JS, `@mediapipe/tasks-vision`), → Vercel
- Backend: Express / Node → Railway
- DB + auth: Supabase (Postgres + Auth); pgvector reserved for later RAG

---

## Data model (Supabase)

`users` — Supabase Auth built-in (id, email). Don't build from scratch.

`sessions`
- `id` (uuid, pk), `user_id` (fk), `started_at`, `ended_at` (nullable), `duration_seconds` (int), `camera_mode` (text 'side'|'top_down', default 'side'), `total_faults` (int)

`fault_events`
- `id` (uuid, pk), `session_id` (fk), `fault_type` (text 'collapsed_wrist'|'arm_posture'), `hand` (text 'left'|'right'|null), `timestamp_ms` (int), `value` (float, nullable)

## API contract (Express)
All require an authenticated Supabase user; backend scopes queries to that user.
- `POST   /sessions`            → start; returns `{ session_id }`
- `PATCH  /sessions/:id`        → end; body `{ ended_at, duration_seconds, total_faults }`
- `POST   /sessions/:id/faults` → batch-log faults; body `{ faults: [ { fault_type, hand, timestamp_ms, value } ] }`. Server caps a batch at 5000; the client posts in batches of 1000 and resumes at the first unsent batch on Retry (a chattering session in this project's own data logged 24.5 events/sec, so one-request-per-session hits the cap after ~3.4 min).
- `GET    /sessions`            → list user's sessions
- `GET    /sessions/:id`        → one session + its fault_events
- `POST   /sessions/:id/landmarks` → store ONE chunk of skeleton replay frames; body `{ frames: [...], chunk_index }`. Upserts on (session_id, chunk_index) — chunks are uploaded *during* the session, so request size is constant (~300 frames) instead of growing with session length, and re-posting a chunk is idempotent.
- `GET    /sessions/:id/landmarks` → the session's frames, chunks stitched in index order

**Flow:** browser detects faults locally → on session end, PATCH summary + POST batched faults → Supabase stores → history reads via GET.

---

## Build order (one layer at a time; each runnable before next)
- **3a** React frontend skeleton (app shell, routing, runs locally). No vision/backend.
- **3b** Vision in browser: MediaPipe Hands (JS) → 21 landmarks on live webcam in-page. Milestone: dots on hands in a webpage.
- **3c** Fault detection in JS: port wrist heuristic (+ arm via Pose). PER-HAND (separate smoothing buffers — never one shared buffer). Strictly-increasing timestamps. Color the specific faulting joint, not a whole-screen border.
- **3d** Backend: Express + endpoints above (stub/in-memory first, then DB).
- **3e** Database + auth: Supabase tables (schema above) + Supabase Auth; wire backend.
- **3f** Wire end-to-end: session lifecycle start → detect → end → store → history.
- **Phase 4** Deploy: frontend Vercel, backend Railway; env vars/secrets configured.

## Lessons from the spike (build RIGHT the first time in JS)
- **Per-hand fault tracking** — separate smoothing buffer per hand; display "LEFT/RIGHT WRIST COLLAPSED". (Spike used one shared buffer = bug.)
- **Monotonic timestamps** — MediaPipe VIDEO mode (JS too) needs strictly-increasing timestamps.
- **Tolerate dropped frames** — skip, don't crash.
- **Smoothing** — flag only sustained faults (rolling window), not single-frame jitter.

## Heuristics reference (from working spike)
- Collapsed wrist: `wrist.y - mean(knuckles[5,9,13,17].y) > ~0.04` (y increases downward). Tune.
- Arm posture: elbow angle via shoulder→elbow→wrist (Pose L:11,13,15 / R:12,14,16); flag if >~160 (locked) or <~70 (cramped). Tune.

## Worth building in v1 (cheap, high UX value)
- Per-hand fault labels.
- Color-code the specific bad joint (not whole-frame red).

---

## Progress (UPDATE as you go)
- [x] 3a React skeleton
- [x] 3b Browser vision (landmarks)
- [x] 3c JS fault detection (per-hand)
- [x] 3d Backend API (in-memory stub)
- [x] 3e Supabase DB + auth
- [x] 3f End-to-end wiring
- [ ] Phase 4 deploy