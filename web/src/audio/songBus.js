/**
 * songBus — the bridge between the piano player UI (React) and the HeroField
 * canvas draw loop (requestAnimationFrame).
 *
 * Deliberately NOT React state. The draw loop reads this every frame, and the
 * strike envelope has a ~40ms attack (≈2.4 frames at 60fps) — routing the clock
 * through re-renders would smear every strike against the audio. Same pattern as
 * the existing `kbRef`: a plain mutable object the RAF loop samples.
 *
 * `getTime()` is a FUNCTION, not a value, so the loop reads the live AudioContext
 * clock each frame. That keeps the visual strike locked to the audible note.
 */

export const songBus = {
  active: false, // song mode → HeroField forces the piano pose + keyboard
  events: null, // [{ t, f: [fingerIdx], lat }] — strike events, t in SECONDS
  strikeSpans: null, // [[[onset, heldFor]…] × 5] per finger, sorted, in SECONDS
  getTime: () => 0, // live playback position in seconds (reads the audio clock)
};

/**
 * Attach a compiled song. `events` / `strikeSpans` come from compileSong().
 * `getTime` must return the current playback position in seconds.
 */
export function setSongSource(events, strikeSpans, getTime) {
  songBus.events = events;
  songBus.strikeSpans = strikeSpans;
  songBus.getTime = getTime;
  songBus.active = true;
}

/** Detach — HeroField falls back to its own idle PIANO_PHRASE. */
export function clearSongSource() {
  songBus.active = false;
  songBus.events = null;
  songBus.strikeSpans = null;
  songBus.getTime = () => 0;
}
