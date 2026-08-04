/** @vitest-environment jsdom */
import { describe, it, expect, afterEach } from "vitest";
import { mountHero } from "./__harness__/heroHarness";
import { SONGS, compileSong } from "../audio/songs";

/**
 * IS THE PLAYING FINGER ON THE KEY IT IS PLAYING?
 *
 * These play the piece through on the harness clock at 60fps. That matters
 * twice over. The hand aims AHEAD of the music, so parking time on a note would
 * catch it reaching for a later one. And the control loop needs dozens of frames
 * to settle — in a throttled browser tab it got 1-5, which is why three earlier
 * attempts at this were tuned against transients and each measured worse.
 *
 * Only frames where the finger is actually PRESSING count. Including the
 * lookahead window, when the finger is deliberately still raised, was a
 * measurement error that made a working aim look like a 0% one.
 *
 * `tipOnAimedKey` comes from HeroField itself: the live fingertip against the
 * drawn quad of the key being aimed at, using the same quad test the renderer
 * uses to decide what to depress. Distance to a sampled point on a key means
 * nothing here — a key is a ~2000px sliver, so a finger correctly on one can sit
 * 2000px from any single point along it.
 */

let hero = null;
afterEach(() => { hero?.destroy(); hero = null; });

const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const noteName = (m) => `${NAMES[m % 12]}${Math.floor(m / 12) - 1}`;
const song = () => compileSong(SONGS.find((s) => s.id === "fur-elise"));

/** Play through, counting only frames where the aiming finger is pressing. */
function strikeCoverage(hero, c, dtMs = 1000 / 60) {
  let t = 0;
  hero.setSong(c, () => t);
  hero.run(600); // keyboard fades up, pose settles, before the clock moves
  const per = new Map();
  const steps = Math.round((c.duration * 1000) / dtMs);
  for (let i = 0; i < steps; i++) {
    t = (i * dtMs) / 1000;
    hero.step(dtMs);
    const p = hero.probe;
    if (!p || !p.aim || !(p.aimStrike > 0.5)) continue;
    const k = p.aim.key;
    if (!per.has(k)) per.set(k, { on: 0, total: 0 });
    per.get(k).total++;
    if (p.tipOnAimedKey) per.get(k).on++;
  }
  return per;
}

describe("playing finger lands on its key", () => {
  it("lights the correct key for every left-hand note", () => {
    // Never in doubt, and worth keeping that way: the press is driven from the
    // note, so it cannot be thrown off by where the hand happens to be.
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

  it("puts the thumb on the G# black key while it is striking", () => {
    // The reported bug: the finger was nowhere near it. A black key is the
    // hardest reach in the piece — set back in depth, and at this yaw depth maps
    // to a long move right — so it is the case that proves the aim works.
    hero = mountHero();
    const gs = strikeCoverage(hero, song()).get("b32");
    expect(gs, "G# was never aimed at while striking").toBeTruthy();
    expect({ key: "b32", reached: gs.on > 0 }).toEqual({ key: "b32", reached: true });
  });

  it("holds the far keys for a decent share of their strike", () => {
    // Arriving for a single frame would not read as playing the key.
    hero = mountHero();
    const per = strikeCoverage(hero, song());
    const frac = (k) => (per.has(k) ? per.get(k).on / per.get(k).total : 0);
    expect(frac("w33")).toBeGreaterThan(0.4); // A3
    expect(frac("b32")).toBeGreaterThan(0.2); // G#3
  });

  it("does not regress: some key is always reached while striking", () => {
    // The state this replaced had tipOnAimedKey false on every note of the
    // piece, because the aim converged the UN-STRUCK fingertip and the strike
    // then drove the finger 1-2 whole key slots past its target.
    hero = mountHero();
    const per = strikeCoverage(hero, song());
    const anyReached = [...per.values()].some((v) => v.on > 0);
    expect(anyReached).toBe(true);
  });
});
