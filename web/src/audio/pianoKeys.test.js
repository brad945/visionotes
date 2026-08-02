import { describe, it, expect } from "vitest";
import { midiToKey, whiteIndex, whiteSpan, keyId } from "./pianoKeys";
import { SONGS, compileSong } from "./songs";

const M = { C4: 60, "C#4": 61, D4: 62, "D#4": 63, E4: 64, F4: 65, "F#4": 66, G4: 67, "G#4": 68, A4: 69, "A#4": 70, B4: 71, C5: 72 };

describe("midiToKey", () => {
  it("puts the seven naturals of an octave on seven consecutive white keys", () => {
    const naturals = ["C4", "D4", "E4", "F4", "G4", "A4", "B4"].map((n) => midiToKey(M[n]));
    expect(naturals.map((k) => k.black)).toEqual([false, false, false, false, false, false, false]);
    const whites = naturals.map((k) => k.white);
    expect(whites).toEqual([whites[0], whites[0] + 1, whites[0] + 2, whites[0] + 3, whites[0] + 4, whites[0] + 5, whites[0] + 6]);
  });

  it("puts each accidental on the black key after its natural", () => {
    // C# sits after C, D# after D, F# after F, G# after G, A# after A.
    for (const [sharp, natural] of [["C#4", "C4"], ["D#4", "D4"], ["F#4", "F4"], ["G#4", "G4"], ["A#4", "A4"]]) {
      const s = midiToKey(M[sharp]);
      const n = midiToKey(M[natural]);
      expect({ sharp, black: s.black, white: s.white }).toEqual({ sharp, black: true, white: n.white });
    }
  });

  it("has no black key between E–F or B–C", () => {
    // The two places a real keyboard has adjacent whites.
    expect(whiteSpan(M.E4, M.F4)).toBe(1);
    expect(whiteSpan(M.B4, M.C5)).toBe(1);
    expect(midiToKey(M.E4).black).toBe(false);
    expect(midiToKey(M.F4).black).toBe(false);
  });

  it("advances exactly seven white keys per octave", () => {
    for (let midi = 21; midi <= 96; midi++) {
      expect(whiteIndex(midi + 12) - whiteIndex(midi)).toBe(7);
    }
  });

  it("is monotonic non-decreasing in pitch across the whole keyboard", () => {
    for (let midi = 21; midi < 108; midi++) {
      expect(whiteIndex(midi + 1)).toBeGreaterThanOrEqual(whiteIndex(midi));
    }
  });

  it("gives every distinct pitch in an octave a distinct key", () => {
    // Injective over the (white, black) pair — the property that makes "the right
    // key goes down" meaningful at all.
    const ids = new Set();
    for (let midi = 60; midi < 72; midi++) ids.add(keyId(midiToKey(midi)));
    expect(ids.size).toBe(12);
  });

  it("gives every distinct pitch across seven octaves a distinct key", () => {
    const ids = new Set();
    for (let midi = 21; midi <= 108; midi++) ids.add(keyId(midiToKey(midi)));
    expect(ids.size).toBe(108 - 21 + 1);
  });

  it("handles pitches below middle C without negative-modulo errors", () => {
    expect(() => midiToKey(0)).not.toThrow();
    expect(midiToKey(0)).toEqual({ white: 0, black: false });
    expect(whiteIndex(12) - whiteIndex(0)).toBe(7);
  });
});

