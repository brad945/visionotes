/**
 * DEV-ONLY rAF shim.
 *
 * The hero animation lives entirely inside a requestAnimationFrame loop, and
 * browsers never fire rAF in a document whose visibilityState is "hidden" —
 * which is how headless/automated browsers and background tabs run. The canvas
 * therefore stays permanently blank there, so the animation cannot be
 * screenshotted, pixel-inspected, or regression-checked by tooling. That gap is
 * how several visual bugs shipped: they were reasoned about, never observed.
 *
 * With `?rafshim=1` this backs rAF with a timer, so the draw loop runs and the
 * canvas paints even in a hidden document. Timers are not visibility-gated the
 * way rAF is.
 *
 * Guarded twice: `import.meta.env.DEV` (so Vite strips it from production
 * builds entirely) and an explicit query flag (so it is inert in normal dev).
 *
 * Must be installed BEFORE the app mounts — HeroField's effect captures whatever
 * requestAnimationFrame is on `window` when it first runs, and it does not
 * re-run on hot reload, so patching later has no effect until a full reload.
 */
export function installRafShim() {
  if (!import.meta.env.DEV) return false;
  if (typeof window === "undefined") return false;
  if (!new URLSearchParams(window.location.search).has("rafshim")) return false;

  let nextId = 1;
  const pending = new Map();

  window.__rafShim = { frames: 0, paused: false };

  window.requestAnimationFrame = (cb) => {
    const id = nextId++;
    const timer = setTimeout(() => {
      pending.delete(id);
      // `paused` lets tooling freeze the canvas on an interesting frame and
      // screenshot it, instead of racing a live loop.
      if (window.__rafShim.paused) return;
      window.__rafShim.frames++;
      cb(performance.now());
    }, 0);
    pending.set(id, timer);
    return id;
  };

  window.cancelAnimationFrame = (id) => {
    const timer = pending.get(id);
    if (timer !== undefined) {
      clearTimeout(timer);
      pending.delete(id);
    }
  };

  return true;
}
