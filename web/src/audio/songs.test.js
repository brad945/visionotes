import { describe, it, expect } from "vitest";
import { SONGS, compileSong } from "./songs";

describe("compileSong", () => {
  for (const song of SONGS) {
    describe(song.id, () => {
      const c = compileSong(song);
      const left = c.notes.filter((n) => n.hand === "L");
      const right = c.notes.filter((n) => n.hand === "R");

      it("converts unit times to seconds and keeps them sorted", () => {
        expect(c.notes.length).toBe(song.notes.length);
        for (let i = 1; i < c.notes.length; i++) {
          expect(c.notes[i].t).toBeGreaterThanOrEqual(c.notes[i - 1].t);
        }
      });

      it("tags every note as exactly one hand", () => {
        for (const n of c.notes) expect(["L", "R"]).toContain(n.hand);
        expect(left.length + right.length).toBe(c.notes.length);
      });

      it("has a left-hand part worth watching and a melody to hear", () => {
        expect(left.length).toBeGreaterThan(4);
        expect(right.length).toBeGreaterThan(4);
      });

      it("gives every left-hand note a finger the hand actually has", () => {
        for (const n of left) {
          expect(Number.isInteger(n.finger)).toBe(true);
          expect(n.finger).toBeGreaterThanOrEqual(0);
          expect(n.finger).toBeLessThanOrEqual(4);
        }
      });

      it("drives no finger from the right hand", () => {
        // The melody sounds but there is no second hand to render it.
        for (const n of right) expect(n.finger).toBeNull();
        const strikes = c.strikeTimes.flat().length;
        expect(strikes).toBe(left.length);
      });

      it("never asks one finger to strike two keys at once", () => {
        for (const ev of c.events) {
          expect(new Set(ev.f).size).toBe(ev.f.length);
          expect(ev.f.length).toBeLessThanOrEqual(5);
        }
      });

      it("centres lat on the middle finger and keeps it in range", () => {
        for (const ev of c.events) {
          const mean = ev.f.reduce((s, x) => s + x, 0) / ev.f.length;
          expect(ev.lat).toBeCloseTo(mean - 2, 6);
          expect(Math.abs(ev.lat)).toBeLessThanOrEqual(2);
        }
      });

      it("indexes the left hand into sorted per-finger strike lists", () => {
        expect(c.strikeTimes).toHaveLength(5);
        for (const arr of c.strikeTimes) {
          for (let i = 1; i < arr.length; i++) {
            expect(arr[i]).toBeGreaterThanOrEqual(arr[i - 1]);
          }
        }
      });

      it("lets the final note ring out before the piece ends", () => {
        const last = c.notes[c.notes.length - 1];
        expect(c.duration).toBeGreaterThan(last.t + last.dur);
      });

      it("spreads fingers across the range rather than collapsing to one", () => {
        expect(new Set(left.map((n) => n.finger)).size).toBeGreaterThanOrEqual(3);
      });
    });
  }

  it("never repeats a finger across a pitch change in a single line", () => {
    // Chords are exempt — they get contiguous fingers by construction — but a
    // melodic line must visibly alternate.
    for (const song of SONGS) {
      const c = compileSong(song);
      const solo = c.events.filter((e) => e.f.length === 1);
      for (let i = 1; i < solo.length; i++) {
        const prev = solo[i - 1];
        const cur = solo[i];
        // only compare events that are genuinely consecutive in the left hand
        if (c.events.indexOf(cur) - c.events.indexOf(prev) !== 1) continue;
        const prevMidi = midiOf(c, prev);
        const curMidi = midiOf(c, cur);
        if (curMidi !== prevMidi) expect(cur.f[0]).not.toBe(prev.f[0]);
      }
    }
  });

  it("plays real chords, not just a single line", () => {
    // The whole point of using left-hand parts: several fingers land together.
    const chordy = SONGS.filter((s) =>
      compileSong(s).events.some((e) => e.f.length >= 3),
    );
    expect(chordy.length).toBeGreaterThanOrEqual(2);
  });

  it("keeps the left hand below the melody", () => {
    // The visible hand sits at the bass end; if it outranged the melody the
    // whole left-hand conceit would read as wrong.
    for (const song of SONGS) {
      const c = compileSong(song);
      const left = c.notes.filter((n) => n.hand === "L");
      const right = c.notes.filter((n) => n.hand === "R");
      const leftMean = left.reduce((s, n) => s + n.midi, 0) / left.length;
      const rightMean = right.reduce((s, n) => s + n.midi, 0) / right.length;
      expect(leftMean).toBeLessThan(rightMean);
    }
  });
});

// events carry fingers, not pitches — recover the pitch for a solo event
function midiOf(compiled, ev) {
  const n = compiled.notes.find((x) => x.hand === "L" && Math.abs(x.t - ev.t) < 1e-9);
  return n ? n.midi : null;
}
