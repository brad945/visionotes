# VisioNotes — Project Context for Claude Code

Paste or reference this at the start of a Claude Code session so it has the full picture.

## What this project is
A web app (eventual) that uses a webcam to watch a pianist's hands while they play a REAL piano and coaches their **posture/technique** in real time — collapsed wrist, flat fingers, hand tension, excessive arm movement. NOT note detection, NOT an air-piano. It's the "SwingFrame for piano" pattern: pre-trained pose/hand model → joint-angle geometry → baseline comparison → LLM coaching → deployed web app.

## Hard scope boundaries (do NOT cross)
- **NO per-finger key-press detection from vision.** Occlusion wall: a finger hides the key exactly when pressed; a 2D webcam can't reliably tell which finger pressed which key. This is permanently out of scope. (Audio/MIDI would handle "what note" later, but v1 has no audio.)
- **NO RL.** Doesn't fit; don't bolt it on.
- **v1 = pure vision form-coach, no audio/MIDI.** Coaches how hands LOOK, not what was played.
- Don't scope-creep. When asked to debug or review, fix the specific thing; don't pile on features.

## Current phase: PHASE 1 — vision spike (almost done)
A throwaway standalone Python script (`piano_spike_starter.py`) proving the vision core works. NOT the real app. Just: webcam → MediaPipe Hands → 21 landmarks drawn → flag a collapsed wrist.

**Status:**
- ✅ Environment working (see stack below)
- ✅ Landmarks render live on hands
- ✅ Collapsed-wrist heuristic implemented (wrist_y vs mean knuckle_y, threshold ~0.04, with 7-frame smoothing)
- 🔜 Tuning the threshold; optionally a camera-switch key (`c`)
- 🔜 THEN: add arm/forearm tracking via **MediaPipe Pose** (Hands can't see past the wrist — Pose has elbows/shoulders). Run Pose alongside Hands.
- After that → Phase 1 done.

## CRITICAL technical notes (things that caused pain — don't regress)
- **Use the MediaPipe TASKS API** (`mp.tasks.vision.HandLandmarker` + `detect_for_video` + a `hand_landmarker.task` model file). DO NOT revert to the old `mp.solutions.hands` — it's removed in mediapipe 0.10.x and will crash.
- **Python 3.12** specifically (3.14 broke mediapipe; Homebrew's 3.12 had an expat/pip bug).
- Environment managed with **`uv`**: `uv venv --python 3.12`, `source .venv/bin/activate`, `uv pip install ...`. uv ships its own clean Python and avoids the system-Python breakage.
- Project lives at `~/Desktop/visionotes`. **Moving the folder breaks `.venv`** — rebuild with `rm -rf .venv && uv venv --python 3.12 && uv pip install mediapipe opencv-python numpy`. The script + model file survive moves; only `.venv` is fragile.
- Model file `hand_landmarker.task` (~7.5MB) must be in the project folder. Re-download:
  `curl -o hand_landmarker.task https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`

## Eventual full-app stack (Phase 3+, not yet built)
- Frontend: React + JS, MediaPipe Hands client-side (JS), deploy on **Vercel**
- Backend: **Express/Node**, deploy on **Railway**
- DB + auth: **Supabase** (Postgres; pgvector for RAG later)
- Vision: ships in JS for the app; Python only for prototyping (this spike) + optional classifier
- LLM coaching agent + RAG over piano-pedagogy text: later phase
- Two camera modes: **side** (wrist/forearm/height faults) and **top-down** (arch/spread). Build side first.

## Build progression
Stage 0 vision spike → 1 heuristic faults → 2 baseline/calibration → 3 LLM coaching → 4 (later) MIDI fusion → 5 (optional) trained classifier swapping heuristics. v1→v5; ship the barebones form-coach before adding anything.

## How to work with me (Claude Code)
- For debugging: give the specific broken behavior + the exact error text; fix only that; explain the fix.
- Keep the Tasks API. Keep Python 3.12 / uv. Don't add features unasked.
- The owner is learning the CV/ML parts deliberately — explain heuristic/geometry changes rather than silently rewriting them.