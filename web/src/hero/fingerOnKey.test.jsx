/** @vitest-environment jsdom */
import { describe, it, expect, afterEach } from "vitest";
import { mountHero } from "./__harness__/heroHarness";
import { SONGS, compileSong } from "../audio/songs";
import { keyId } from "../audio/pianoKeys";

/**
 * HOW THE HAND MOVES WHILE A PIECE PLAYS.
 *
 * Played through on the harness clock at 60fps. That matters twice: the hand
 * aims AHEAD of the music, so parking time on a note would catch it reaching for
 * a later one, and the control loop needs dozens of frames to settle — in a
 * throttled browser tab it got 1-5, which is why earlier attempts at this were
 * tuned against transients and each measured worse than the last.
 */

let hero = null;
afterEach(() => { hero?.destroy(); hero = null; });

const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const noteName = (m) => `${NAMES[m % 12]}${Math.floor(m / 12) - 1}`;
const song = () => compileSong(SONGS.find((s) => s.id === "fur-elise"));

/** Play the piece through, sampling every frame. */
function play(hero, c, dtMs = 1000 / 60) {
  let t = 0;
  hero.setSong(c, () => t);
  hero.run(600); // keyboard fades up and the pose settles before the clock moves
  const frames = [];
  const steps = Math.round((c.duration * 1000) / dtMs);
  for (let i = 0; i < steps; i++) {
    t = (i * dtMs) / 1000;
    hero.step(dtMs);
    const p = hero.probe;
    if (p) frames.push({ t, x: p.pianoX, y: p.pianoY, aim: p.aim?.key, strike: p.aimStrike, on: p.tipOnAimedKey,
                         tips: p.tips, reach: p.reach, quads: p.keyQuads, lean: p.blackReach || 0 });
  }
  return frames;
}

function inPoly(x, y, p) {
  let c = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    if ((p[i][1] > y) !== (p[j][1] > y) &&
        x < ((p[j][0] - p[i][0]) * (y - p[i][1])) / (p[j][1] - p[i][1]) + p[i][0]) c = !c;
  }
  return c;
}

/**
 * Per-key contact, anchored to the NOTES rather than to the aim.
 *
 * Over each note's own window, is the striking finger's LIVE tip inside that
 * note's key? Two things this fixes about the way it used to be measured:
 *
 *  - Aim-anchored filtering (`f.aim === "w33"`) only ever measured the keys it
 *    was asked about, and every earlier number in this file was w33 and b32.
 *    That hid the fact that w23 and w26 have essentially ZERO contact.
 *  - The aim runs ahead of the music, so with a large lookahead it points at the
 *    next note while the finger is still on this one. An aim-anchored count then
 *    silently changes what it is counting as the lookahead is tuned, which made
 *    two settings look comparable when they were not.
 */
function contactByKey(frames, c, keyIdOf) {
  const tally = new Map();
  for (const n of c.notes.filter((x) => x.hand === "L")) {
    const id = keyIdOf(n.key);
    const win = frames.filter((f) => f.t >= n.t && f.t < n.t + n.dur && f.quads && f.quads[id]);
    if (!win.length) continue;
    const on = win.filter((f) => {
      const rt = f.tips[n.finger], rc = f.reach[n.finger];
      return rt && rc && inPoly(rt[0] + rc[0], rt[1] + rc[1], f.quads[id]);
    }).length;
    const e = tally.get(id) || { n: 0, on: 0 };
    e.n += win.length; e.on += on;
    tally.set(id, e);
  }
  return tally;
}

