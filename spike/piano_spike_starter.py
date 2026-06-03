"""
PHASE 1 VISION SPIKE — Piano Posture Coach (Hands + Pose)
=========================================================
Now runs TWO models per frame:
  - HandLandmarker (21 pts/hand) -> wrist/finger faults
  - PoseLandmarker (33 body pts) -> arm/forearm faults (shoulders, elbows, wrists)

Models needed in this folder:
  hand_landmarker.task
  pose_landmarker.task   (download:
    curl -o pose_landmarker.task \
    https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task )

Keys: q quit, c switch camera.
"""

import time
from collections import deque

import cv2
import numpy as np
import mediapipe as mp
from mediapipe.tasks import python as mp_python
from mediapipe.tasks.python import vision

HAND_MODEL_PATH = "hand_landmarker.task"
POSE_MODEL_PATH = "pose_landmarker.task"

# --- Hand skeleton (21 pts) ---
HAND_CONNECTIONS = [
    (0, 1), (1, 2), (2, 3), (3, 4),
    (0, 5), (5, 6), (6, 7), (7, 8),
    (5, 9), (9, 10), (10, 11), (11, 12),
    (9, 13), (13, 14), (14, 15), (15, 16),
    (13, 17), (17, 18), (18, 19), (19, 20),
    (0, 17),
]

# --- Pose upper-body connections (subset of the 33 pts; arms + shoulders) ---
# 11 L-shoulder, 12 R-shoulder, 13 L-elbow, 14 R-elbow, 15 L-wrist, 16 R-wrist
POSE_ARM_CONNECTIONS = [
    (11, 12),            # shoulders
    (11, 13), (13, 15),  # left arm: shoulder-elbow-wrist
    (12, 14), (14, 16),  # right arm
]

SMOOTHING_WINDOW = 7
collapse_history = deque(maxlen=SMOOTHING_WINDOW)
arm_history = deque(maxlen=SMOOTHING_WINDOW)


# ---------------------------------------------------------------------------
# HAND fault (already implemented + tuned by you)
# ---------------------------------------------------------------------------
def detect_collapsed_wrist(landmarks):
    wrist_y = landmarks[0].y
    knuckle_y = np.mean([landmarks[i].y for i in (5, 9, 13, 17)])
    return (wrist_y - knuckle_y) > 0.04


# ---------------------------------------------------------------------------
# ARM fault — YOUR JOB to tune (this is the Pose equivalent)
# ---------------------------------------------------------------------------
def angle_at(b, a, c):
    """
    Angle (degrees) at point B formed by segments B->A and B->C.
    Each of a, b, c is a landmark with .x .y. Used for elbow angle:
    angle_at(elbow, shoulder, wrist).
    """
    ba = np.array([a.x - b.x, a.y - b.y])
    bc = np.array([c.x - b.x, c.y - b.y])
    cos = np.dot(ba, bc) / (np.linalg.norm(ba) * np.linalg.norm(bc) + 1e-9)
    cos = np.clip(cos, -1.0, 1.0)
    return np.degrees(np.arccos(cos))


def detect_arm_fault(pose_landmarks):
    """
    Flags an arm-posture problem from elbow angle.

    Good piano posture keeps the forearm roughly level with a relaxed,
    slightly-open elbow (commonly ~90-150 deg depending on bench height).
    This stub flags when EITHER elbow is too straight (locked, >160) or
    too closed (cramped, <70). Tune these numbers on your own setup.

    pose_landmarks: list of 33 landmarks. Arm indices:
      L: shoulder 11, elbow 13, wrist 15
      R: shoulder 12, elbow 14, wrist 16
    """
    # Visibility check: skip if arm not clearly seen (avoids garbage angles)
    def visible(i):
        v = getattr(pose_landmarks[i], "visibility", 1.0)
        return v is None or v > 0.5

    faults = False
    for sh, el, wr in [(11, 13, 15), (12, 14, 16)]:
        if not (visible(sh) and visible(el) and visible(wr)):
            continue
        elbow_angle = angle_at(pose_landmarks[el],
                               pose_landmarks[sh],
                               pose_landmarks[wr])
        if elbow_angle > 160 or elbow_angle < 70:   # <-- TUNE THESE
            faults = True
    return faults


