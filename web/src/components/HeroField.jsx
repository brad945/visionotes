import { useRef, useEffect, useState } from "react";
import { useTheme } from "../theme/ThemeProvider";
import { songBus } from "../audio/songBus";
import { strikeAt, SONG_PRESS } from "../audio/strike";
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
const CLICK_DROP = 4 * DEG; // how far the index dips down at the peak of the press (a clear little tap)
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
// HOW A STRUCK FINGER MOVES. A finger pressing a key REACHES INTO it: it swings
// down at the knuckle and straightens as it goes, so the tip travels toward the
// key. This used to be a tighter CURL, which pulls the fingertip away from the
// very key it is supposed to be depressing — the opposite of playing.
//
// Per finger, because they do not behave alike. The thumb and pinky are the
// short ones: they visibly stretch to cover notes the long fingers reach without
// effort, and that stretch is a lot of what reads as "playing" rather than
// "tapping". The thumb gets no straightening — it rests straight already, and
// extending it further bends it backwards at the joint.
// Measured, not assumed: the knuckle swing is what carries the tip DOWN onto the
// key. Straightening barely helps and can even work against it — the long
// fingers rest curled UNDER, so unrolling them sends the tip back up and forward
// (measured: 13px across, 1px down on the index). It is kept small, for the look
// of a finger extending into the note rather than as the thing doing the work.
//                       thumb  index  middle  ring  pinky
const PIANO_REACH  = [14, 13, 12, 13, 18].map((d) => d * DEG); // knuckle swings down
const PIANO_EXTEND = [0, 3, 2.5, 3, 7].map((d) => d * DEG);    // finger straightens
// Idle fingers HOVER. What the eye reads is contrast against the neighbours, not
// absolute depth — measured, the index dropped 27px while the ring sat at 18px,
// leaving 9px of difference, which is why that note looked like it never moved.
// Lifting the fingers that are not playing roughly doubles the separation for
// free, and it is what a pianist's hand actually does between notes.
const PIANO_HOVER = [4, 4, 4, 4, 4].map((d) => d * DEG);
// The pinky needs a bigger angle than the thumb for a comparable reach: it rests
// more curled and its bones are shorter, so the same swing buys less travel.
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
// Time constant of the song cross-fade, in seconds (~0.8s to settle). Matches
// the feel of the old 0.08-per-frame ease at 60Hz, but holds at any framerate.
const SONG_FADE_TAU = 0.2;
// How hard the hand chases the key it is about to play, per frame. Notes in
// Fuer Elise's left hand arrive ~10 frames apart at 60Hz, so this closes ~85%
// of the gap between one note and the next — a hand moving, not teleporting.
// Time constant of the reach toward a note, in seconds. Für Elise's arpeggio
// runs a note every 0.165s, so this has to arrive quickly — but on the clock,
// not per frame.
const SONG_AIM_TAU = 0.05;
// Ceiling on how fast the hand may travel, px/sec. Bounds the lurch when the
// interval is large or the loop has been starved.
// Also relative to the hand: a bigger hand has further to travel between the
// same two notes, so a fixed px/sec ceiling would throttle it.
const SONG_AIM_MAX_SPEED = 3.33; // × unit, per second
// Time constant of the velocity filter, in seconds. On the WALL CLOCK, not per
// frame — a per-frame coefficient smooths far less on a slow loop than a fast
// one, so the motion would differ between displays and, more insidiously, any
// measurement taken on a throttled loop would understate the real thing.
// Roughly how long the hand takes to settle on a new note, in seconds. Drives a
// critically damped spring, so this is a settling time, not a time constant.
const SONG_AIM_SETTLE = 0.22;
// How far ahead of the music the hand starts moving, in seconds — what a player
// does anyway, and here the only way a long reach is covered at a calm speed
// rather than a lurch.
//
// MEASURED TRADE-OFF (see fingerOnKey.test.jsx). Für Elise's left hand asks for
// up to ~660px of travel between notes 165ms apart, because at this near-edge-on
// yaw a black key's depth maps to a long move right. Nothing covers that in one
// note without darting. Leading by more than the note gap buys the far keys —
// A3 reaches 65% of its striking frames and G# 31% at 0.28, against 0% for both
// at 0.06 — but the aim is then a note ahead of the finger that is striking, so
// the near keys stop coinciding. This value favours the far keys, G# included.
const SONG_AIM_LOOKAHEAD = 0.28;
// How far past the white key a black-key note pushes the hand, in slots. A black
// key sits between two whites, so half a slot lands the finger on it.
const SONG_BLACK_KEY_BIAS = 0.5;
// How far the hand may travel from its rest pose while playing, in px. Sized to
// keep the whole hand in shot at the login splash's framing.
// Travel bounds, and they are deliberately lopsided. Measured at this framing,
// consecutive keys separate about 5:1 VERTICALLY on screen — 355px down the
// range against 75px across it — because the keyboard recedes away from a
// side-on camera. So moving ALONG the keys is very nearly a vertical move, and
// a wide horizontal allowance just lets the controller swing the hand off frame
// chasing an axis the keys barely use.
// Expressed as a fraction of `unit`, so they track the hand's size instead of
// being absolute pixels, and hold across viewport sizes.
//
// These are a ceiling on how far the hand will lunge, and they are the ONLY
// lever for "the hand should move further" — the keyboard is not to be moved to
// suit the hand. Raised 0.75 -> 1.00 and 0.556 -> 0.65 on request; the hand now
// travels 490px right (was 368) and 319px down (was 280) at its furthest.
//
// Swept at the production keyboard (Für Elise, 60fps, 1600x900):
//
//   reach x/y      far white key   G# (black)   p90 motion
//   0.75 / 0.556       55%             0%        15.2px/f
//   0.90 / 0.65        88%             0%        17.5px/f
//   1.00 / 0.65        88%             0%        18.9px/f   <- here
//   1.05 / 0.65        88%             0%        20.3px/f
//   1.45 / 1.00        88%             0%        28.0px/f
//
// Two things that sweep settles, both worth knowing before touching these:
//  - Y IS NOT BINDING past 0.65. Downward travel stops at 319px whether the
//    bound is 0.65 or 1.00, and the clamp never fires during the G#. Raising it
//    further is a no-op; 0.65 is exactly where it stops mattering.
//  - X IS PINNED AT THE BOUND for 26 of 26 G# frames at EVERY value tried, up to
//    1.45. The aim target for a black key runs away rightward without limit, so
//    the hand is always against the wall and the G# never lands however much
//    room it is given. That is a defect in the black-key goal, not a reach
//    problem, and no value of these constants will fix it. 1.00 is simply the
//    most travel that stays under the 20px/frame smoothness guard.
const SONG_AIM_REACH_X = 1.00; // × unit
const SONG_AIM_REACH_Y = 0.65; // × unit
// BLACK-KEY LEAN — a hard-coded extra reach applied ONLY while the hand is going
// for an accidental. Für Elise's G#3 is the case it exists for.
//
// SET BY EYE, and currently BELOW the value that makes contact. The reach was
// judged visually too far right twice and shortened on request, 0.66 -> 0.57 ->
// 0.385 (356 -> 307 -> 207px at the shipping hand size). Finger-on-key contact
// for the G# goes with it: 0.57 measures 60%, 0.48 measures 5%, and 0.44 and
// below measure 0%. At 0.385 the fingertip stops short of the key. That is a
// deliberate choice of look over contact — raise it back to 0.57 to reverse it.
//
// NOTE FOR THE NEXT TIME THIS IS ASKED TO COME DOWN: the lean is only a fraction
// of how far right the hand goes. At its furthest the thumb tip sits 734px right
// of home, of which the lean is 207px — the other ~527px is the aim loop's own
// travel, bounded by SONG_AIM_REACH_X. Taking 100px off the lean moved the peak
// 834 -> 734, about 12%. If the reach still reads as too far, SONG_AIM_REACH_X
// is the bigger lever, and it affects every note rather than only accidentals.
//
// Deliberately a constant rather than derived. A black key is set back in depth,
// and at this near-edge-on yaw depth maps to a long move right: the key's near
// edge sits ~660px right of the white keys the hand rests on. The aim loop
// cannot cover that inside a 200ms note — its target lands 340px short and the
// drawn hand is still accelerating when the note ends — and each principled fix
// was measured and failed. Raising the travel bound saturates (travel stops
// growing past 684px however high it goes). Aiming shallower is worth ~190px and
// still misses. More lookahead with a stiffer spring gets there only at 28px per
// frame, the visible dart that was rejected twice.
//
// Two things the sweeps settled that are NOT about the magnitude:
//
//  - THE VERTICAL COMPONENT MUST BE ZERO. "Right and down" is the intuition, but
//    the key runs right and slightly UP (slope -0.064 on screen), so any
//    downward lean walks the tip out through the bottom edge. At the contacting
//    magnitude, y = -0.04 and y = +0.14 both measured 0%; y = 0 measured 70%.
//  - IT MUST BE HIDDEN FROM THE AIM LOOP (see the subtraction at the aim block).
//    Left visible, the loop reads the lean as progress and steers to cancel it —
//    that version needed twice the lean and cost 1.5px/frame of hand motion.
//    Hidden, hand motion is completely unchanged.
const BLACK_NUDGE_X = 0.385; // × unit, rightward — by eye; 0.57 is where contact starts
const BLACK_NUDGE_Y = 0; // × unit — NOT downward; see above
// Seconds for the lean to travel its full distance, in and out. This is a
// TIME-based S-curve rather than the usual exponential approach, because an
// exponential starts at maximum velocity: the lean was released mid-phrase and
// the first frame moved the fingertip 83px on its own, which reads as a pop.
// Smoothstep has zero derivative at both ends, so the reach starts from rest.
const BLACK_NUDGE_RISE = 0.20;
// How long after the PREVIOUS note's onset the lean may start, in seconds. The
// lookahead alone had the hand leaving for the accidental before the note in
// front of it was played (that note was contacted on 10% of its own window).
const BLACK_NUDGE_HOLD = 0.05;
// The song strike envelope (press / hold for the note's length / lift) now lives
// in ../audio/strike so it can be unit-tested — it was a private const in this
// 1400-line component, which is why the behaviour it exists to provide had no
// direct coverage and shipped with an overlap bug.
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
// The unit the keyboard's px offsets below were dialled in at (scale 0.5 at
// 1600x900). posX/posY are screen pixels, but everything else about the scene —
// the hand, the key widths, the pivot — scales with `unit`. Left unscaled, the
// keyboard slides relative to the hand whenever the hand's size or the viewport
// changes: growing the hand lifted its fingers off the keys and left them
// hovering at the top edge. Dividing through by this makes the placement
// scale-invariant, and is identity at the size it was tuned at.
const KB_TUNED_UNIT = 450;
const KB_DEFAULTS = {
  posX: 800, posY: -122,   // screen-px offset of the whole keyboard
  // DO NOT "correct" the scale or yaw to make the keyboard anatomically
  // proportional to the hand. The hand is a flat 2D SIDE PROFILE, not a 3D
  // model, and this framing exists to accommodate it: a steep side-on keyboard
  // reads correctly behind a side-on hand. Opening the yaw up (tried at -30,
  // scale 1.15) turns the piano into a three-quarter front view, which only
  // works if the hand is 3D as well — it isn't, and the result looks wrong.
  // Whatever the finger-to-key mapping needs, it accommodates THIS framing.
  scale: 3,           // size multiplier about the (fixed) pivot
  tiltDeg: -1,         // 2D screen tilt, DELTA from the baseline (0.2 − 9°)
  yawDeg: -51,        // top-down 3D yaw about the left edge (− = clockwise)
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
    // Offscreen buffer: the whole hand/arm is drawn here OPAQUE, then composited onto the
    // scene at one uniform alpha — so overlapping parts (fingers/palm/arm) never stack into
    // darker patches. The same buffer is reused to cast the hand's soft drop shadow.
    const handCanvas = document.createElement("canvas");
    const handCtx = handCanvas.getContext("2d");
    // Second buffer: a dark silhouette of the hand, projected (squashed) onto the keyboard plane
    // to cast a contact-correct shadow (no offset where a finger touches a key).
    const shadowCanvas = document.createElement("canvas");
    const shadowCtx = shadowCanvas.getContext("2d");
    const canvas = bgCanvas; // the bg canvas drives sizing / cursor math

    let W, H, DPR, unit, cx, wristY;
    let mouseX = null, mouseY = null;
    let rafId = null, resizeTimer = null;
    let t0 = performance.now();
    let lastMove = t0; // timestamp of the last cursor movement (for the idle timeout)
    let armLift = 0; // eased: the whole hand pivots up at the elbow to reach high cursors
    let lungeX = 0, lungeY = 0; // eased translation of the whole model toward the Send button
    let pianoX = 0, pianoY = 0; // eased model offset for the idle piano (lateral run + wrist dip)
    let blackReach = 0; // eased 0..1: extra lean onto an accidental (see BLACK_NUDGE)
    let blackLeanFor = null; // the aim event the lean has been released for (latch)
    let blackPhase = 0; // 0..1 position along the lean's S-curve
    let lastFrameMs = t0; // for frame-rate-independent easing
    let lastRestTips = null; // previous frame's un-struck fingertips
    let lastPressedTips = null; // ...and where each lands at full press, for aiming
    let aimTargetX = 0, aimTargetY = 0; // exact aim target; the drawn hand springs to it
    let aimVelX = 0, aimVelY = 0; // spring velocity, px/sec
    let songFade = 0; // eased 0→1 as a song starts/stops — cross-fades the keyboard
    //                   and the playing pose. Without it the keyboard would blink in
    //                   and out in a single frame on play/pause and at every song
    //                   boundary, while everything else on the rig eases.
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
      for (const [cv, c2] of [[bgCanvas, bgCtx], [fgCanvas, fgCtx], [handCanvas, handCtx], [shadowCanvas, shadowCtx]]) {
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
    //
    // blackReach is a RENDER-ONLY lean onto an accidental, deliberately outside
    // the aim loop. The loop cannot deliver this itself: traced frame by frame,
    // its target for the G# converges 340px short of the key and the drawn hand
    // is still accelerating when the 200ms note ends, so raising the travel
    // bound just saturates (see the G# test). Feeding the lean back through
    // pianoX would also make the loop fight it — the slot error would read as
    // overshoot and it would steer straight back off the key. Applied here, the
    // controller never sees it, and it rides the strike envelope so it eases on
    // and off with the press rather than snapping.
    const toCanvas = (p) => {
      const q = armLift ? liftLocal(p, armLift) : p;
      const bx = blackReach * BLACK_NUDGE_X * unit;
      const by = blackReach * BLACK_NUDGE_Y * unit;
      return [cx + lungeX + pianoX + bx + q[0] * unit, wristY + lungeY + pianoY + by - q[1] * unit];
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

    // ---- keyboard layout (pure; no dependence on the LIVE hand) --------------
    // Everything here comes from the CONSTANT rest pose and the tuning knobs, so
    // it can be computed before the hand is posed. That ordering is what lets the
    // hand be aimed AT a key: pianoX/pianoY are set early in draw(), long before
    // the keyboard used to be laid out.
    function computeKeyboard() {
      const k = kbRef.current;
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
      const nearY = sumY / FINGERS.length + 0.02 * unit; // front edge — where fingers press
      const faceH = 0.1 * unit; // key thickness / front+side face height
      const nWhite = Math.max(7, Math.round(kbW / (0.115 * unit)));
      const wKeyW = kbW / nWhite;
      const EXT_L = k.extL, EXT_R = k.extR;
      const vpX = kbLeft + kbW * k.vpXf;
      const vpY = nearY - k.vpYf * unit;
      const recede = k.recede;
      const pivotXk = kbLeft - EXT_L * wKeyW; // leftmost near-edge x (the yaw pivot)
      const rightXk = kbLeft + (nWhite + EXT_R) * wKeyW;
      const Uspan = rightXk - pivotXk || 1;
      const cur0 = (X, w) => [X + (vpX - X) * w * recede, nearY + (vpY - nearY) * w * recede];
      const kbH = squareToQuad([cur0(pivotXk, 0), cur0(rightXk, 0), cur0(rightXk, 1), cur0(pivotXk, 1)]);
      const KB_DEPTH = k.depth;
      const KB_YAW = k.yawDeg * DEG;
      const yc = Math.cos(KB_YAW), ys = Math.sin(KB_YAW);
      const projUV = (u, v) => {
        const Xw = u, Zw = v * KB_DEPTH;
        const ur = Xw * yc - Zw * ys;
        const vr = (Xw * ys + Zw * yc) / KB_DEPTH;
        return applyH(kbH, ur, clamp(vr, -3, 1.7));
      };
      const proj = (X, w) => projUV((X - pivotXk) / Uspan, w);
      const tbL = rotW([FINGERS[0].mcp[0] + FINGER_OFFSET[0], FINGERS[0].mcp[1] + FINGER_OFFSET[1]], -HAND_DROOP);
      const pcx = cx + tbL[0] * unit, pcy = wristY - tbL[1] * unit;
      // See KB_TUNED_UNIT: the keyboard's px offsets have to scale with the rest
      // of the scene, or it slides relative to the hand as the hand or viewport
      // changes size.
      const posX = k.posX * (unit / KB_TUNED_UNIT);
      const posY = k.posY * (unit / KB_TUNED_UNIT);
      const kbTilt = 0.2 - 9 * DEG + k.tiltDeg * DEG;
      const kbCos = Math.cos(kbTilt), kbSin = Math.sin(kbTilt);
      const toScreen = (pt) => {
        const sx = (pt[0] - pcx) * k.scale;
        const sy = (pt[1] - pcy) * k.scale;
        return [posX + pcx + sx * kbCos - sy * kbSin, posY + pcy + sx * kbSin + sy * kbCos];
      };
      // Where a given key sits on screen, at the near edge where a finger presses.
      // A black key sits between white `slot` and `slot + 1`.
      //
      // Both use the SAME shallow depth. The keyboard recedes steeply and is then
      // scaled 3x, so depth dominates screen position: aiming a black key even
      // slightly further back (0.3 vs 0.1) threw its target 1377px sideways and
      // the hand lunged off the keyboard for every accidental. Fingers press near
      // the front edge of whatever key they are on, so front is also the honest
      // place to aim.
      const KEY_PRESS_DEPTH = 0.1;
      const keyPoint = (slot, black) => {
        const x = black ? kbLeft + (slot + 1) * wKeyW : kbLeft + (slot + 0.5) * wKeyW;
        return toScreen(proj(x, KEY_PRESS_DEPTH));
      };
      // Which drawn key slot a screen point falls in, using the SAME quad test
      // the renderer uses to decide what to depress. At this yaw a key is a long
      // sliver, so a fingertip can be correctly on a key while sitting far from
      // any single sampled point along it — only the quad answers honestly.
      const slotAt = (pt) => {
        for (let kk = -EXT_L; kk < nWhite + EXT_R; kk++) {
          const x0 = kbLeft + kk * wKeyW, x1 = x0 + wKeyW;
          const quad = [toScreen(proj(x0, 0)), toScreen(proj(x1, 0)),
                        toScreen(proj(x1, 1)), toScreen(proj(x0, 1))];
          if (pointInPoly(pt[0], pt[1], quad)) return kk;
        }
        return null;
      };
      // Screen displacement from one slot to the next, measured locally: the
      // keyboard recedes, so this grows with slot and no fixed step stays true.
      const slotStep = (slot) => {
        const a = toScreen(proj(kbLeft + (slot + 0.5) * wKeyW, 0));
        const b = toScreen(proj(kbLeft + (slot + 1.5) * wKeyW, 0));
        return [b[0] - a[0], b[1] - a[1]];
      };
      return { k, posX, posY, kbLeft, kbW, nearY, faceH, nWhite, wKeyW, EXT_L, EXT_R, proj, toScreen, keyPoint, slotAt, slotStep, pcx, pcy, kbTilt };
    }



    function draw() {
      const now = performance.now();
      const t = (now - t0) / 1000;
      let ctx = bgCtx; // hand render target (reassigned to the offscreen buffer for the normal hand)
      bgCtx.clearRect(0, 0, W, H);
      fgCtx.clearRect(0, 0, W, H);
      bgCtx.globalAlpha = MODEL_ALPHA; // render the whole model slightly transparent
      fgCtx.globalAlpha = MODEL_ALPHA;

      // Morph-sequence window (thumbs-up). Computed UP HERE so the lunge can freeze during it:
      // the morph snapshots the hand dots once, but the forearm keeps drawing live — if the lunge
      // eased home meanwhile, the arm would drift off the snapshotted hand (the click-Send-vs-'g' bug).
      const sinceSent = now - sentT;
      const MORPH_TOTAL = MORPH_PAUSE_IN + MORPH_RISE + MORPH_HOLD + MORPH_FALL + MORPH_PAUSE_OUT;
      const inMorphSeq = sinceSent >= 0 && sinceSent < MORPH_TOTAL;

      // Lunge toward the "Send link" button when the cursor is over it: ease the
      // whole model so the index fingertip closes onto the cursor (just touching the
      // button). While hovering, keep the hand engaged (reset the idle timeout).
      // Hover-lunge over the Send-link button OR the theme toggle (the finger chases the cursor onto
      // whichever it's over).
      const overEl = (sel) => {
        if (!(followCursor && mouseX != null)) return false;
        const el = document.querySelector(sel);
        if (!el) return false;
        const br = el.getBoundingClientRect();
        const cr = canvas.getBoundingClientRect();
        const pxc = mouseX + cr.left, pyc = mouseY + cr.top;
        return pxc >= br.left && pxc <= br.right && pyc >= br.top && pyc <= br.bottom;
      };
      // Song mode: the piano player is playing a piece. Sampled ONCE per frame so
      // every consumer below sees a consistent value, and the clock is read live
      // off the AudioContext so each strike lands on the note you actually hear.
      // Laid out BEFORE the hand is posed, so the hand can be aimed at a key.
      const kbGeom = computeKeyboard();
      const songHeld = !!songBus.strikeSpans && !!songBus.events; // data attached (may be suspended)
      const songActive = songBus.active && songHeld;
      // Read the clock whenever a song is ATTACHED, not only while it plays.
      // Suspended, getTime() returns the frozen playback position, which is what
      // holds the hand on its last chord through the fade; zeroing it here would
      // snap the pose back to the top of the piece instead.
      const songT = songHeld ? songBus.getTime() : 0;
      // Ease on WALL CLOCK, not per frame. A fixed per-frame coefficient makes
      // the cross-fade last however long a frame happens to take: ~0.8s at 60Hz
      // but ~0.35s on a 144Hz display, and near-instant on a 240Hz one, so the
      // effect this was written to produce quietly disappears on better hardware.
      const frameDt = Math.min(0.1, (now - lastFrameMs) / 1000);
      lastFrameMs = now;
      songFade += ((songActive ? 1 : 0) - songFade) * (1 - Math.exp(-frameDt / SONG_FADE_TAU));

      // While a song plays the hand must stay over its keyboard, so the hover-lunge
      // is suppressed — otherwise moving the cursor onto Send mid-piece would drag
      // the whole model off the keys.
      const overButton = !songActive && (overEl(".login-send-btn") || overEl(".vn-theme-toggle"));
      if (inMorphSeq) {
        // FREEZE the lunge during the morph so the live forearm stays glued to the snapshotted
        // (possibly lunged) hand — otherwise the arm eases home and detaches at the wrist.
      } else if (overButton) {
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
      // A playing song takes the hand over: fading `front` out stops the fingers
      // chasing the cursor and stops the arm-lift, exactly as going idle does
      // today — so the hand eases into its playing posture over the keys.
      const front = (1 - songFade) * spatialGate * idleActive;
      // While the cursor is LEFT of the line, STOP tracking it — aim at the LAST in-zone
      // position so the hand HOLDS that pose (then `front` fades it into the piano).
      const aimLc = cursorLeft && lastLc ? lastLc : lc;

      // Dot-morph sequence for the thumbs-up: PAUSE (hand frozen as dots) → RISE (fly to
      // thumbs-up) → HOLD → FALL (fly back) → PAUSE (frozen) → resume. The pauses make it
      // obvious the SAME dots form both the hand and the thumbs-up. `morph` = 0 (hand) → 1
      // (thumbs-up). `inMorphSeq` = the whole sequence (the hand is frozen throughout it).
      let morph = 0;
      if (inMorphSeq) {
        const r0 = MORPH_PAUSE_IN, r1 = r0 + MORPH_RISE, h1 = r1 + MORPH_HOLD, f1 = h1 + MORPH_FALL;
        if (sinceSent < r0) morph = 0; // pause on the hand
        else if (sinceSent < r1) morph = smoothstep(r0, r1, sinceSent); // fly out
        else if (sinceSent < h1) morph = 1; // hold thumbs-up
        else if (sinceSent < f1) morph = 1 - smoothstep(h1, f1, sinceSent); // fly back
        else morph = 0; // pause on the hand
      }

      // Piano mode: run a phrase, dip the wrist on strikes (weight) and drift the
      // arm laterally toward the most-recent note (so it "follows" the run). The
      // source is either the looping idle PIANO_PHRASE or, when the player is
      // running, the current song — both reduce to the same {t, f, lat} events, so
      // everything downstream (strike curl, key press, keyboard fade) is untouched.
      // Whichever wants the keyboard more — a playing song or the idle timeout —
      // wins, so play/pause and every song boundary cross-fade instead of blinking
      // (the keyboard is drawn at globalAlpha = pianoGate). The morph factor is
      // preserved so the thumbs-up still beats a playing song.
      const pianoGate = Math.max(songFade, 1 - idleActive) * (inMorphSeq ? 0 : 1);
      // The keyboard needs its OWN alpha, because `inMorphSeq ? 0 : 1` is a hard
      // binary: trigger the thumbs-up mid-song and the keyboard blinked out on
      // one frame and back in 4.58s later — exactly the pop the cross-fade was
      // written to remove. The strike freeze genuinely needs the binary (the dots
      // are snapshotted), but the keyboard only needs to be gone while the hand
      // is a thumbs-up, so ride `morph`, which is already eased both ways.
      const kbAlpha = Math.max(songFade, 1 - idleActive) * (1 - morph);
      const handFrozen = inMorphSeq; // freeze the hand pose so the dots hold + resume cleanly
      const phraseT = (t * PIANO_BPS) % PIANO_PHRASE_BEATS;
      const pianoFlexArr = [0, 0, 0, 0, 0];
      let songAim = null;
      let blackGateOK = true; // has the note immediately before the accidental been played?
      let hingeTarget = 0;
      if (pianoGate > 0.01) {
        let strkSum = 0;
        let latTarget = 0;
        // Drive from the song for as long as the cross-fade is still running, not
        // just while it is actively playing. `songActive` flips in a single frame
        // on pause and at every song boundary, and the idle phrase it fell back
        // to runs on a free-running clock with no relation to the music — so the
        // fingers snapped to an unrelated pose while the keyboard was still up.
        // The bus keeps the spans attached when suspended, and getTime() returns
        // the frozen position, so the hand simply holds its last chord instead.
        if (songHeld && (songActive || songFade > 0.01)) {
          const evs = songBus.events;
          let recentEv = null;
          for (const ev of evs) {
            if (ev.t <= songT) recentEv = ev;
            else break;
          }
          latTarget = recentEv ? recentEv.lat : 0;
          // AIM AHEAD. A pianist moves toward a note before playing it, and here
          // that is also the only way the hand can arrive on time: reaching G#
          // means travelling ~660px, because at this near-edge-on yaw a black
          // key's depth maps to a long move right — and Für Elise's arpeggio
          // gives a note every 165ms. Starting on the downbeat, the hand covers
          // barely a third of that before the next note. Starting early, it
          // arrives with the sound, without having to dart to do it.
          //
          // But NOT before the current note has been struck. Applied blindly the
          // lookahead abandons the note the hand is on: the reach for the G#
          // began 280ms early, which is before the note preceding it was even
          // played, so that note was contacted on 10% of its own window while
          // the hand was already on its way to the accidental. Holding the aim
          // until the press has landed costs the reach a little of its head
          // start and buys the previous note actually being hit.
          let aimEv = recentEv;
          for (const ev of evs) {
            if (ev.t <= songT + SONG_AIM_LOOKAHEAD) aimEv = ev;
            else break;
          }
          songAim = aimEv || null; // the note the hand should be reaching for
          // Gate for the black-key lean: has the note IMMEDIATELY BEFORE the
          // accidental been played?
          //
          // It must be that note, found in the event list, and not simply the
          // most recent event. Für Elise's arpeggio runs E2 2.31, E3 2.48, G#
          // 2.64, and the aim reaches the G# at 2.36 — when the most recent
          // event is still the E2. Gating on "the current event" therefore let
          // the lean go at 2.37, 110ms before the E3 it was supposed to wait
          // for. The E3 measured better anyway, but only as an artifact of the
          // retraction bug below holding the hand back by accident.
          //
          // Touching the LOOKAHEAD instead was tried twice and is much worse:
          // gating every note drops the far white key 75% -> 40%, and gating
          // only accidentals inside the search above strands it on the blocked
          // event and drops that key to 18%. The lookahead is load-bearing for
          // the whole piece; the lean is not.
          blackGateOK = true;
          if (aimEv && aimEv.aimKey && aimEv.aimKey.black) {
            const ai = evs.indexOf(aimEv);
            const before = ai > 0 ? evs[ai - 1] : null;
            blackGateOK = !before || songT >= before.t + BLACK_NUDGE_HOLD;
          }
          for (let si = 0; si < 5; si++) {
            pianoFlexArr[si] = strikeAt(songBus.strikeSpans[si], songT);
            strkSum += pianoFlexArr[si];
          }
        } else {
          let recentEv = PIANO_PHRASE[PIANO_PHRASE.length - 1];
          for (const ev of PIANO_PHRASE) {
            if (ev.t <= phraseT) recentEv = ev;
            else break;
          }
          latTarget = recentEv.lat;
          for (let si = 0; si < 5; si++) {
            pianoFlexArr[si] = pianoStrike(si, phraseT);
            strkSum += pianoFlexArr[si];
          }
        }
        if (songAim && songAim.aimKey && lastPressedTips && lastPressedTips[songAim.aimFinger]) {
          // TRAVEL TO THE NOTE — as a closed loop on the quantity that actually
          // matters: which key slot the striking finger is sitting in.
          //
          // Open-loop attempts all failed for the same reason. Aiming the finger
          // at a sampled point on the key overshot, because a key is a long
          // sliver here and the sample sits far along it. Displacing the hand by
          // the key-to-key screen delta ignored WHICH finger strikes, so it
          // worked for the thumb and index (3 of 7 notes) and missed by up to 5
          // slots for the ring and pinky. And no fixed step can be right anyway:
          // the keyboard recedes, so screen distance per slot grows across it.
          //
          // Measuring the error in SLOTS and stepping by the local per-slot
          // vector sidesteps all of that — it converges whatever the finger and
          // wherever it is, and it optimises exactly the property being judged.
          const slotOfKey = songAim.aimKey.white - songBus.keyOffset;
          // Which slot to steer the finger into. For a white key that is the key
          // itself. For a BLACK key it is whichever slot the black key's own
          // playable point falls in — a black key is centred on the boundary
          // between two whites AND set back in depth, and at this near-edge-on
          // yaw "into the keyboard" and "along the keys" are nearly the same
          // screen direction, so its contact point does not sit in the white slot
          // that names it. Letting the geometry answer that avoids trying to
          // correct for it with an offset: offsetting by the full depth vector
          // overshot three slots, and the part perpendicular to the key axis is
          // ~zero at this angle, so there is nothing to correct WITH.
          let want = slotOfKey;
          if (songAim.aimKey.black) {
            const bxc = kbGeom.kbLeft + (slotOfKey + 1) * kbGeom.wKeyW;
            const contact = kbGeom.slotAt(kbGeom.toScreen(kbGeom.proj(bxc, 0.36)));
            if (contact !== null) want = contact;
          }
          // Subtract the black-key lean before reasoning about the tip. The
          // lean is applied in toCanvas, so lastPressedTips already carries it —
          // and if the controller sees it, it treats it as progress toward the
          // key and steers the hand back left to cancel it. The two then fight,
          // which is why the lean needed to be roughly twice as large as the gap
          // it was closing. Undoing it here makes the lean genuinely additive.
          const leanX = blackReach * BLACK_NUDGE_X * unit;
          const leanY = blackReach * BLACK_NUDGE_Y * unit;
          const tipRaw = lastPressedTips[songAim.aimFinger];
          const tip = [tipRaw[0] - leanX, tipRaw[1] - leanY];
          // Correctness and smoothness are separated, because tying them
          // together forces a choice between the two: enough filtering to stop
          // the hand lurching also stops it arriving in time for the next note.
          //
          // The closed loop converges an exact TARGET, and the drawn hand eases
          // toward that target. Crucially the slot error is evaluated at where
          // the target is, NOT where the hand currently is — feeding back on the
          // lagging rendered position would keep reporting an error the target
          // has already corrected, and the target would wind up and overshoot.
          const tipAtTarget = [tip[0] + (aimTargetX - pianoX), tip[1] + (aimTargetY - pianoY)];
          // Steer to the key's PLAYING POINT — near its front edge, where a
          // hand actually sits — and correct the full 2-D error.
          //
          // Constraining only the perpendicular distance to the key's centre
          // line does not work, and the failure is subtle: a key here is a
          // ~2000px sliver, so a hand that has drifted far ALONG one is still on
          // its centre line. The loop reads that as solved and never pulls back.
          // Traced, the hand reached out ~660px for the G# and then sat there for
          // the remaining six seconds of the piece, drifting further out on every
          // note, because each new white-key target was also "satisfied".
          //
          // A fixed point near the front edge removes that freedom: there is one
          // place on each key the finger should be, so every note pulls the hand
          // to a definite position and it returns from the black key on its own.
          const kx = songAim.aimKey.black
            ? kbGeom.kbLeft + (slotOfKey + 1) * kbGeom.wKeyW  // centred on the boundary
            : kbGeom.kbLeft + (want + 0.5) * kbGeom.wKeyW;    // down the middle
          // Black keys start further back (they span 0.12-0.6), so their playing
          // point is deeper than a white key's.
          const goal = kbGeom.toScreen(kbGeom.proj(kx, songAim.aimKey.black ? 0.14 : 0.06));
          {
            const k = 1 - Math.exp(-frameDt / SONG_AIM_TAU);
            aimTargetX += (goal[0] - tipAtTarget[0]) * k * pianoGate;
            aimTargetY += (goal[1] - tipAtTarget[1]) * k * pianoGate;
          }
          const reachX = SONG_AIM_REACH_X * unit;
          const reachY = SONG_AIM_REACH_Y * unit;
          aimTargetX = clamp(aimTargetX, -reachX, reachX);
          aimTargetY = clamp(aimTargetY, -reachY, reachY);
          // Follow the target on the wall clock, with a ceiling on how fast the
          // hand may travel. The ceiling is what stops a large interval — or a
          // frame the loop was starved through — resolving in one step, which
          // reads as a teleport rather than a hand moving.
          // Follow with a CRITICALLY DAMPED SPRING, not an exponential ease.
          // Exponential smoothing is fastest at the instant the target moves and
          // decays from there — the hand leaves at full speed and coasts in,
          // which is precisely the lurch. A spring starts from rest, accelerates
          // and decelerates, and settles without overshoot: continuous velocity,
          // so there is nothing to read as a jump.
          //
          // It can afford to be leisurely. The lit key is driven by the NOTE, so
          // a hand still gliding into place does not light the wrong key — the
          // worst case is the hand arriving a little after its own note, which
          // is what a real hand does anyway.
          // A BLACK key is identified by the white key it sits after, so the
          // loop above parks the finger on that WHITE key — in front of the
          // black one, never on it. Für Elise's G#3 is the case that matters.
          // Offset the drawn hand half a slot further along the key axis, which
          // is where the black key physically sits. Applied to the RENDER only:
          // the loop keeps converging on the integer white slot, so the two
          // never fight, and the lit key is note-driven regardless.
          const goalX = aimTargetX;
          const goalY = aimTargetY;
          const w = 2 / SONG_AIM_SETTLE; // natural frequency for critical damping
          aimVelX += (w * w * (goalX - pianoX) - 2 * w * aimVelX) * frameDt;
          aimVelY += (w * w * (goalY - pianoY) - 2 * w * aimVelY) * frameDt;
          const sp = Math.hypot(aimVelX, aimVelY);
          const maxSpeed = SONG_AIM_MAX_SPEED * unit;
          if (sp > maxSpeed) {
            aimVelX *= maxSpeed / sp;
            aimVelY *= maxSpeed / sp;
          }
          pianoX += aimVelX * frameDt;
          pianoY += aimVelY * frameDt;
          // Backstop the drawn position too. reachX/reachY, NOT the bare
          // constants — those are fractions of `unit`, so clamping to them
          // directly pins the hand inside a fifth of a pixel and it cannot move
          // at all. That is exactly what happened when the constants were made
          // unit-relative and this second clamp was left behind.
          pianoX = clamp(pianoX, -reachX, reachX);
          pianoY = clamp(pianoY, -reachY, reachY);
        } else {
          pianoX += (latTarget * PIANO_SHIFT * pianoGate - pianoX) * 0.07;
          pianoY += (Math.min(strkSum, 1.6) * PIANO_DROP * pianoGate - pianoY) * 0.3;
        }
        // Lean onto the accidental, driven by the AIM rather than by the press.
        //
        // Tying it to the striking finger's press level is the obvious choice and
        // it does not work: the press ramps over the note, so the lean peaked at
        // 0.79 at t=2.82 for a note ending at 2.87 and the finger only arrived as
        // it was leaving. Following the aim instead means the lean starts with
        // the lookahead, ~300ms early, and is fully in place before the note is
        // struck — which is also what a pianist does. It still eases rather than
        // steps, so the hand leans over rather than teleporting.
        // ...and not until the note before the accidental has been played.
        //
        // LATCHED PER TARGET, which matters more than the gate itself. Testing
        // the gate every frame made it RETRACT a lean already under way: each
        // new event reset it for BLACK_NUDGE_HOLD, so mid-approach the lean fell
        // 0.75 -> 0.41 and then climbed again, twice per G#, yanking the hand
        // ~200px backwards and forwards. Ten direction reversals across the
        // piece — the "glitchy/jumpy" that was reported. Once released for a
        // given target the lean stays released until the aim leaves it, so the
        // gate can only ever delay the reach, never reverse it.
        if (!(songAim && songAim.aimKey && songAim.aimKey.black)) blackLeanFor = null;
        else if (blackLeanFor !== songAim && blackGateOK) blackLeanFor = songAim;
        const blackTarget = blackLeanFor && blackLeanFor === songAim ? pianoGate : 0;
        blackPhase = clamp(blackPhase + (blackTarget > 0.5 ? frameDt : -frameDt) / BLACK_NUDGE_RISE, 0, 1);
        blackReach = blackPhase * blackPhase * (3 - 2 * blackPhase); // smoothstep
        // wrist hinges: a slow undulation + a flex DOWN on each strike (weight).
        hingeTarget = (Math.sin(t * 0.4) * WRIST_SWAY - Math.min(strkSum, 1.5) * WRIST_FLEX) * pianoGate;
      } else if (!handFrozen) {
        pianoX += (0 - pianoX) * 0.07;
        pianoY += (0 - pianoY) * 0.3;
        blackPhase = Math.max(0, blackPhase - frameDt / BLACK_NUDGE_RISE);
        blackReach = blackPhase * blackPhase * (3 - 2 * blackPhase);
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
      const isDark = themeRef.current !== "light";

      // Returns a top→bottom linear gradient across a GLOBAL bounding box shared
      // by all hand parts — so forearm, palm, and every finger are all shaded by
      // the same light, making the hand read as one unified solid rather than
      // separate objects each with their own full highlight→shadow range.
      // `globalMinY` / `globalMaxY` are computed after all polys are built (below).
      function handGrad(c, globalMinY, globalMaxY) {
        const g = c.createLinearGradient(0, globalMinY, 0, globalMaxY);
        if (isDark) {
          g.addColorStop(0,    "#3a5068"); // lit top (bounced skylight)
          g.addColorStop(0.3,  "#243549"); // upper-mid
          g.addColorStop(0.65, "#161d27"); // base colour
          g.addColorStop(1,    "#07101a"); // shadowed underside
        } else {
          g.addColorStop(0,    "#f0f5f7"); // lit top
          g.addColorStop(0.3,  "#e8eef2"); // upper-mid
          g.addColorStop(0.65, "#dde5e9"); // base colour
          g.addColorStop(1,    "#bfcdd4"); // shadowed underside
        }
        return g;
      }

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
        // Reach into the key: swing down at the knuckle AND straighten. Curl is
        // negative for a finger curled under, so ADDING moves it toward straight.
        const strike = pianoFlexArr[i] * pianoGate;
        const reach = strike * PIANO_REACH[i];
        const extend = strike * PIANO_EXTEND[i];
        const hover = (1 - strike) * pianoGate * PIANO_HOVER[i]; // lift when idle
        const joints = fingerJoints(
          origin, st.base - pressBase - reach + hover, st.curl + extend, f.seg, f.prof,
        );
        const contour = smoothClosed(fingerContour(joints, f.w), 2).map(drp);
        // rest (un-struck) tip: same finger WITHOUT the piano strike / click press, so the
        // keyboard can be sized off a stable anchor instead of the jittering live tip.
        const restJoints = fingerJoints(origin, st.base, st.curl, f.seg, f.prof);
        // Where this finger's tip lands at FULL press — a fixed pose, not the
        // live one. The aim converges on THIS rather than the resting tip: a
        // strike drives the fingertip a long way (measured, 1-2 whole key slots
        // past the target), so aiming the resting tip puts the pressed finger
        // that far beyond the key it is playing. Using a fixed pose keeps the
        // loop from feeding back on the live strike level.
        const pressedJoints = fingerJoints(
          origin, st.base - PIANO_REACH[i], st.curl + PIANO_EXTEND[i], f.seg, f.prof,
        );
        fingerJobs.push({
          poly: contour,
          joints: joints.map(drp),
          tip: drp(joints[joints.length - 1]),
          restTip: drp(restJoints[restJoints.length - 1]),
          pressedTip: drp(pressedJoints[pressedJoints.length - 1]),
          w: f.w,
          capR: f.w * unit * 2.2, // small zone (≈ knuckle-cap size) around the MCP
        });
      }

      // Remember the UN-STRUCK fingertips, indexed by finger. The next frame aims
      // the hand with these: they are the tip positions without the strike curl,
      // so a finger pressing down cannot drag the whole hand after it.
      lastRestTips = [];
      lastPressedTips = [];
      fingerJobs.forEach((job, idx) => {
        lastRestTips[order[idx]] = job.restTip;
        lastPressedTips[order[idx]] = job.pressedTip;
      });

      // --- Idle piano keyboard: fades in with the idle pose. Drawn HERE so it sits
      // UNDER the hand. The keyboard is fixed (so the lateral run reads as the hand
      // moving along the keys) and the key under each striking fingertip sinks in
      // sync with the finger press.
      if (kbAlpha > 0.02) {
        const k = kbRef.current; // live tuning knobs (DEV panel); = KB_DEFAULTS in production
        // `restX/restY` is the UN-STRUCK fingertip. The live tip moves up to 76px
        // during its own press, which is 2 key slots at this angle, so hit-testing
        // the live tip made a single note light three keys in sequence.
        const tips = fingerJobs.map((job, idx) => ({
          x: job.tip[0], y: job.tip[1],
          restX: job.restTip[0], restY: job.restTip[1],
          s: pianoFlexArr[order[idx]] * pianoGate,
        }));
        // DEV probe: publish the real numbers the aim depends on, so the
        // finger-to-key relationship can be measured from the page instead of
        // reasoned about from approximations. Costs nothing in production —
        // import.meta.env.DEV is compiled out — and only runs under ?rafshim=1.
        if (import.meta.env.DEV && window.__rafShim) {
          const probe = { pianoX, pianoY, blackReach, tips: {}, keys: {} };
          fingerJobs.forEach((job, idx) => {
            probe.tips[order[idx]] = job.restTip;
            // live (struck) tip vs rest tip: how far the strike actually reaches
            probe.reach = probe.reach || {};
            probe.reach[order[idx]] = [
              Math.round(job.tip[0] - job.restTip[0]),
              Math.round(job.tip[1] - job.restTip[1]),
            ];
          });
          if (songBus.keys) {
            const G0 = kbGeom;
            probe.keyQuads = {};
            for (const id of songBus.keys.keys()) {
              const black = id[0] === "b";
              const abs = parseInt(id.slice(1), 10);
              const slot = abs - songBus.keyOffset;
              probe.keys[id] = G0.keyPoint(slot, black);
              // Publish the QUAD too, not just a point. Measuring the aim against
              // "distance to a point on the key" is what misled several earlier
              // attempts — a key is a ~2500px sliver, so a fingertip correctly on
              // one can sit 2000px from any sampled point. And the quad has to be
              // available for EVERY key on every frame, not just the aimed one:
              // with a large lookahead the aim has already moved to the next note
              // while the finger is still on this one, so an aim-anchored
              // measurement silently changes what it is counting.
              if (black) {
                const bw = G0.wKeyW * 0.56;
                const bx = G0.kbLeft + (slot + 1) * G0.wKeyW - bw / 2;
                probe.keyQuads[id] = [G0.toScreen(G0.proj(bx, 0.12)), G0.toScreen(G0.proj(bx + bw, 0.12)),
                                      G0.toScreen(G0.proj(bx + bw, 0.6)), G0.toScreen(G0.proj(bx, 0.6))];
              } else {
                const x0 = G0.kbLeft + slot * G0.wKeyW;
                probe.keyQuads[id] = [G0.toScreen(G0.proj(x0, 0)), G0.toScreen(G0.proj(x0 + G0.wKeyW, 0)),
                                      G0.toScreen(G0.proj(x0 + G0.wKeyW, 1)), G0.toScreen(G0.proj(x0, 1))];
              }
            }
          }
          // Is the LIVE fingertip inside the quad of the key it is playing?
          // The only honest test of the aim: a key is a ~2000px sliver at this
          // camera angle, so distance to any sampled point on it is meaningless
          // — a finger correctly on a key can sit 2000px from that point.
          if (songAim && songAim.aimKey && fingerJobs[order.indexOf(songAim.aimFinger)]) {
            const G = kbGeom;
            const job = fingerJobs[order.indexOf(songAim.aimFinger)];
            const slot = songAim.aimKey.white - songBus.keyOffset;
            let quad;
            if (songAim.aimKey.black) {
              const bw = G.wKeyW * 0.56;
              const bx = G.kbLeft + (slot + 1) * G.wKeyW - bw / 2;
              quad = [G.toScreen(G.proj(bx, 0.12)), G.toScreen(G.proj(bx + bw, 0.12)),
                      G.toScreen(G.proj(bx + bw, 0.6)), G.toScreen(G.proj(bx, 0.6))];
            } else {
              const x0 = G.kbLeft + slot * G.wKeyW;
              quad = [G.toScreen(G.proj(x0, 0)), G.toScreen(G.proj(x0 + G.wKeyW, 0)),
                      G.toScreen(G.proj(x0 + G.wKeyW, 1)), G.toScreen(G.proj(x0, 1))];
            }
            probe.tipOnAimedKey = pointInPoly(job.tip[0], job.tip[1], quad);
            probe.aimStrike = pianoFlexArr[songAim.aimFinger] * pianoGate;
            probe.aimQuad = quad;
            probe.aimTipXY = [job.tip[0], job.tip[1]];
            probe.aimClamped = {
              x: Math.abs(Math.abs(aimTargetX) - SONG_AIM_REACH_X * unit) < 0.5,
              y: Math.abs(Math.abs(aimTargetY) - SONG_AIM_REACH_Y * unit) < 0.5,
            };
            probe.wantSlot = slot;
            probe.liveTipSlot = G.slotAt(job.tip);
            probe.restTipSlot = G.slotAt(job.restTip);
          }
          if (songAim && songAim.aimKey) {
            probe.aim = {
              finger: songAim.aimFinger,
              key: (songAim.aimKey.black ? "b" : "w") + songAim.aimKey.white,
              slot: songAim.aimKey.white - songBus.keyOffset,
            };
          }
          // Which key slot each fingertip is actually INSIDE, using the same
          // quad test the renderer uses. This is the only honest measure of
          // finger-to-key tracking: at this yaw a key is a long sliver, so a
          // fingertip can be on the right key while being far from any single
          // sampled point along it.
          probe.fingerSlot = {};
          const G = kbGeom; // destructured copies are not in scope yet here
          for (let fi = 0; fi < 5; fi++) {
            const tp = probe.tips[fi];
            if (!tp) continue;
            for (let kk = -G.EXT_L; kk < G.nWhite + G.EXT_R; kk++) {
              const x0 = G.kbLeft + kk * G.wKeyW, x1 = x0 + G.wKeyW;
              const quad = [G.toScreen(G.proj(x0, 0)), G.toScreen(G.proj(x1, 0)),
                            G.toScreen(G.proj(x1, 1)), G.toScreen(G.proj(x0, 1))];
              if (pointInPoly(tp[0], tp[1], quad)) { probe.fingerSlot[fi] = kk; break; }
            }
          }
          probe.whitePressed = {};
          probe.blackPressed = {};
          window.__vnProbe = probe;
        }
        // Song-driven key press. Returns null when no song is playing, so the
        // caller falls back to the geometric hit-test for the idle phrase.
        const songKeyPress = (whiteSlot, black) => {
          if (!songActive || !songBus.keys) return null;
          // Drawn slot -> ABSOLUTE white-key index. The offset is a whole number
          // of octaves precisely so this addition preserves pitch class: the
          // renderer's own black-key pattern makes drawn slot k the natural
          // [C,D,E,F,G,A,B][k mod 7], so any non-multiple-of-7 shift rotates
          // every note onto a wrongly-named key.
          const spans = songBus.keys.get(
            (black ? "b" : "w") + (whiteSlot + songBus.keyOffset),
          );
          return spans ? strikeAt(spans, songT) : 0;
        };
        // Keyboard SIZE/POSITION is computed from the CONSTANT rest pose (fixed angles, base
        // hand rotation, NO breathing / wrist-hinge / run / dip), so it NEVER changes size or
        // place — the hand just plays over a fixed keyboard. (Live `tips` only sink struck keys.)
        const { kbLeft, kbW, nearY, faceH, nWhite, wKeyW, EXT_L, EXT_R, proj, toScreen } = kbGeom;
        bgCtx.save();
        // OPAQUE keys, faded by pianoGate so the keyboard fades in/out with piano mode
        // (only the fade uses alpha): otherwise the page background bleeds through and, on
        // the dark theme, blackens the pressed front faces.
        bgCtx.globalAlpha = kbAlpha;
        // rotate the keyboard CLOCKWISE around the (FIXED) base of the thumb. Use the
        // CONSTANT rest-pose thumb MCP so the pivot never moves → the whole keyboard is
        // stable in size AND place (not tied to the live, breathing thumb).
        const { pcx, pcy, kbTilt } = kbGeom;
        // Position / tilt / scale as ONE rigid transform (canvas post-multiplies, so the LAST call
        // is the FIRST transform a point sees): posX/posY is OUTERMOST → a pure screen-px offset,
        // unaffected by tilt/scale. Tilt + uniform scale share the fixed pivot (pcx,pcy) so they
        // commute and the keyboard never drifts. Yaw is NOT here — it lives inside proj() as the
        // metric ground-plane rotation before the homography.
        bgCtx.translate(kbGeom.posX, kbGeom.posY);
        bgCtx.translate(pcx, pcy);
        bgCtx.rotate(kbTilt);
        bgCtx.scale(k.scale, k.scale);
        bgCtx.translate(-pcx, -pcy);
        // Replay that same rigid transform by hand, so key geometry can be compared
        // against the fingertips. The keys are drawn INSIDE the transform above, but
        // the fingertips live in plain canvas space — so hit-testing a fingertip's raw
        // x against an untransformed key slot compares two different coordinate
        // systems. At scale 3 and posX 800 the key that "matched" a fingertip was
        // rendered somewhere else entirely (off-screen, in practice), so NO key ever
        // visibly went down while the hand played: the piano looked dead against the
        // audio. Order matters — canvas post-multiplies, so a point is scaled about
        // the pivot, then rotated, then offset.
        // Each key is drawn as a SOLID extruded block = body (silhouette) + top cap + front lip.
        // The body is the convex hull of the 8 box corners (4 top + 4 dropped straight down by
        // faceH). Because adjacent keys share their boundary corners exactly, neighbouring bodies
        // overlap on every shared edge → NO see-through gaps at ANY yaw (the fix for the "ribbon"
        // look at steep yaw). The body carries NO stroke (a body stroke would redraw the dark seam
        // and re-open the gaps); only the cap + lip are stroked. At yaw 0 the side walls are edge-on
        // so this degrades to today's top-quad + front-lip look.
        const H_DOWN = [0, faceH]; // constant screen-down extrusion (keeps the height unchanged)
        const cross2 = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
        const convexHull = (pts) => {
          const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
          if (p.length < 3) return p;
          const lo = [];
          for (const q of p) { while (lo.length >= 2 && cross2(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
          const hi = [];
          for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (hi.length >= 2 && cross2(hi[hi.length - 2], hi[hi.length - 1], q) <= 0) hi.pop(); hi.push(q); }
          lo.pop(); hi.pop();
          return lo.concat(hi);
        };
        const fillHull = (poly) => {
          if (poly.length < 2) return;
          bgCtx.beginPath();
          bgCtx.moveTo(poly[0][0], poly[0][1]);
          for (let i = 1; i < poly.length; i++) bgCtx.lineTo(poly[i][0], poly[i][1]);
          bgCtx.closePath();
          bgCtx.fill();
        };
        for (let k = -EXT_L; k < nWhite + EXT_R; k++) {
          const x = kbLeft + k * wKeyW;
          const x2 = x + wKeyW;
          const nl = proj(x, 0), nr = proj(x2, 0); // near (front) edge — yawed
          const fl = proj(x, 1), fr = proj(x2, 1); // far (back) edge — yawed
          // WHICH KEY GOES DOWN.
          //
          // While a song plays this comes from the NOTE, not from where a
          // fingertip landed. Measurement killed the geometric approach: at this
          // camera angle a key draws as a ~1900px-long, ~6px-tall sliver, so the
          // key a fingertip is "over" is chosen by its vertical position, and the
          // hand's lateral travel carries ~0.04 slots of authority against 2 slots
          // of noise from the strike curl and 4-10 from the wrist hinge — roughly
          // 1:100 signal to noise, and it changed with the window size. Driving
          // the press from the music makes the lit key exact and stable, and the
          // hand pose decorative.
          //
          // The idle phrase claims no pitches, so it keeps the geometric test —
          // but against the UN-STRUCK fingertip, because a finger's own curl walks
          // its tip across two key slots during a single press, which made one
          // note flash three different keys.
          let press = songKeyPress(k, false);
          if (import.meta.env.DEV && window.__vnProbe && press > 0.01) {
            window.__vnProbe.whitePressed[k] = +press.toFixed(2);
          }
          if (press === null) {
            press = 0;
            const cap = [toScreen(nl), toScreen(nr), toScreen(fr), toScreen(fl)];
            for (const tp of tips) {
              if (tp.s > press && pointInPoly(tp.restX, tp.restY, cap)) press = tp.s;
            }
          }
          const dy = press * 0.05 * unit; // pressed key tilts DOWN at the front (pivots at the back)
          const A = [nl[0], nl[1] + dy], B = [nr[0], nr[1] + dy]; // top corners: near sinks on press
          const C = [fr[0], fr[1]], D = [fl[0], fl[1]];           // far edge fixed
          const Ad = [A[0], A[1] + faceH], Bd = [B[0], B[1] + faceH]; // straight-down extrusions (key thickness)
          const Cd = [C[0], C[1] + faceH], Dd = [D[0], D[1] + faceH];
          const pressed = press > 0.06;
          // (a) BODY — silhouette hull of the 8 box corners (top quad + faceH down), filled the SAME
          //     WHITE as the top (no dark side-wall "depth wedge"), NO stroke. Its only job now is to
          //     fill the inter-key gaps so there's no see-through — the key reads as one solid flat
          //     white surface, not a 3D box.
          bgCtx.fillStyle = pressed ? "rgb(150,196,216)" : "rgb(240,244,249)";
          fillHull(convexHull([A, B, C, D, Ad, Bd, Cd, Dd]));
          // (b) TOP CAP — the white key top + the per-key seam stroke (the only lines kept). The
          //     white body already fills the front/side area, so there is NO grey "depth wedge" lip
          //     and no diagonal triangle border — each key reads as one solid flat white surface,
          //     separated from its neighbours only by the thin seam.
          bgCtx.fillStyle = pressed ? "rgb(150,196,216)" : "rgb(240,244,249)";
          bgCtx.strokeStyle = "rgba(10,14,20,0.5)";
          bgCtx.lineWidth = 1;
          bgCtx.beginPath();
          bgCtx.moveTo(A[0], A[1]); bgCtx.lineTo(B[0], B[1]); bgCtx.lineTo(C[0], C[1]); bgCtx.lineTo(D[0], D[1]);
          bgCtx.closePath(); bgCtx.fill(); bgCtx.stroke();
        }
        // black keys: small CONSTANT extruded body so they don't vanish at steep yaw (subordinate)
        const bkW = wKeyW * 0.56;
        const BK_DOWN = faceH * 0.6;
        bgCtx.strokeStyle = "rgba(0,0,0,0.7)";
        bgCtx.lineWidth = 1;
        for (let k = -EXT_L; k < nWhite - 1 + EXT_R; k++) {
          if (![0, 1, 3, 4, 5].includes(((k % 7) + 7) % 7)) continue; // +mod handles k<0
          const bx = kbLeft + (k + 1) * wKeyW - bkW / 2;
          const bx2 = bx + bkW;
          // A black key sits after white slot k, which is exactly how pianoKeys.js
          // identifies it. Black keys previously could never depress at all — every
          // fingertip sits in front of them — so an accidental like Für Elise's G#3
          // sounded with nothing moving. Note-driven press fixes that for free.
          const bPress = songKeyPress(k, true) || 0;
          if (import.meta.env.DEV && window.__vnProbe && bPress > 0.01) {
            window.__vnProbe.blackPressed[k] = +bPress.toFixed(2);
          }
          // Sink a pressed black key noticeably. The hand is directly over the
          // key it plays — that is what playing looks like — so the movement at
          // the key's edges is the only part of the press a viewer can see.
          const bDy = bPress * 0.075 * unit;
          // near edge set back along the recede (start ~12%), far ~60% — shorter than whites
          const n0 = proj(bx, 0.12), n1 = proj(bx2, 0.12), f0 = proj(bx, 0.6), f1 = proj(bx2, 0.6);
          n0[1] += bDy; n1[1] += bDy; // pressed black key sinks at the front
          const bn0 = [n0[0], n0[1] + BK_DOWN], bn1 = [n1[0], n1[1] + BK_DOWN];
          const bf0 = [f0[0], f0[1] + BK_DOWN], bf1 = [f1[0], f1[1] + BK_DOWN];
          const bDown = bPress > 0.06;
          // A bright, saturated blue, deliberately. The previous rgb(60,92,112)
          // sat within a few points of the hand's own gradient top (#3a5068), so
          // a pressed black key was indistinguishable from the hand lying across
          // it. It also defeated the pixel check used to verify this: the scan
          // matched the HAND and reported ~93k pixels of "pressed key".
          bgCtx.fillStyle = bDown ? "rgb(74,142,196)" : "rgb(8,10,14)"; // body, no stroke
          fillHull(convexHull([n0, n1, f1, f0, bn0, bn1, bf1, bf0]));
          bgCtx.fillStyle = bDown ? "rgb(108,186,240)" : "rgb(16,19,25)"; // top cap
          bgCtx.beginPath();
          bgCtx.moveTo(n0[0], n0[1]); bgCtx.lineTo(n1[0], n1[1]); bgCtx.lineTo(f1[0], f1[1]); bgCtx.lineTo(f0[0], f0[1]);
          bgCtx.closePath(); bgCtx.fill(); bgCtx.stroke();
          bgCtx.beginPath(); // front lip
          bgCtx.moveTo(n0[0], n0[1]); bgCtx.lineTo(n1[0], n1[1]); bgCtx.lineTo(bn1[0], bn1[1]); bgCtx.lineTo(bn0[0], bn0[1]);
          bgCtx.closePath(); bgCtx.fill(); bgCtx.stroke();
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
      // Route the NORMAL hand through the offscreen buffer (drawn opaque, then composited at one
      // uniform alpha so overlaps never darken). The MORPH path is left drawing straight to bgCtx.
      if (inMorphSeq) {
        ctx = bgCtx;
      } else {
        handCtx.setTransform(DPR, 0, 0, DPR, 0, 0);
        handCtx.clearRect(0, 0, W, H);
        handCtx.globalAlpha = 1;
        ctx = handCtx;
      }
      // Compute the global bounding box across ALL hand polygons so every part
      // shares the same gradient range — one unified light source, no seams.
      let gMinY = Infinity, gMaxY = -Infinity;
      for (const poly of [...bodyPolys, ...fingerJobs.map((j) => j.poly)]) {
        for (const [, py] of poly) {
          if (py < gMinY) gMinY = py;
          if (py > gMaxY) gMaxY = py;
        }
      }

      // 1) FOREARM — always drawn solid (forearm = bodyPolys[0]; palm = bodyPolys[1]). The
      //    thumbs-up gets its OWN fill (below) so the arm + hand match and overlap solidly.
      ctx.fillStyle = handGrad(ctx, gMinY, gMaxY);
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
        ctx.fillStyle = handGrad(ctx, gMinY, gMaxY);
        pathPoly(ctx, bodyPolys[1]);
        ctx.fill();
        ctx.fillStyle = dot;
        outline(ctx, bodyPolys[1], [bodyPolys[0]], 111.3);

        // 3) fingers, back→front: fill THEN outline (later fills occlude earlier outlines).
        for (let fi = 0; fi < fingerJobs.length; fi++) {
          const job = fingerJobs[fi];
          ctx.fillStyle = handGrad(ctx, gMinY, gMaxY);
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

        // 4) Foreground layer: redraw the index finger on the top canvas (above the form) ONLY when
        //    the hand is actually reaching over the form (tracking / lunging at Send). In the idle
        //    piano state the index never overlaps the form, so the redundant fg copy is skipped —
        //    the index then comes solely from the uniform offscreen buffer (no overlap patch).
        const idxJob = (overButton || front > 0.05) ? fingerJobs[3] : null;
        if (idxJob) {
          fgCtx.fillStyle = handGrad(fgCtx, gMinY, gMaxY);
          pathPoly(fgCtx, idxJob.poly);
          fgCtx.fill();
          fgCtx.fillStyle = dot;
          const im = idxJob.joints[0];
          outline(fgCtx, idxJob.poly, [], 67.7 + 3 * 100, { polys: bodyPolys, cx: im[0], cy: im[1], r2: idxJob.capR * idxJob.capR });
        }
        // SHADOW — project the hand onto the keyboard PLANE, anchored at the finger CONTACT line,
        // so it is logical to the keys: a finger touching a key casts essentially no offset shadow
        // (its shadow sits right under it → hidden by the finger), while the raised palm/arm cast a
        // longer, softer shadow back across the keys. Method: build a dark silhouette of the hand,
        // then draw it squashed toward the contact line (a shadow "laid flat" on the ground plane).
        let cYsum = 0; // contact line = average fingertip height (where the fingers meet the keys)
        for (const j of fingerJobs) cYsum += j.tip[1];
        const contactY = cYsum / fingerJobs.length;
        // (1) dark, alpha-masked silhouette of the hand
        shadowCtx.setTransform(1, 0, 0, 1, 0, 0);
        shadowCtx.globalAlpha = 1;
        shadowCtx.globalCompositeOperation = "source-over";
        shadowCtx.clearRect(0, 0, shadowCanvas.width, shadowCanvas.height);
        shadowCtx.drawImage(handCanvas, 0, 0);
        shadowCtx.globalCompositeOperation = "source-in"; // recolour to flat black, keep the alpha
        shadowCtx.fillStyle = "#000";
        shadowCtx.fillRect(0, 0, shadowCanvas.width, shadowCanvas.height);
        shadowCtx.globalCompositeOperation = "source-over";
        // (2) project it onto the keys (device-px affine: squash vertically toward contactY + lean)
        bgCtx.save();
        bgCtx.setTransform(1, 0, 0, 1, 0, 0);
        const cY = contactY * DPR;
        const KS = 0.5;  // vertical squash toward the contact line → lays the shadow flat on the keys
        const KX = 0.45; // horizontal lean (light from the upper-left)
        bgCtx.transform(1, 0, KX, KS, -KX * cY, cY * (1 - KS));
        bgCtx.globalAlpha = 0.5;
        bgCtx.filter = `blur(${5 * DPR}px)`;
        // Only cast the shadow onto the KEYBOARD (which is already on bg here, before the hand) — not
        // onto the empty page background. In dark mode that stray shadow was invisible (dark on dark);
        // in light mode it showed as a grey smudge floating where there's no surface.
        bgCtx.globalCompositeOperation = "source-atop";
        bgCtx.drawImage(shadowCanvas, 0, 0);
        bgCtx.restore();
        // Punch the index finger out of the HAND BUFFER when it will also be
        // drawn on fgCtx, so it isn't composited twice (bg + fg, both at
        // MODEL_ALPHA) and left darker than every other finger.
        //
        // This must happen after the shadow is derived (so the shadow keeps its
        // index) and before the hand is composited — NOT afterwards on bgCtx.
        // Punching bgCtx cut a finger-shaped hole through the keyboard and the
        // shadow underneath it, which are innocent bystanders: bgCtx holds the
        // whole scene, handCanvas holds only the hand. The hole was invisible
        // while the two layers were mutually exclusive, but the keyboard fade
        // means both can now be on screen at once — during the ~700ms after the
        // cursor stops, `front` is still positive while the keyboard is already
        // fading in.
        if (idxJob) {
          handCtx.save();
          handCtx.globalCompositeOperation = "destination-out";
          handCtx.globalAlpha = 1;
          pathPoly(handCtx, idxJob.poly);
          handCtx.fill();
          handCtx.restore();
        }

        // COMPOSITE the hand at ONE uniform alpha
        bgCtx.save();
        bgCtx.setTransform(1, 0, 0, 1, 0, 0);
        bgCtx.globalAlpha = MODEL_ALPHA;
        bgCtx.drawImage(handCanvas, 0, 0);
        bgCtx.restore();

        ctx = bgCtx;
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
      // index-finger press tap on a click of EITHER the Send link button or the theme toggle
      if (e.target && e.target.closest && e.target.closest(".login-send-btn, .vn-theme-toggle")) {
        clickT = performance.now();
      }
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

