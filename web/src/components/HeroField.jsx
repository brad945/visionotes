import { useRef, useEffect } from "react";
import "./HeroField.css";

// --- Hand-landmark cloud (normalized 0..1 coords) --------------------------------
const LM = [
  [0.5, 0.95],
  [0.33, 0.86], [0.24, 0.76], [0.18, 0.67], [0.14, 0.59],
  [0.4, 0.64], [0.38, 0.47], [0.37, 0.35], [0.36, 0.25],
  [0.5, 0.62], [0.5, 0.43], [0.5, 0.3], [0.5, 0.2],
  [0.6, 0.64], [0.62, 0.47], [0.63, 0.35], [0.64, 0.26],
  [0.69, 0.68], [0.73, 0.55], [0.76, 0.45], [0.78, 0.38],
];
const EDGES = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [0, 9], [9, 10], [10, 11], [11, 12],
  [0, 13], [13, 14], [14, 15], [15, 16],
  [0, 17], [17, 18], [18, 19], [19, 20],
  [5, 9], [9, 13], [13, 17], [1, 5],
];

/**
 * Scroll-pinned particle hero. A pixel-sampled dot cloud assembles into a hand
 * skeleton as the page scrolls through the pinned track. Canvas logic is a
 * direct port of the reference; copy is driven by props.
 */
