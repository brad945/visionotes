// faults.test.js — vitest suite for the pure fault-detection geometry.
// ---------------------------------------------------------------------------
// Asserts against the REAL detector behavior (4-knuckle line, 0.04 threshold,
// 70–160° elbow window, visibility gate, {fault, elbowAngle} shape) plus the
// three deliberate hardening contracts (epsilon boundary, NaN-degenerate angle,
// safe missing-landmark handling).
//
// What's worth testing here:
//   - HAPPY path: clearly-collapsed wrist / locked elbow flag; clean ones don't.
//   - BOUNDARY: exactly at tolerance must NOT flag (epsilon guard); just past must.
//   - DEGENERATE: missing/invisible/coincident landmarks return safely, no throw.
//
// Run:  npm test   (vitest run)
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import {
  isWristCollapsed,
  knuckleLineY,
  angleDeg,
  checkArmPosture,
  HAND_LANDMARK,
  ARM_INDICES,
} from "./faults.js";

// --- helpers to build minimal valid landmark arrays --------------------------

// Build a 21-length hand-landmark array, overriding wrist + all FOUR knuckles
// (the real detector averages index/middle/ring/pinky MCP, not just two).
function makeHand({ wristY, knuckleY }) {
  const lm = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
  lm[HAND_LANDMARK.WRIST] = { x: 0.5, y: wristY, z: 0 };
  for (const i of [HAND_LANDMARK.INDEX_MCP, HAND_LANDMARK.MIDDLE_MCP, HAND_LANDMARK.RING_MCP, HAND_LANDMARK.PINKY_MCP]) {
    lm[i] = { x: 0.5, y: knuckleY, z: 0 };
  }
  return lm;
}

// Build a 33-length pose array; place one arm's shoulder/elbow/wrist.
function makeArm(side, { shoulder, elbow, wrist }) {
  const lm = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 1 }));
  const idx = ARM_INDICES[side];
  lm[idx.shoulder] = { visibility: 1, ...shoulder };
  lm[idx.elbow] = { visibility: 1, ...elbow };
  lm[idx.wrist] = { visibility: 1, ...wrist };
  return lm;
}

// ---------------------------------------------------------------------------

describe("knuckleLineY", () => {
  it("averages the four knuckle y-values", () => {
    const lm = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
    lm[HAND_LANDMARK.INDEX_MCP] = { y: 0.40 };
    lm[HAND_LANDMARK.MIDDLE_MCP] = { y: 0.50 };
    lm[HAND_LANDMARK.RING_MCP] = { y: 0.50 };
    lm[HAND_LANDMARK.PINKY_MCP] = { y: 0.60 };
    expect(knuckleLineY(lm)).toBeCloseTo(0.5, 5);
  });
});

describe("isWristCollapsed", () => {
  it("does NOT flag a healthy wrist sitting above the knuckle line", () => {
    expect(isWristCollapsed(makeHand({ wristY: 0.40, knuckleY: 0.50 }))).toBe(false);
  });

  it("flags a clearly collapsed wrist dropping well below the knuckles", () => {
    expect(isWristCollapsed(makeHand({ wristY: 0.70, knuckleY: 0.50 }))).toBe(true);
  });

  it("does NOT flag exactly at the tolerance boundary (epsilon guard)", () => {
    // 0.54 - 0.50 === 0.040000000000000036 in IEEE-754, which naively trips the
    // exact-0.04 threshold. The epsilon guard must hold this OFF.
    expect(isWristCollapsed(makeHand({ wristY: 0.54, knuckleY: 0.50 }), 0.04)).toBe(false);
  });

  it("flags just past the tolerance boundary", () => {
    expect(isWristCollapsed(makeHand({ wristY: 0.541, knuckleY: 0.50 }), 0.04)).toBe(true);
  });

  it("respects a custom (looser) tolerance", () => {
    const hand = makeHand({ wristY: 0.58, knuckleY: 0.50 }); // drop = 0.08
    expect(isWristCollapsed(hand, 0.04)).toBe(true);
    expect(isWristCollapsed(hand, 0.10)).toBe(false);
  });

  it("returns false (no throw) on a missing / too-short landmark array", () => {
    expect(isWristCollapsed(null)).toBe(false);
    expect(isWristCollapsed([])).toBe(false);
    expect(isWristCollapsed([{ x: 0, y: 0 }])).toBe(false);
  });
});

describe("angleDeg", () => {
  it("computes a right angle as 90 degrees", () => {
    expect(angleDeg({ x: 0, y: 1 }, { x: 0, y: 0 }, { x: 1, y: 0 })).toBeCloseTo(90, 4);
  });

  it("computes a straight line as 180 degrees", () => {
    expect(angleDeg({ x: -1, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 })).toBeCloseTo(180, 4);
  });

  it("returns NaN for a coincident joint instead of a meaningless angle", () => {
    const p = { x: 0.5, y: 0.5 };
    expect(Number.isNaN(angleDeg(p, p, p))).toBe(true);
  });
});

describe("checkArmPosture", () => {
  it("flags a locked-out (too straight) elbow", () => {
    const pose = makeArm("right", {
      shoulder: { x: 0.0, y: 0.5 },
      elbow: { x: 0.5, y: 0.5 },
      wrist: { x: 1.0, y: 0.5 }, // ~180°
    });
    const { fault, elbowAngle } = checkArmPosture(pose, "right");
    expect(elbowAngle).toBeCloseTo(180, 1);
    expect(fault).toBe(true);
  });

  it("does NOT flag a relaxed mid-range elbow", () => {
    const pose = makeArm("right", {
      shoulder: { x: 0.0, y: 0.5 },
      elbow: { x: 0.5, y: 0.5 },
      wrist: { x: 0.5, y: 1.0 }, // ~90°
    });
    expect(checkArmPosture(pose, "right").fault).toBe(false);
  });

  it("flags a cramped (too acute) elbow", () => {
    const pose = makeArm("left", {
      shoulder: { x: 0.5, y: 0.40 },
      elbow: { x: 0.5, y: 0.50 },
      wrist: { x: 0.55, y: 0.41 }, // folds back up -> very acute
    });
    const { fault, elbowAngle } = checkArmPosture(pose, "left");
    expect(elbowAngle).toBeLessThan(70);
    expect(fault).toBe(true);
  });

  it("returns a safe null reading when arm landmarks are missing", () => {
    const pose = Array.from({ length: 33 }, () => undefined);
    expect(checkArmPosture(pose, "right")).toEqual({ fault: false, elbowAngle: null });
  });

  it("returns a safe null reading when arm landmarks are not visible enough", () => {
    const pose = makeArm("right", {
      shoulder: { x: 0.0, y: 0.5, visibility: 0.1 },
      elbow: { x: 0.5, y: 0.5, visibility: 0.1 },
      wrist: { x: 1.0, y: 0.5, visibility: 0.1 },
    });
    expect(checkArmPosture(pose, "right")).toEqual({ fault: false, elbowAngle: null });
  });

  it("returns a safe null reading for a coincident (degenerate) joint", () => {
    const p = { x: 0.5, y: 0.5, visibility: 1 };
    const pose = makeArm("right", { shoulder: p, elbow: p, wrist: p });
    expect(checkArmPosture(pose, "right")).toEqual({ fault: false, elbowAngle: null });
  });
});
