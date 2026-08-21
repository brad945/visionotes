// newFaults.test.js — geometry for the three fault checks added after v1:
// flat fingers, back lean, and the side-view framing gate.
//
// These are PURE functions, so they are tested with hand-built landmark arrays
// rather than a webcam. The cases that matter most are the DEGENERATE ones: at a
// real piano the hips are frequently occluded and a hand is frequently partly out
// of frame, and a posture coach that fires on a guess is worse than one that stays
// quiet. Every "no reading" assertion below is guarding that.

import { describe, it, expect } from "vitest";
import {
  checkFlatFingers,
  checkBackPosture,
  checkSideView,
  FINGER_CHAINS,
  POSE_LANDMARK,
} from "./faults";

// Build 21 hand landmarks, all coincident, then let callers shape fingers.
function hand() {
  return Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5 }));
}

// Lay one finger out as either straight (180°) or bent (~90°) at the PIP.
function setFinger(lm, chain, { straight }) {
  lm[chain.mcp] = { x: 0.5, y: 0.5 };
  lm[chain.pip] = { x: 0.6, y: 0.5 };
  // straight: continue along +x. bent: turn 90° at the PIP.
  lm[chain.tip] = straight ? { x: 0.7, y: 0.5 } : { x: 0.6, y: 0.6 };
}

function pose(overrides = {}) {
  const lm = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 1 }));
  for (const [idx, v] of Object.entries(overrides)) lm[idx] = { visibility: 1, ...v };
  return lm;
}

describe("checkFlatFingers", () => {
  it("does not fault a properly arched hand", () => {
    const lm = hand();
    for (const c of FINGER_CHAINS) setFinger(lm, c, { straight: false });
    const { fault, flatCount } = checkFlatFingers(lm);
    expect(flatCount).toBe(0);
    expect(fault).toBe(false);
  });

  it("faults when three or more fingers are held straight", () => {
    const lm = hand();
    FINGER_CHAINS.forEach((c, i) => setFinger(lm, c, { straight: i < 3 }));
    const { fault, flatCount } = checkFlatFingers(lm);
    expect(flatCount).toBe(3);
    expect(fault).toBe(true);
  });

  it("tolerates ONE straight finger — reaching for an interval is not a fault", () => {
    const lm = hand();
    FINGER_CHAINS.forEach((c, i) => setFinger(lm, c, { straight: i === 0 }));
    expect(checkFlatFingers(lm).fault).toBe(false);
  });

  it("returns no reading for a short/missing landmark array instead of throwing", () => {
    expect(checkFlatFingers([]).fault).toBe(false);
    expect(checkFlatFingers(undefined).fault).toBe(false);
    expect(checkFlatFingers(Array(10).fill({ x: 0, y: 0 })).flatCount).toBe(0);
  });

  it("skips a finger whose joints are coincident rather than scoring it flat", () => {
    const lm = hand(); // every point identical -> angleDeg returns NaN
    const { angles, fault } = checkFlatFingers(lm);
    expect(angles.every((a) => a === null)).toBe(true);
    expect(fault).toBe(false);
  });
});

