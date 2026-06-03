# CLAUDE.md — VisioNotes

Auto-loaded every session. This file holds the **durable** rules: identity, working style, hard scope boundaries, and current state. **The detailed build spec lives in `PLAN.md` — always read `PLAN.md` before doing any web-app work.**

---

## The project
A web app that watches a pianist's hands/arms through a webcam **while they play a REAL piano** and coaches posture/technique in real time (collapsed wrist, arm posture, etc.). NOT note detection. NOT an air-piano. Pattern: pre-trained hand/pose model → joint-angle geometry → (later) baseline → (later) LLM coaching → deployed web app.

## The goal
Portfolio/resume project demonstrating full-stack + applied-CV skill. **Built-well-and-shipped beats novel-but-unfinished.** The owner is learning full-stack deliberately — **explain concepts and decisions, don't silently generate.** They want to understand and defend every part in interviews.

## Hard scope boundaries (NEVER cross without explicit approval)
- **NO per-finger key-press detection from vision** — occlusion wall, permanently out of scope.
- **NO RL.**
- **NO audio/MIDI in v1.**
- **NO LLM coaching / RAG in lean v1** — that's the "fuller v1," a later layer.
- **Don't scope-creep.** Suggesting ideas is fine; building them unasked is not. When asked to debug/review, fix the specific thing. The owner holds the scope line — respect it.

## How to work with the owner
- Explain decisions and concepts as you go (owner is learning).
- Build ONE layer at a time; each must be runnable before the next.
- Confirm before large multi-file generation.
- Keep the MediaPipe **Tasks API** (never the deprecated `solutions` API).
- Any Python work: **Python 3.12 + uv**.

## Current state (keep this updated as phases complete)
- ✅ Phase 1 (vision spike) DONE — frozen in `spike/`. DO NOT edit or "improve" the spike.
- ✅ Repo live: github.com/brad945/visionotes (first commit + README done).
- 🔜 NOW: **Phase 3 — building lean v1 web app.** See `PLAN.md` for full spec and current sub-phase.

## Repo layout
One repo. `spike/` = frozen Python proof-of-concept. Web app lives in `web/` (or as structured during scaffolding). Root holds `CLAUDE.md`, `PLAN.md`, `README.md`, `.gitignore`.

---
**Before web-app work: read `PLAN.md`.** It is the source of truth for scope, architecture, data model, API, and build order.