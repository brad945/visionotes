import { useRef, useEffect, useState } from "react";
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
const FRONT_X = 0.6; // threshold: cursor LEFT of here → (after a grace) fade to the idle
//                      piano; right of here → track the cursor.
const LEFT_DELAY = 500; // ms to HOLD after the cursor crosses left, before fading to piano
const LEFT_FADE = 600; // ms to fade into the piano once the grace elapses
const IDLE_AFTER_MS = 2000; // cursor sitting still this long → relax to the rest pose too
const IDLE_FADE_MS = 700; // ease into that idle over this window (no snap)
const CLICK_MS = 220; // duration of the index "press" tap when the Send-link button is clicked
const CLICK_DROP = 1.6 * DEG; // how far the index dips down at the peak of the press (very subtle)
// Idle "playing piano": a looping PHRASE through real keyboard gestures — an
// ascending scale (thumb→pinky), a chord, an arpeggio, a descending scale, a chord.
// Each event strikes its finger(s); the arm drifts laterally to follow the run and
// the wrist dips on each strike (weight into the key), like real technique.
const PIANO_PHRASE = [
  // chord cluster 1 — long + diverse voicings (incl. thumb+pinky octaves)
  { t: 0.0, f: [0, 4] }, { t: 0.7, f: [0, 2, 4] }, { t: 1.4, f: [1, 3] }, { t: 2.1, f: [0, 1, 3] },
  { t: 2.8, f: [2, 3, 4] }, { t: 3.5, f: [0, 4] }, { t: 4.2, f: [0, 2, 3] }, { t: 4.9, f: [1, 2, 4] },
  // scale run up and back down
  { t: 5.8, f: [0] }, { t: 6.15, f: [1] }, { t: 6.5, f: [2] }, { t: 6.85, f: [3] }, { t: 7.2, f: [4] },
  { t: 7.55, f: [3] }, { t: 7.9, f: [2] }, { t: 8.25, f: [1] }, { t: 8.6, f: [0] },
  // chord cluster 2 — wide/sparse voicings
  { t: 9.4, f: [0, 4] }, { t: 10.1, f: [0, 1] }, { t: 10.8, f: [3, 4] }, { t: 11.5, f: [0, 1, 4] },
  { t: 12.2, f: [1, 2, 3] }, { t: 12.9, f: [0, 2, 4] }, { t: 13.6, f: [0, 4] },
  // arpeggio cluster
  { t: 14.4, f: [0] }, { t: 14.75, f: [1] }, { t: 15.1, f: [2] }, { t: 15.45, f: [4] },
  { t: 15.8, f: [2] }, { t: 16.15, f: [1] }, { t: 16.5, f: [0] },
  // a second scale run
  { t: 17.2, f: [0] }, { t: 17.55, f: [1] }, { t: 17.9, f: [2] }, { t: 18.25, f: [3] }, { t: 18.6, f: [4] },
  { t: 18.95, f: [3] }, { t: 19.3, f: [2] }, { t: 19.65, f: [1] }, { t: 20.0, f: [0] },
  // chord cluster 3 — closing build to the full chord
  { t: 20.8, f: [0, 4] }, { t: 21.5, f: [1, 3] }, { t: 22.2, f: [0, 2, 4] }, { t: 22.9, f: [0, 1, 4] },
  { t: 23.6, f: [1, 2, 3, 4] }, { t: 24.3, f: [0, 1, 2, 3, 4] },
];
const PIANO_PHRASE_BEATS = 25.2; // loop length in beats (~2× longer)
const PIANO_BPS = 3.4; // beats per second (tempo) — 4× the original 0.85
const PIANO_CURL = 7 * DEG; // per-knuckle flex at a key strike
const PIANO_SHIFT = 13; // px the hand drifts laterally per finger-step (arm follows the run)
const PIANO_DROP = 0; // 0 = the whole hand does NOT translate down on strikes (kept the
//                       finger-press curl + lateral drift; this dip made the hand sink)
const WRIST_SWAY = 3 * DEG; // gentle continuous wrist undulation while playing
const WRIST_FLEX = 2 * DEG; // subtle wrist flex on a strike (was 5° — that pulled the hand down)
// derive: per-finger sorted strike times + each event's lateral position (avg finger − 2).
const PIANO_STRIKES = [[], [], [], [], []];
for (const ev of PIANO_PHRASE) {
  ev.lat = ev.f.reduce((s, x) => s + x, 0) / ev.f.length - 2;
  for (const fi of ev.f) PIANO_STRIKES[fi].push(ev.t);
}
PIANO_STRIKES.forEach((a) => a.sort((x, y) => x - y));
// triangle strike envelope: fast attack, slower release (a key press → lift). dt seconds.
const pianoEnv = (dt) => {
  if (dt < 0) return 0;
  if (dt < 0.04) return dt / 0.04;
  if (dt < 0.28) return 1 - (dt - 0.04) / 0.24;
  return 0;
};
// strike amount (0–1) for finger i at the given phrase time (beats), with wrap-around.
const pianoStrike = (i, phraseT) => {
  const times = PIANO_STRIKES[i];
  if (!times.length) return 0;
  let recent = -1;
  for (const tt of times) {
    if (tt <= phraseT) recent = tt;
    else break;
  }
  const dtBeats = recent < 0 ? phraseT + (PIANO_PHRASE_BEATS - times[times.length - 1]) : phraseT - recent;
  return pianoEnv(dtBeats / PIANO_BPS);
};
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
// Projective square→quad homography. Maps the unit square corners (0,0)(1,0)(1,1)(0,1)
// to `corners` (4 screen pts) and returns the 3×3 matrix as [a,b,c, d,e,f, g,h,i].
// Used to draw the piano keyboard as a TRUE perspective plane (so a top-down yaw stays
// straight, unlike the old bilinear map which bowed edges into parabolas).
const squareToQuad = (corners) => {
  const [x0, y0] = corners[0], [x1, y1] = corners[1], [x2, y2] = corners[2], [x3, y3] = corners[3];
  const dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3;
  if (Math.abs(dx3) < 1e-9 && Math.abs(dy3) < 1e-9) return [x1 - x0, x3 - x0, x0, y1 - y0, y3 - y0, y0, 0, 0, 1];
  const den = dx1 * dy2 - dx2 * dy1 || 1e-9;
  const g = (dx3 * dy2 - dx2 * dy3) / den;
  const h = (dx1 * dy3 - dx3 * dy1) / den;
  return [x1 - x0 + g * x1, x3 - x0 + h * x3, x0, y1 - y0 + g * y1, y3 - y0 + h * y3, y0, g, h, 1];
};
const applyH = (H, u, v) => {
  let w = H[6] * u + H[7] * v + H[8];
  if (Math.abs(w) < 1e-4) w = w < 0 ? -1e-4 : 1e-4; // guard the projective divide (behind-camera)
  return [(H[0] * u + H[1] * v + H[2]) / w, (H[3] * u + H[4] * v + H[5]) / w];
};
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
// --- Dot-morph helpers (the "rearrange into a thumbs-up" effect) ---
// Sample a set of closed polygons EVENLY along their combined perimeter into N points.
const samplePolys = (polys, N) => {
  const segs = [];
  let total = 0;
  for (const poly of polys) {
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len > 1e-6) { segs.push([a, b, len]); total += len; }
    }
  }
  const pts = [];
  if (!total) return pts;
  const step = total / N;
  let si = 0, acc = 0;
  for (let n = 0; n < N; n++) {
    const d = n * step;
    while (si < segs.length - 1 && acc + segs[si][2] < d) { acc += segs[si][2]; si++; }
    const [a, b, len] = segs[si];
    const t = (d - acc) / len;
    pts.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
  }
  return pts;
};
// Order points by angle around their centroid → matching index i↔i between two shapes
// gives a radial correspondence (angle θ → angle θ), so dots flow smoothly, not crossed.
const orderByAngle = (pts) => {
  let cx = 0, cy = 0;
  for (const p of pts) { cx += p[0]; cy += p[1]; }
  cx /= pts.length || 1;
  cy /= pts.length || 1;
  return pts.slice().sort((p, q) => Math.atan2(p[1] - cy, p[0] - cx) - Math.atan2(q[1] - cy, q[0] - cx));
};
// Closed capsule polygon (local coords) from A→B, half-width hwA tapering to hwB.
const capsuleLocal = (a, b, hwA, hwB) => {
  const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
  const out = [];
  for (let i = 0; i <= 14; i++) { const t = ang - Math.PI / 2 + Math.PI * (i / 14); out.push([b[0] + Math.cos(t) * hwB, b[1] + Math.sin(t) * hwB]); }
  for (let i = 0; i <= 14; i++) { const t = ang + Math.PI / 2 + Math.PI * (i / 14); out.push([a[0] + Math.cos(t) * hwA, a[1] + Math.sin(t) * hwA]); }
  return out;
};
const MORPH_PAUSE_IN = 240; // ms: brief freeze of the hand (as dots) before flying
const MORPH_RISE = 1150; // ms: hand dots fly into the thumbs-up (smooth)
const MORPH_HOLD = 1800; // ms: hold the static thumbs-up
const MORPH_FALL = 1150; // ms: flow back to the hand
const MORPH_PAUSE_OUT = 240; // ms: brief freeze before resuming play
// EXACT Google thumbs-up emoji outline + internal finger lines, extracted from the
// PNG as evenly-spaced edge points (normalized [x,y], y-up). The dot morph lands on
// these → the dots form that emoji precisely. Mapped into the hand frame at runtime.
const EMOJI_THUMB = [[0.026,0.143],[0.021,0.157],[0.016,0.171],[0.011,0.190],[0.037,0.133],[0.005,0.210],[0.005,0.224],[0.000,0.238],[0.000,0.252],[0.053,0.129],[-0.005,0.276],[-0.005,0.290],[0.005,0.267],[0.063,0.138],[-0.005,0.305],[0.074,0.129],[-0.005,0.319],[-0.005,0.333],[0.079,0.143],[-0.005,0.348],[0.090,0.129],[-0.005,0.362],[-0.005,0.376],[0.095,0.148],[0.106,0.129],[0.000,0.390],[0.000,0.405],[0.116,0.138],[0.111,0.152],[0.000,0.419],[0.127,0.129],[0.005,0.433],[0.127,0.152],[0.005,0.448],[0.138,0.138],[0.011,0.462],[0.143,0.157],[0.153,0.133],[0.016,0.476],[0.169,0.129],[0.159,0.157],[0.021,0.490],[0.180,0.138],[0.026,0.505],[0.175,0.162],[0.190,0.129],[0.042,0.505],[0.206,0.124],[0.190,0.162],[0.058,0.505],[0.206,0.157],[0.222,0.124],[0.212,0.171],[0.238,0.114],[0.074,0.505],[0.212,0.186],[0.212,0.200],[0.254,0.105],[0.090,0.500],[0.265,0.095],[0.228,0.186],[0.238,0.167],[0.275,0.086],[0.249,0.152],[0.106,0.500],[0.259,0.143],[0.291,0.076],[0.270,0.133],[0.122,0.500],[0.307,0.067],[0.286,0.124],[0.296,0.114],[0.323,0.057],[0.132,0.510],[0.307,0.105],[0.339,0.048],[0.148,0.505],[0.323,0.095],[0.354,0.043],[0.339,0.086],[0.164,0.505],[0.370,0.038],[0.354,0.081],[0.175,0.514],[0.365,0.071],[0.386,0.029],[0.190,0.514],[0.381,0.067],[0.402,0.029],[0.217,0.471],[0.397,0.062],[0.217,0.486],[0.201,0.524],[0.418,0.024],[0.222,0.500],[0.413,0.057],[0.233,0.481],[0.217,0.524],[0.434,0.019],[0.228,0.514],[0.238,0.495],[0.429,0.052],[0.228,0.533],[0.450,0.019],[0.249,0.505],[0.444,0.048],[0.238,0.543],[0.466,0.014],[0.254,0.519],[0.460,0.043],[0.249,0.552],[0.481,0.014],[0.265,0.529],[0.476,0.043],[0.254,0.567],[0.270,0.543],[0.497,0.010],[0.492,0.038],[0.265,0.576],[0.280,0.552],[0.508,0.019],[0.519,0.010],[0.275,0.586],[0.508,0.038],[0.291,0.562],[0.534,0.010],[0.286,0.595],[0.524,0.038],[0.302,0.571],[0.296,0.605],[0.550,0.010],[0.540,0.038],[0.312,0.581],[0.307,0.614],[0.566,0.005],[0.556,0.038],[0.323,0.590],[0.317,0.624],[0.577,0.014],[0.333,0.600],[0.587,0.005],[0.571,0.043],[0.328,0.633],[0.466,0.314],[0.344,0.610],[0.603,0.005],[0.587,0.043],[0.471,0.329],[0.481,0.305],[0.339,0.643],[0.354,0.619],[0.598,0.052],[0.619,0.005],[0.497,0.295],[0.508,0.281],[0.354,0.643],[0.487,0.333],[0.577,0.124],[0.587,0.100],[0.571,0.138],[0.603,0.067],[0.519,0.267],[0.365,0.629],[0.598,0.081],[0.534,0.238],[0.545,0.214],[0.529,0.252],[0.635,0.005],[0.360,0.657],[0.497,0.343],[0.376,0.638],[0.651,0.005],[0.376,0.657],[0.508,0.352],[0.386,0.648],[0.381,0.671],[0.667,0.005],[0.519,0.362],[0.397,0.657],[0.392,0.681],[0.683,0.000],[0.529,0.371],[0.402,0.671],[0.402,0.690],[0.693,0.010],[0.540,0.381],[0.413,0.681],[0.688,0.033],[0.704,0.000],[0.413,0.700],[0.704,0.029],[0.550,0.390],[0.423,0.690],[0.720,0.000],[0.423,0.710],[0.720,0.019],[0.561,0.400],[0.735,-0.005],[0.688,0.114],[0.434,0.719],[0.735,0.014],[0.566,0.414],[0.693,0.129],[0.746,0.005],[0.439,0.733],[0.571,0.429],[0.757,-0.005],[0.704,0.138],[0.757,0.014],[0.577,0.443],[0.450,0.743],[0.772,-0.005],[0.582,0.457],[0.772,0.010],[0.455,0.757],[0.720,0.143],[0.788,-0.005],[0.587,0.471],[0.460,0.771],[0.735,0.138],[0.593,0.486],[0.466,0.786],[0.720,0.190],[0.804,-0.005],[0.730,0.171],[0.593,0.500],[0.751,0.138],[0.471,0.800],[0.593,0.514],[0.746,0.167],[0.815,0.005],[0.593,0.529],[0.476,0.814],[0.593,0.543],[0.825,-0.005],[0.767,0.138],[0.476,0.829],[0.593,0.557],[0.762,0.167],[0.720,0.271],[0.593,0.571],[0.836,0.005],[0.481,0.843],[0.783,0.133],[0.593,0.586],[0.481,0.857],[0.778,0.162],[0.593,0.600],[0.730,0.281],[0.481,0.871],[0.852,0.000],[0.704,0.352],[0.593,0.614],[0.799,0.133],[0.481,0.886],[0.714,0.338],[0.593,0.629],[0.794,0.157],[0.481,0.900],[0.741,0.290],[0.725,0.329],[0.862,0.010],[0.481,0.914],[0.598,0.643],[0.815,0.133],[0.481,0.929],[0.810,0.157],[0.741,0.324],[0.757,0.290],[0.698,0.429],[0.481,0.943],[0.603,0.657],[0.878,0.014],[0.831,0.129],[0.481,0.957],[0.825,0.152],[0.608,0.671],[0.757,0.324],[0.884,0.029],[0.772,0.290],[0.709,0.443],[0.487,0.971],[0.847,0.129],[0.841,0.152],[0.619,0.681],[0.772,0.324],[0.894,0.038],[0.720,0.452],[0.788,0.290],[0.497,0.981],[0.862,0.124],[0.704,0.500],[0.698,0.514],[0.624,0.695],[0.857,0.148],[0.646,0.648],[0.899,0.052],[0.714,0.490],[0.788,0.324],[0.646,0.662],[0.656,0.638],[0.735,0.452],[0.804,0.290],[0.899,0.067],[0.508,0.990],[0.878,0.124],[0.630,0.710],[0.873,0.143],[0.899,0.081],[0.730,0.486],[0.889,0.114],[0.651,0.676],[0.899,0.095],[0.667,0.648],[0.804,0.324],[0.519,1.000],[0.751,0.452],[0.820,0.290],[0.640,0.719],[0.889,0.138],[0.698,0.590],[0.656,0.690],[0.640,0.733],[0.899,0.124],[0.746,0.486],[0.683,0.643],[0.534,0.995],[0.820,0.324],[0.836,0.290],[0.661,0.705],[0.767,0.457],[0.905,0.138],[0.709,0.605],[0.651,0.743],[0.661,0.719],[0.915,0.124],[0.762,0.486],[0.698,0.643],[0.836,0.319],[0.545,1.005],[0.651,0.757],[0.852,0.290],[0.783,0.457],[0.667,0.733],[0.720,0.614],[0.926,0.133],[0.656,0.771],[0.778,0.486],[0.561,1.000],[0.709,0.652],[0.852,0.319],[0.672,0.748],[0.868,0.290],[0.661,0.786],[0.799,0.462],[0.672,0.762],[0.735,0.619],[0.577,0.995],[0.725,0.648],[0.794,0.486],[0.942,0.138],[0.672,0.776],[0.868,0.319],[0.667,0.800],[0.884,0.290],[0.815,0.462],[0.677,0.790],[0.593,0.990],[0.735,0.657],[0.952,0.148],[0.751,0.624],[0.672,0.814],[0.810,0.490],[0.884,0.319],[0.746,0.648],[0.899,0.290],[0.683,0.805],[0.608,0.981],[0.958,0.162],[0.831,0.462],[0.677,0.829],[0.672,0.843],[0.619,0.971],[0.767,0.624],[0.825,0.490],[0.899,0.319],[0.757,0.657],[0.672,0.857],[0.630,0.962],[0.667,0.876],[0.915,0.295],[0.968,0.171],[0.661,0.895],[0.640,0.948],[0.656,0.914],[0.847,0.467],[0.651,0.929],[0.968,0.186],[0.915,0.314],[0.772,0.652],[0.841,0.490],[0.783,0.629],[0.931,0.295],[0.974,0.200],[0.862,0.467],[0.783,0.662],[0.931,0.314],[0.857,0.490],[0.799,0.629],[0.979,0.214],[0.942,0.305],[0.979,0.229],[0.799,0.657],[0.878,0.471],[0.974,0.248],[0.958,0.290],[0.873,0.495],[0.968,0.271],[0.815,0.633],[0.958,0.310],[0.979,0.262],[0.815,0.657],[0.894,0.471],[0.889,0.495],[0.831,0.633],[0.968,0.319],[0.825,0.667],[0.905,0.481],[0.905,0.495],[0.847,0.633],[0.979,0.329],[0.841,0.662],[0.921,0.481],[0.984,0.343],[0.921,0.495],[0.862,0.638],[0.857,0.662],[0.989,0.357],[0.937,0.490],[0.878,0.638],[0.873,0.657],[0.995,0.371],[0.947,0.500],[0.894,0.633],[1.000,0.386],[0.958,0.486],[0.884,0.667],[1.000,0.400],[0.952,0.514],[0.995,0.419],[0.894,0.657],[0.974,0.471],[0.989,0.443],[0.984,0.457],[0.910,0.633],[0.958,0.529],[1.000,0.433],[0.910,0.652],[0.958,0.543],[0.926,0.629],[0.921,0.643],[0.958,0.557],[0.958,0.571],[0.942,0.619],[0.952,0.595],[0.937,0.638],[0.952,0.610],[0.963,0.586]];
// Outer silhouette of the emoji (ordered polygon) → the fill behind the dots.
const EMOJI_FILL = [[0.529,1.000],[0.487,0.971],[0.481,0.819],[0.429,0.710],[0.222,0.524],[0.026,0.500],[0.000,0.395],[0.016,0.186],[0.042,0.133],[0.201,0.133],[0.402,0.029],[0.841,0.000],[0.889,0.029],[0.899,0.124],[0.958,0.157],[0.979,0.205],[0.963,0.314],[1.000,0.371],[1.000,0.424],[0.952,0.495],[0.958,0.600],[0.884,0.662],[0.651,0.648],[0.677,0.757],[0.667,0.900],[0.608,0.986]];
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

