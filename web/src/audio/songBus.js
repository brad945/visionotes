import { keyId } from "./pianoKeys";

/**
 * songBus — the bridge between the piano player UI (React) and the HeroField
 * canvas draw loop (requestAnimationFrame).
 *
 * Deliberately NOT React state. The draw loop reads this every frame, and the
 * strike envelope has a ~50ms attack (≈3 frames at 60fps) — routing the clock
 * through re-renders would smear every strike against the audio. Same pattern as
 * the existing `kbRef`: a plain mutable object the RAF loop samples.
 *
 * `getTime()` is a FUNCTION, not a value, so the loop reads the live AudioContext
 * clock each frame. That keeps the visual strike locked to the audible note.
 */

export const songBus = {
  active: false, // song mode → HeroField takes its pose and keys from the song
  events: null, // [{ t, f: [fingerIdx], lat }] — strike events, t in SECONDS
  strikeSpans: null, // [[[onset, heldFor]…] × 5] per finger, sorted, in SECONDS
  keys: null, // Map keyId -> [[onset, heldFor]…]: which KEY is down, per note
  keyOffset: 0, // whole octaves to subtract to reach the renderer's drawn slots
  aimRef: null, // key the hand's rest pose corresponds to; travel is relative to it
  getTime: () => 0, // live playback position in seconds (reads the audio clock)
};

/**
 * Attach a compiled song. Everything but `getTime` comes from compileSong().
 * `getTime` must return the current playback position in seconds.
 */
export function setSongSource(compiled, getTime) {
  songBus.events = compiled.events;
  songBus.strikeSpans = compiled.strikeSpans;
  songBus.keys = new Map(compiled.keys.map((k) => [keyId(k), k.spans]));
  songBus.keyOffset = compiled.keyOffset;
  songBus.aimRef = compiled.aimRef;
  songBus.getTime = getTime;
  songBus.active = true;
}

/**
 * Suspend song mode WITHOUT throwing the song away.
 *
 * Pausing used to detach the source outright, which made the hand abandon its
 * pose mid-bar and start air-playing the idle phrase — a phrase on a free-running
 * clock with no relation to the music — while the keyboard was still fading out.
 * Leaving the data attached lets getTime() return the frozen offset, so the hand
 * simply holds its last chord, and lets HeroField keep sampling the song through
 * the cross-fade instead of snapping to an unrelated pose.
 */
export function suspendSongSource() {
  songBus.active = false;
}

/** Fully detach — on unmount or when switching pieces. */
export function clearSongSource() {
  songBus.active = false;
  songBus.events = null;
  songBus.strikeSpans = null;
  songBus.keys = null;
  songBus.keyOffset = 0;
  songBus.aimRef = null;
  songBus.getTime = () => 0;
}