# ---------------------------------------------------------------------------
# Drawing
# ---------------------------------------------------------------------------
def draw_points(frame, landmarks, connections, pt_color, line_color):
    h, w, _ = frame.shape
    pts = [(int(lm.x * w), int(lm.y * h)) for lm in landmarks]
    for a, b in connections:
        if a < len(pts) and b < len(pts):
            cv2.line(frame, pts[a], pts[b], line_color, 2)
    for (x, y) in pts:
        cv2.circle(frame, (x, y), 4, pt_color, -1)


def main():
    base = mp_python.BaseOptions
    hand_opts = vision.HandLandmarkerOptions(
        base_options=base(model_asset_path=HAND_MODEL_PATH),
        running_mode=vision.RunningMode.VIDEO,
        num_hands=2,
        min_hand_detection_confidence=0.6,
        min_tracking_confidence=0.5,
    )
    pose_opts = vision.PoseLandmarkerOptions(
        base_options=base(model_asset_path=POSE_MODEL_PATH),
        running_mode=vision.RunningMode.VIDEO,
        num_poses=1,
        min_pose_detection_confidence=0.5,
        min_tracking_confidence=0.5,
    )
    hand_landmarker = vision.HandLandmarker.create_from_options(hand_opts)
    pose_landmarker = vision.PoseLandmarker.create_from_options(pose_opts)

    cam_index = 0
    cap = cv2.VideoCapture(cam_index)

    #let cam wakeup blud
    for _ in range(5):
        cap.read()
        time.sleep(0.05)


    if not cap.isOpened():
        print("Could not open webcam. Check camera permissions.")
        return

    start = time.time()
    while True:
        ok, frame = cap.read()
        if not ok:
            continue   # skip this frame, try again (camera may still be warming up)

        frame = cv2.flip(frame, 1)
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
        ts = int((time.time() - start) * 1000)

        hand_result = hand_landmarker.detect_for_video(mp_image, ts)
        pose_result = pose_landmarker.detect_for_video(mp_image, ts)

        # --- hands ---
        if hand_result.hand_landmarks:
            for hand in hand_result.hand_landmarks:
                draw_points(frame, hand, HAND_CONNECTIONS,
                            (0, 0, 255), (0, 255, 0))
                collapse_history.append(bool(detect_collapsed_wrist(hand)))

        # --- pose (arms) ---
        if pose_result.pose_landmarks:
            for body in pose_result.pose_landmarks:
                draw_points(frame, body, POSE_ARM_CONNECTIONS,
                            (255, 0, 0), (255, 200, 0))
                arm_history.append(bool(detect_arm_fault(body)))

        # --- smoothed verdicts ---
        faults = []
        if len(collapse_history) == SMOOTHING_WINDOW and \
           sum(collapse_history) > SMOOTHING_WINDOW // 2:
            faults.append("WRIST COLLAPSED")
        if len(arm_history) == SMOOTHING_WINDOW and \
           sum(arm_history) > SMOOTHING_WINDOW // 2:
            faults.append("ARM POSTURE")

        h, w, _ = frame.shape
        if faults:
            cv2.rectangle(frame, (0, 0), (w - 1, h - 1), (0, 0, 255), 8)
            for i, f in enumerate(faults):
                cv2.putText(frame, f, (20, 50 + i * 45),
                            cv2.FONT_HERSHEY_SIMPLEX, 1.2, (0, 0, 255), 3)
        else:
            cv2.putText(frame, "EVERYTHING IS LOOKIN FRESH AND GREAT", (20, 50),
                        cv2.FONT_HERSHEY_SIMPLEX, 1.2, (0, 200, 0), 2)

        cv2.imshow("Piano Posture Spike (q quit, c camera)", frame)

        key = cv2.waitKey(1) & 0xFF
        if key == ord("q"):
            break
        elif key == ord("c"):
            cap.release()
            cam_index = (cam_index + 1) % 4
            cap = cv2.VideoCapture(cam_index)
            if not cap.isOpened():
                print(f"Camera {cam_index} unavailable, trying 0")
                cam_index = 0
                cap = cv2.VideoCapture(cam_index)
            print(f"Switched to camera {cam_index}")

    cap.release()
    cv2.destroyAllWindows()
    hand_landmarker.close()
    pose_landmarker.close()


if __name__ == "__main__":
    main()