// --- DEV-only piano keyboard tuning panel ---------------------------------
// Live knobs for the keyboard's position / rotation / size / perspective. The
// draw loop reads these (via a ref) every frame, so dragging a slider updates
// the keyboard in real time without restarting the RAF. These DEFAULTS are the
// dialed-in production look (big, swung forward as a close-up — the front edge
// runs off the bottom on purpose). tiltDeg is a DELTA on top of the baseline
// screen tilt (0.2 − 9°), so 0 leaves that baseline untouched. The panel only
// renders under import.meta.env.DEV — it never ships; the defaults below are
// what production shows. Keep tweaking via the panel; tell me to re-bake.
const KB_DEFAULTS = {
  posX: 800, posY: -122,   // screen-px offset of the whole keyboard
  scale: 3,           // size multiplier about the (fixed) pivot
  tiltDeg: -1,         // 2D screen tilt, DELTA from the baseline (0.2 − 9°)
  yawDeg: -47,        // top-down 3D yaw; past ~−48° the keys go end-on and read as flat
  //                     ribbons, so −47 keeps them as solid 3D blocks (− = clockwise)
  depth: 0.65,        // yaw depth/sensitivity (larger = gentler swing)
  extL: 6, extR: 4, // extra key slots added left / right
  recede: 0.42,       // how far the key-backs travel toward the vanishing point
  vpXf: 1,            // vanishing-point X factor (horizontal convergence)
  vpYf: 0.1,          // vanishing-point Y factor (tilt into the distance)
};
// [key, label, min, max, step]
const KB_CONTROLS = [
  ["posX", "pos X", -1200, 1200, 1],
  ["posY", "pos Y", -400, 400, 1],
  ["scale", "scale", 0.3, 5, 0.01],
  ["tiltDeg", "tilt Δ°", -45, 45, 0.1],
  ["yawDeg", "yaw °", -90, 90, 0.5],
  ["depth", "depth", 0.15, 1.5, 0.01],
  ["extL", "ext L", 0, 40, 1],
  ["extR", "ext R", 0, 40, 1],
  ["recede", "recede", 0.1, 0.95, 0.01],
  ["vpXf", "vp X", 0.8, 6, 0.1],
  ["vpYf", "vp Y", 0, 2, 0.05],
];
const KB_PANEL = {
  box: {
    position: "fixed", top: 12, right: 12, zIndex: 50, width: 232,
    background: "rgba(20,24,30,0.92)", color: "#e7edf5",
    font: "12px/1.5 ui-monospace,monospace", padding: "10px 12px",
    borderRadius: 8, pointerEvents: "auto", boxShadow: "0 6px 20px rgba(0,0,0,0.4)",
  },
  head: { fontWeight: 700, marginBottom: 6 },
  row: { display: "block", marginBottom: 3 },
  label: { display: "inline-block", width: 52 },
  slider: { width: 104, verticalAlign: "middle", margin: "0 6px" },
  val: { display: "inline-block", width: 40, textAlign: "right" },
  btnRow: { display: "flex", gap: 6, marginTop: 8 },
  btn: {
    flex: 1, font: "11px ui-monospace,monospace", color: "#e7edf5",
    background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.18)",
    borderRadius: 5, padding: "4px 0", cursor: "pointer",
  },
};

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

  // Live keyboard-tuning state. `kb` drives the (DEV-only) panel UI; `kbRef`
  // mirrors it so the RAF draw loop can read current values every frame without
  // the [scale, followCursor] effect re-running on a slider drag.
  const [kb, setKb] = useState(KB_DEFAULTS);
  const kbRef = useRef(kb);
  useEffect(() => { kbRef.current = kb; }, [kb]);
  // The tuning panel is HIDDEN by default now that the look is dialed in, but kept
  // in code: press "k" (dev only, not while typing in a field) to summon it again.
  const [showPanel, setShowPanel] = useState(false);

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
    let pianoX = 0, pianoY = 0; // eased model offset for the idle piano (lateral run + wrist dip)
    let wristHinge = 0; // eased wrist-joint rotation (hand hinges relative to the forearm)
    let lastIdxTip = null; // index fingertip (canvas px) from the previous frame
    let clickT = -1e9; // timestamp of the last Send-link click (for the index press tap)
    let leftAt = -1; // timestamp the cursor crossed LEFT of FRONT_X (-1 = currently right)
    let lastLc = null; // last cursor pos while in the tracking zone (held when it goes left)
    let sentT = -1e9; // timestamp of a successful email send → triggers the dot morph
    let morphSrc = null; // hand dots snapshot (captured at trigger) → morph source
    let morphTgt = null; // thumbs-up dots → morph target (one per source dot)
    let morphFade = null; // per-dot: true = an EXCESS dot that fades out at the thumbs-up
    let morphFill = null; // thumbs-up silhouette polygon (canvas) → the fill behind the dots

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
      wristY = H * 0.68; // vertical position of the wrist on the canvas (smaller = higher)
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
      return [cx + lungeX + pianoX + q[0] * unit, wristY + lungeY + pianoY - q[1] * unit];
    };
    // canvas px -> local (un-lifted frame; the cursor lives here)
    const toLocal = (x, y) => [(x - cx - lungeX - pianoX) / unit, (wristY + lungeY + pianoY - y) / unit];

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
      // Spatial gate: while the cursor is RIGHT of FRONT_X → track (1). Once it crosses
      // LEFT, HOLD for LEFT_DELAY ms, then fade to 0 over LEFT_FADE ms → the idle piano.
      const cursorLeft = lc ? lc[0] <= FRONT_X : true;
      if (!cursorLeft) { leftAt = -1; lastLc = lc; } // in the tracking zone → reset + remember pose
      else if (leftAt < 0) leftAt = now; // just crossed left → start the grace timer
      const spatialGate = !lc ? 0 : cursorLeft ? 1 - smoothstep(LEFT_DELAY, LEFT_DELAY + LEFT_FADE, now - leftAt) : 1;
      const front = spatialGate * idleActive;
      // While the cursor is LEFT of the line, STOP tracking it — aim at the LAST in-zone
      // position so the hand HOLDS that pose (then `front` fades it into the piano).
      const aimLc = cursorLeft && lastLc ? lastLc : lc;

      // Dot-morph sequence for the thumbs-up: PAUSE (hand frozen as dots) → RISE (fly to
      // thumbs-up) → HOLD → FALL (fly back) → PAUSE (frozen) → resume. The pauses make it
      // obvious the SAME dots form both the hand and the thumbs-up. `morph` = 0 (hand) → 1
      // (thumbs-up). `inMorphSeq` = the whole sequence (the hand is frozen throughout it).
      const sinceSent = now - sentT;
      const MORPH_TOTAL = MORPH_PAUSE_IN + MORPH_RISE + MORPH_HOLD + MORPH_FALL + MORPH_PAUSE_OUT;
      const inMorphSeq = sinceSent >= 0 && sinceSent < MORPH_TOTAL;
      let morph = 0;
      if (inMorphSeq) {
        const r0 = MORPH_PAUSE_IN, r1 = r0 + MORPH_RISE, h1 = r1 + MORPH_HOLD, f1 = h1 + MORPH_FALL;
        if (sinceSent < r0) morph = 0; // pause on the hand
        else if (sinceSent < r1) morph = smoothstep(r0, r1, sinceSent); // fly out
        else if (sinceSent < h1) morph = 1; // hold thumbs-up
        else if (sinceSent < f1) morph = 1 - smoothstep(h1, f1, sinceSent); // fly back
        else morph = 0; // pause on the hand
      }

      // Idle piano: run the phrase, dip the wrist on strikes (weight) and drift the
      // arm laterally toward the most-recent note (so it "follows" the run).
      const pianoGate = (1 - front) * (inMorphSeq ? 0 : 1); // off during the whole morph
      const handFrozen = inMorphSeq; // freeze the hand pose so the dots hold + resume cleanly
      const phraseT = (t * PIANO_BPS) % PIANO_PHRASE_BEATS;
      const pianoFlexArr = [0, 0, 0, 0, 0];
      let hingeTarget = 0;
      if (pianoGate > 0.01) {
        let strkSum = 0;
        let recentEv = PIANO_PHRASE[PIANO_PHRASE.length - 1];
        for (const ev of PIANO_PHRASE) {
          if (ev.t <= phraseT) recentEv = ev;
          else break;
        }
        for (let si = 0; si < 5; si++) {
          pianoFlexArr[si] = pianoStrike(si, phraseT);
          strkSum += pianoFlexArr[si];
        }
        pianoX += (recentEv.lat * PIANO_SHIFT * pianoGate - pianoX) * 0.07;
        pianoY += (Math.min(strkSum, 1.6) * PIANO_DROP * pianoGate - pianoY) * 0.3;
        // wrist hinges: a slow undulation + a flex DOWN on each strike (weight).
        hingeTarget = (Math.sin(t * 0.4) * WRIST_SWAY - Math.min(strkSum, 1.5) * WRIST_FLEX) * pianoGate;
      } else if (!handFrozen) {
        pianoX += (0 - pianoX) * 0.07;
        pianoY += (0 - pianoY) * 0.3;
      }
      if (!handFrozen) wristHinge += (hingeTarget - wristHinge) * 0.25; // eased wrist bend
      const handRot = -HAND_DROOP + wristHinge; // hand's rotation about the wrist (dynamic)

      // Arm lift: hinge the hand up at the elbow when the cursor is high AND close
      // AND in the good zone. Gated on the RESTING middle knuckle (never the lifted
      // one) so it can't feed back on itself. Eased for flow.
      let liftTarget = 0;
      if (aimLc) {
        const ref = FINGERS[2].mcp; // resting middle knuckle
        const prox = clamp(1 - Math.hypot(aimLc[0] - ref[0], aimLc[1] - ref[1]) / LIFT_RADIUS, 0, 1);
        const elev = clamp((aimLc[1] - LIFT_REST_Y) / LIFT_RANGE, 0, 1);
        liftTarget = MAX_LIFT * prox * elev * front;
      }
      if (!handFrozen) armLift += (liftTarget - armLift) * 0.12;

      FINGERS.forEach((f, i) => {
        const st = state[i];
        let targetBase = f.rest;
        let targetCurl = f.restCurl;

        if (aimLc) {
          // Tip-IK: aim THIS fingertip at the cursor (or the HELD pos when it's gone left).
          // Measured from the finger's LIFTED knuckle (the hand may have hinged up), in the
          // local frame. hand is displayed drooped by HAND_DROOP, so aim at the cursor
          // rotated into the un-drooped frame (keeps the fingertip on the real cursor).
          const aim = rotW(aimLc, -handRot);
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
        // breathing: NONE while reaching for the Send button (the lunge would chase
        // the breath and bob the whole arm); otherwise a subtle baseline while
        // tracking, scaling UP to full at rest.
        const breathAmt = overButton ? 0 : 0.45 + 0.55 * (1 - front);
        const breathCurl = (Math.sin(t * 0.8 + i * 0.7) + 0.45 * Math.sin(t * 1.9 + i * 1.3)) * 3.2 * DEG;
        const breathBase = Math.sin(t * 0.5 + i * 0.6) * 2.2 * DEG;
        targetCurl += breathCurl * breathAmt;
        targetBase += breathBase * breathAmt;

        // damp toward targets (no snapping)
        if (!handFrozen) {
          st.base += (targetBase - st.base) * 0.16;
          st.curl += (targetCurl - st.curl) * 0.16;
        }
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
        ).map((p) => toCanvas(rotW(p, handRot))),
      );

      // fingers — far side (pinky) → near side, thumb last so it sits in front.
      const order = [4, 3, 2, 1, 0];
      for (const i of order) {
        const f = FINGERS[i];
        const st = state[i];
        const origin = [f.mcp[0] + FINGER_OFFSET[0], f.mcp[1] + FINGER_OFFSET[1]];
        const drp = (p) => toCanvas(rotW(p, handRot)); // hand rotated about the wrist (droop + live hinge)
        if (i === 1) {
          // lunge tracks the index's UN-PRESSED tip, so the click dip doesn't make
          // the model chase the tip (which dragged the whole arm up, accumulating).
          const bare = fingerJoints(origin, st.base, st.curl, f.seg, f.prof);
          lastIdxTip = drp(bare[bare.length - 1]);
        }
        // Transient flexes layered on the eased pose (applied directly, so they stay
        // crisp): the index dips on a Send-link click, and in the idle pose every
        // finger "plays piano" — striking down on its own drifting rhythm.
        const pressBase = i === 1 ? clickPress * CLICK_DROP : 0;
        const pianoFlex = pianoFlexArr[i] * PIANO_CURL * pianoGate; // idle key strike for this finger
        const joints = fingerJoints(origin, st.base - pressBase, st.curl - pianoFlex, f.seg, f.prof);
        const contour = smoothClosed(fingerContour(joints, f.w), 2).map(drp);
        // rest (un-struck) tip: same finger WITHOUT the piano strike / click press, so the
        // keyboard can be sized off a stable anchor instead of the jittering live tip.
        const restJoints = fingerJoints(origin, st.base, st.curl, f.seg, f.prof);
        fingerJobs.push({
          poly: contour,
          joints: joints.map(drp),
          tip: drp(joints[joints.length - 1]),
          restTip: drp(restJoints[restJoints.length - 1]),
          w: f.w,
          capR: f.w * unit * 2.2, // small zone (≈ knuckle-cap size) around the MCP
        });
      }

      // --- Idle piano keyboard: fades in with the idle pose. Drawn HERE so it sits
      // UNDER the hand. The keyboard is fixed (so the lateral run reads as the hand
      // moving along the keys) and the key under each striking fingertip sinks in
      // sync with the finger press.
      if (pianoGate > 0.02) {
        const k = kbRef.current; // live tuning knobs (DEV panel); = KB_DEFAULTS in production
        const tips = fingerJobs.map((job, idx) => ({ x: job.tip[0], y: job.tip[1], s: pianoFlexArr[order[idx]] * pianoGate }));
        // Keyboard SIZE/POSITION is computed from the CONSTANT rest pose (fixed angles, base
        // hand rotation, NO breathing / wrist-hinge / run / dip), so it NEVER changes size or
        // place — the hand just plays over a fixed keyboard. (Live `tips` only sink struck keys.)
        let nMin = Infinity, nMax = -Infinity, sumY = 0;
        for (let kf = 0; kf < FINGERS.length; kf++) {
          const kfg = FINGERS[kf];
          const ko = [kfg.mcp[0] + FINGER_OFFSET[0], kfg.mcp[1] + FINGER_OFFSET[1]];
          const kj = fingerJoints(ko, kfg.rest, kfg.restCurl, kfg.seg, kfg.prof);
          const kt = rotW(kj[kj.length - 1], -HAND_DROOP); // fixed base rotation, no live hinge
          const kx = cx + kt[0] * unit; // base model position — no lunge/piano offsets
          const ky = wristY - kt[1] * unit;
          nMin = Math.min(nMin, kx);
          nMax = Math.max(nMax, kx);
          sumY += ky;
        }
        const margin = 0.22 * unit + 2 * PIANO_SHIFT;
        const kbLeft = nMin - margin;
        const kbW = nMax - nMin + 2 * margin;
        const nearY = sumY / FINGERS.length + 0.02 * unit; // front (near) edge — where the fingers press
        const faceH = 0.05 * unit; // short front faces (low side angle)
        const nWhite = Math.max(7, Math.round(kbW / (0.115 * unit)));
        const wKeyW = kbW / nWhite;
        // EXTEND: extra white keys added to the LEFT and RIGHT. The VP / perspective / wKeyW
        // below are ALL from the ORIGINAL keyboard and left UNCHANGED — we just draw more key
        // slots (k from -EXT_L .. nWhite+EXT_R) with that same fixed mapping, so the original
        // keys stay pixel-identical and the new ones are exact copies.
        const EXT_L = k.extL, EXT_R = k.extR;
        // SIDE VIEW (like watching a pianist from the side): the keyboard recedes off
        // into the distance to the RIGHT, so the vanishing point is far to the right and
        // only slightly up — the keys angle sideways rather than facing forward.
        const vpX = kbLeft + kbW * k.vpXf;
        const vpY = nearY - k.vpYf * unit;
        const recede = k.recede; // how far the key backs travel toward the VP
        // TRUE-PERSPECTIVE keyboard: fit a projective homography H to TODAY'S four corners
        // (so yaw=0 is pixel-identical along the white keys), and apply a TOP-DOWN YAW about
        // the LEFT-FRONT corner as a metric in-plane rotation BEFORE H. homography ∘ rotation
        // keeps every edge perfectly STRAIGHT (a real camera yaw), unlike the old bilinear
        // map which bowed them. u = along-slab [0..1], v = key depth [0=front..1=back].
        const pivotXk = kbLeft - EXT_L * wKeyW; // leftmost near-edge x (the yaw pivot)
        const rightXk = kbLeft + (nWhite + EXT_R) * wKeyW; // right near-edge x
        const Uspan = rightXk - pivotXk || 1;
        const cur0 = (X, w) => [X + (vpX - X) * w * recede, nearY + (vpY - nearY) * w * recede]; // today's map
        const kbH = squareToQuad([cur0(pivotXk, 0), cur0(rightXk, 0), cur0(rightXk, 1), cur0(pivotXk, 1)]);
        const KB_DEPTH = k.depth; // yaw sensitivity; floor (0.15) keeps small-depth+high-yaw from
        // saturating the vr clamp (vr = u·sinθ/depth + v·cosθ; depth cancels in the v-term, so this
        // is clamp-saturation under yaw amplification, NOT a divide-by-zero — depth never divides v).
        const KB_YAW = k.yawDeg * DEG; // top-down yaw about the LEFT edge; − = clockwise (chosen by eye)
        const yc = Math.cos(KB_YAW), ys = Math.sin(KB_YAW);
        const projUV = (u, v) => {
          const Xw = u, Zw = v * KB_DEPTH;
          const ur = Xw * yc - Zw * ys; // rotate in the metric ground plane about (0,0)=left-front corner
          const vr = (Xw * ys + Zw * yc) / KB_DEPTH; // renormalize depth back to homography v-units
          // Only the FAR side (large +v) has a projective horizon (~1.82) to stay shy of; the NEAR
          // side (−v, in front of the keyboard) has none, so allow it to run well forward — strong
          // yaw pulls the near corner toward the viewer and a tight floor would slice it flat.
          return applyH(kbH, ur, clamp(vr, -3, 1.7));
        };
        const proj = (X, w) => projUV((X - pivotXk) / Uspan, w); // by near-edge X (drop-in)
        bgCtx.save();
        // OPAQUE keys, faded by pianoGate so the keyboard fades in/out with piano mode
        // (only the fade uses alpha): otherwise the page background bleeds through and, on
        // the dark theme, blackens the pressed front faces.
        bgCtx.globalAlpha = pianoGate;
        // rotate the keyboard CLOCKWISE around the (FIXED) base of the thumb. Use the
        // CONSTANT rest-pose thumb MCP so the pivot never moves → the whole keyboard is
        // stable in size AND place (not tied to the live, breathing thumb).
        const tbL = rotW([FINGERS[0].mcp[0] + FINGER_OFFSET[0], FINGERS[0].mcp[1] + FINGER_OFFSET[1]], -HAND_DROOP);
        const pcx = cx + tbL[0] * unit, pcy = wristY - tbL[1] * unit;
        // Position / tilt / scale as ONE rigid transform (canvas post-multiplies, so the LAST call
        // is the FIRST transform a point sees): posX/posY is OUTERMOST → a pure screen-px offset,
        // unaffected by tilt/scale. Tilt + uniform scale share the fixed pivot (pcx,pcy) so they
        // commute and the keyboard never drifts. Yaw is NOT here — it lives inside proj() as the
        // metric ground-plane rotation before the homography.
        bgCtx.translate(k.posX, k.posY);
        bgCtx.translate(pcx, pcy);
        bgCtx.rotate(0.2 - 9 * DEG + k.tiltDeg * DEG); // baseline tilt (+ = CW) plus the panel delta
        bgCtx.scale(k.scale, k.scale);
        bgCtx.translate(-pcx, -pcy);
        for (let k = -EXT_L; k < nWhite + EXT_R; k++) {
          const x = kbLeft + k * wKeyW;
          const x2 = x + wKeyW;
          let press = 0;
          // MIRROR the notes: hit-test the fingertip x reflected about the keyboard's own
          // centre, so a strike lights the mirror-image key. Drawing is unchanged.
          for (const tp of tips) { const mx = 2 * kbLeft + kbW - tp.x; if (mx >= x && mx < x2 && tp.s > press) press = tp.s; }
          const dy = press * 0.05 * unit; // pressed key tilts DOWN at the front (pivots at the back)
          const nl = proj(x, 0), nr = proj(x2, 0); // near (front) edge — yawed
          const fl = proj(x, 1), fr = proj(x2, 1); // far (back) edge — yawed
          // key TOP — near (front) edge tilts down on press; far edge fixed
          bgCtx.fillStyle = press > 0.06 ? "rgb(150,196,216)" : "rgb(240,244,249)";
          bgCtx.strokeStyle = "rgba(10,14,20,0.5)";
          bgCtx.lineWidth = 1;
          bgCtx.beginPath();
          bgCtx.moveTo(nl[0], nl[1] + dy);
          bgCtx.lineTo(nr[0], nr[1] + dy);
          bgCtx.lineTo(fr[0], fr[1]);
          bgCtx.lineTo(fl[0], fl[1]);
          bgCtx.closePath();
          bgCtx.fill();
          bgCtx.stroke();
          // tall FRONT face (faces the viewer)
          bgCtx.fillStyle = press > 0.06 ? "rgb(112,150,170)" : "rgb(198,205,214)";
          bgCtx.beginPath();
          bgCtx.moveTo(nl[0], nl[1] + dy);
          bgCtx.lineTo(nr[0], nr[1] + dy);
          bgCtx.lineTo(nr[0], nr[1] + faceH + dy);
          bgCtx.lineTo(nl[0], nl[1] + faceH + dy);
          bgCtx.closePath();
          bgCtx.fill();
          bgCtx.stroke();
        }
        // black keys: raised, set back, receding to the same VP (after white k%7∈{0,1,3,4,5})
        const bkW = wKeyW * 0.56;
        bgCtx.fillStyle = "rgb(16,19,25)";
        bgCtx.strokeStyle = "rgba(0,0,0,0.7)";
        for (let k = -EXT_L; k < nWhite - 1 + EXT_R; k++) {
          if (![0, 1, 3, 4, 5].includes(((k % 7) + 7) % 7)) continue; // +mod handles k<0
          const bx = kbLeft + (k + 1) * wKeyW - bkW / 2;
          const bx2 = bx + bkW;
          // near edge set back along the recede (start ~12%), far ~60% — shorter than whites
          const n0 = proj(bx, 0.12), n1 = proj(bx2, 0.12), f0 = proj(bx, 0.6), f1 = proj(bx2, 0.6);
          bgCtx.beginPath();
          bgCtx.moveTo(n0[0], n0[1]);
          bgCtx.lineTo(n1[0], n1[1]);
          bgCtx.lineTo(f1[0], f1[1]);
          bgCtx.lineTo(f0[0], f0[1]);
          bgCtx.closePath();
          bgCtx.fill();
          bgCtx.stroke();
        }
        bgCtx.restore();
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
      // `collect` (optional): instead of drawing, push each dot's [x, y, r] into it — used
      // to capture the hand's EXACT dots so the morph reuses them (not a fresh dot set).
      const outline = (c, poly, against, seed, baseGate, collect) => {
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
              if (collect) {
                collect.push([x, y, r]);
              } else {
                c.beginPath();
                c.arc(x, y, r, 0, Math.PI * 2);
                c.fill();
              }
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

      // Dot morph: on a successful send (vn-email-sent), the HAND (palm + fingers) dots
      // fly into a static THUMBS-UP (fist + thumb) and back. The FOREARM stays normal.
      // (`morph` was computed earlier so the keyboard could fade with it.)
      // 1) FOREARM — always drawn solid (forearm = bodyPolys[0]; palm = bodyPolys[1]). The
      //    thumbs-up gets its OWN fill (below) so the arm + hand match and overlap solidly.
      ctx.fillStyle = fill;
      pathPoly(ctx, bodyPolys[0]);
      ctx.fill();
      ctx.fillStyle = dot;
      outline(ctx, bodyPolys[0], [bodyPolys[1]], 11.3);

      if (inMorphSeq) {
        // ONCE, at trigger: snapshot the hand's EXACT dots (so the morph reuses the SAME
        // dots, not a fresh set) and build a same-count thumbs-up target.
        if (!morphSrc) {
          const src = [];
          outline(ctx, bodyPolys[1], [bodyPolys[0]], 111.3, null, src); // palm dots
          for (let fi = 0; fi < fingerJobs.length; fi++) {
            const job = fingerJobs[fi];
            const mcp = job.joints[0];
            outline(ctx, job.poly, [], 67.7 + fi * 100, { polys: bodyPolys, cx: mcp[0], cy: mcp[1], r2: job.capR * job.capR }, src);
          }
          morphSrc = orderByAngle(src);
          const H = morphSrc.length;
          // TARGET = the EXACT Google thumbs-up emoji (outline + internal finger lines).
          // Rotate/scale it, then AUTO-ANCHOR: slide the whole emoji so its wrist (its
          // extreme point toward the elbow) OVERLAPS the forearm tip — guaranteed contact,
          // no gap, regardless of pose. (No hand-tuned offsets to drift.)
          const EMOJI_S = 0.95, EMOJI_ROT = -0.24; // scale + slight clockwise tilt (radians, y-up)
          const pvx = 0.12, pvy = 0.14; // pivot the rotation about the emoji's wrist
          const cR = Math.cos(EMOJI_ROT), sR = Math.sin(EMOJI_ROT);
          const E = EMOJI_THUMB.length;
          const mapPt = (p) => { // normalized emoji pt → canvas (rotate+scale about the pivot)
            const dx = p[0] - pvx, dy = p[1] - pvy;
            return toCanvas([(dx * cR - dy * sR) * EMOJI_S, (dx * sR + dy * cR) * EMOJI_S]);
          };
          let eCanvas = EMOJI_THUMB.map(mapPt);
          // forearm tip + direction toward the elbow (canvas space)
          const fl = Math.hypot(WRIST[0] - FOREARM_END[0], WRIST[1] - FOREARM_END[1]) || 1;
          const ftL = [WRIST[0] + ((WRIST[0] - FOREARM_END[0]) / fl) * 0.2, WRIST[1] + ((WRIST[1] - FOREARM_END[1]) / fl) * 0.2];
          const armTip = toCanvas(rotW(ftL, ARM_RAISE));
          const elbowC = toCanvas(rotW(FOREARM_END, ARM_RAISE));
          const al = Math.hypot(elbowC[0] - armTip[0], elbowC[1] - armTip[1]) || 1;
          const aux = (elbowC[0] - armTip[0]) / al, auy = (elbowC[1] - armTip[1]) / al; // unit → elbow
          // the emoji's wrist = its point with max projection toward the elbow
          let wp = eCanvas[0], wpProj = -Infinity;
          for (const p of eCanvas) { const pr = (p[0] - armTip[0]) * aux + (p[1] - armTip[1]) * auy; if (pr > wpProj) { wpProj = pr; wp = p; } }
          const ov = 0.2 * unit; // bury the wrist this far into the forearm tip (deep overlap)
          const drop = 0.15 * unit; // sit the hand LOWER relative to the arm
          const sx = armTip[0] + aux * ov - wp[0], sy = armTip[1] + auy * ov - wp[1] + drop;
          eCanvas = eCanvas.map((p) => [p[0] + sx, p[1] + sy]);
          // the FILL silhouette, through the SAME transform + shift (drawn behind the dots)
          morphFill = EMOJI_FILL.map((p) => { const c = mapPt(p); return [c[0] + sx, c[1] + sy]; });
          const eOrd = orderByAngle(eCanvas);
          // each source dot → the emoji point at the matching angular rank
          morphTgt = morphSrc.map((_, i) => eOrd[Math.min(E - 1, Math.floor((i * E) / H))]);
          // H hand dots > E emoji points → keep one dot per emoji point (the first to land
          // there) and FADE the duplicates out at the apex, so spacing stays even.
          morphFade = morphSrc.map((_, i) => i > 0 && Math.floor((i * E) / H) === Math.floor(((i - 1) * E) / H));
        }
        // fade the hand FILL out as the dots leave it
        const fillA = clamp(1 - morph * 1.7, 0, 1);
        if (fillA > 0.01) {
          ctx.globalAlpha = MODEL_ALPHA * fillA;
          ctx.fillStyle = fill;
          pathPoly(ctx, bodyPolys[1]);
          ctx.fill();
          for (const job of fingerJobs) { pathPoly(ctx, job.poly); ctx.fill(); }
          ctx.globalAlpha = MODEL_ALPHA;
        }
        // fade the THUMBS-UP fill IN as the dots arrive → a solid hand like the arm (under dots)
        const tuFillA = morphFill ? smoothstep(0.45, 1, morph) : 0;
        if (tuFillA > 0.01) {
          ctx.globalAlpha = MODEL_ALPHA * tuFillA;
          ctx.fillStyle = fill;
          pathPoly(ctx, morphFill);
          ctx.fill();
          ctx.globalAlpha = MODEL_ALPHA;
        }
        // the morphing DOTS — the SAME dots throughout; excess ones fade out at the apex.
        ctx.fillStyle = dot;
        const H = morphSrc.length;
        let curA = -1;
        for (let i = 0; i < H; i++) {
          // excess dots fade out EARLY (gone by ~45% of the morph) so they don't pile up
          // onto the kept dots near the apex; they fade back in on the return to the hand.
          const a = morphFade[i] ? clamp(1 - morph * 2.2, 0, 1) : 1;
          if (a <= 0.02) continue;
          const s = morphSrc[i], t = morphTgt[i];
          // slight per-dot scatter (grows with the morph) so the settled outline reads
          // hand-stippled like the rest of the rig, not a perfect stamped path.
          const jx = (hash01(i * 12.9898) - 0.5) * 2.6 * morph;
          const jy = (hash01(i * 7.717) - 0.5) * 2.6 * morph;
          const x = s[0] + (t[0] - s[0]) * morph + jx;
          const y = s[1] + (t[1] - s[1]) * morph + jy;
          const ga = MODEL_ALPHA * a;
          if (ga !== curA) { ctx.globalAlpha = ga; curA = ga; }
          ctx.beginPath();
          ctx.arc(x, y, s[2], 0, Math.PI * 2); // reuse the captured dot radius
          ctx.fill();
        }
        ctx.globalAlpha = MODEL_ALPHA;
      } else {
        morphSrc = null;
        // 2) palm — fill + outline (suppress the forearm⇄palm seam)
        ctx.fillStyle = fill;
        pathPoly(ctx, bodyPolys[1]);
        ctx.fill();
        ctx.fillStyle = dot;
        outline(ctx, bodyPolys[1], [bodyPolys[0]], 111.3);

        // 3) fingers, back→front: fill THEN outline (later fills occlude earlier outlines).
        for (let fi = 0; fi < fingerJobs.length; fi++) {
          const job = fingerJobs[fi];
          ctx.fillStyle = fill;
          pathPoly(ctx, job.poly);
          ctx.fill();
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
          ctx.fillStyle = dot;
          const mcp = job.joints[0];
          outline(ctx, job.poly, [], 67.7 + fi * 100, { polys: bodyPolys, cx: mcp[0], cy: mcp[1], r2: job.capR * job.capR });
        }

        // 4) Foreground layer: redraw ONLY the index finger on the top canvas (above the form).
        const idxJob = fingerJobs[3];
        if (idxJob) {
          fgCtx.fillStyle = fill;
          pathPoly(fgCtx, idxJob.poly);
          fgCtx.fill();
          fgCtx.fillStyle = dot;
          const im = idxJob.joints[0];
          outline(fgCtx, idxJob.poly, [], 67.7 + 3 * 100, { polys: bodyPolys, cx: im[0], cy: im[1], r2: idxJob.capR * idxJob.capR });
        }
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
    function onSent() {
      sentT = performance.now();
      morphSrc = null; // re-snapshot the hand dots on the trigger frame
    }
    function onKeyDown(e) {
      if (e.key === "g") onSent(); // TEMP: preview the thumbs-up morph
      // toggle the keyboard tuning panel (dev only) — ignore while typing in a field
      const tag = e.target && e.target.tagName;
      if (e.key === "k" && tag !== "INPUT" && tag !== "TEXTAREA") setShowPanel((v) => !v);
    }

    setup();
    rafId = requestAnimationFrame(draw);
    if (followCursor) window.addEventListener("mousemove", onMouseMove, { passive: true });
    if (followCursor) window.addEventListener("mousedown", onMouseDown, { passive: true });
    window.addEventListener("resize", onResize);
    window.addEventListener("vn-email-sent", onSent);
    window.addEventListener("keydown", onKeyDown); // TEMP

    return () => {
      cancelAnimationFrame(rafId);
      clearTimeout(resizeTimer);
      if (followCursor) window.removeEventListener("mousemove", onMouseMove);
      if (followCursor) window.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("vn-email-sent", onSent);
      window.removeEventListener("keydown", onKeyDown); // TEMP
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
      {import.meta.env.DEV && followCursor && showPanel && (
        <div style={KB_PANEL.box}>
          <div style={KB_PANEL.head}>keyboard tuning</div>
          {KB_CONTROLS.map(([key, label, min, max, step]) => (
            <label key={key} style={KB_PANEL.row}>
              <span style={KB_PANEL.label}>{label}</span>
              <input
                type="range"
                min={min}
                max={max}
                step={step}
                value={kb[key]}
                onChange={(e) => setKb((s) => ({ ...s, [key]: +e.target.value }))}
                style={KB_PANEL.slider}
              />
              <span style={KB_PANEL.val}>{kb[key]}</span>
            </label>
          ))}
          <div style={KB_PANEL.btnRow}>
            <button style={KB_PANEL.btn} onClick={() => setKb(KB_DEFAULTS)}>Reset</button>
            <button
              style={KB_PANEL.btn}
              onClick={() => {
                console.log("[keyboard tuning]", kb);
                navigator.clipboard?.writeText(JSON.stringify(kb, null, 2));
              }}
            >
              Copy
            </button>
          </div>
        </div>
      )}
    </>
  );
}
