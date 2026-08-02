/**
 * Key/finger strike envelope for a played song.
 *
 * Extracted from HeroField so it can be unit-tested: it used to be a private
 * const inside a 1400-line canvas component, which meant the behaviour it exists
 * to provide — a finger staying down for the length of its note — had no direct
 * coverage at all.
 *
 * Unlike the idle phrase's fixed 0.28s triangle, a real piece HOLDS notes, so
 * the envelope presses, settles under the weight, and lifts, driven by each
 * note's actual duration.
 */

export const SONG_PRESS = 0.05; // time to push the key down
export const SONG_LIFT = 0.16; // time to come back off it
export const SONG_SETTLE = 0.35; // how fast a held key relaxes to resting weight
const SETTLE_DEPTH = 0.25; // how far it relaxes (1 -> 0.75)

/** Level a held key has settled to `dt` seconds after a press that lasts `held`. */
function settled(dt) {
  return 1 - SETTLE_DEPTH * Math.min(1, Math.max(0, dt - SONG_PRESS) / SONG_SETTLE);
}

/**
 * One span's contribution at `dt` seconds after its onset.
 *
 * Continuous for ANY held >= 0. A note shorter than SONG_PRESS never reaches
 * full depth, and releases from wherever the press actually got to — without
 * that, a short or zero-length note produced an instantaneous jump (a 0.31 drop
 * measured at held=0), because the release used to start from the level a FULL
 * press would have reached rather than the one this press did.
 */
export function strikeEnvelope(dt, held) {
  if (dt < 0) return 0;
  const dur = Math.max(0, held);
  const attack = Math.min(SONG_PRESS, dur); // how far down this press gets
  const peak = attack / SONG_PRESS; // <= 1

  if (dt < attack) return dt / SONG_PRESS; // pressing down
  if (dt < dur) return peak * settled(dt); // holding while it sounds

  const release = dt - dur;
  if (release >= SONG_LIFT) return 0;
  const from = peak * settled(dur);
  return from * (1 - release / SONG_LIFT); // lifting off
}

/**
 * How far down a key/finger is at time `t`, given its spans of [onset, held].
 *
 * Takes the MAXIMUM over every span still live, not just the most recently
 * started one. Selecting only the last-started span collapsed the envelope to
 * zero in a single frame whenever two spans overlapped — measured at spans
 * [[0,1],[0.4,0.2]]: 0.75 at t=0.399, 0.00 at t=0.400 — and then released the
 * first note 0.24s early. Overlap is normal (a pedal bass under a moving line),
 * so the consumer cannot assume it away.
 *
 * `spans` must be sorted by onset.
 */
export function strikeAt(spans, t) {
  if (!spans || spans.length === 0) return 0;
  let best = 0;
  for (let i = 0; i < spans.length; i++) {
    const onset = spans[i][0];
    if (onset > t) break; // sorted: nothing later can have started
    const v = strikeEnvelope(t - onset, spans[i][1]);
    if (v > best) best = v;
  }
  return best;
}
