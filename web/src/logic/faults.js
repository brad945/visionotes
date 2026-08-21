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

// Per-finger joint chains (MCP -> PIP -> TIP) for the four fingers. The thumb is
// deliberately excluded: its saddle joint moves in a different plane, so the same
// curl threshold would misread a perfectly normal thumb as flat.
export const FINGER_CHAINS = [
  { name: "index", mcp: 5, pip: 6, tip: 8 },
  { name: "middle", mcp: 9, pip: 10, tip: 12 },
  { name: "ring", mcp: 13, pip: 14, tip: 16 },
  { name: "pinky", mcp: 17, pip: 18, tip: 20 },
];

// MediaPipe Pose landmark indices for the arms.
export const POSE_LANDMARK = {
  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
  LEFT_ELBOW: 13,
  RIGHT_ELBOW: 14,
  LEFT_WRIST: 15,
  RIGHT_WRIST: 16,
  // pose_landmarker_full returns all 33 points, so the hips are available even
  // though only the arms were mapped before. Shoulder->hip is the torso line.
  LEFT_HIP: 23,
  RIGHT_HIP: 24,
};

// Default acceptable elbow-angle window (degrees). Outside this is a fault.
// Elbow window. `max` is the "arms too stretched" line: past ~130 the elbow is
// heading toward locked-out, which pushes the player to reach from the shoulder
// instead of staying loose over the keys. It was 160 (near-straight), which only
// caught the extreme; 130 is the coaching threshold the owner plays to.
export const ELBOW_WINDOW = { min: 70, max: 130 };

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

// --- Flat-finger detection -------------------------------------------------------

// Curl angle at the PIP joint, in degrees. 180 = a perfectly straight finger;
// smaller = more curved. A pianist's hand should hold a rounded arch, so a finger
// approaching straight is the fault. NOT key-press detection — this measures the
// shape of the finger, never which key it is over.
export const FLAT_FINGER_ANGLE = 160;

// How many of the four fingers must be flat before it counts. One straight finger
// is normal (reaching for an interval); three or more is a collapsed arch.
export const FLAT_FINGER_MIN_COUNT = 3;

/**
 * Flat-finger fault: too many fingers held straight instead of arched.
 *
 * @param {Array} landmarks - 21 hand landmarks ({x,y})
 * @param {number} [angleThreshold=FLAT_FINGER_ANGLE]
 * @param {number} [minCount=FLAT_FINGER_MIN_COUNT]
 * @returns {{fault:boolean, flatCount:number, angles:Array<number|null>}}
 */
export function checkFlatFingers(
  landmarks,
  angleThreshold = FLAT_FINGER_ANGLE,
  minCount = FLAT_FINGER_MIN_COUNT
) {
  if (!Array.isArray(landmarks) || landmarks.length < 21) {
    return { fault: false, flatCount: 0, angles: [] };
  }

  const angles = FINGER_CHAINS.map(({ mcp, pip, tip }) => {
    const a = landmarks[mcp];
    const b = landmarks[pip];
    const c = landmarks[tip];
    if (!a || !b || !c) return null;
    const angle = angleDeg(a, b, c);
    return Number.isNaN(angle) ? null : angle;
  });

  const flatCount = angles.filter((a) => a !== null && a >= angleThreshold).length;
  return { fault: flatCount >= minCount, flatCount, angles };
}

// --- Back posture (torso lean) ---------------------------------------------------

// Degrees of lean from vertical before it counts as a fault.
//
// HONEST LIMIT: this measures how far the torso LEANS, not whether the upper back
// is ROUNDED — which is usually what a teacher means by "sit up straight". Rounding
// is a curvature of the spine between shoulders and neck, and pose landmarks give
// no points along the spine to measure it. Slouching forward from the hips is
// caught; hunching with the hips upright is not.
export const BACK_LEAN_LIMIT_DEG = 15;

/**
 * Back-posture fault via torso lean from vertical.
 *
 * Uses the shoulder midpoint -> hip midpoint line. Returns "no reading" whenever
 * the hips are missing or low-visibility, which is common at a piano: the bench
 * and the instrument occlude them, and a seated player is often cropped at the
 * waist. Staying silent is deliberate — a posture fault fired from a guessed hip
 * position would train the player against noise.
 *
 * @param {Array} poseLandmarks - 33 pose landmarks ({x,y,visibility})
 * @param {number} [limitDeg=BACK_LEAN_LIMIT_DEG]
 * @returns {{fault:boolean, leanDeg:number|null}}
 */
