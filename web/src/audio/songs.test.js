import { describe, it, expect } from "vitest";
import { SONGS, compileSong } from "./songs";

describe("compileSong", () => {
  for (const song of SONGS) {
    describe(song.id, () => {
      const c = compileSong(song);

      it("converts unit times to seconds and keeps them sorted", () => {
        expect(c.notes.length).toBe(song.notes.length);
        for (let i = 1; i < c.notes.length; i++) {
          expect(c.notes[i].t).toBeGreaterThanOrEqual(c.notes[i - 1].t);
        }
        // first authored note maps to unit * step
        const [unit] = song.notes[0];
        expect(c.notes[0].t).toBeCloseTo(unit * song.step, 6);
      });

      it("assigns every note a finger the hand actually has", () => {
        for (const n of c.notes) {
          expect(Number.isInteger(n.finger)).toBe(true);
          expect(n.finger).toBeGreaterThanOrEqual(0);
          expect(n.finger).toBeLessThanOrEqual(4);
        }
      });

      it("never repeats a finger across a pitch change", () => {
        // A real player alternates fingers on a trill; the rank mapping alone
        // would land Für Elise's E–D# on one finger, so compileSong nudges.
        for (let i = 1; i < c.notes.length; i++) {
          const prev = c.notes[i - 1];
          const cur = c.notes[i];
          if (cur.midi !== prev.midi) expect(cur.finger).not.toBe(prev.finger);
        }
      });

      it("groups simultaneous notes into events with a centred lat", () => {
        for (const ev of c.events) {
          expect(ev.f.length).toBeGreaterThan(0);
          const mean = ev.f.reduce((s, x) => s + x, 0) / ev.f.length;
          expect(ev.lat).toBeCloseTo(mean - 2, 6);
          // lat drives lateral drift; must stay inside the ±2 finger span
          expect(Math.abs(ev.lat)).toBeLessThanOrEqual(2);
        }
        expect(c.events.length).toBeLessThanOrEqual(c.notes.length);
      });

      it("indexes every note into a sorted per-finger strike list", () => {
        const total = c.strikeTimes.reduce((s, a) => s + a.length, 0);
        expect(total).toBe(c.notes.length);
        expect(c.strikeTimes).toHaveLength(5);
        for (const arr of c.strikeTimes) {
          for (let i = 1; i < arr.length; i++) {
            expect(arr[i]).toBeGreaterThanOrEqual(arr[i - 1]);
          }
        }
      });

      it("lets the final note ring out before the song ends", () => {
        const last = c.notes[c.notes.length - 1];
        expect(c.duration).toBeGreaterThan(last.t + last.dur);
      });
    });
  }

  it("spreads fingers across the range rather than collapsing to one", () => {
    // Guards the pitch→finger rank mapping: a bug that clamped everything to a
    // single finger would still pass the per-note range check above.
    for (const song of SONGS) {
      const used = new Set(compileSong(song).notes.map((n) => n.finger));
      expect(used.size).toBeGreaterThanOrEqual(3);
    }
  });

  it("moves the hand in the direction the melody moves", () => {
    // Contour check: a big upward leap must not drift the hand left.
    const c = compileSong(SONGS.find((s) => s.id === "ode-to-joy"));
    const byT = new Map(c.events.map((e) => [e.t.toFixed(4), e]));
    const at = (unit) => byT.get((unit * 0.42).toFixed(4));
    // C4 (unit 8) is the lowest note; G4 (unit 3) is near the top
    expect(at(3).lat).toBeGreaterThan(at(8).lat);
  });
});
