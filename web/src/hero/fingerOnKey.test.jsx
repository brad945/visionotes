/** @vitest-environment jsdom */
import { describe, it, expect, afterEach } from "vitest";
import { mountHero } from "./__harness__/heroHarness";
import { SONGS, compileSong } from "../audio/songs";

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
    if (p) frames.push({ t, x: p.pianoX, y: p.pianoY, aim: p.aim?.key, strike: p.aimStrike, on: p.tipOnAimedKey });
  }
  return frames;
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
    const frames = play(hero, c);
    // after each G# passage, the hand should be back near home within a second
    const gsharps = c.notes.filter((n) => n.hand === "L" && n.midi === 56);
    const stranded = [];
    for (const g of gsharps) {
      const after = frames.filter((f) => f.t > g.t + 0.8 && f.t < g.t + 1.6);
      if (!after.length) continue;
      const closest = Math.min(...after.map((f) => Math.abs(f.x)));
      if (closest > 200) stranded.push(`after G# @${g.t.toFixed(2)}: nearest home was ${Math.round(closest)}px`);
    }
    expect(stranded).toEqual([]);
  });

  it("moves smoothly rather than darting", () => {
    // "Shakey" in numbers: per-frame travel at 60fps. A lunge shows up here long
    // before it is describable.
    hero = mountHero();
    const frames = play(hero, song());
    const steps = [];
    for (let i = 1; i < frames.length; i++) {
      steps.push(Math.hypot(frames[i].x - frames[i - 1].x, frames[i].y - frames[i - 1].y));
    }
    const sorted = [...steps].sort((a, b) => a - b);
    const p90 = sorted[Math.floor(sorted.length * 0.9)];
    expect(p90).toBeLessThan(20); // px per frame
    expect(Math.max(...steps) * 60).toBeLessThan(1700); // px/sec
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

  it("documents that G# is approached but not landed inside its note", () => {
    // Honest record of a measured limit, not an aspiration — and NOT one the
    // travel bounds can lift. Sweeping SONG_AIM_REACH_X from 0.75 to 1.45 leaves
    // this at 0% the whole way, while the X clamp fires on 26 of 26 struck frames
    // at every single value. The hand is always against the wall, so the aim
    // target for a black key must be running away rightward without limit: a
    // defect in the black-key goal, not a lack of reach.
    //
    // So if this starts passing, do NOT assume the bounds fixed it. Check the
    // black-key goal in the songAim block, and check the camera yaw.
    hero = mountHero();
    const frames = play(hero, song()).filter((f) => f.aim === "b32" && f.strike > 0.5);
    expect(frames.length).toBeGreaterThan(0); // it IS aimed at while striking
    const on = frames.filter((f) => f.on).length;
    expect(on / frames.length).toBeLessThan(0.2); // and does not arrive
  });
});
