/**
 * HEADLESS HERO HARNESS
 *
 * Runs the REAL HeroField draw loop, deterministically, with no browser.
 *
 * Why this exists. The hero lives entirely inside requestAnimationFrame, and
 * browsers do not fire rAF in a hidden document — so the only way to observe it
 * was a visible tab, which Chrome then throttles to 1-5 frames per second after
 * a few minutes. A control loop that needs ~15 frames to settle simply never
 * settles inside a measurement, so every reading was a transient. Three separate
 * "fixes" were tuned against that noise and each measured worse than the last.
 *
 * The fix is to own the clock. Nothing here is mocked except the pixels:
 *  - getContext("2d") returns a no-op recorder, so every draw call is accepted
 *    and discarded. The GEOMETRY still runs — which is the part under test.
 *  - requestAnimationFrame is replaced by a manual stepper, so a frame happens
 *    when the test says so, at exactly the dt the test chooses.
 *  - the song clock is a plain number the test sets.
 *
 * The component therefore executes its real code path, at a real frame rate,
 * and the probe it already publishes becomes a reliable measurement.
 */
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import ThemeProvider from "../../theme/ThemeProvider";
import HeroField from "../../components/HeroField";
import { setSongSource, clearSongSource } from "../../audio/songBus";

/** A 2D context that accepts every call and remembers nothing. */
function stubContext() {
  const noop = () => {};
  const ctx = {
    canvas: null,
    // state that the code reads back
    globalAlpha: 1,
    globalCompositeOperation: "source-over",
    fillStyle: "#000",
    strokeStyle: "#000",
    lineWidth: 1,
    lineJoin: "round",
    lineCap: "round",
    filter: "none",
    font: "",
  };
  for (const m of [
    "setTransform", "transform", "translate", "rotate", "scale", "save", "restore",
    "clearRect", "fillRect", "beginPath", "moveTo", "lineTo", "closePath", "fill",
    "stroke", "arc", "drawImage", "fillText", "createLinearGradient", "measureText",
    "getImageData", "putImageData",
  ]) ctx[m] = noop;
  ctx.createLinearGradient = () => ({ addColorStop: noop });
  ctx.measureText = () => ({ width: 0 });
  ctx.getImageData = () => ({ data: new Uint8ClampedArray(4) });
  return ctx;
}

/**
 * Mount the hero and return a controller.
 *
 * `width`/`height` set the viewport the component measures itself against —
 * getBoundingClientRect is stubbed because jsdom reports every element as 0x0,
 * and a 0-wide canvas makes the whole layout degenerate.
 */
export function mountHero({ width = 1600, height = 900, scale = 0.56, dpr = 2 } = {}) {
  const frames = [];
  const realRAF = globalThis.requestAnimationFrame;
  const realCAF = globalThis.cancelAnimationFrame;
  let nextId = 1;
  const pending = new Map();

  // Manual clock. performance.now() drives the component's own timing, so the
  // harness owns it outright rather than racing a real one.
  let clockMs = 0;
  const realNow = performance.now.bind(performance);
  performance.now = () => clockMs;

  globalThis.requestAnimationFrame = (cb) => {
    const id = nextId++;
    pending.set(id, cb);
    return id;
  };
  globalThis.cancelAnimationFrame = (id) => pending.delete(id);

  globalThis.devicePixelRatio = dpr;
  HTMLCanvasElement.prototype.getContext = function () {
    if (!this.__ctx) this.__ctx = stubContext();
    return this.__ctx;
  };
  Element.prototype.getBoundingClientRect = function () {
    return { width, height, top: 0, left: 0, right: width, bottom: height, x: 0, y: 0 };
  };
  // the probe is gated on this
  globalThis.__rafShim = { frames: 0, paused: false, headless: true };
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;

  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => {
    root.render(createElement(ThemeProvider, null, createElement(HeroField, { scale, followCursor: false })));
  });

  return {
    /** Advance exactly one frame, `dtMs` after the last. */
    step(dtMs = 1000 / 60) {
      clockMs += dtMs;
      const due = [...pending.entries()];
      pending.clear();
      for (const [, cb] of due) cb(clockMs);
      frames.push(globalThis.__vnProbe);
      globalThis.__rafShim.frames++;
      return globalThis.__vnProbe;
    },
    /** Advance `ms` of simulated time at a fixed frame rate. */
    run(ms, dtMs = 1000 / 60) {
      const n = Math.max(1, Math.round(ms / dtMs));
      let last;
      for (let i = 0; i < n; i++) last = this.step(dtMs);
      return last;
    },
    setSong(compiled, timeFn) { setSongSource(compiled, timeFn); },
    clearSong() { clearSongSource(); },
    get probe() { return globalThis.__vnProbe; },
    get clock() { return clockMs; },
    destroy() {
      act(() => root.unmount());
      host.remove();
      performance.now = realNow;
      globalThis.requestAnimationFrame = realRAF;
      globalThis.cancelAnimationFrame = realCAF;
      clearSongSource();
    },
  };
}
