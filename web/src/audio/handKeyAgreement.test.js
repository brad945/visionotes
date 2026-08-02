import { describe, it, expect } from "vitest";
import { SONGS, compileSong } from "./songs";
import { keyId } from "./pianoKeys";
import { strikeAt, SONG_PRESS, SONG_LIFT } from "./strike";

/**
 * DO THE FINGERS AND THE KEYS AGREE?
 *
 * The hand pose and the key press are two independent paths out of compileSong —
 * `strikeSpans[finger]` drives the fingers, `keys[keyId]` drives the keyboard.
 * Both are derived from the same notes, but nothing checked they stay in step,
 * and "the fingers are lining up but pushing the wrong keys" is exactly the
 * class of bug that shipped repeatedly. These tests close that loop.
 *
 * Everything here is pure — no canvas, no rAF — because the renderer only reads
 * these two structures and interpolates between the sampled values.
 */

const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const noteName = (m) => `${NAMES[m % 12]}${Math.floor(m / 12) - 1}`;

// What the renderer reads: a Map from key id to that key's spans.
const keyMap = (c) => new Map(c.keys.map((k) => [keyId(k), k.spans]));

// Every left-hand note whose key should still be down at time t. `tail` covers
// the release ramp: a key lifts over SONG_LIFT rather than snapping up, so it
// legitimately reads as pressed for a moment after its note has ended.
const soundingAt = (c, t, tail = 0) =>
  c.notes.filter((n) => n.hand === "L" && n.t <= t && t < n.t + n.dur + tail);

describe("hand / key agreement", () => {
  for (const s of SONGS) {
    describe(s.id, () => {
      const c = compileSong(s);
      const keys = keyMap(c);
      const left = c.notes.filter((n) => n.hand === "L");

      it("puts the finger down at the moment its own note is struck", () => {
        const late = left
          .filter((n) => strikeAt(c.strikeSpans[n.finger], n.t + SONG_PRESS) <= 0.5)
          .map((n) => `${noteName(n.midi)} @${n.t.toFixed(3)} finger ${n.finger}`);
        expect(late).toEqual([]);
      });

      it("puts THAT NOTE'S key down at the same moment", () => {
        // The headline property the user asked for: the key that goes down is
        // the key for the note being played.
        const wrong = left
          .filter((n) => strikeAt(keys.get(keyId(n.key)) || [], n.t + SONG_PRESS) <= 0.5)
          .map((n) => `${noteName(n.midi)} @${n.t.toFixed(3)} key ${keyId(n.key)}`);
        expect(wrong).toEqual([]);
      });

      it("presses the finger and its key by the same amount, throughout", () => {
        // They must not merely both be down — they must move together, or the
        // finger will visibly lift while its key is still held (or vice versa).
        const drift = [];
        for (const n of left) {
          for (const frac of [0.1, 0.3, 0.5, 0.8, 1.0, 1.3]) {
            const t = n.t + n.dur * frac;
            const f = strikeAt(c.strikeSpans[n.finger], t);
            const k = strikeAt(keys.get(keyId(n.key)) || [], t);
            if (Math.abs(f - k) > 1e-9) {
              drift.push(`${noteName(n.midi)} @${t.toFixed(3)}: finger ${f.toFixed(3)} vs key ${k.toFixed(3)}`);
            }
          }
        }
        expect(drift.slice(0, 5)).toEqual([]);
      });

      it("never lights a key whose note is not sounding", () => {
        // Sample densely across the whole piece: at every instant, the set of
        // pressed keys must be a subset of the keys whose notes are live.
        const stray = [];
        for (let t = 0; t < c.duration; t += 0.02) {
          const live = new Set(soundingAt(c, t, SONG_LIFT).map((n) => keyId(n.key)));
          for (const [id, spans] of keys) {
            if (strikeAt(spans, t) > 0 && !live.has(id)) {
              stray.push(`${id} at t=${t.toFixed(2)}`);
            }
          }
        }
        expect(stray.slice(0, 5)).toEqual([]);
      });

      it("lights exactly as many keys as there are notes sounding", () => {
        for (const n of left) {
          const t = n.t + SONG_PRESS;
          const expected = new Set(soundingAt(c, t, SONG_LIFT).map((x) => keyId(x.key))).size;
          const actual = [...keys.values()].filter((sp) => strikeAt(sp, t) > 0.5).length;
          expect({ t: t.toFixed(3), actual }).toEqual({ t: t.toFixed(3), actual: expected });
        }
      });

      it("releases the key when the note ends, not before or long after", () => {
        for (const n of left) {
          const spans = keys.get(keyId(n.key)) || [];
          // still down just before the note ends...
          expect(strikeAt(spans, n.t + n.dur - 1e-4)).toBeGreaterThan(0.5);
          // ...and fully up once the lift has run, unless the same key is
          // restruck (Für Elise repeats A2 every other bar).
          const restruck = spans.some(([o]) => o > n.t && o <= n.t + n.dur + 0.2);
          if (!restruck) expect(strikeAt(spans, n.t + n.dur + 0.2)).toBe(0);
        }
      });
    });
  }

  it("moves the lit key in the direction the music moves", () => {
    // "From C to A" — consecutive left-hand notes that rise in pitch must light
    // a key further up the keyboard, and vice versa. This is the property that
    // was impossible under the old geometric hit-test.
    for (const s of SONGS) {
      const c = compileSong(s);
      const left = c.notes.filter((n) => n.hand === "L").sort((a, b) => a.t - b.t);
      const wrong = [];
      for (let i = 1; i < left.length; i++) {
        const prev = left[i - 1];
        const cur = left[i];
        if (cur.midi === prev.midi) continue;
        const rose = cur.midi > prev.midi;
        const keyRose = cur.key.white > prev.key.white
          || (cur.key.white === prev.key.white && cur.key.black && !prev.key.black);
        const keyFell = cur.key.white < prev.key.white
          || (cur.key.white === prev.key.white && !cur.key.black && prev.key.black);
        if (rose && !keyRose) wrong.push(`${noteName(prev.midi)}->${noteName(cur.midi)} rose but key did not`);
        if (!rose && !keyFell) wrong.push(`${noteName(prev.midi)}->${noteName(cur.midi)} fell but key did not`);
      }
      expect({ song: s.id, wrong }).toEqual({ song: s.id, wrong: [] });
    }
  });
});
