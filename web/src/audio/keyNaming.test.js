import { describe, it, expect } from "vitest";
import { SONGS, compileSong } from "./songs";
import { midiToKey, keyId } from "./pianoKeys";

/**
 * IS THE LIT KEY THE KEY THAT NOTE IS NAMED AFTER?
 *
 * Every previous test checked that distinct pitches got distinct keys, that the
 * keys moved in the right direction, and that fingers and keys agreed. All of
 * that passed while EVERY NOTE WAS ON THE WRONG KEY, because nothing tied the
 * mapping to the renderer's own idea of which key is which.
 *
 * The renderer never names its keys. It draws a black key after every white slot
 * k where k mod 7 is in {0,1,3,4,5} — the C-D-F-G-A pattern — and that pattern
 * IS the naming: drawn slot k is the natural [C,D,E,F,G,A,B][k mod 7]. This file
 * reimplements that rule from the renderer's side and checks the notes land on
 * the keys they are named after.
 *
 * Keep this in sync with the black-key condition in HeroField's keyboard block.
 */

const NATURALS = ["C", "D", "E", "F", "G", "A", "B"];
const BLACK_AFTER = [0, 1, 3, 4, 5]; // HeroField: [0,1,3,4,5].includes(k mod 7)
const mod7 = (k) => ((k % 7) + 7) % 7;

/** What the RENDERER draws at a given slot, derived only from its own pattern. */
const rendererWhiteName = (slot) => NATURALS[mod7(slot)];
const rendererHasBlackAfter = (slot) => BLACK_AFTER.includes(mod7(slot));
const rendererBlackName = (slot) =>
  rendererHasBlackAfter(slot) ? `${NATURALS[mod7(slot)]}#` : null;

const PITCH = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const pitchClass = (midi) => PITCH[midi % 12];
const noteName = (midi) => `${pitchClass(midi)}${Math.floor(midi / 12) - 1}`;

describe("key naming matches the renderer", () => {
  for (const s of SONGS) {
    describe(s.id, () => {
      const c = compileSong(s);
      const left = c.notes.filter((n) => n.hand === "L");
      // exactly what HeroField does: drawn slot -> absolute index
      const drawnSlot = (n) => n.key.white - c.keyOffset;

      it("lights the key the note is actually named after", () => {
        const wrong = [];
        for (const n of left) {
          const slot = drawnSlot(n);
          const drawn = n.key.black ? rendererBlackName(slot) : rendererWhiteName(slot);
          if (drawn !== pitchClass(n.midi)) {
            wrong.push(`${noteName(n.midi)} lights ${drawn ?? "a key that does not exist"} (slot ${slot})`);
          }
        }
        expect([...new Set(wrong)]).toEqual([]);
      });

      it("puts every accidental on a slot that HAS a black key", () => {
        // Für Elise's G#3 previously mapped to a slot the renderer draws F# on.
        for (const n of left.filter((x) => x.key.black)) {
          const slot = drawnSlot(n);
          expect({ note: noteName(n.midi), hasBlack: rendererHasBlackAfter(slot) })
            .toEqual({ note: noteName(n.midi), hasBlack: true });
        }
      });

      it("offsets by whole octaves so pitch classes cannot rotate", () => {
        // The root cause: any offset that is not a multiple of 7 shifts the notes
        // against the renderer's fixed black-key pattern.
        expect(c.keyOffset % 7).toBe(0);
      });

      it("keeps the played range on keys the renderer draws", () => {
        // HeroField draws roughly slots -6 .. nWhite+4 (~14 at common sizes).
        for (const n of left) {
          const slot = drawnSlot(n);
          expect({ note: noteName(n.midi), inRange: slot >= -6 && slot <= 14 })
            .toEqual({ note: noteName(n.midi), inRange: true });
        }
      });

      it("keeps the octave relationship intact", () => {
        // Two pitches an octave apart must be exactly 7 slots apart.
        for (const n of left) {
          const up = midiToKey(n.midi + 12);
          expect(up.white - n.key.white).toBe(7);
          expect(up.black).toBe(n.key.black);
        }
      });
    });
  }

  it("names Für Elise's left hand correctly, note by note", () => {
    // Spelled out, because this is the case the user caught by eye.
    const c = compileSong(SONGS.find((x) => x.id === "fur-elise"));
    const seen = new Map();
    for (const n of c.notes.filter((x) => x.hand === "L")) {
      const slot = n.key.white - c.keyOffset;
      const drawn = n.key.black ? rendererBlackName(slot) : rendererWhiteName(slot);
      seen.set(noteName(n.midi), drawn);
    }
    expect(Object.fromEntries([...seen].sort())).toEqual({
      E2: "E",
      A2: "A",
      E3: "E",
      "G#3": "G#", // was landing on F#
      A3: "A",
    });
  });

  it("names the Prelude's left hand correctly, note by note", () => {
    const c = compileSong(SONGS.find((x) => x.id === "prelude-in-c"));
    const seen = new Map();
    for (const n of c.notes.filter((x) => x.hand === "L")) {
      const slot = n.key.white - c.keyOffset;
      seen.set(noteName(n.midi), rendererWhiteName(slot));
    }
    expect(Object.fromEntries([...seen].sort())).toEqual({
      B3: "B",
      C4: "C",
      D4: "D",
      E4: "E",
    });
  });

  it("agrees with the renderer for every pitch on a real keyboard", () => {
    // Not just our two pieces: the rule must hold for all 88 keys, so a future
    // piece cannot reintroduce this.
    for (let midi = 21; midi <= 108; midi++) {
      const k = midiToKey(midi);
      const offset = 7 * Math.floor(k.white / 7); // any whole-octave shift
      const slot = k.white - offset;
      const drawn = k.black ? rendererBlackName(slot) : rendererWhiteName(slot);
      expect({ midi, drawn }).toEqual({ midi, drawn: pitchClass(midi) });
    }
  });

  it("gives each key id one pitch class, forever", () => {
    // keyId is what the bus keys its Map by; a collision would light two notes
    // on one key.
    const byId = new Map();
    for (let midi = 21; midi <= 108; midi++) {
      const id = keyId(midiToKey(midi));
      const pc = pitchClass(midi);
      if (byId.has(id)) expect(byId.get(id)).toBe(pc);
      byId.set(id, pc);
    }
  });
});
