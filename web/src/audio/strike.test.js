import { describe, it, expect } from "vitest";
import {
  strikeAt,
  strikeEnvelope,
  SONG_PRESS,
  SONG_LIFT,
  SONG_SETTLE,
} from "./strike";

/**
 * The strike envelope had no direct coverage for its entire life, because it was
 * a private const inside a 1400-line canvas component. Both bugs it shipped with
 * — the overlap collapse and the short-note discontinuity — are asserted here.
 */

const sampleContinuity = (fn, from, to, steps = 4000) => {
  let worst = 0;
  let at = from;
  let prev = fn(from);
  for (let i = 1; i <= steps; i++) {
    const t = from + ((to - from) * i) / steps;
    const v = fn(t);
    const jump = Math.abs(v - prev);
    if (jump > worst) {
      worst = jump;
      at = t;
    }
    prev = v;
  }
  return { worst, at };
};

describe("strikeEnvelope", () => {
  it("is silent before the note starts", () => {
    expect(strikeEnvelope(-0.001, 1)).toBe(0);
    expect(strikeEnvelope(-10, 1)).toBe(0);
  });

  it("presses from 0 to full over SONG_PRESS", () => {
    expect(strikeEnvelope(0, 1)).toBe(0);
    expect(strikeEnvelope(SONG_PRESS / 2, 1)).toBeCloseTo(0.5, 6);
    expect(strikeEnvelope(SONG_PRESS * 0.999, 1)).toBeCloseTo(0.999, 3);
  });

  it("stays down for the whole time the note sounds", () => {
    // The behaviour the hold was introduced for: a finger must not blip.
    const held = 1.2;
    for (let dt = SONG_PRESS; dt < held; dt += 0.01) {
      expect(strikeEnvelope(dt, held)).toBeGreaterThanOrEqual(0.7);
    }
  });

  it("settles under weight rather than staying pinned at full depth", () => {
    const held = 2;
    const early = strikeEnvelope(SONG_PRESS + 0.001, held);
    const late = strikeEnvelope(SONG_PRESS + SONG_SETTLE + 0.5, held);
    expect(early).toBeGreaterThan(late);
    expect(late).toBeCloseTo(0.75, 2);
  });

  it("reaches exactly zero at held + SONG_LIFT and stays there", () => {
    const held = 0.8;
    expect(strikeEnvelope(held + SONG_LIFT, held)).toBe(0);
    expect(strikeEnvelope(held + SONG_LIFT + 5, held)).toBe(0);
  });

  it("is continuous across the whole envelope for a normal note", () => {
    const held = 1.0;
    const { worst } = sampleContinuity((t) => strikeEnvelope(t, held), -0.1, held + SONG_LIFT + 0.1);
    expect(worst).toBeLessThan(0.01);
  });

  it("is continuous for a note SHORTER than the press time", () => {
    // Regression: the release used to start from the level a FULL press would
    // have reached, not the level this press actually reached, so a short note
    // jumped. Measured at held=0 it dropped 0.31 in one frame.
    for (const held of [0, 0.001, 0.01, SONG_PRESS / 2, SONG_PRESS]) {
      const { worst, at } = sampleContinuity(
        (t) => strikeEnvelope(t, held),
        -0.05,
        held + SONG_LIFT + 0.05,
      );
      expect({ held, jump: worst > 0.02, at: worst > 0.02 ? at : null })
        .toEqual({ held, jump: false, at: null });
    }
  });

  it("never exceeds 1 or drops below 0 for any duration", () => {
    for (const held of [0, 0.01, 0.05, 0.3, 1, 4]) {
      for (let dt = -0.2; dt < held + 1; dt += 0.005) {
        const v = strikeEnvelope(dt, held);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });

  it("presses a short note less deeply than a long one", () => {
    // A grace note should not slam the key as hard as a held one.
    const shallow = Math.max(...[0.01, 0.02, 0.03].map((dt) => strikeEnvelope(dt, 0.02)));
    const deep = strikeEnvelope(SONG_PRESS, 1);
    expect(shallow).toBeLessThan(deep);
  });
});

describe("strikeAt", () => {
  it("returns 0 for no spans", () => {
    expect(strikeAt(null, 1)).toBe(0);
    expect(strikeAt([], 1)).toBe(0);
  });

  it("returns 0 before the first onset", () => {
    expect(strikeAt([[1, 0.5]], 0.999)).toBe(0);
  });

  it("does NOT collapse when two spans overlap", () => {
    // The exact regression, with the measured numbers: selecting only the
    // last-started span gave 0.75 at t=0.399 and 0.00 at t=0.400.
    const spans = [
      [0, 1],
      [0.4, 0.2],
    ];
    expect(strikeAt(spans, 0.399)).toBeGreaterThan(0.6);
    expect(strikeAt(spans, 0.4)).toBeGreaterThan(0.6);
    expect(strikeAt(spans, 0.401)).toBeGreaterThan(0.6);
  });

  it("holds an overlapped note for its full length instead of lifting early", () => {
    // The first note runs to t=1.0; the old code went silent from t=0.76.
    const spans = [
      [0, 1],
      [0.4, 0.2],
    ];
    for (let t = 0.76; t < 1.0; t += 0.01) {
      expect(strikeAt(spans, t)).toBeGreaterThan(0.5);
    }
  });

  it("is continuous across an overlapping pair", () => {
    const spans = [
      [0, 1],
      [0.4, 0.2],
      [0.9, 0.6],
    ];
    const { worst } = sampleContinuity((t) => strikeAt(spans, t), -0.1, 2.0, 8000);
    expect(worst).toBeLessThan(0.01);
  });

  it("takes the deepest of several live spans", () => {
    const spans = [
      [0, 3],
      [1, 1],
    ];
    // at t just after 1, the fresh press is at full depth while the old one has settled
    expect(strikeAt(spans, 1 + SONG_PRESS)).toBeGreaterThan(strikeAt(spans, 0.99));
  });

  it("is silent well after every span has released", () => {
    const spans = [
      [0, 1],
      [0.4, 0.2],
    ];
    expect(strikeAt(spans, 5)).toBe(0);
  });

  it("handles a backward seek without stale state", () => {
    // The draw loop can jump backwards when the user scrubs the progress bar.
    const spans = [
      [0, 0.5],
      [2, 0.5],
    ];
    const forward = [0.2, 2.2, 0.2].map((t) => strikeAt(spans, t));
    expect(forward[0]).toBe(forward[2]); // pure function of t, no memory
  });
});