describe("checkBackPosture", () => {
  const { LEFT_SHOULDER: LS, RIGHT_SHOULDER: RS, LEFT_HIP: LH, RIGHT_HIP: RH } = POSE_LANDMARK;

  it("does not fault an upright torso", () => {
    // shoulders directly above hips (y grows downward)
    const lm = pose({
      [LS]: { x: 0.4, y: 0.3 }, [RS]: { x: 0.6, y: 0.3 },
      [LH]: { x: 0.4, y: 0.7 }, [RH]: { x: 0.6, y: 0.7 },
    });
    const { fault, leanDeg } = checkBackPosture(lm);
    expect(leanDeg).toBeCloseTo(0, 5);
    expect(fault).toBe(false);
  });

  it("faults a torso leaning past the limit", () => {
    // shoulders shifted forward by the same amount as the torso height -> 45°
    const lm = pose({
      [LS]: { x: 0.8, y: 0.3 }, [RS]: { x: 1.0, y: 0.3 },
      [LH]: { x: 0.4, y: 0.7 }, [RH]: { x: 0.6, y: 0.7 },
    });
    const { fault, leanDeg } = checkBackPosture(lm);
    expect(leanDeg).toBeCloseTo(45, 5);
    expect(fault).toBe(true);
  });

  it("STAYS SILENT when the hips are occluded — the piano-bench case", () => {
    const lm = pose({
      [LS]: { x: 0.8, y: 0.3 }, [RS]: { x: 1.0, y: 0.3 },
      [LH]: { x: 0.4, y: 0.7, visibility: 0.1 },
      [RH]: { x: 0.6, y: 0.7, visibility: 0.1 },
    });
    // Geometrically this is a 45-degree lean, but the hips cannot be trusted.
    const { fault, leanDeg } = checkBackPosture(lm);
    expect(leanDeg).toBeNull();
    expect(fault).toBe(false);
  });

  it("returns no reading when hips are absent entirely", () => {
    const lm = pose({ [LS]: { x: 0.4, y: 0.3 }, [RS]: { x: 0.6, y: 0.3 } });
    lm[LH] = undefined;
    lm[RH] = undefined;
    expect(checkBackPosture(lm)).toEqual({ fault: false, leanDeg: null });
  });

  it("treats leaning back as a fault too, not just forward", () => {
    const lm = pose({
      [LS]: { x: 0.0, y: 0.3 }, [RS]: { x: 0.2, y: 0.3 },
      [LH]: { x: 0.4, y: 0.7 }, [RH]: { x: 0.6, y: 0.7 },
    });
    expect(checkBackPosture(lm).fault).toBe(true);
  });
});

describe("checkSideView", () => {
  const { LEFT_SHOULDER: LS, RIGHT_SHOULDER: RS, LEFT_ELBOW: LE, RIGHT_ELBOW: RE } = POSE_LANDMARK;

  it("accepts a true side view — the far shoulder hides behind the near one", () => {
    const lm = pose({
      [LS]: { x: 0.50, y: 0.30 }, [RS]: { x: 0.52, y: 0.30 }, // gap 0.02
      [LE]: { x: 0.50, y: 0.50 }, [RE]: { x: 0.52, y: 0.50 }, // arm 0.20
    });
    const { isSideView, ratio } = checkSideView(lm);
    expect(ratio).toBeCloseTo(0.1, 5);
    expect(isSideView).toBe(true);
  });

  it("rejects a 3/4 view — shoulders splay apart", () => {
    const lm = pose({
      [LS]: { x: 0.35, y: 0.30 }, [RS]: { x: 0.65, y: 0.30 }, // gap 0.30
      [LE]: { x: 0.35, y: 0.50 }, [RE]: { x: 0.65, y: 0.50 }, // arm 0.20
    });
    const { isSideView, ratio } = checkSideView(lm);
    expect(ratio).toBeCloseTo(1.5, 5);
    expect(isSideView).toBe(false);
  });

  it("is INDEPENDENT of distance from the camera", () => {
    // Same pose, uniformly scaled by 0.5 (player sits further back).
    const near = pose({
      [LS]: { x: 0.40, y: 0.30 }, [RS]: { x: 0.60, y: 0.30 },
      [LE]: { x: 0.40, y: 0.70 }, [RE]: { x: 0.60, y: 0.70 },
    });
    const far = pose({
      [LS]: { x: 0.45, y: 0.40 }, [RS]: { x: 0.55, y: 0.40 },
      [LE]: { x: 0.45, y: 0.60 }, [RE]: { x: 0.55, y: 0.60 },
    });
    expect(checkSideView(near).ratio).toBeCloseTo(checkSideView(far).ratio, 5);
  });

  it("returns no reading when shoulders are not visible", () => {
    const lm = pose({
      [LS]: { x: 0.5, y: 0.3, visibility: 0.1 },
      [RS]: { x: 0.52, y: 0.3, visibility: 0.1 },
    });
    expect(checkSideView(lm)).toEqual({ isSideView: false, ratio: null });
  });

  it("returns no reading when neither arm gives a usable scale reference", () => {
    const lm = pose({
      [LS]: { x: 0.5, y: 0.3 }, [RS]: { x: 0.52, y: 0.3 },
      [LE]: { x: 0.5, y: 0.3 }, [RE]: { x: 0.52, y: 0.3 }, // zero-length arms
    });
    expect(checkSideView(lm).ratio).toBeNull();
  });
});
