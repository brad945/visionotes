import { useRef, useEffect } from "react";
import { useTheme } from "../theme/ThemeProvider";
import "./HeroField.css";

// Theme-aware particle palettes (rgb triples used in rgba()).
const PALETTES = {
  // solid = opaque hand fill (a hair off bg) so overlapping fingers occlude.
  dark: { bg: "#07090d", solid: "#161d27", base: "231,237,245", accent: "94,234,212" },
  light: { bg: "#f3f6f7", solid: "#dfe6e9", base: "22,25,27", accent: "14,124,134" },
};

// --- Hand rig: SIDE PROFILE of a pianist's hand (local frame: x = forward/right,
// y = UP, wrist at origin). Forearm enters from the left; the back of the hand
// arches up over the keys; fingers hang down and curl toward the cursor. ---
const DEG = Math.PI / 180;
const MODEL_ALPHA = 0.82; // whole hand/arm rendered slightly transparent
// How a finger's total curl is distributed across its knuckles. Distal joints
// flex MORE than the base knuckle, so the finger rolls up like a real one
// (not a rigid stick rotating about the MCP).
const CURL_PROFILE3 = [0.6, 1.05, 1.35]; // index/middle/ring/pinky (MCP, PIP, DIP)
const CURL_PROFILE2 = [0.85, 1.15]; // thumb (MCP, IP)
// MCP knuckles ride an upward arch (the "good posture" dome). Each finger points
// down-forward from its knuckle and curls under; rest base angle is from +x
// (−90°=straight down). restCurl (negative) curls the fingertip back under.
// w = half-width at the MCP (local units); fingers taper to TIP_RATIO of that.
// `prof` = this finger's OWN curl distribution across (MCP, PIP, DIP) — each
// finger bends a little differently so they don't read as identical clones.
// A bigger middle value = a sharper, more angular bend at the PIP knuckle.
const FINGERS = [
  { name: "thumb", mcp: [0.34, 0.16], rest: -16 * DEG, seg: [0.34, 0.27], prof: [0.85, 1.15], restCurl: 0 * DEG, reachW: 0.7, w: 0.1 },
  // rest/restCurl define the IDLE pose only (reaching uses live IK). `mcp` is the
  // PALM knuckle — it anchors the palm arch / dome. The FINGER itself is drawn from
  // mcp + FINGER_OFFSET, so the fingers can sit lower/right of the palm WITHOUT
  // dragging the palm or wrist down (those stay put).
  { name: "index", mcp: [0.56, 0.5], rest: 14 * DEG, seg: [0.428, 0.3, 0.214], prof: [0.62, 1.08, 1.3], restCurl: -31 * DEG, reachW: 1, w: 0.0899 },
  { name: "middle", mcp: [0.72, 0.54], rest: 14 * DEG, seg: [0.44, 0.3, 0.21], prof: [0.8, 1.2, 1.0], restCurl: -31 * DEG, reachW: 1, w: 0.084 },
  { name: "ring", mcp: [0.87, 0.5], rest: 14 * DEG, seg: [0.4, 0.28, 0.2], prof: [0.5, 1.34, 1.16], restCurl: -31 * DEG, reachW: 1, w: 0.077 },
  { name: "pinky", mcp: [1.0, 0.42], rest: 14 * DEG, seg: [0.3, 0.22, 0.16], prof: [0.72, 0.96, 1.5], restCurl: -31 * DEG, reachW: 1, w: 0.064 },
];
// Fingers are drawn from this offset off their palm knuckle (palm stays put).
const FINGER_OFFSET = [0.04, -0.06]; // [right, down] — tune the DOWN value to taste
// Landmark dots (knuckle joints + fingertips). Hidden for the clean dotted-outline
// look; flip either to `true` to bring them back when tuning/editing the rig.
const SHOW_JOINT_DOTS = false;
const SHOW_TIP_DOTS = false;
const TIP_RATIO = 0.58; // distal half-width relative to MCP half-width
const WRIST = [0, 0.13]; // slightly raised so the wrist line isn't collapsed
const ELBOW = [-0.92, 0.1]; // forearm runs back-left to an off-screen elbow (also the lift pivot)
const FOREARM_END = [-3.2, -0.5]; // the forearm is DRAWN out to here (far past the elbow): far
//                                   left so it never cuts off when the hand lunges, and LOW so
//                                   the forearm rises into the wrist in line with the hand (≈180°)
// Open up the wrist angle: rotate the forearm UP (CCW) and the hand DOWN (CW),
// each about the wrist. Tune these two to taste (degrees).
const ARM_RAISE = 0 * DEG; // forearm rotation about the wrist (+ = CCW/up, − = CW/down)
const HAND_DROOP = -5 * DEG; // hand (palm + fingers) rotation about the wrist (+ = CW/down, − = CCW/up)
const rotW = (p, ang) => {
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  const vx = p[0] - WRIST[0];
  const vy = p[1] - WRIST[1];
  return [WRIST[0] + vx * c - vy * s, WRIST[1] + vx * s + vy * c];
};
// Tip-IK: each FINGERTIP reaches toward the cursor, and how much the finger
// CURLS is derived from how close the cursor is relative to the finger's full
// length — far → straighten to reach; close → curl/crunch to keep the tip near
// it. The curl total comes from distance; CURL_PROFILE spreads it over knuckles.
// "Good zone": the cursor is right of the thumb knuckle. Left of it (over the
// wrist/forearm or behind the hand) the fingers smoothly relax to rest instead
// of whipping around an ill-defined aim direction.
const FRONT_LO = 0.54; // cursor AT or LEFT of here (right of the thumb knuckle) → fully
//                        idle: hand ignores the cursor and rests with idle breathing.
const FRONT_HI = 0.72; // cursor well right of here → fully engaged (tracks the cursor)
const IDLE_AFTER_MS = 2000; // cursor sitting still this long → relax to the rest pose too
const IDLE_FADE_MS = 700; // ease into that idle over this window (no snap)
const CLICK_MS = 220; // duration of the index "press" tap when the Send-link button is clicked
const CLICK_DROP = 1.6 * DEG; // how far the index dips down at the peak of the press (very subtle)
const FINGER_MIN = -104 * DEG; // anatomical clamp on the FINAL base angle (down)
const FINGER_MAX = 14 * DEG; // anatomical clamp (up) — no wrist hyperextension
const INDEX_MAX = 42 * DEG; // the index alone may rise higher, to point up at a high cursor
const REACH_MIN_RATIO = 0.45; // tightest curl: tip won't pull closer than 45% of length
const CURL_SPAN = 78 * DEG; // per-knuckle curl at full crunch (× CURL_PROFILE)
const FAR_FADE = 4.5; // local units: beyond ~this the hand relaxes toward its natural
//                       fanned rest pose instead of straining straight at a far cursor.
// Index acts as a pointer: the higher the cursor, the straighter it goes, so it
// points more directly at the cursor and separates from the curled long fingers.
const INDEX_HIGH_LO = 0.3; // cursor local height where the pointing starts
const INDEX_HIGH_RANGE = 0.55; // height over which it ramps to full pointing
const INDEX_STRAIGHTEN = 0.35; // fraction of its curl the index keeps when fully pointing
// Thumb-only: unlike the long fingers (which just flex inward), the thumb can
// also EXTEND/bend back — which reads correctly from the side when the cursor is
// high or forward. Its curl is signed by the direction to the cursor.
const THUMB_NEUTRAL = -15 * DEG; // cursor direction above this → thumb extends back
const THUMB_SPLIT = 65 * DEG; // direction range mapped across full flex ↔ extend
const THUMB_FLEX = 42 * DEG; // max inward curl, per knuckle
const THUMB_EXT = 30 * DEG; // max backward bend, per knuckle (limited, like a real thumb)
// Arm lift: when the cursor is high AND close, the hand hinges up at the elbow so
// the knuckles rise to meet it (gated on the RESTING knuckle to avoid feedback).
const LIFT_RADIUS = 1.8; // cursor within this of the resting middle knuckle → can lift
const LIFT_REST_Y = 0.15; // cursor above this local height (≈ mid-hand) starts the lift
const LIFT_RANGE = 0.55; // local height over which lift ramps to full
const MAX_LIFT = 28 * DEG; // most the hand will hinge up

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
// Cheap deterministic hash → [0,1). Used to scatter the outline dots (jitter
// their position/size/spacing) so the silhouette reads hand-drawn, not stamped
// on a perfect line. Deterministic in the dot index → a STABLE scatter that
// doesn't shimmer frame-to-frame while the geometry holds still.
const hash01 = (n) => {
  const s = Math.sin(n) * 43758.5453;
  return s - Math.floor(s);
};
// Catmull-Rom through a CLOSED ring of control points → a denser, rounded ring.
// Turns the blocky forearm/palm polygons into smooth organic curves.
const smoothClosed = (pts, sub) => {
  const n = pts.length;
  const out = [];
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    const p3 = pts[(i + 2) % n];
    for (let s = 0; s < sub; s++) {
      const t = s / sub;
      const t2 = t * t;
      const t3 = t2 * t;
      out.push([
        0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
        0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
      ]);
    }
  }
  return out;
};
// Ray-cast point-in-polygon (poly = array of [x,y]). Used to suppress outline
// dots that fall inside another body part, so the hand reads as one piece.
const pointInPoly = (x, y, poly) => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0];
    const yi = poly[i][1];
    const xj = poly[j][0];
    const yj = poly[j][1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};