describe("song key mapping", () => {
  for (const song of SONGS) {
    describe(song.id, () => {
      const c = compileSong(song);
      const left = c.notes.filter((n) => n.hand === "L");

      it("assigns a key to every left-hand note and none to the right", () => {
        for (const n of left) expect(n.key).toBeTruthy();
        for (const n of c.notes.filter((x) => x.hand === "R")) expect(n.key).toBeUndefined();
      });

      it("gives different pitches different keys, and the same pitch the same key", () => {
        // This is the user-visible property: play C then A and two different keys
        // go down; play C twice and it is the same key both times.
        const byPitch = new Map();
        for (const n of left) {
          const id = keyId(n.key);
          if (!byPitch.has(n.midi)) byPitch.set(n.midi, id);
          expect(byPitch.get(n.midi)).toBe(id); // stable
        }
        expect(new Set(byPitch.values()).size).toBe(byPitch.size); // distinct
      });

      it("orders keys the way the pitches are ordered", () => {
        const pitches = [...new Set(left.map((n) => n.midi))].sort((a, b) => a - b);
        const whites = pitches.map((m) => left.find((n) => n.midi === m).key.white);
        for (let i = 1; i < whites.length; i++) {
          expect(whites[i]).toBeGreaterThanOrEqual(whites[i - 1]);
        }
      });

      it("lands the played range near the bottom of the drawn keyboard", () => {
        // Keys are ABSOLUTE white indices; keyOffset (a whole number of octaves)
        // is what brings them onto the renderer's slots. It cannot normalise the
        // low note to exactly 0 — doing so is what rotated every note onto a
        // wrongly-named key — so the low note lands in a 7-slot window instead.
        const lowSlot = Math.min(...left.map((n) => n.key.white)) - c.keyOffset;
        expect(lowSlot).toBeGreaterThanOrEqual(2);
        expect(lowSlot).toBeLessThanOrEqual(8);
      });

      it("fits inside the keys the hero actually draws", () => {
        // The renderer draws roughly slots -6..14 at common viewport sizes.
        const highSlot = Math.max(...left.map((n) => n.key.white)) - c.keyOffset;
        expect(highSlot).toBeLessThanOrEqual(14);
      });

      it("emits one span list per distinct key, covering every left-hand note", () => {
        const total = c.keys.reduce((s, k) => s + k.spans.length, 0);
        expect(total).toBe(left.length);
        expect(c.keys.length).toBe(new Set(left.map((n) => keyId(n.key))).size);
      });

      it("keeps each key's spans sorted, positive and non-overlapping", () => {
        // strikeAt tolerates overlap now, but a key overlapping ITSELF means the
        // same note was scheduled twice.
        for (const k of c.keys) {
          for (let i = 0; i < k.spans.length; i++) {
            expect(k.spans[i][1]).toBeGreaterThan(0);
            if (i === 0) continue;
            expect(k.spans[i][0]).toBeGreaterThanOrEqual(k.spans[i - 1][0]);
            expect(k.spans[i][0]).toBeGreaterThanOrEqual(
              k.spans[i - 1][0] + k.spans[i - 1][1] - 1e-9,
            );
          }
        }
      });
    });
  }

  it("puts Für Elise's G#3 on a black key", () => {
    // The accidental in the left-hand E-major arpeggio. Black keys could never
    // depress under the old geometric hit-test, so this note moved nothing.
    const c = compileSong(SONGS.find((s) => s.id === "fur-elise"));
    const gsharp = c.notes.find((n) => n.hand === "L" && n.midi === 56);
    expect(gsharp.key.black).toBe(true);
  });

  it("spaces Für Elise's left-hand keys by the right intervals", () => {
    // E2 -> A2 is a fourth (3 white keys); A2 -> E3 a fifth (4); E3 -> A3 a
    // fourth (3). If the key mapping drifted, these would not hold.
    const c = compileSong(SONGS.find((s) => s.id === "fur-elise"));
    const keyOf = (midi) => c.notes.find((n) => n.hand === "L" && n.midi === midi).key.white;
    expect(keyOf(45) - keyOf(40)).toBe(3); // E2 -> A2
    expect(keyOf(52) - keyOf(45)).toBe(4); // A2 -> E3
    expect(keyOf(57) - keyOf(52)).toBe(3); // E3 -> A3
  });

  it("puts the Prelude's left hand on four adjacent white keys", () => {
    // B3 C4 D4 E4 — literally consecutive naturals.
    const c = compileSong(SONGS.find((s) => s.id === "prelude-in-c"));
    const keyOf = (midi) => c.notes.find((n) => n.hand === "L" && n.midi === midi).key;
    const base = keyOf(59).white;
    expect([59, 60, 62, 64].map((m) => keyOf(m).white - base)).toEqual([0, 1, 2, 3]);
    expect([59, 60, 62, 64].map((m) => keyOf(m).black)).toEqual([false, false, false, false]);
  });
});
