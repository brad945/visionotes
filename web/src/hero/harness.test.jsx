/** @vitest-environment jsdom */
import { describe, it, expect, afterEach } from "vitest";
import { mountHero } from "./__harness__/heroHarness";
import { SONGS, compileSong } from "../audio/songs";

let hero = null;
afterEach(() => { hero?.destroy(); hero = null; });

const furElise = () => compileSong(SONGS.find((s) => s.id === "fur-elise"));

describe("hero harness", () => {
  it("runs the real draw loop and publishes a probe", () => {
    // The probe is published from the keyboard block, which only runs once the
    // keyboard is up — either a song is playing or the cursor has been still
    // past the idle threshold. Attach a song rather than wait 2.7s.
    hero = mountHero();
    hero.setSong(furElise(), () => 1.4);
    const p = hero.run(400);
    expect(p).toBeTruthy();
    expect(typeof p.pianoX).toBe("number");
    expect(p.tips && Object.keys(p.tips).length).toBe(5);
  });

  it("advances exactly one frame per step, on the harness clock", () => {
    hero = mountHero();
    const before = hero.clock;
    hero.step(16);
    expect(hero.clock - before).toBe(16);
  });

  it("gives the loop enough frames to actually settle", () => {
    // The whole point: 1 second of simulated time is 60 frames here, where a
    // throttled browser tab gave 1-5. A controller that needs ~15 frames to
    // converge can only be measured honestly at this rate.
    hero = mountHero();
    const start = globalThis.__rafShim.frames;
    hero.run(1000);
    expect(globalThis.__rafShim.frames - start).toBe(60);
  });

  it("drives the hand from a song and moves it", () => {
    hero = mountHero();
    const c = furElise();
    let t = 0;
    hero.setSong(c, () => t);
    hero.run(400); // let the keyboard fade in and the pose settle
    const a = { x: hero.probe.pianoX, y: hero.probe.pianoY };
    t = 2.70; // the G#3 strike, several keys away
    hero.run(600);
    const b = { x: hero.probe.pianoX, y: hero.probe.pianoY };
    expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeGreaterThan(5);
  });

  it("scales the idle phrase with the hand", () => {
    // The idle animation is driven by angles apart from one lateral drift, which
    // was 13 raw pixels. Angles already give proportional travel, so when the
    // hand was resized only the drift stayed put: the full sweep measured 31.1px
    // at EVERY hand size and viewport — 0.062 unit at scale 0.56 but 0.058 at
    // 0.60 and 0.048 at 1920x1080, so the bigger the hand the less it moved
    // relative to itself.
    //
    // Asserting the RATIO rather than the pixels is the point: pixels are what
    // let this rot silently.
    const drift = (opts) => {
      const h = mountHero(opts);
      try {
        h.run(3200); // past the idle threshold, so the keyboard is up
        const xs = [];
        for (let i = 0; i < 600; i++) { h.step(); if (h.probe) xs.push(h.probe.pianoX); }
        return (Math.max(...xs) - Math.min(...xs)) / h.unit;
      } finally { h.destroy(); }
    };
    const ratios = [
      drift({ width: 1600, height: 900, scale: 0.60 }),
      drift({ width: 1280, height: 800, scale: 0.60 }),
      drift({ width: 1920, height: 1080, scale: 0.60 }),
      drift({ width: 1600, height: 900, scale: 0.56 }),
    ];
    expect(Math.max(...ratios)).toBeGreaterThan(0.03); // it really does drift
    for (const r of ratios) expect(r).toBeCloseTo(ratios[0], 4);
  });
});
