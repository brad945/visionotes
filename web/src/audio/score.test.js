import { describe, it, expect } from "vitest";
import { SONGS } from "./songs";
import { FUR_ELISE_SCORE, PRELUDE_IN_C_SCORE } from "./__fixtures__/scores";

/**
 * SCORE FIDELITY — is the note data actually the piece?
 *
 * Every other test in this suite checks that compileSong is self-consistent.
 * None of them could catch data that is consistently WRONG, which is exactly
 * what shipped: Für Elise's left hand entered three sixteenths late and two
 * right-hand figures were missing outright. These tests compare against
 * independently transcribed ground truth instead of against ourselves.
 */

const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const noteName = (m) => `${NAMES[m % 12]}${Math.floor(m / 12) - 1}`;
const key = (n) => `${n[0]}|${n[1]}|${n[3]}`; // onset|midi|hand — duration compared separately
const describeNote = (n) => `${noteName(n[1])} ${n[3]} @${n[0]} (dur ${n[2]})`;

// songs.js authors in whatever subdivision suits the piece; the fixture is in
// sixteenths. Für Elise's unit IS a sixteenth; the Prelude's is too.
const CASES = [
  { id: "fur-elise", score: FUR_ELISE_SCORE, limit: Infinity },
  // songs.js implements the first four measures = 64 sixteenths
  { id: "prelude-in-c", score: PRELUDE_IN_C_SCORE, limit: 64 },
];

describe("score fidelity", () => {
  for (const { id, score, limit } of CASES) {
    describe(id, () => {
      const song = SONGS.find((s) => s.id === id);
      const actual = song.notes
        .filter((n) => n[0] < limit)
        .map((n) => [n[0], n[1], n[2], n[3]]);
      const expected = score.filter((n) => n[0] < limit);

      it("plays every note the score has, and no others", () => {
        const a = new Set(actual.map(key));
        const e = new Set(expected.map(key));
        const missing = expected.filter((n) => !a.has(key(n))).map(describeNote);
        const extra = actual.filter((n) => !e.has(key(n))).map(describeNote);
        expect({ missing, extra }).toEqual({ missing: [], extra: [] });
      });

      it("assigns every note to the hand the score assigns it to", () => {
        // The Für Elise bug in one assertion: the C4-E4-A4 and E4-G#4-B4 figures
        // are RIGHT hand. Putting them in the left displaces the real LH part.
        const byOnsetPitch = new Map(expected.map((n) => [`${n[0]}|${n[1]}`, n[3]]));
        const wrongHand = actual
          .filter((n) => {
            const want = byOnsetPitch.get(`${n[0]}|${n[1]}`);
            return want !== undefined && want !== n[3];
          })
          .map((n) => `${describeNote(n)} should be hand ${byOnsetPitch.get(`${n[0]}|${n[1]}`)}`);
        expect(wrongHand).toEqual([]);
      });

      it("holds every note for the notated duration", () => {
        const byKey = new Map(expected.map((n) => [key(n), n[2]]));
        const wrongDur = actual
          .filter((n) => byKey.has(key(n)) && byKey.get(key(n)) !== n[2])
          .map((n) => `${describeNote(n)} should last ${byKey.get(key(n))}`);
        expect(wrongDur).toEqual([]);
      });

      it("starts each hand on the beat the score starts it", () => {
        // The reported bug, stated directly: a hand entering late.
        for (const hand of ["L", "R"]) {
          const firstActual = Math.min(...actual.filter((n) => n[3] === hand).map((n) => n[0]));
          const firstExpected = Math.min(...expected.filter((n) => n[3] === hand).map((n) => n[0]));
          expect(`${hand} enters at ${firstActual}`).toBe(`${hand} enters at ${firstExpected}`);
        }
      });
    });
  }

  it("strikes the Für Elise left hand together with the melody's A4", () => {
    // The specific regression: in m2 the LH A2 and the RH A4 are struck on the
    // same downbeat. The shipped data had the LH three sixteenths behind.
    const song = SONGS.find((s) => s.id === "fur-elise");
    const at8 = song.notes.filter((n) => n[0] === 8);
    expect(at8.map((n) => `${noteName(n[1])}/${n[3]}`).sort()).toEqual(["A2/L", "A4/R"]);
  });

  it("never leaves the left hand idle for more than a bar while the melody plays", () => {
    // A late or dropped LH entry shows up as a long silent stretch under an
    // active melody. Für Elise is 3/8 (6 sixteenths); the Prelude 4/4 (16).
    const BAR = { "fur-elise": 6, "prelude-in-c": 16 };
    for (const { id, limit } of CASES) {
      const song = SONGS.find((s) => s.id === id);
      const left = song.notes.filter((n) => n[3] === "L" && n[0] < limit).map((n) => n[0]).sort((a, b) => a - b);
      const gaps = [];
      for (let i = 1; i < left.length; i++) {
        const gap = left[i] - left[i - 1];
        if (gap > BAR[id] * 2) gaps.push(`${left[i - 1]} -> ${left[i]}`);
      }
      expect({ id, gaps }).toEqual({ id, gaps: [] });
    }
  });
});
