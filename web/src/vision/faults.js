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
      this.periods.push({
        fault_type: open.fault_type,
        hand: open.hand,
        timestamp_ms: open.start_ms,
        value: timestampMs - open.start_ms, // duration in ms
      });
      delete this.openPeriods[label];
    }

    return { active, started };
  }

  /** Finalize any still-open periods (called when session stops). */
  finalize(endMs) {
    for (const [label, open] of Object.entries(this.openPeriods)) {
      this.periods.push({
        fault_type: open.fault_type,
        hand: open.hand,
        timestamp_ms: open.start_ms,
        value: endMs - open.start_ms,
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
    const open = Object.values(this.openPeriods).map((period) => ({
      fault_type: period.fault_type,
      hand: period.hand,
      timestamp_ms: period.start_ms,
      value: Math.max(0, nowMs - period.start_ms),
    }));
    return [...this.periods, ...open];
  }

  clear() {
    this.buffers = {};
    this.prev = {};
    this.openPeriods = {};
    this.periods = [];
  }
}
