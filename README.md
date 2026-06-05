<h1 align="center">🎹 VisioNotes</h1>

<p align="center">
  <b>A real-time piano posture coach that watches your hands through a webcam — no special hardware required.</b>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/status-in_development-yellow" alt="status" />
  <img src="https://img.shields.io/badge/python-3.12-blue" alt="python" />
  <img src="https://img.shields.io/badge/MediaPipe-Tasks_API-00C2A8" alt="mediapipe" />
  <img src="https://img.shields.io/badge/license-MIT-green" alt="license" />
</p>

---

## What it does

VisioNotes uses computer vision to watch a pianist's hands and arms **while they play a real piano**, then flags technique faults in real time — the kind of thing a teacher catches looking over your shoulder:

- 🖐️ **Collapsed wrist** — wrist dropping below the knuckle line
- 💪 **Arm posture** — locked or overly-cramped elbow angles
- *(more faults in progress — see roadmap)*

It deliberately does **not** try to detect *which notes you played* from the camera — that's an unsolved problem on a 2D webcam (your fingers hide the keys at the moment of the press). Instead it focuses on the thing a webcam *can* do reliably: **posture and form**, the gap left open by audio-only practice apps and $500 hardware coaches.

---

## 🎥 Demo

> _**[ADD YOUR GIF HERE]** — a short screen recording of the live hand + arm tracking with a fault flagging. This is the single most important thing in the README. See "Adding the demo GIF" below._

<p align="center">
  <img src="demo.gif" alt="VisioNotes live tracking demo" width="600" />
</p>

---

## How it works

```
  Webcam ──▶ MediaPipe Hands (21 hand landmarks)   ──┐
        └──▶ MediaPipe Pose  (33 body landmarks)   ──┤
                                                     ▼
                                    Joint-angle geometry + smoothing
                                                     ▼
                                      Real-time fault detection
```

- **Pre-trained vision models** (MediaPipe Tasks API) extract 21 hand landmarks and 33 body landmarks per frame — consumed, not trained.
- **Feature engineering**: raw landmarks become meaningful geometry — wrist-vs-knuckle height, shoulder→elbow→wrist angles.
- **Temporal smoothing**: a rolling window flags only *sustained* faults, not single-frame jitter.
- **Robust capture**: tolerates dropped frames and supports hot-switching cameras.

---

## 🛠️ Tech

**Current (vision spike):** Python · MediaPipe Tasks API · OpenCV · NumPy

**Planned (full app):** React · Express/Node · Supabase (Postgres + auth) · LLM coaching agent with RAG-grounded feedback · Vercel + Railway deployment

---

## 🚀 Run it locally

> Requires **Python 3.12** (MediaPipe is not yet compatible with newer versions).
> [`uv`](https://github.com/astral-sh/uv) is recommended — it ships a clean Python and avoids system-Python issues.

```bash
# 1. Clone
git clone https://github.com/brad945/visionotes.git
cd visionotes

# 2. Environment
uv venv --python 3.12
source .venv/bin/activate
uv pip install mediapipe opencv-python numpy

# 3. Download the models (not committed — large binaries)
curl -o hand_landmarker.task https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task
curl -o pose_landmarker.task https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task

# 4. Run
python piano_spike_starter.py
```

**Controls:** `q` quit · `c` cycle camera

---

## 🗺️ Roadmap

- [x] Vision spike: live hand + arm landmark tracking
- [x] Collapsed-wrist detection (heuristic + smoothing)
- [x] Arm-posture detection via Pose (elbow angle)
- [ ] Per-user baseline calibration (compare against *your* best form)
- [ ] Side + top-down camera modes
- [ ] LLM coaching layer — plain-English feedback, RAG-grounded in piano pedagogy
- [ ] Full-stack web app (React + Express + Supabase), deployed
- [ ] Session history & progress trends

---

## 📝 Notes

This project is in active development. The current codebase is a **vision proof-of-concept** validating that posture coaching works from a plain webcam; the full-stack application is being built on top of it.

---

<p align="center"><sub>Built by Bradley Tsou</sub></p>