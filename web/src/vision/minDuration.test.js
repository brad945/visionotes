// minDuration.test.js — a fault must PERSIST to count.
//
// The 7-frame smoothing window only kills single-frame flicker (~0.2s). It does
// not help with faults whose "bad" shape is a normal part of playing: you cannot
// play with permanently curved fingers, so reaching an octave or crossing the
// thumb flattens the hand for a moment. Those moments must not become faults.

import { describe, it, expect } from "vitest";
import { FaultSmoother, MIN_FAULT_DURATION_MS } from "./faults";

// Drive a smoother past its smoothing window so `active` latches, then release.
// Returns the harvested periods.
function runFault(faultType, { holdMs, window = 7 }) {
  const s = new FaultSmoother(window);
  let t = 0;
  // Fill the window with `true` so the fault becomes active.
  for (let i = 0; i < window; i++) s.push("L", true, faultType, "left", t++);
  // Hold it for the requested duration.
  const startedAt = t - 1;
  t = startedAt + holdMs;
  s.push("L", true, faultType, "left", t);
  // Release: fill the window with `false` so it deactivates and closes.
  for (let i = 0; i < window; i++) s.push("L", false, faultType, "left", ++t);
  return s.harvest();
}

describe("flat fingers must persist to count", () => {
  it("ignores a brief flat-finger moment — reaching for an octave", () => {
    expect(runFault("flat_fingers", { holdMs: 300 })).toEqual([]);
  });

  it("ignores one just under the threshold", () => {
    const periods = runFault("flat_fingers", { holdMs: MIN_FAULT_DURATION_MS.flat_fingers - 50 });
    expect(periods).toEqual([]);
  });

  it("records a sustained collapsed arch", () => {
    const periods = runFault("flat_fingers", { holdMs: 2000 });
    expect(periods).toHaveLength(1);
    expect(periods[0].fault_type).toBe("flat_fingers");
    expect(periods[0].value).toBeGreaterThanOrEqual(MIN_FAULT_DURATION_MS.flat_fingers);
  });
});

describe("back posture must persist to count", () => {
  it("ignores a brief lean — reaching the far end of the keyboard", () => {
    expect(runFault("back_posture", { holdMs: 800 })).toEqual([]);
  });

  it("records a sustained slouch", () => {
    expect(runFault("back_posture", { holdMs: 3000 })).toHaveLength(1);
  });
});

describe("existing fault types are unchanged", () => {
  it("still records a short collapsed wrist — no minimum applies", () => {
    const periods = runFault("collapsed_wrist", { holdMs: 100 });
    expect(periods).toHaveLength(1);
  });

  it("still records a short arm-posture fault", () => {
    expect(runFault("arm_posture", { holdMs: 100 })).toHaveLength(1);
  });
});

describe("the minimum also applies when a session ends mid-fault", () => {
  it("drops a too-brief open period on finalize", () => {
    const s = new FaultSmoother(7);
    let t = 0;
    for (let i = 0; i < 7; i++) s.push("L", true, "flat_fingers", "left", t++);
    s.finalize(t + 100); // still flat, but only briefly
    expect(s.harvest()).toEqual([]);
  });

  it("keeps a long-enough open period on finalize", () => {
    const s = new FaultSmoother(7);
    let t = 0;
    for (let i = 0; i < 7; i++) s.push("L", true, "flat_fingers", "left", t++);
    s.finalize(t + 5000);
    expect(s.harvest()).toHaveLength(1);
  });
});

describe("the live panel agrees with what gets recorded", () => {
  it("hides an open flat-finger period until it passes the minimum", () => {
    const s = new FaultSmoother(7);
    let t = 0;
    for (let i = 0; i < 7; i++) s.push("L", true, "flat_fingers", "left", t++);
    const startMs = t - 1;

    // Early: nothing shown, because nothing would be recorded either.
    expect(s.snapshot(startMs + 200)).toEqual([]);
    // Past the threshold: now it is real.
    expect(s.snapshot(startMs + MIN_FAULT_DURATION_MS.flat_fingers + 10)).toHaveLength(1);
  });
});
