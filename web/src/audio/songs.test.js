import { describe, it, expect } from "vitest";
import { SONGS, compileSong } from "./songs";

// Fraction of the piece during which at least one finger is on a key. This is
// the number that broke: with onset-only strikes the hand blipped for ~0.28s
// every ~0.8s, so it sat frozen ~70% of the time while the melody played on.
function coverage(c) {
  const spans = c.strikeSpans.flat().sort((a, b) => a[0] - b[0]);
  let covered = 0;
  let end = -1;
  for (const [t, dur] of spans) {
    const stop = t + dur;
    if (t > end) {
      covered += dur;
      end = stop;
    } else if (stop > end) {
      covered += stop - end;
      end = stop;
    }
  }
  return covered / c.duration;
}

// events carry fingers, not pitches — recover the pitch for a solo event
function midiOf(compiled, ev) {
  const n = compiled.notes.find((x) => x.hand === "L" && Math.abs(x.t - ev.t) < 1e-9);
  return n ? n.midi : null;
}

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
        const strikes = c.strikeSpans.reduce((s, a) => s + a.length, 0);
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

      it("indexes the left hand into sorted per-finger strike spans", () => {
        expect(c.strikeSpans).toHaveLength(5);
        for (const arr of c.strikeSpans) {
          for (let i = 1; i < arr.length; i++) {
            expect(arr[i][0]).toBeGreaterThanOrEqual(arr[i - 1][0]);
          }
        }
      });

      it("carries how long each note is held, not just when it starts", () => {
        // A finger must stay down for as long as its note sounds. With onsets
        // alone the envelope collapses to a fixed blip and the hand twitches then
        // freezes while the chord is still ringing — which reads as the animation
        // being out of sync with the audio.
        for (const arr of c.strikeSpans) {
          for (const span of arr) {
            expect(span).toHaveLength(2);
            expect(span[1]).toBeGreaterThan(0);
          }
        }
      });

      it("keeps the hand engaged for a real share of the piece", () => {
        expect(coverage(c)).toBeGreaterThan(0.3);
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

  it("keeps a hand on the keys almost continuously in the chordal pieces", () => {
    // Canon and Ode carry the block chords; if the hand is idle for most of
    // either, the left-hand conceit has stopped working.
    for (const id of ["canon-in-d", "ode-to-joy"]) {
      const c = compileSong(SONGS.find((s) => s.id === id));
      expect(coverage(c)).toBeGreaterThan(0.6);
    }
  });

  it("never repeats a finger across a pitch change in a single line", () => {
    // Chords are exempt — they get contiguous fingers by construction — but a
    // melodic line must visibly alternate.
    for (const song of SONGS) {
      const c = compileSong(song);
      const solo = c.events.filter((e) => e.f.length === 1);
      for (let i = 1; i < solo.length; i++) {
        const prev = solo[i - 1];
        const cur = solo[i];
        if (c.events.indexOf(cur) - c.events.indexOf(prev) !== 1) continue;
        const prevMidi = midiOf(c, prev);
        const curMidi = midiOf(c, cur);
        if (curMidi !== prevMidi) expect(cur.f[0]).not.toBe(prev.f[0]);
      }
    }
  });

  it("plays real chords, not just a single line", () => {
    const chordy = SONGS.filter((s) =>
      compileSong(s).events.some((e) => e.f.length >= 3),
    );
    expect(chordy.length).toBeGreaterThanOrEqual(2);
  });

  it("keeps the left hand below the melody", () => {
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