// Shape of a finger curled by `curl` (per-knuckle × CURL_PROFILE) with base=0,
// in the LOCAL (y-up) frame: the chord angle from MCP to tip and the chord
// length. Used to aim the tip — set base = (dir to cursor) − alpha.
function chordShape(seg, curl, prof) {
  prof = prof || (seg.length === 2 ? CURL_PROFILE2 : CURL_PROFILE3);
  let a = 0;
  let x = 0;
  let y = 0;
  for (let i = 0; i < seg.length; i++) {
    a += curl * prof[i];
    x += Math.cos(a) * seg[i];
    y += Math.sin(a) * seg[i];
  }
  return { alpha: Math.atan2(y, x), len: Math.hypot(x, y) };
}

/**
 * Skeletal hand whose fingers articulate toward the cursor (procedural forward
 * kinematics with anatomical limits + idle breathing), rendered as a dot cloud.
 */
export default function HeroField({ background = false, scale = 0.34, followCursor = true, overlay = false }) {
  const { theme } = useTheme();
  const bgCanvasRef = useRef(null); // hand body + non-index fingers (BEHIND the form)
  const fgCanvasRef = useRef(null); // the index finger only (ABOVE the form)
  const themeRef = useRef(theme);
  useEffect(() => {
    themeRef.current = theme;
  }, [theme]);

  useEffect(() => {
    const bgCanvas = bgCanvasRef.current;
    const fgCanvas = fgCanvasRef.current;
    if (!bgCanvas || !fgCanvas) return;
    const bgCtx = bgCanvas.getContext("2d");
    const fgCtx = fgCanvas.getContext("2d");
    const canvas = bgCanvas; // the bg canvas drives sizing / cursor math

    let W, H, DPR, unit, cx, wristY;
    let mouseX = null, mouseY = null;
    let rafId = null, resizeTimer = null;
    let t0 = performance.now();
    let lastMove = t0; // timestamp of the last cursor movement (for the idle timeout)
    let armLift = 0; // eased: the whole hand pivots up at the elbow to reach high cursors
    let lungeX = 0, lungeY = 0; // eased translation of the whole model toward the Send button
    let lastIdxTip = null; // index fingertip (canvas px) from the previous frame
    let clickT = -1e9; // timestamp of the last Send-link click (for the index press tap)

    // per-finger eased state {base, curl}
    const state = FINGERS.map((f) => ({ base: f.rest, curl: f.restCurl }));

    function setup() {
      DPR = Math.min(window.devicePixelRatio || 1, 2);
      const r = canvas.getBoundingClientRect();
      W = r.width;
      H = r.height;
      for (const [cv, c2] of [[bgCanvas, bgCtx], [fgCanvas, fgCtx]]) {
        cv.width = W * DPR;
        cv.height = H * DPR;
        c2.setTransform(DPR, 0, 0, DPR, 0, 0);
        c2.lineJoin = "round";
        c2.lineCap = "round";
      }
      unit = Math.min(W, H) * scale;
      cx = W * 0.22; // wrist toward the left; the forearm runs off the left edge
      wristY = H * 0.81 + 110; // vertical position of the wrist on the canvas (smaller = higher)
    }

    // Rotate a local point about the ELBOW by `ang` (lifts the wrist+hand up;
    // the elbow stays fixed, so the forearm hinges like a raising arm).
    const liftLocal = (p, ang) => {
      const vx = p[0] - ELBOW[0];
      const vy = p[1] - ELBOW[1];
      const c = Math.cos(ang);
      const s = Math.sin(ang);
      return [ELBOW[0] + vx * c - vy * s, ELBOW[1] + vx * s + vy * c];
    };
    // local (hand-frame) -> canvas px, with the current arm lift applied.
    const toCanvas = (p) => {
      const q = armLift ? liftLocal(p, armLift) : p;
      return [cx + lungeX + q[0] * unit, wristY + lungeY - q[1] * unit];
    };
    // canvas px -> local (un-lifted frame; the cursor lives here)
    const toLocal = (x, y) => [(x - cx - lungeX) / unit, (wristY + lungeY - y) / unit];

    function fingerJoints(mcp, base, curl, seg, prof) {
      prof = prof || (seg.length === 2 ? CURL_PROFILE2 : CURL_PROFILE3);
      const joints = [mcp];
      let a = base;
      let p = mcp;
      for (let i = 0; i < seg.length; i++) {
        a += curl * prof[i]; // flex AT this knuckle before drawing the bone
        p = [p[0] + Math.cos(a) * seg[i], p[1] + Math.sin(a) * seg[i]];
        joints.push(p);
      }
      return joints;
    }

    // Build a closed, tapered finger silhouette by offsetting the joint spine
    // perpendicularly (base→tip taper) and rounding the fingertip. Returns local pts.
    function fingerContour(joints, baseHW) {
      const m = joints.length;
      const tipHW = baseHW * TIP_RATIO;
      const left = [];
      const right = [];
      for (let k = 0; k < m; k++) {
        let dx, dy;
        if (k < m - 1) {
          dx = joints[k + 1][0] - joints[k][0];
          dy = joints[k + 1][1] - joints[k][1];
        } else {
          dx = joints[k][0] - joints[k - 1][0];
          dy = joints[k][1] - joints[k - 1][1];
        }
        const len = Math.hypot(dx, dy) || 1;
        const px = -dy / len;
        const py = dx / len; // CCW perpendicular
        const hw = lerp(baseHW, tipHW, k / (m - 1));
        left.push([joints[k][0] + px * hw, joints[k][1] + py * hw]);
        right.push([joints[k][0] - px * hw, joints[k][1] - py * hw]);
      }
      const N = 7;
      // rounded tip cap: arc around the last joint, left→forward→right
      const tip = joints[m - 1];
      const fwd = Math.atan2(tip[1] - joints[m - 2][1], tip[0] - joints[m - 2][0]);
      const tipCap = [];
      for (let s = 0; s <= N; s++) {
        const a = fwd + Math.PI / 2 - Math.PI * (s / N);
        tipCap.push([tip[0] + Math.cos(a) * tipHW, tip[1] + Math.sin(a) * tipHW]);
      }
      // rounded knuckle (base) cap: arc around the MCP joint, bulging BACK away
      // from the finger. This gives the knuckle end its own rounded outline —
      // not a bare gap, and not the flat connection line. Closes right→back→left.
      const base = joints[0];
      const bwd = Math.atan2(base[1] - joints[1][1], base[0] - joints[1][0]);
      const baseCap = [];
      for (let s = 0; s <= N; s++) {
        const a = bwd + Math.PI / 2 - Math.PI * (s / N);
        baseCap.push([base[0] + Math.cos(a) * baseHW, base[1] + Math.sin(a) * baseHW]);
      }
      return [...left, ...tipCap, ...right.reverse(), ...baseCap];
    }


    function draw() {
      const now = performance.now();
      const t = (now - t0) / 1000;
      const ctx = bgCtx; // main render target = the layer drawn BEHIND the form
      bgCtx.clearRect(0, 0, W, H);
      fgCtx.clearRect(0, 0, W, H);
      bgCtx.globalAlpha = MODEL_ALPHA; // render the whole model slightly transparent
      fgCtx.globalAlpha = MODEL_ALPHA;

      // Lunge toward the "Send link" button when the cursor is over it: ease the
      // whole model so the index fingertip closes onto the cursor (just touching the
      // button). While hovering, keep the hand engaged (reset the idle timeout).
      const sendBtn = followCursor && mouseX != null ? document.querySelector(".login-send-btn") : null;
      let overButton = false;
      if (sendBtn) {
        const br = sendBtn.getBoundingClientRect();
        const cr = canvas.getBoundingClientRect();
        const pxc = mouseX + cr.left;
        const pyc = mouseY + cr.top;
        overButton = pxc >= br.left && pxc <= br.right && pyc >= br.top && pyc <= br.bottom;
      }
      if (overButton) {
        lastMove = now; // stay engaged while hovering the button
        if (lastIdxTip) {
          lungeX += (mouseX - lastIdxTip[0]) * 0.1; // close the gap to the cursor
          lungeY += (mouseY - lastIdxTip[1]) * 0.1;
        }
      } else {
        lungeX += (0 - lungeX) * 0.07; // ease back home
        lungeY += (0 - lungeY) * 0.07;
      }

      // index "press" tap on a Send-link click: a quick down→up pulse (snappy, not
      // damped) that dips the index as if pressing the button, then springs back.
      const sinceClick = now - clickT;
      const clickPress = sinceClick >= 0 && sinceClick < CLICK_MS ? Math.sin((sinceClick / CLICK_MS) * Math.PI) : 0;

      const haveCursor = followCursor && mouseX != null;
      const lc = haveCursor ? toLocal(mouseX, mouseY) : null;

      // Behind-gate: relax toward rest when the cursor is to the LEFT (behind the
      // "front": how far into the good zone (right of the thumb knuckle) the
      // cursor is. 0 when it's over the wrist/forearm or behind → fingers relax.
      // Idle when the cursor is too far left OR hasn't moved for IDLE_AFTER_MS.
      const idleActive = 1 - smoothstep(IDLE_AFTER_MS, IDLE_AFTER_MS + IDLE_FADE_MS, now - lastMove);
      const front = lc ? smoothstep(FRONT_LO, FRONT_HI, lc[0]) * idleActive : 0;

      // Arm lift: hinge the hand up at the elbow when the cursor is high AND close
      // AND in the good zone. Gated on the RESTING middle knuckle (never the lifted
      // one) so it can't feed back on itself. Eased for flow.
      let liftTarget = 0;
      if (lc) {
        const ref = FINGERS[2].mcp; // resting middle knuckle
        const prox = clamp(1 - Math.hypot(lc[0] - ref[0], lc[1] - ref[1]) / LIFT_RADIUS, 0, 1);
        const elev = clamp((lc[1] - LIFT_REST_Y) / LIFT_RANGE, 0, 1);
        liftTarget = MAX_LIFT * prox * elev * front;
      }
      armLift += (liftTarget - armLift) * 0.12;

      FINGERS.forEach((f, i) => {
        const st = state[i];
        let targetBase = f.rest;
        let targetCurl = f.restCurl;

        if (lc) {
          // Tip-IK: aim THIS fingertip at the cursor. Measured from the finger's
          // LIFTED knuckle (the hand may have hinged up), in the local frame.
          // hand is displayed drooped by HAND_DROOP, so aim at the cursor rotated
          // into the un-drooped frame (keeps the fingertip on the real cursor).
          const aim = rotW(lc, HAND_DROOP);
          const mcp = liftLocal([f.mcp[0] + FINGER_OFFSET[0], f.mcp[1] + FINGER_OFFSET[1]], armLift);
          const dx = aim[0] - mcp[0];
          const dy = aim[1] - mcp[1];
          const beta = Math.atan2(dy, dx); // direction lifted-MCP → cursor
          const dCursor = Math.hypot(dx, dy);
          const maxLen = f.seg.reduce((s, v) => s + v, 0);

          // CURL is derived from distance, but FLOORED at the finger's natural
          // rest curl — a reaching hand is gently curved, never ramrod straight.
          const ratio = clamp(dCursor / maxLen, REACH_MIN_RATIO, 1);
          let curl = lerp(f.restCurl, -CURL_SPAN, 1 - ratio);
          if (f.name === "thumb") {
            // signed by cursor direction: flex inward for low cursors, extend
            // back (the other way) for high/forward ones. Magnitude still grows
            // as the cursor nears, but keeps a little bend at full reach.
            const ext = clamp((beta - THUMB_NEUTRAL) / THUMB_SPLIT, -1, 1);
            const mag = clamp(1 - ratio * 0.6, 0.2, 1);
            curl = (ext >= 0 ? ext * THUMB_EXT : ext * THUMB_FLEX) * mag;
          } else if (f.name === "index") {
            // the higher the cursor, the straighter the index → it points at it
            const high = clamp((aim[1] - INDEX_HIGH_LO) / INDEX_HIGH_RANGE, 0, 1);
            curl = lerp(curl, curl * INDEX_STRAIGHTEN, high);
          }

          // Aim the tip: the finger is drawn in the un-lifted frame then rotated
          // by armLift, so subtract armLift here. Clamp the base relative to the
          // PALM (anatomical limit) — the lift adds the natural raised-wrist tilt.
          const { alpha } = chordShape(f.seg, curl, f.prof);
          const base = clamp(beta - alpha - armLift, FINGER_MIN, f.name === "index" ? INDEX_MAX : FINGER_MAX);

          // Fade reach out at the edges: too far → relax to fanned rest (kills the
          // "salute"); over the arm / behind (front→0) → relax (no spaz). The good
          // zone right of the thumb knuckle keeps full tracking.
          const eng = front * clamp(1.4 - dCursor / FAR_FADE, 0, 1);
          targetBase = lerp(f.rest, base, eng);
          targetCurl = lerp(f.restCurl, curl, eng);
        }

        // idle breathing — a gentle, organic sway so the hand feels alive at rest.
        // Two layered sines (different speeds) read more fluid than one; a slow
        // base-angle drift adds subtle whole-finger motion. Stronger when idle.
        const idleAmt = 1 - front; // ~1 at rest / not tracking, ~0 when actively reaching
        const breathCurl = (Math.sin(t * 0.8 + i * 0.7) + 0.45 * Math.sin(t * 1.9 + i * 1.3)) * 3.2 * DEG;
        const breathBase = Math.sin(t * 0.5 + i * 0.6) * 2.2 * DEG;
        targetCurl += breathCurl * idleAmt;
        targetBase += breathBase * idleAmt;

        // damp toward targets (no snapping)
        st.base += (targetBase - st.base) * 0.16;
        st.curl += (targetCurl - st.curl) * 0.16;
      });

      const pal = PALETTES[themeRef.current === "light" ? "light" : "dark"];
      const fill = pal.solid;
      const dot = `rgba(${pal.base},0.85)`;
      const accent = `rgba(${pal.accent},0.85)`;

      // ---- Build every body part as a CANVAS-space polygon. The hand is drawn as
      // ONE smooth piece: fill everything in the same colour (seamless solid), then
      // outline by walking each perimeter but SKIPPING dots that fall inside another
      // part — so the forearm/palm seam and the finger bases vanish, leaving only
      // the union silhouette. Fingers fold in FRONT of the palm, so their outlines
      // are kept over the palm (only suppressed where they overlap each OTHER). ----
      const bodyPolys = []; // forearm + palm (the arm/hand mass)
      const fingerJobs = []; // { poly, joints, tip } per finger, in fill order

      // forearm: tapered band, its wrist end pushed INTO the palm and width matched
      // to the wrist so the union has no notch there.
      {
        const E = FOREARM_END; // draw the forearm out to here (well past the lift elbow)
        const ux = (WRIST[0] - E[0]) / (Math.hypot(WRIST[0] - E[0], WRIST[1] - E[1]) || 1);
        const uy = (WRIST[1] - E[1]) / (Math.hypot(WRIST[0] - E[0], WRIST[1] - E[1]) || 1);
        const px = -uy;
        const py = ux;
        const wEnd = [WRIST[0] + ux * 0.2, WRIST[1] + uy * 0.2]; // slim wrist, tucked into palm
        // Forearm: a clean taper from the slim wrist, widening MONOTONICALLY toward
        // the (off-screen) elbow — the back edge a touch fuller than the underside.
        // No mid-bulge (that pinched the wrist) and a straight centerline (no pipe).
        const at = (s) => [lerp(wEnd[0], E[0], s), lerp(wEnd[1], E[1], s)];
        const m1 = at(0.28);
        const m2 = at(0.6);
        bodyPolys.push(
          smoothClosed(
            [
              [wEnd[0] + px * 0.12, wEnd[1] + py * 0.12], // wrist, back edge (slim)
              [m1[0] + px * 0.17, m1[1] + py * 0.17], // back edge fills out…
              [m2[0] + px * 0.215, m2[1] + py * 0.215], // …toward the elbow (muscle)
              [E[0] + px * 0.22, E[1] + py * 0.22],
              [E[0] - px * 0.22, E[1] - py * 0.22],
              [m2[0] - px * 0.19, m2[1] - py * 0.19],
              [m1[0] - px * 0.15, m1[1] - py * 0.15], // straighter, slimmer underside
              [wEnd[0] - px * 0.12, wEnd[1] - py * 0.12], // wrist, underside (slim)
            ],
            10,
          ).map((p) => toCanvas(rotW(p, ARM_RAISE))),
        );
      }

      // palm: from the wrist, up the arched back through the knuckles, down the
      // front — splined into a smooth, rounded hand mass (no straight facets).
      bodyPolys.push(
        smoothClosed(
          [
            [-0.06, 0.24],
            FINGERS[1].mcp,
            FINGERS[2].mcp,
            FINGERS[3].mcp,
            FINGERS[4].mcp,
            [0.92, 0.2],
            [0.66, 0.08],
            [0.34, 0.0],
            [0.16, 0.1], // divot: raised so the underside hollows in behind the thumb
            [0.02, 0.0],
          ],
          6,
        ).map((p) => toCanvas(rotW(p, -HAND_DROOP))),
      );

      // fingers — far side (pinky) → near side, thumb last so it sits in front.
      const order = [4, 3, 2, 1, 0];
      for (const i of order) {
        const f = FINGERS[i];
        const st = state[i];
        const origin = [f.mcp[0] + FINGER_OFFSET[0], f.mcp[1] + FINGER_OFFSET[1]];
        const drp = (p) => toCanvas(rotW(p, -HAND_DROOP)); // display the hand drooped at the wrist
        if (i === 1) {
          // lunge tracks the index's UN-PRESSED tip, so the click dip doesn't make
          // the model chase the tip (which dragged the whole arm up, accumulating).
          const bare = fingerJoints(origin, st.base, st.curl, f.seg, f.prof);
          lastIdxTip = drp(bare[bare.length - 1]);
        }
        // closed silhouette (tapered sides + rounded tip + knuckle caps). The index
        // gets a small transient downward dip during a Send-link press.
        const pressBase = i === 1 ? clickPress * CLICK_DROP : 0;
        const joints = fingerJoints(origin, st.base - pressBase, st.curl, f.seg, f.prof);
        const contour = smoothClosed(fingerContour(joints, f.w), 2).map(drp);
        fingerJobs.push({
          poly: contour,
          joints: joints.map(drp),
          tip: drp(joints[joints.length - 1]),
          w: f.w,
          capR: f.w * unit * 2.2, // small zone (≈ knuckle-cap size) around the MCP
        });
      }

      const pathPoly = (c, poly) => {
        c.beginPath();
        c.moveTo(poly[0][0], poly[0][1]);
        for (let k = 1; k < poly.length; k++) c.lineTo(poly[k][0], poly[k][1]);
        c.closePath();
      };
      // dotted outline of `poly`, skipping any dot that lands inside one of
      // `against`. Dots are scattered off the line (perpendicular jitter), sized
      // unevenly, and spaced unevenly — smaller + denser than a clean stroke — so
      // the silhouette reads organic/hand-stippled, not stamped on a perfect path.
      const outline = (c, poly, against, seed, baseGate) => {
        let carry = 0;
        let k = seed;
        for (let i = 0; i < poly.length; i++) {
          const a = poly[i];
          const b = poly[(i + 1) % poly.length];
          const dx = b[0] - a[0];
          const dy = b[1] - a[1];
          const len = Math.hypot(dx, dy) || 0.0001;
          const nx = -dy / len; // unit normal — scatter the dot off the edge
          const ny = dx / len;
          let d = carry;
          while (d < len) {
            k += 1.7;
            const t = d / len;
            const perp = (hash01(k * 12.9898) - 0.5) * 2.4; // ±1.2px off the line
            const x = a[0] + dx * t + nx * perp;
            const y = a[1] + dy * t + ny * perp;
            let hidden = false;
            for (let s = 0; s < against.length; s++) {
              if (pointInPoly(x, y, against[s])) {
                hidden = true;
                break;
              }
            }
            // knuckle-merge: in a SMALL zone around the MCP, hide cap/base dots that
            // fall inside the hand body — so a finger whose knuckle bulges INTO the
            // wrist/palm (e.g. the index reaching across) merges cleanly there, while
            // a knuckle that caps on the silhouette edge keeps its rounded outline.
            if (!hidden && baseGate) {
              const bx = x - baseGate.cx;
              const by = y - baseGate.cy;
              if (bx * bx + by * by < baseGate.r2) {
                for (let s = 0; s < baseGate.polys.length; s++) {
                  if (pointInPoly(x, y, baseGate.polys[s])) {
                    hidden = true;
                    break;
                  }
                }
              }
            }
            if (!hidden) {
              const r = 0.85 + hash01(k * 78.233) * 0.7; // 0.85–1.55px, mostly small
              c.beginPath();
              c.arc(x, y, r, 0, Math.PI * 2);
              c.fill();
            }
            d += 3.8 + hash01(k * 39.42) * 2.2; // 3.8–6.0px gaps → denser than before
          }
          carry = d - len;
        }
      };

      // Painter's order, strict back→front. Each part's FILL paints over the
      // OUTLINES of everything drawn before it, giving true occlusion: a finger in
      // front cleanly covers the outline of the fingers (and palm) behind it — no
      // point-in-poly finger suppression, so none of the fragmented/crossing dotted
      // lines that produced. Only the base-merge (a finger fusing into the hand at
      // its MCP) still needs an explicit gate, since the palm is drawn before it.

      // 1) body mass (forearm + palm), filled then outlined as one union. The
      //    finger fills drawn next will cover the palm edge where fingers are in
      //    front; here we only suppress the forearm⇄palm seam against each other.
      for (const p of bodyPolys) {
        ctx.fillStyle = fill;
        pathPoly(ctx, p);
        ctx.fill();
      }
      ctx.fillStyle = dot;
      bodyPolys.forEach((p, idx) => outline(ctx, p, bodyPolys.filter((q) => q !== p), 11.3 + idx * 100));

      // 2) fingers, back→front: fill + knuckle dots + mint tip, THEN outline. The
      //    NEXT (more-front) finger's fill paints over this finger's outline where
      //    they overlap — clean depth occlusion.
      for (let fi = 0; fi < fingerJobs.length; fi++) {
        const job = fingerJobs[fi];
        ctx.fillStyle = fill;
        pathPoly(ctx, job.poly);
        ctx.fill();
        // joint dots from the MCP (knuckle) through the inner joints — the MCP dot
        // (kk=0) defines each finger where it connects to the hand, since the open
        // "U" outline leaves the knuckle end bare. Tip gets the mint dot below.
        if (SHOW_JOINT_DOTS) {
          ctx.fillStyle = dot;
          for (let kk = 0; kk < job.joints.length - 1; kk++) {
            ctx.beginPath();
            ctx.arc(job.joints[kk][0], job.joints[kk][1], Math.max(1.7, job.w * unit * 0.22), 0, Math.PI * 2);
            ctx.fill();
          }
        }
        if (SHOW_TIP_DOTS) {
          ctx.fillStyle = accent;
          ctx.beginPath();
          ctx.arc(job.tip[0], job.tip[1], job.w * TIP_RATIO * unit * 0.5, 0, Math.PI * 2);
          ctx.fill();
        }
        // outline now (closed silhouette, both ends capped). Finger-vs-finger
        // occlusion is handled by the later fills painting over it. The only
        // suppression is the knuckle-merge gate: clear the cap where it bulges into
        // the wrist/palm, so a finger reaching across merges in at the knuckle.
        ctx.fillStyle = dot;
        const mcp = job.joints[0];
        outline(ctx, job.poly, [], 67.7 + fi * 100, {
          polys: bodyPolys,
          cx: mcp[0],
          cy: mcp[1],
          r2: job.capR * job.capR,
        });
      }

      // Foreground layer: redraw ONLY the index finger on the top canvas, so it sits
      // ABOVE the form while the rest of the hand (already drawn on bgCtx) stays
      // behind it. The index is fingerJobs[3] (draw order [4,3,2,1,0]).
      const idxJob = fingerJobs[3];
      if (idxJob) {
        fgCtx.fillStyle = fill;
        pathPoly(fgCtx, idxJob.poly);
        fgCtx.fill();
        fgCtx.fillStyle = dot;
        const im = idxJob.joints[0];
        outline(fgCtx, idxJob.poly, [], 67.7 + 3 * 100, {
          polys: bodyPolys,
          cx: im[0],
          cy: im[1],
          r2: idxJob.capR * idxJob.capR,
        });
      }

      rafId = requestAnimationFrame(draw);
    }

    function onMouseMove(e) {
      const r = canvas.getBoundingClientRect();
      mouseX = e.clientX - r.left;
      mouseY = e.clientY - r.top;
      lastMove = performance.now();
    }
    function onMouseDown(e) {
      const btn = document.querySelector(".login-send-btn");
      if (btn && (e.target === btn || btn.contains(e.target))) clickT = performance.now();
    }
    function onResize() {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(setup, 150);
    }

    setup();
    rafId = requestAnimationFrame(draw);
    if (followCursor) window.addEventListener("mousemove", onMouseMove, { passive: true });
    if (followCursor) window.addEventListener("mousedown", onMouseDown, { passive: true });
    window.addEventListener("resize", onResize);

    return () => {
      cancelAnimationFrame(rafId);
      clearTimeout(resizeTimer);
      if (followCursor) window.removeEventListener("mousemove", onMouseMove);
      if (followCursor) window.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("resize", onResize);
    };
  }, [scale, followCursor]);

  // Two stacked, full-bleed canvases (cover the positioned parent). Both ignore
  // pointer events so the form stays clickable; the cursor is tracked on window.
  // The form is given a z-index BETWEEN these two (see App), so the body/other
  // fingers (bg, zIndex 0) sit behind it and the index (fg, zIndex 6) sits above.
  const layer = { position: "absolute", inset: 0, width: "100%", height: "100%", display: "block", pointerEvents: "none" };
  return (
    <>
      <canvas ref={bgCanvasRef} style={{ ...layer, zIndex: 0 }} />
      <canvas ref={fgCanvasRef} style={{ ...layer, zIndex: 6 }} />
    </>
  );
}
