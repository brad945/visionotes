/**
 * MIDI pitch -> which key on the drawn keyboard.
 *
 * WHY THIS EXISTS. The keyboard used to decide which key went down by
 * hit-testing the fingertip against the drawn key quads. Measurement showed
 * that cannot work: at the tuned camera angle (yaw -51°) each key renders as a
 * ~1900px-long, ~6px-tall sliver, so which key a fingertip is "over" is decided
 * by its VERTICAL position. The available control authority was 0.04 key slots
 * of lateral hand travel, against 2 slots of noise from the strike curl alone
 * and 4-10 slots from the wrist hinge — a signal-to-noise ratio around 1:100.
 * The finger geometry simply cannot address a key.
 *
 * So the key press is driven from the NOTE instead, and the hand pose is
 * decorative. That is also what makes the result stable: the key that goes down
 * is a pure function of the music and cannot be perturbed by breathing, wrist
 * sway, or the window being resized.
 *
 * A keyboard octave is 7 white keys and 5 black ones. A black key is identified
 * by the white key it sits immediately to the right of, which matches how the
 * renderer draws them (the black after white slot k, for k mod 7 in {0,1,3,4,5}
 * — i.e. after C, D, F, G, A).
 */

// semitone within an octave -> [white-key offset, is it a black key]
const SEMITONE = [
  [0, false], // C
  [0, true], //  C#  (after C)
  [1, false], // D
  [1, true], //  D#  (after D)
  [2, false], // E
  [3, false], // F
  [3, true], //  F#  (after F)
  [4, false], // G
  [4, true], //  G#  (after G)
  [5, false], // A
  [5, true], //  A#  (after A)
  [6, false], // B
];

/**
 * Absolute key position for a MIDI pitch.
 *
 * `white` is the white-key index counting from C-1 (MIDI 0). For a black key,
 * `white` is the white key it sits after, and `black` is true. Monotonic
 * non-decreasing in pitch, and injective across the (white, black) pair.
 */
export function midiToKey(midi) {
  const octave = Math.floor(midi / 12);
  const [offset, black] = SEMITONE[((midi % 12) + 12) % 12];
  return { white: octave * 7 + offset, black };
}

/** White-key index alone — handy for measuring how far apart two pitches sit. */
export function whiteIndex(midi) {
  return midiToKey(midi).white;
}

/** How many white keys apart two pitches are. */
export function whiteSpan(loMidi, hiMidi) {
  return whiteIndex(hiMidi) - whiteIndex(loMidi);
}

/** Stable string id for a key, for use as a map key. */
export function keyId(key) {
  return key.black ? `b${key.white}` : `w${key.white}`;
}
