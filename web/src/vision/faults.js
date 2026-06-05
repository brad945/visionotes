/**
 * Fault detection heuristics — ported from Python spike.
 *
 * Key differences from the spike:
 *  - Per-hand smoothing (separate buffer per hand label).
 *  - Returns which landmark indices are faulting (for joint-level coloring).
 */

const SMOOTHING_WINDOW = 7;

// --- Collapsed-wrist detection ---------------------------------------------------

/**
 * Returns true if the wrist is dropped relative to the knuckle line.
 * landmarks: array of 21 {x, y, z} (normalized coords, y-down).
 */
export function isWristCollapsed(landmarks) {
  const wristY = landmarks[0].y;
  const knuckleY =
    (landmarks[5].y + landmarks[9].y + landmarks[13].y + landmarks[17].y) / 4;
  return wristY - knuckleY > 0.04;
}

// Fault indices for drawing: wrist + the four knuckles used in the check
export const WRIST_FAULT_INDICES = [0, 5, 9, 13, 17];

// --- Arm-posture detection (elbow angle) -----------------------------------------

function angleDeg(a, b, c) {
  // Angle at point B formed by segments B→A and B→C.
  const ba = [a.x - b.x, a.y - b.y];
  const bc = [c.x - b.x, c.y - b.y];
  const dot = ba[0] * bc[0] + ba[1] * bc[1];
  const magBA = Math.hypot(ba[0], ba[1]);
  const magBC = Math.hypot(bc[0], bc[1]);
  const cos = Math.max(-1, Math.min(1, dot / (magBA * magBC + 1e-9)));
  return (Math.acos(cos) * 180) / Math.PI;
}

/**
 * Returns { fault: bool, elbowAngle: number|null } for one arm.
 * poseLandmarks: array of 33 {x, y, z, visibility}.
 * side: 'left' | 'right'
 */
export function checkArmPosture(poseLandmarks, side) {
  const [sh, el, wr] =
    side === "left" ? [11, 13, 15] : [12, 14, 16];

  const visible = (i) => (poseLandmarks[i].visibility ?? 1) > 0.3;
  if (!visible(sh) || !visible(el) || !visible(wr)) {
    return { fault: false, elbowAngle: null };
  }

  const angle = angleDeg(
    poseLandmarks[sh],
    poseLandmarks[el],
    poseLandmarks[wr]
  );
  return { fault: angle > 160 || angle < 70, elbowAngle: angle };
}

// Pose landmark indices for arm drawing
export const ARM_INDICES = {
  left: { shoulder: 11, elbow: 13, wrist: 15 },
  right: { shoulder: 12, elbow: 14, wrist: 16 },
};

// --- Per-hand smoothing buffer ---------------------------------------------------

export class FaultSmoother {
  constructor(window = SMOOTHING_WINDOW) {
    this.window = window;
    this.buffers = {}; // keyed by label, e.g. "Left" / "Right"
    this.prev = {}; // previous smoothed state per label (for edge detection)
  }

  /**
   * Push a boolean and return { active, started }.
   *   active  — smoothed fault is currently on
   *   started — fault just transitioned off→on this frame (log-worthy)
   */
  push(label, value) {
    if (!this.buffers[label]) {
      this.buffers[label] = [];
    }
    const buf = this.buffers[label];
    buf.push(value);
    if (buf.length > this.window) buf.shift();

    let active = false;
    if (buf.length >= this.window) {
      const trueCount = buf.reduce((s, v) => s + (v ? 1 : 0), 0);
      active = trueCount > this.window / 2;
    }

    const wasActive = this.prev[label] || false;
    this.prev[label] = active;

    return { active, started: active && !wasActive };
  }

  clear() {
    this.buffers = {};
    this.prev = {};
  }
}