describe("hand movement during playback", () => {
  it("lights the correct key for every left-hand note", () => {
    // The press is driven from the note, never from geometry, so it cannot be
    // thrown off by where the hand happens to be.
    hero = mountHero();
    const c = song();
    const missing = [];
    for (const n of c.notes.filter((x) => x.hand === "L")) {
      let t = n.t + 0.06;
      hero.setSong(c, () => t);
      hero.run(120);
      const p = hero.probe;
      const slot = n.key.white - c.keyOffset;
      const lit = n.key.black ? p.blackPressed : p.whitePressed;
      if (!lit || lit[slot] === undefined) {
        missing.push(`${noteName(n.midi)} @${n.t.toFixed(2)} -> ${JSON.stringify(lit)}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("comes back from the black key instead of staying out there", () => {
    // The reported bug, and a nasty one: the hand reached ~660px for the G# and
    // then sat there for the remaining six seconds, drifting further out on every
    // note. The cause was that the aim only constrained distance ACROSS a key —
    // and a key is a ~2000px sliver, so a hand stranded far ALONG one still reads
    // as "on the centre line" and the loop thinks it is done.
    hero = mountHero();
    const c = song();
    const frames = play(hero, c);
    const peak = Math.max(...frames.map((f) => f.x));
    const settled = frames[frames.length - 1].x;
    expect(peak).toBeGreaterThan(100); // it really does reach out for the G#
    expect(Math.abs(settled)).toBeLessThan(peak * 0.25); // and comes home again
  });

  it("returns near home after every black-key excursion, not just the last", () => {
    hero = mountHero();
    const c = song();
    const u = hero.unit; // unit-relative, so resizing the hand cannot false-fail this
    const frames = play(hero, c);
    // after each G# passage, the hand should be back near home within a second
    const gsharps = c.notes.filter((n) => n.hand === "L" && n.midi === 56);
    const stranded = [];
    for (const g of gsharps) {
      const after = frames.filter((f) => f.t > g.t + 0.8 && f.t < g.t + 1.6);
      if (!after.length) continue;
      const closest = Math.min(...after.map((f) => Math.abs(f.x)));
      if (closest > 0.4 * u) stranded.push(`after G# @${g.t.toFixed(2)}: nearest home was ${Math.round(closest)}px`);
    }
    expect(stranded).toEqual([]);
  });

  it("moves smoothly rather than darting", () => {
    // "Shakey" in numbers: per-frame travel at 60fps. A lunge shows up here long
    // before it is describable.
    //
    // Bounds are fractions of the hand's own unit, NOT pixels. A bigger hand
    // covers the same ground in more pixels, so a fixed px/s bound is really a
    // test of the hand's size — it false-failed the moment the scale went
    // 0.56 -> 0.60 while the motion was identical. The speed bound is just above
    // SONG_AIM_MAX_SPEED (3.33 unit/s), which is what it is there to police.
    hero = mountHero();
    const u = hero.unit;
    const frames = play(hero, song());
    const steps = [];
    for (let i = 1; i < frames.length; i++) {
      steps.push(Math.hypot(frames[i].x - frames[i - 1].x, frames[i].y - frames[i - 1].y));
    }
    const sorted = [...steps].sort((a, b) => a - b);
    const p90 = sorted[Math.floor(sorted.length * 0.9)];
    expect(p90 / u).toBeLessThan(0.040); // per frame; measures 0.036
    expect((Math.max(...steps) * 60) / u).toBeLessThan(3.4); // per second; measures 3.33
  });

  it("holds the far white key for most of its strike", () => {
    // Measures 88%, identically at 1280x800, 1366x768, 1440x900, 1600x900 and
    // 1920x1080 — up from 55% before the travel bounds were raised, which is the
    // real payoff of that change. The floor sits below 88% because the aim is a
    // spring and the opening frames of a strike are still travelling.
    hero = mountHero();
    const frames = play(hero, song()).filter((f) => f.aim === "w33" && f.strike > 0.5);
    const on = frames.filter((f) => f.on).length;
    expect(frames.length).toBeGreaterThan(0);
    expect(on / frames.length).toBeGreaterThan(0.8);
  });

  it("records how often the striking finger is actually on its own key", () => {
    // THE HONEST NUMBER, and it is not a good one. Measured per key, over each
    // note's own window (see contactByKey):
    //
    //   w23   0%     w26   5%     w30  12%     w33  75%     b32   0%
    //   whole piece: 22%
    //
    // b32 is 0% because BLACK_NUDGE_X is set by eye below the contact threshold —
    // see "lands the G# at the shorter, owner-chosen lean".
    //
    // Only the far white key tracks. Every other note in the piece is struck
    // with the finger somewhere other than the key that lights up. Every earlier
    // "coverage" figure in this file was w33 or b32 alone, so this never showed.
    //
    // It is not a tuning problem. The piece spans 9 white slots; the hand spans
    // about 4, and the aim steers ONE finger — the one striking the current
    // event — so the others land wherever the hand's pose puts them. Raising the
    // reach, lookahead and spring stiffness together buys the black key (0% ->
    // 60%) at p90 frame-to-frame motion of 28px/f, which is the "shakey" the
    // owner rejected twice. The whole-piece figure barely moves: 22% -> 27%.
    //
    // Fixing it properly means steering the hand so the WHOLE pose lands, not
    // one fingertip — a change to the aim, not to these constants. Until then
    // this test exists to stop the number quietly getting worse.
    hero = mountHero();
    const c = song();
    const tally = contactByKey(play(hero, c), c, keyId);
    const all = [...tally.values()].reduce((a, e) => ({ n: a.n + e.n, on: a.on + e.on }), { n: 0, on: 0 });
    expect(tally.size).toBeGreaterThan(3); // measuring every key, not just one
    expect(all.on / all.n).toBeGreaterThan(0.18);
    expect((tally.get("w33").on / tally.get("w33").n)).toBeGreaterThan(0.65);
  });

  it("never reverses the black-key lean mid-reach", () => {
    // THE GLITCH, reported as "glitchy/jumpy". The gate was re-evaluated every
    // frame, so each new event reset it for BLACK_NUDGE_HOLD and RETRACTED a
    // lean already under way: mid-approach it fell 0.75 -> 0.41, climbed back,
    // fell 0.85 -> 0.47, climbed back — the hand yanked ~200px backwards and
    // forwards, twice per G#. Ten direction reversals across the piece.
    //
    // Latching the release per target fixed it. Zero reversals now, and this
    // asserts exactly that: the lean is monotonic in each direction, so the
    // reach can be delayed but never reversed.
    hero = mountHero();
    const frames = play(hero, song());
    let reversals = 0;
    for (let i = 2; i < frames.length; i++) {
      const a = frames[i - 2].lean, b = frames[i - 1].lean, c = frames[i].lean;
      if ((b - a) * (c - b) < -1e-9) reversals++;
    }
    expect(reversals).toBe(0);
  });

  it("starts the lean from rest rather than popping", () => {
    // The second half of the glitch. An exponential ease starts at MAXIMUM
    // velocity, so releasing the lean mid-phrase moved the fingertip 83px in its
    // first frame. BLACK_NUDGE_RISE drives a smoothstep instead, which has zero
    // derivative at both ends, and the same frame now moves 34px.
    //
    // Measured on the jerk — frame-to-frame CHANGE in step size — because that
    // is what a pop actually is, and a plain step-size bound cannot see it.
    hero = mountHero();
    const frames = play(hero, song());
    const step = [];
    for (let i = 1; i < frames.length; i++) {
      const a = frames[i - 1], b = frames[i];
      step.push(Math.hypot(
        (b.tips[0][0] + b.reach[0][0]) - (a.tips[0][0] + a.reach[0][0]),
        (b.tips[0][1] + b.reach[0][1]) - (a.tips[0][1] + a.reach[0][1]),
      ));
    }
    const jerk = [];
    for (let i = 1; i < step.length; i++) jerk.push(Math.abs(step[i] - step[i - 1]));
    const sorted = [...jerk].sort((a, b) => a - b);
    expect(sorted[Math.floor(sorted.length * 0.99)] / hero.unit).toBeLessThan(0.055); // measures 0.041
  });

  it("waits for the note before the G# to be played before reaching for it", () => {
    // The reported problem: the hand left for the accidental on the lookahead,
    // ~280ms early, which is before the note in front of it had sounded. That
    // note (E3 at 2.48s) was contacted on 10% of its own window.
    //
    // BLACK_NUDGE_HOLD gates the lean on the previous note's press landing, and
    // takes it to 20%. The comparison that shows the gate is doing it: the SAME
    // E3 appears three more times in the piece with no accidental after it, and
    // those still measure 10-11%. The pre-G# one is now the best of the four.
    //
    // Gating the LOOKAHEAD instead of the lean was tried and is much worse —
    // see the comment at the aim block.
    hero = mountHero();
    const c = song();
    const frames = play(hero, c);
    const left = c.notes.filter((n) => n.hand === "L").sort((a, b) => a.t - b.t);
    const gi = left.findIndex((n) => n.midi === 56); // first G#
    expect(gi).toBeGreaterThan(0);
    const before = left[gi - 1];
    const pct = (n) => {
      const t = contactByKey(frames, { notes: [n] }, keyId);
      const e = [...t.values()][0];
      return e ? e.on / e.n : 0;
    };
    expect(pct(before)).toBeGreaterThan(0.15);
    // and it beats the same note where no accidental follows
    const others = left.filter((n) => n.midi === before.midi && n !== before);
    expect(others.length).toBeGreaterThan(0);
    expect(pct(before)).toBeGreaterThan(Math.max(...others.map(pct)));
  });

  it("records the G# lean, which is set by eye below the contact threshold", () => {
    // BLACK_NUDGE_X is chosen by look, not by this measurement. Shortened twice
    // on request — 0.66 -> 0.57 -> 0.385 — and contact follows it down:
    //
    //   0.57 (307px)  60%      0.48 (259px)   5%      0.44 (237px)  0%
    //   0.385 (207px)  0%   <- here
    //
    // So the finger does NOT touch the G# at the current value, deliberately.
    // This test therefore asserts the lean is still APPLIED and still large —
    // which is what a regression would remove — and records the threshold rather
    // than asserting contact that is not there by choice. 0.57 restores it.
    //
    // The lean is also only part of the excursion: the thumb tip peaks 734px
    // right of home, of which the lean is 207px. SONG_AIM_REACH_X supplies the
    // rest, and is the lever if the reach still reads as too far.
    hero = mountHero();
    const c = song();
    const frames = play(hero, c);
    const g = c.notes.find((n) => n.hand === "L" && n.midi === 56);
    const win = frames.filter((f) => f.t >= g.t && f.t < g.t + g.dur);
    const home = frames[5].tips[0][0];
    const reached = Math.max(...win.map((f) => f.tips[0][0])) - home;
    expect(reached / hero.unit).toBeGreaterThan(0.5); // the lean is happening
  });

  it("keeps the fingertip path smooth, lean included", () => {
    // The other smoothness test measures pianoX/pianoY, which is the hand offset
    // ONLY — BLACK_NUDGE is applied in toCanvas and is invisible to it. Without
    // this, the lean could get arbitrarily jerky and no test would notice.
    // Measured on the thumb, the finger the lean actually moves.
    hero = mountHero();
    const u = hero.unit;
    const frames = play(hero, song());
    const steps = [];
    for (let i = 1; i < frames.length; i++) {
      const a = frames[i - 1], b = frames[i];
      const ax = a.tips[0][0] + a.reach[0][0], ay = a.tips[0][1] + a.reach[0][1];
      const bx = b.tips[0][0] + b.reach[0][0], by = b.tips[0][1] + b.reach[0][1];
      steps.push(Math.hypot(bx - ax, by - ay));
    }
    const sorted = [...steps].sort((a, b) => a - b);
    // unit-relative, same reason as the hand-motion test above
    expect(sorted[Math.floor(sorted.length * 0.9)] / u).toBeLessThan(0.080); // measures 0.065
  });
});