export default function HeroField({
  eyebrow = "Computer-vision posture coach",
  headline = (
    <>
      Your hands,
      <br />
      <span className="hero-thin">mapped to every key.</span>
    </>
  ),
  lead = "VisioNotes reads 21 joints from any webcam and corrects your form in real time. No sensors. Just vision.",
  // auto: drive progress by time instead of scroll (assemble after a delay).
  auto = false,
  autoDelayMs = 3000,
  autoDurationMs = 4000,
  // background: render the canvas only (no copy/cue/scroll-track), filling its parent.
  background = false,
  // scale: hand size as a fraction of min(viewport w,h).
  scale = 0.78,
  // followCursor: glide the whole cloud toward the pointer.
  followCursor = false,
}) {
  const canvasRef = useRef(null);
  const trackRef = useRef(null);
  const overlayRef = useRef(null);
  const cueRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const track = trackRef.current;
    if (!canvas || !track) return;
    const ctx = canvas.getContext("2d");

    let W, H, DPR;
    let particles = [];
    let edgesScreen = [];
    let progress = 0;
    let rendered = 0;
    let rafId = null;
    let resizeTimer = null;
    let startTime = null; // for auto (time-driven) mode
    let baseCx = 0,
      baseCy = 0; // hand rest center (px)
    let mouseX = null,
      mouseY = null; // pointer in canvas coords (null until first move)
    let offX = 0,
      offY = 0; // smoothed cursor-follow offset

    function buildTargets(cx, cy, s) {
      const pts = [];
      const map = (n) => [cx + (n[0] - 0.5) * s, cy + (n[1] - 0.5) * s];
      for (const lm of LM) {
        const [x, y] = map(lm);
        for (let k = 0; k < 7; k++) {
          const a = Math.random() * Math.PI * 2,
            r = Math.random() * s * 0.012;
          pts.push({ x: x + Math.cos(a) * r, y: y + Math.sin(a) * r, w: 1 });
        }
      }
      for (const [a, b] of EDGES) {
        const pa = map(LM[a]),
          pb = map(LM[b]);
        const len = Math.hypot(pb[0] - pa[0], pb[1] - pa[1]);
        const n = Math.max(8, Math.floor(len / (s * 0.012)));
        for (let i = 0; i < n; i++) {
          const t = i / (n - 1);
          const jx = (Math.random() - 0.5) * s * 0.008;
          const jy = (Math.random() - 0.5) * s * 0.008;
          pts.push({ x: pa[0] + (pb[0] - pa[0]) * t + jx, y: pa[1] + (pb[1] - pa[1]) * t + jy, w: 0.6 });
        }
      }
      return pts;
    }

    function setup() {
      DPR = Math.min(window.devicePixelRatio || 1, 2);
      const r = canvas.getBoundingClientRect();
      W = r.width;
      H = r.height;
      canvas.width = W * DPR;
      canvas.height = H * DPR;
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

      const s = Math.min(W, H) * scale;
      baseCx = W * 0.66;
      baseCy = H * 0.5;
      const cx = baseCx;
      const cy = baseCy;

      const targets = buildTargets(cx, cy, s);

      const MIN = 900;
      while (targets.length < MIN) {
        const base = targets[Math.floor(Math.random() * targets.length)];
        targets.push({
          x: base.x + (Math.random() - 0.5) * s * 0.02,
          y: base.y + (Math.random() - 0.5) * s * 0.02,
          w: 0.5,
        });
      }

      particles = targets.map((t) => {
        const ang = Math.random() * Math.PI * 2;
        const dist = (0.5 + Math.random() * 0.9) * Math.max(W, H);
        return {
          tx: t.x,
          ty: t.y,
          sx: cx + Math.cos(ang) * dist,
          sy: cy + Math.sin(ang) * dist,
          r: t.w > 0.8 ? 0.9 + Math.random() * 0.7 : 0.5 + Math.random() * 0.9,
          delay: Math.random() * 0.4,
          twk: Math.random() * Math.PI * 2,
          bright: 0.35 + Math.random() * 0.5,
        };
      });

      edgesScreen = EDGES.map(([a, b]) => {
        const map = (n) => [cx + (n[0] - 0.5) * s, cy + (n[1] - 0.5) * s];
        return [map(LM[a]), map(LM[b])];
      });
    }

    const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    const lerp = (a, b, t) => a + (b - a) * t;

    function computeProgress() {
      if (auto) {
        // Time-driven: hold dispersed for autoDelayMs, then assemble over autoDurationMs.
        if (startTime == null) startTime = performance.now();
        const elapsed = performance.now() - startTime;
        progress = clamp((elapsed - autoDelayMs) / autoDurationMs, 0, 1);
        return;
      }
      const rect = track.getBoundingClientRect();
      const scrollable = rect.height - window.innerHeight;
      progress = clamp(-rect.top / scrollable, 0, 1);
    }

    function draw() {
      if (auto) computeProgress(); // recompute from the clock each frame
      rendered += (progress - rendered) * 0.12;
      const P = rendered;

      // Cursor-follow: ease the whole cloud toward the pointer (partial, damped).
      if (followCursor && mouseX != null) {
        const FOLLOW = 0.6;
        offX += ((mouseX - baseCx) * FOLLOW - offX) * 0.08;
        offY += ((mouseY - baseCy) * FOLLOW - offY) * 0.08;
      }

      ctx.clearRect(0, 0, W, H);

      const edgeP = clamp((P - 0.6) / 0.4, 0, 1);
      if (edgeP > 0.01) {
        ctx.lineWidth = 1;
        ctx.strokeStyle = `rgba(94,234,212,${0.1 * edgeP})`;
        for (const [pa, pb] of edgesScreen) {
          ctx.beginPath();
          ctx.moveTo(pa[0] + offX, pa[1] + offY);
          ctx.lineTo(pb[0] + offX, pb[1] + offY);
          ctx.stroke();
        }
      }

      const now = performance.now();
      for (const p of particles) {
        const local = easeInOut(clamp((P - p.delay) / (1 - p.delay), 0, 1));
        const x = lerp(p.sx, p.tx, local);
        const y = lerp(p.sy, p.ty, local);
        const tw = (1 - local) * 1.2;
        const dx = Math.sin(now / 1600 + p.twk) * tw;
        const dy = Math.cos(now / 1900 + p.twk) * tw;
        const settled = local;
        const a = (0.15 + p.bright * 0.85) * (0.4 + 0.6 * settled);
        if (p.r > 1.2 && settled > 0.7) {
          ctx.fillStyle = `rgba(94,234,212,${a})`;
        } else {
          ctx.fillStyle = `rgba(231,237,245,${a})`;
        }
        ctx.beginPath();
        ctx.arc(x + dx + offX, y + dy + offY, p.r, 0, Math.PI * 2);
        ctx.fill();
      }

      const copyFade = clamp(1 - (P - 0.15) / 0.45, 0, 1);
      if (overlayRef.current) overlayRef.current.style.opacity = copyFade;
      if (cueRef.current) cueRef.current.style.opacity = clamp(1 - P / 0.12, 0, 1);

      rafId = requestAnimationFrame(draw);
    }

    function onScroll() {
      computeProgress();
    }
    function onMouseMove(e) {
      const r = canvas.getBoundingClientRect();
      mouseX = e.clientX - r.left;
      mouseY = e.clientY - r.top;
    }
    function onResize() {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        setup();
        computeProgress();
      }, 150);
    }

    // init
    setup();
    computeProgress();
    rendered = progress;
    rafId = requestAnimationFrame(draw);

    if (!auto) window.addEventListener("scroll", onScroll, { passive: true });
    if (followCursor) window.addEventListener("mousemove", onMouseMove, { passive: true });
    window.addEventListener("resize", onResize);

    return () => {
      cancelAnimationFrame(rafId);
      clearTimeout(resizeTimer);
      if (!auto) window.removeEventListener("scroll", onScroll);
      if (followCursor) window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("resize", onResize);
    };
  }, [auto, autoDelayMs, autoDurationMs, scale, followCursor]);

  // Background mode: just the canvas, filling its (positioned) parent.
  if (background) {
    return (
      <div className="hero-fill" ref={trackRef}>
        <canvas className="hero-canvas" ref={canvasRef} />
      </div>
    );
  }

  return (
    <div className="hero-track" ref={trackRef}>
      <div className="hero-pin">
        <canvas className="hero-canvas" ref={canvasRef} />
        <div className="hero-overlay" ref={overlayRef}>
          <div className="hero-eyebrow">{eyebrow}</div>
          <h1 className="hero-headline">{headline}</h1>
          <p className="hero-lead">{lead}</p>
        </div>
        <div className="hero-cue" ref={cueRef}>
          <span>scroll</span>
          <span className="hero-cue-line" />
        </div>
      </div>
    </div>
  );
}