export function checkBackPosture(poseLandmarks, limitDeg = BACK_LEAN_LIMIT_DEG) {
  const ls = poseLandmarks?.[POSE_LANDMARK.LEFT_SHOULDER];
  const rs = poseLandmarks?.[POSE_LANDMARK.RIGHT_SHOULDER];
  const lh = poseLandmarks?.[POSE_LANDMARK.LEFT_HIP];
  const rh = poseLandmarks?.[POSE_LANDMARK.RIGHT_HIP];
  if (!ls || !rs || !lh || !rh) return { fault: false, leanDeg: null };

  const visible = (p) => (p.visibility ?? 1) > MIN_VISIBILITY;
  if (![ls, rs, lh, rh].every(visible)) return { fault: false, leanDeg: null };

  const shoulderMid = { x: (ls.x + rs.x) / 2, y: (ls.y + rs.y) / 2 };
  const hipMid = { x: (lh.x + rh.x) / 2, y: (lh.y + rh.y) / 2 };

  const dx = shoulderMid.x - hipMid.x;
  const dy = shoulderMid.y - hipMid.y; // negative = shoulders above hips (y grows downward)
  if (dx === 0 && dy === 0) return { fault: false, leanDeg: null };

  // Angle of the torso away from vertical, unsigned — leaning forward and leaning
  // back are both faults, and in a side view we cannot reliably tell which anyway.
  const leanDeg = (Math.atan2(Math.abs(dx), Math.abs(dy)) * 180) / Math.PI;
  return { fault: leanDeg > limitDeg, leanDeg };
}

// --- Camera framing: is this actually a side view? -------------------------------

// Shoulder separation as a fraction of upper-arm length. In a true side view the
// far shoulder sits almost directly behind the near one, so the horizontal gap is
// small. Turn toward 3/4 and the shoulders splay apart. Normalising by upper-arm
// length makes this independent of how far the player sits from the camera —
// a raw pixel gap would change meaning every time the tripod moved.
export const SIDE_VIEW_MAX_RATIO = 0.6;

/**
 * Judge whether the camera is square-on enough to the player's side.
 *
 * This is a SETUP check, not a posture fault: a bad angle is one static mistake to
 * fix before recording, so it gates the framing step instead of logging hundreds
 * of identical fault rows during a session.
 *
 * @param {Array} poseLandmarks - 33 pose landmarks ({x,y,visibility})
 * @param {number} [maxRatio=SIDE_VIEW_MAX_RATIO]
 * @returns {{isSideView:boolean, ratio:number|null}}
 */
export function checkSideView(poseLandmarks, maxRatio = SIDE_VIEW_MAX_RATIO) {
  const ls = poseLandmarks?.[POSE_LANDMARK.LEFT_SHOULDER];
  const rs = poseLandmarks?.[POSE_LANDMARK.RIGHT_SHOULDER];
  const le = poseLandmarks?.[POSE_LANDMARK.LEFT_ELBOW];
  const re = poseLandmarks?.[POSE_LANDMARK.RIGHT_ELBOW];
  if (!ls || !rs || !le || !re) return { isSideView: false, ratio: null };

  const visible = (p) => (p.visibility ?? 1) > MIN_VISIBILITY;
  if (!visible(ls) || !visible(rs)) return { isSideView: false, ratio: null };

  const shoulderGap = Math.hypot(ls.x - rs.x, ls.y - rs.y);

  // Scale reference: the longer visible upper arm. Using the longer one avoids
  // dividing by an arm that is foreshortened to almost nothing in this very view.
  const armLengths = [
    visible(le) ? Math.hypot(ls.x - le.x, ls.y - le.y) : 0,
    visible(re) ? Math.hypot(rs.x - re.x, rs.y - re.y) : 0,
  ];
  const scale = Math.max(...armLengths);
  if (scale === 0) return { isSideView: false, ratio: null };

  const ratio = shoulderGap / scale;
  return { isSideView: ratio <= maxRatio, ratio };
}
