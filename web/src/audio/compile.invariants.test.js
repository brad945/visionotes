import { describe, it, expect } from "vitest";
import { SONGS, compileSong } from "./songs";
import { keyId } from "./pianoKeys";

/**
 * Invariants the CONSUMERS depend on.
 *
 * The existing suite checks properties of compileSong's output in isolation.
 * These check the contracts HeroField and the player actually rely on — the
 * ones whose violation shows up as a visual glitch rather than a failed
 * assertion, and which therefore went unnoticed.
 */

const song = (id) => SONGS.find((s) => s.id === id);

const fixture = (notes, id = "fixture") => ({
  id,
  title: id,
  composer: "test",
  step: 0.25,
  notes,
});

describe("compile invariants", () => {
  for (const s of SONGS) {
    describe(s.id, () => {
      const c = compileSong(s);
      const left = c.notes.filter((n) => n.hand === "L");

      it("never asks one finger to hold two notes at once", () => {
        // strikeAt tolerates overlap now, but on ONE finger it means the hand was
        // told to hold two keys with the same digit — a fingering bug, not a
        // rendering one.
        for (let f = 0; f < 5; f++) {
          const spans = c.strikeSpans[f];
          for (let i = 1; i < spans.length; i++) {
            const prevEnd = spans[i - 1][0] + spans[i - 1][1];
            expect({ finger: f, overlap: spans[i][0] < prevEnd - 1e-9 })
              .toEqual({ finger: f, overlap: false });
          }
        }
      });

      it("agrees between events and strikeSpans", () => {
        // Both are derived from the same notes; a mismatch means the hand's pose
        // and its strike timing disagree about what is being played.
        const fromEvents = [];
        for (const ev of c.events) for (const f of ev.f) fromEvents.push(`${f}@${ev.t.toFixed(4)}`);
        const fromSpans = [];
        c.strikeSpans.forEach((spans, f) =>
          spans.forEach(([t]) => fromSpans.push(`${f}@${t.toFixed(4)}`)),
        );
        expect(fromSpans.sort()).toEqual(fromEvents.sort());
      });

      it("agrees between keys and the left-hand notes", () => {
        const fromKeys = [];
        for (const k of c.keys) for (const [t] of k.spans) fromKeys.push(`${keyId(k)}@${t.toFixed(4)}`);
        const fromNotes = c.notes
          .filter((n) => n.hand === "L")
          .map((n) => `${keyId(n.key)}@${n.t.toFixed(4)}`);
        expect(fromKeys.sort()).toEqual(fromNotes.sort());
      });

      it("gives every event the key and finger the hand should aim at", () => {
        // These were silently undefined for a whole revision: events were built
        // BEFORE n.key was assigned, so `aimKey` was always missing and the
        // renderer fell back to the old +/-26px drift. The hand simply never
        // travelled, and nothing failed — the feature was inert, not broken.
        for (const ev of c.events) {
          expect(ev.aimKey, `event at t=${ev.t} has no aimKey`).toBeTruthy();
          expect(typeof ev.aimKey.white).toBe("number");
          expect(typeof ev.aimKey.black).toBe("boolean");
          expect(ev.f).toContain(ev.aimFinger);
        }
      });

      it("anchors travel on a real key", () => {
        expect(c.aimRef).toBeTruthy();
        const lowest = Math.min(...left.map((n) => n.key.white));
        expect(c.aimRef.white).toBe(lowest);
      });

      it("aims at the lowest note of a chord", () => {
        for (const ev of c.events) {
          const atT = left.filter((n) => Math.abs(n.t - ev.t) < 1e-9);
          const lowest = atT.reduce((lo, n) => (n.midi < lo.midi ? n : lo), atT[0]);
          expect(ev.aimKey.white).toBe(lowest.key.white);
        }
      });

      it("has a duration that outlasts every note", () => {
        for (const n of c.notes) expect(c.duration).toBeGreaterThan(n.t + n.dur);
      });

      it("keeps events in chronological order", () => {
        for (let i = 1; i < c.events.length; i++) {
          expect(c.events[i].t).toBeGreaterThan(c.events[i - 1].t);
        }
      });
    });
  }

  it("rejects a zero-length note instead of rendering a discontinuous strike", () => {
    expect(() => compileSong(fixture([[0, 60, 0, "L"], [1, 64, 1, "R"]]))).toThrow(/duration/);
  });

  it("rejects a negative-length note", () => {
    expect(() => compileSong(fixture([[0, 60, -2, "L"], [1, 64, 1, "R"]]))).toThrow(/duration/);
  });

  it("survives a left hand with a single repeated pitch", () => {
    // Degenerate range: hi === lo, so the rank map divides by a zero span.
    const c = compileSong(fixture([[0, 48, 1, "L"], [2, 48, 1, "L"], [0, 72, 1, "R"]]));
    const left = c.notes.filter((n) => n.hand === "L");
    for (const n of left) {
      expect(Number.isInteger(n.finger)).toBe(true);
      expect(n.finger).toBeGreaterThanOrEqual(0);
      expect(n.finger).toBeLessThanOrEqual(4);
    }
    expect(c.keys.length).toBe(1); // one pitch, one key
  });

  it("survives a song with no left hand at all", () => {
    const c = compileSong(fixture([[0, 72, 1, "R"], [1, 74, 1, "R"]]));
    expect(c.events).toEqual([]);
    expect(c.keys).toEqual([]);
    expect(c.strikeSpans.every((a) => a.length === 0)).toBe(true);
    expect(c.duration).toBeGreaterThan(0);
  });

  it("keeps a chord of more than five notes to five distinct fingers", () => {
    const c = compileSong(
      fixture([
        [0, 40, 2, "L"], [0, 44, 2, "L"], [0, 47, 2, "L"],
        [0, 52, 2, "L"], [0, 55, 2, "L"], [0, 59, 2, "L"],
        [0, 72, 2, "R"],
      ]),
    );
    for (const ev of c.events) {
      expect(ev.f.length).toBeLessThanOrEqual(5);
      expect(new Set(ev.f).size).toBe(ev.f.length);
    }
  });

  it("exercises the alternation nudge on a run inside one rank bin", () => {
    // Dead code on both shipped pieces, so it needs a fixture to run at all.
    const c = compileSong(
      fixture([
        [0, 36, 1, "L"], [1, 60, 1, "L"], [2, 61, 1, "L"], [3, 62, 1, "L"], [4, 84, 1, "L"],
        [0, 96, 1, "R"],
      ]),
    );
    const solo = c.events.filter((e) => e.f.length === 1);
    for (let i = 1; i < solo.length; i++) {
      expect(solo[i].f[0]).not.toBe(solo[i - 1].f[0]);
    }
  });

  it("fingers the left hand pinky-low across a wide range", () => {
    // The handedness convention, pinned in one place. FINGERS is
    // [thumb, index, middle, ring, pinky], so low pitch -> HIGH index.
    const c = compileSong(
      fixture([[0, 36, 1, "L"], [1, 48, 1, "L"], [2, 60, 1, "L"], [3, 96, 1, "R"]]),
    );
    const left = c.notes.filter((n) => n.hand === "L").sort((a, b) => a.midi - b.midi);
    for (let i = 1; i < left.length; i++) {
      expect(left[i].finger).toBeLessThan(left[i - 1].finger);
    }
  });

  it("gives Für Elise's two arpeggios the same shape on the keyboard", () => {
    // A-minor (A2 E3 A3) and E-major (E2 E3 G#3) alternate bar by bar. Whatever
    // the fingering, each must run upward on the keys — a descending key sequence
    // would mean the hand appeared to play the figure backwards.
    const c = compileSong(song("fur-elise"));
    const byTime = new Map();
    for (const n of c.notes.filter((x) => x.hand === "L")) {
      const bar = Math.floor(n.t / (6 * 0.165));
      if (!byTime.has(bar)) byTime.set(bar, []);
      byTime.get(bar).push(n);
    }
    for (const [bar, group] of byTime) {
      if (group.length < 2) continue;
      const keys = group.sort((a, b) => a.t - b.t).map((n) => n.key.white);
      for (let i = 1; i < keys.length; i++) {
        expect({ bar, ascending: keys[i] >= keys[i - 1] }).toEqual({ bar, ascending: true });
      }
    }
  });
});
