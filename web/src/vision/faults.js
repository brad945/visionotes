/**
 * FaultSmoother — stateful, per-hand temporal smoothing + fault-period tracking.
 *
 * This is the CAMERA-LOOP side of fault detection: it holds per-label rolling
 * buffers and converts the per-frame boolean verdicts (from the pure geometry in
 * logic/faults.js) into debounced active/started signals and timed fault periods.
 *
 * The pure decision math lives in ../logic/faults.js and is imported by the
 * camera loop directly; this file deliberately keeps only the stateful parts
 * (per-hand buffers, monotonic-timestamp period bookkeeping).
 */

const SMOOTHING_WINDOW = 7;

// Minimum time a fault must PERSIST before it counts as a real fault, per type.
//
// The smoothing window above only removes single-frame flicker (~0.2s). That is
// not enough for faults whose "bad" shape is a normal, momentary part of playing:
//
//   flat_fingers — you cannot play with permanently curved fingers. Reaching an
//     octave, crossing the thumb under, or stretching for an interval all flatten
//     the hand for a moment. A flat-finger FAULT means the arch stayed collapsed,
//     not that it passed through flat on the way somewhere.
//
//   back_posture — leaning to reach the far end of the keyboard is correct
//     technique, not slouching. Only a sustained lean is a posture problem.
//
// collapsed_wrist and arm_posture keep no minimum: their bad states are not a
// normal part of playing, so an existing detection that works stays untouched.
//
// A period shorter than its minimum is discarded outright — never stored, never
// counted in total_faults.
export const MIN_FAULT_DURATION_MS = {
  flat_fingers: 800,
  back_posture: 1500,
};

function meetsMinimumDuration(faultType, durationMs) {
  const min = MIN_FAULT_DURATION_MS[faultType] ?? 0;
  return durationMs >= min;
}

// --- Per-hand smoothing buffer with period tracking ------------------------------

export class FaultSmoother {
  constructor(window = SMOOTHING_WINDOW) {
    this.window = window;
    this.buffers = {}; // keyed by label, e.g. "Left" / "Right"
    this.prev = {}; // previous smoothed state per label
    this.openPeriods = {}; // label -> { fault_type, hand, start_ms } (currently active)
    this.periods = []; // completed periods: { fault_type, hand, timestamp_ms, value (duration) }
  }

  /**
   * Push a boolean and return { active, started }.
   *   active  — smoothed fault is currently on
   *   started — fault just transitioned off→on this frame
   */
  push(label, value, faultType, hand, timestampMs) {
    if (!this.buffers[label]) {
      this.buffers[label] = [];
    }
    const buf = this.buffers[label];
    buf.push(value);
    if (buf.length > this.window) buf.shift();

    let active = false;
    if (buf.length >= this.window) {
      const trueCount = buf.reduce((s, v) => s + (v ? 1 : 0), 0);
      active = trueCount > this.window / 2;
    }

    const wasActive = this.prev[label] || false;
    this.prev[label] = active;

    const started = active && !wasActive;
    const ended = !active && wasActive;

    // Track fault periods
    if (started) {
      this.openPeriods[label] = { fault_type: faultType, hand, start_ms: timestampMs };
    }
    if (ended && this.openPeriods[label]) {
      const open = this.openPeriods[label];
      const duration = timestampMs - open.start_ms;
      // Too brief to be a habit — drop it rather than coach the player on a
      // shape they were only passing through.
      if (meetsMinimumDuration(open.fault_type, duration)) {
        this.periods.push({
          fault_type: open.fault_type,
          hand: open.hand,
          timestamp_ms: open.start_ms,
          value: duration, // duration in ms
        });
      }
      delete this.openPeriods[label];
    }

    return { active, started };
  }

  /** Finalize any still-open periods (called when session stops). */
  finalize(endMs) {
    for (const open of Object.values(this.openPeriods)) {
      const duration = endMs - open.start_ms;
      if (!meetsMinimumDuration(open.fault_type, duration)) continue;
      this.periods.push({
        fault_type: open.fault_type,
        hand: open.hand,
        timestamp_ms: open.start_ms,
        value: duration,
      });
    }
    this.openPeriods = {};
  }

  /** Return all completed periods and reset. */
  harvest() {
    const result = [...this.periods];
    this.periods = [];
    return result;
  }

  /** Return completed periods plus currently-open periods with live duration. */
  snapshot(nowMs) {
    const open = Object.values(this.openPeriods)
      .map((period) => ({
        fault_type: period.fault_type,
        hand: period.hand,
        timestamp_ms: period.start_ms,
        value: Math.max(0, nowMs - period.start_ms),
      }))
      // Same minimum as the recorded path, so the live panel cannot show a
      // fault that is about to be thrown away — the player would be corrected
      // for something that never reaches their history.
      .filter((period) => meetsMinimumDuration(period.fault_type, period.value));
    return [...this.periods, ...open];
  }

  clear() {
    this.buffers = {};
    this.prev = {};
    this.openPeriods = {};
    this.periods = [];
  }
}
