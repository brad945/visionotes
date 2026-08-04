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
});
