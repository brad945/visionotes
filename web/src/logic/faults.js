// faults.js — pure fault-detection geometry
// ---------------------------------------------------------------------------
// NO MediaPipe, NO React, NO side effects. Just landmark coordinates in,
// posture verdicts out. Isolated from the camera loop so it is deterministic
// and trivially unit-testable (see faults.test.js).
//
// This is where correctness actually matters: a false "collapsed wrist" erodes
// trust faster than any UI bug. So this is the part that earns real tests.
//
// Coordinate convention (matches MediaPipe Tasks output): each landmark is
// { x, y, z } in normalized [0,1] image space, y INCREASING downward. "Below"
// therefore means LARGER y.
//
// Extracted from the original vision/faults.js. The geometry (4-knuckle line,
// 0.04 threshold, 70–160° elbow window, visibility gate, return shapes) is the
// REAL behavior. Three deliberate hardening changes over the original — each
// flagged inline and in the task report:
//   1. isWristCollapsed takes a `tolerance` (default 0.04) + an epsilon guard.
//   2. angleDeg returns NaN at a coincident joint instead of a meaningless ~90.
//   3. checkArmPosture guards missing landmarks instead of throwing on them.
// ---------------------------------------------------------------------------

// MediaPipe Hands landmark indices we care about.
export const HAND_LANDMARK = {
  WRIST: 0,
  INDEX_MCP: 5, // index knuckle
  MIDDLE_MCP: 9, // middle knuckle
  RING_MCP: 13, // ring knuckle
  PINKY_MCP: 17, // pinky knuckle
};

// MediaPipe Pose landmark indices for the arms.
export const POSE_LANDMARK = {
  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
  LEFT_ELBOW: 13,
  RIGHT_ELBOW: 14,
  LEFT_WRIST: 15,
  RIGHT_WRIST: 16,
};

// Default acceptable elbow-angle window (degrees). Outside this is a fault.
export const ELBOW_WINDOW = { min: 70, max: 160 };

// Minimum MediaPipe visibility for a pose landmark to be trusted.
const MIN_VISIBILITY = 0.3;

// --- Collapsed-wrist detection ---------------------------------------------------

/**
 * Average the y of the FOUR knuckle landmarks (index/middle/ring/pinky MCP) to
 * get the "knuckle line" height. Pure helper. Matches the real detector — the
 * reference template averaged only two knuckles.
 */
export function knuckleLineY(landmarks) {
  return (
    (landmarks[HAND_LANDMARK.INDEX_MCP].y +
      landmarks[HAND_LANDMARK.MIDDLE_MCP].y +
      landmarks[HAND_LANDMARK.RING_MCP].y +
      landmarks[HAND_LANDMARK.PINKY_MCP].y) /
    4
  );
}

/**
 * Collapsed-wrist detection.
 *
 * A healthy hand keeps the wrist at or slightly above the knuckle line. A
 * collapsed wrist drops BELOW the knuckles (larger y). We require the drop to
 * clear a tolerance so normal micro-movement doesn't trip the flag.
 *
 * @param {Array<{x:number,y:number}>} landmarks - 21 hand landmarks
 * @param {number} [tolerance=0.04] - normalized-units slack before flagging
 * @returns {boolean} true if the wrist is collapsed
 */
export function isWristCollapsed(landmarks, tolerance = 0.04) {
  // Safe handling of missing/short input — the camera loop must never crash on
  // a dropped frame. The original accessed landmarks[0].y unguarded.
  if (!landmarks || landmarks.length < 18) return false;

  const wristY = landmarks[HAND_LANDMARK.WRIST].y;
  const kLineY = knuckleLineY(landmarks);

  // EPSILON guards the boundary: subtracting normalized floats (e.g. 0.54 - 0.50)
  // can yield 0.040000000000000036, which would spuriously trip an exact-tolerance
  // pose. Require the drop to clear tolerance by more than float noise. (The
  // original used a bare `> 0.04`; this is the intended hardening.)
  const EPSILON = 1e-9;
  return wristY - kLineY > tolerance + EPSILON;
}

// Fault indices for drawing: wrist + the four knuckles used in the check.
export const WRIST_FAULT_INDICES = [0, 5, 9, 13, 17];

// --- Arm-posture detection (elbow angle) -----------------------------------------

/**
 * Interior angle (degrees) at point B formed by segments B→A and B→C. Pure trig.
 *
 * Returns NaN when either segment has zero length (a coincident joint): there is
 * no defined angle there, so callers must treat it as "no reading" rather than a
 * real 0°/90°. The original returned a meaningless ~90° via a `+1e-9` denominator
 * fudge; NaN makes the degenerate case explicit and refusable.
 */
export function angleDeg(a, b, c) {
  const ba = [a.x - b.x, a.y - b.y];
  const bc = [c.x - b.x, c.y - b.y];
  const magBA = Math.hypot(ba[0], ba[1]);
  const magBC = Math.hypot(bc[0], bc[1]);
  if (magBA === 0 || magBC === 0) return NaN;

  const dot = ba[0] * bc[0] + ba[1] * bc[1];
  // clamp guards float drift outside [-1, 1].
  const cos = Math.max(-1, Math.min(1, dot / (magBA * magBC)));
  return (Math.acos(cos) * 180) / Math.PI;
}

// Pose landmark indices per arm (used by the renderer too).
export const ARM_INDICES = {
  left: { shoulder: 11, elbow: 13, wrist: 15 },
  right: { shoulder: 12, elbow: 14, wrist: 16 },
};

/**
 * Arm-posture fault via elbow angle.
 *
 * A healthy elbow sits in a relaxed mid-range; too straight (locked out) or too
 * acute (cramped) are both faults. Flags anything outside [min, max].
 *
 * @param {Array} poseLandmarks - 33 pose landmarks ({x,y,z,visibility})
 * @param {"left"|"right"} side
 * @param {{min:number,max:number}} [window=ELBOW_WINDOW]
 * @returns {{fault:boolean, elbowAngle:number|null}}
 */
export function checkArmPosture(poseLandmarks, side, window = ELBOW_WINDOW) {
  const { shoulder: shIdx, elbow: elIdx, wrist: wrIdx } = ARM_INDICES[side];
  const sh = poseLandmarks?.[shIdx];
  const el = poseLandmarks?.[elIdx];
  const wr = poseLandmarks?.[wrIdx];

  // Missing-landmark safety. The original threw a TypeError reading `.visibility`
  // off an undefined landmark; here we return "no reading" instead.
  if (!sh || !el || !wr) return { fault: false, elbowAngle: null };

  const visible = (p) => (p.visibility ?? 1) > MIN_VISIBILITY;
  if (!visible(sh) || !visible(el) || !visible(wr)) {
    return { fault: false, elbowAngle: null };
  }

  const angle = angleDeg(sh, el, wr);
  if (Number.isNaN(angle)) return { fault: false, elbowAngle: null };

  return { fault: angle > window.max || angle < window.min, elbowAngle: angle };
}
