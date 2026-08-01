/**
 * PianoSynth — a small additive piano voice built on the Web Audio API.
 *
 * No samples, no audio files: every note is generated from oscillators at call
 * time. That keeps the bundle tiny and sidesteps sound-recording copyright
 * entirely (see the note in songs.js).
 *
 * The tone borrows the three things that make a struck string read as "piano":
 *   1. harmonic partials whose UPPER members decay faster than the fundamental,
 *   2. slight inharmonicity — real strings are stiff, so upper partials run
 *      sharp of exact integer multiples,
 *   3. a lowpass that closes over the note's life, so the attack is bright and
 *      the tail goes mellow.
 *
 * Browsers block an AudioContext created before a user gesture, so the context
 * is built lazily on the first play() and reused for the app's lifetime.
 */

// [harmonic multiple, relative amplitude, decay rate vs. the fundamental]
const PARTIALS = [
  [1, 1.0, 1.0],
  [2, 0.44, 0.70],
  [3, 0.20, 0.50],
  [4, 0.10, 0.38],
  [5, 0.055, 0.30],
  [7, 0.020, 0.22],
];

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const midiToFreq = (midi) => 440 * Math.pow(2, (midi - 69) / 12);

export default class PianoSynth {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.voices = new Set(); // live oscillators, so stopAll() can cut them
  }

  /** Lazily create/resume the context. Must be called from a user gesture. */
  ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.16; // conservative — this plays on a login page

      // Chords stack: a 3-note left-hand chord over a ringing bass and a melody
      // note can sum past 1.0, and the destination hard-clips into audible
      // distortion. A limiter on the way out keeps dense passages clean without
      // having to tune the gain down until quiet passages disappear.
      const limiter = this.ctx.createDynamicsCompressor();
      limiter.threshold.value = -8;
      limiter.knee.value = 0;
      limiter.ratio.value = 12;
      limiter.attack.value = 0.003;
      limiter.release.value = 0.25;

      this.master.connect(limiter);
      limiter.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") this.ctx.resume();
    return this.ctx;
  }

  /** Current audio-clock time in seconds (0 before the context exists). */
  now() {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  /**
   * Schedule one note. `when` is an absolute AudioContext time; scheduling ahead
   * of `currentTime` is what keeps timing sample-accurate rather than
   * setTimeout-accurate.
   */
  noteOn(midi, when, dur = 0.5) {
    const ctx = this.ctx;
    if (!ctx) return;
    const freq = midiToFreq(midi);

    // Long bass strings ring far longer than short treble ones.
    const ring = clamp(4.0 - (midi - 40) * 0.05, 0.85, 4.0);
    const life = Math.min(ring, Math.max(dur, 0.14) + 1.2);

    const voice = ctx.createGain();
    voice.gain.value = 1;

    // Brightness dies before the fundamental does.
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.Q.value = 0.4;
    lp.frequency.setValueAtTime(Math.min(9500, freq * 9), when);
    lp.frequency.exponentialRampToValueAtTime(
      Math.max(420, freq * 2.2),
      when + life * 0.65,
    );

    voice.connect(lp);
    lp.connect(this.master);

    for (const [mult, amp, decayRate] of PARTIALS) {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      // inharmonicity: stiffness pushes upper partials sharp
      osc.frequency.value = freq * mult * (1 + 0.0006 * mult * mult);

      const g = ctx.createGain();
      const partialLife = life * decayRate;
      // exponentialRamp can never touch 0, so ride just above it
      g.gain.setValueAtTime(0.0001, when);
      g.gain.exponentialRampToValueAtTime(amp * 0.9, when + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, when + partialLife);

      osc.connect(g);
      g.connect(voice);
      osc.start(when);
      osc.stop(when + partialLife + 0.05);

      this.voices.add(osc);
      osc.onended = () => {
        this.voices.delete(osc);
        try {
          osc.disconnect();
          g.disconnect();
        } catch {
          /* already torn down */
        }
      };
    }
  }

  /** Cut every scheduled and sounding note — for pause / next / stop. */
  stopAll() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    for (const osc of [...this.voices]) {
      try {
        osc.stop(t);
      } catch {
        /* already stopped */
      }
    }
    this.voices.clear();
  }

  /** Release the context on unmount. */
  close() {
    this.stopAll();
    if (this.ctx) {
      this.ctx.close().catch(() => {});
      this.ctx = null;
      this.master = null;
    }
  }
}
