---
name: VisioNotes
description: A calm, instrument-grade visual system for a real-time piano-posture coach.
colors:
  paper: "#F7F8F8"
  surface: "#FFFFFF"
  surface-sunken: "#EEF1F1"
  ink: "#16191B"
  ink-muted: "#565C61"
  line: "#DDE1E1"
  line-strong: "#C4C9C9"
  accent: "#2B5CE6"
  accent-deep: "#1E47C0"
  accent-soft: "#E7EDFB"
  signal: "#C2410C"
  signal-deep: "#9A330A"
  signal-soft: "#FBEADF"
  positive: "#15803D"
  positive-deep: "#11652F"
typography:
  display:
    fontFamily: "'IBM Plex Sans', system-ui, sans-serif"
    fontSize: "clamp(1.9rem, 1.4rem + 1.8vw, 2.5rem)"
    fontWeight: 600
    lineHeight: 1.1
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "'IBM Plex Sans', system-ui, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.01em"
  title:
    fontFamily: "'IBM Plex Sans', system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 600
    lineHeight: 1.3
  body:
    fontFamily: "'IBM Plex Sans', system-ui, sans-serif"
    fontSize: "0.95rem"
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: "'IBM Plex Mono', ui-monospace, monospace"
    fontSize: "0.7rem"
    fontWeight: 500
    letterSpacing: "0.06em"
  data:
    fontFamily: "'IBM Plex Mono', ui-monospace, monospace"
    fontSize: "0.875rem"
    fontWeight: 500
rounded:
  sm: "4px"
  md: "6px"
  lg: "8px"
  xl: "12px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  xxl: "32px"
  xxxl: "48px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.surface}"
    rounded: "{rounded.md}"
    padding: "8px 20px"
  button-primary-hover:
    backgroundColor: "{colors.accent-deep}"
    textColor: "{colors.surface}"
  button-stop:
    backgroundColor: "{colors.signal}"
    textColor: "{colors.surface}"
    rounded: "{rounded.md}"
    padding: "8px 20px"
  button-ghost:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "6px 12px"
  input-text:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "10px 12px"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "16px"
  badge-fault:
    backgroundColor: "{colors.signal}"
    textColor: "{colors.surface}"
    rounded: "{rounded.sm}"
    padding: "4px 10px"
---

# Design System: VisioNotes

## 1. Overview

**Creative North Star: "The Practice Instrument"**

VisioNotes should feel like a precision instrument for technique — a tuner, a studio meter, a measurement tool — not an app fighting for attention. The pianist is mid-practice with their hands on the keys; the screen is peripheral, glanced at between phrases. So the system is quiet by default and exact when it speaks. Calm surfaces, hairline structure, and a single disciplined accent. Numbers — timers, durations, fault counts, pace — are set in mono, because an instrument reads out values, it doesn't decorate them.

The palette is a cool near-neutral paper with a deep blue needle and a measured clay warning. Restraint is the whole point: the quiet state is the normal state, and the accent earns its rarity. When a fault appears it is plainly legible, never alarming — a serious, matter-of-fact signal, not a flashing alert.

This system explicitly **rejects** three looks named in `PRODUCT.md`: the **generic AI-SaaS** template (Inter + purple→blue gradients + rounded cards everywhere), the **enterprise dashboard** (gray-on-gray density and chart-junk), and the **gamified consumer app** (mascots, confetti, badges, bounce). VisioNotes is a serious tool a serious player would trust.

**Key Characteristics:**
- Cool, calm paper surfaces — flat by default, structured with hairlines, not boxes-in-boxes.
- One blue accent, used on ≤10% of any screen; clay reserved strictly for faults.
- All numeric readouts in IBM Plex Mono — the instrument tell.
- Motion is restrained and always has a reduced-motion fallback.
- AA contrast everywhere, muted text included.

## 2. Colors

A cool near-neutral foundation with one blue accent and one clay signal — low chroma, high discipline.

### Primary
- **Needle Blue** (#2B5CE6): The instrument's one voice. Primary actions (Start), active states, focus rings, the live recording needle, links. Used sparingly. For body-size text on white, shift to **Needle Blue Deep** (#1E47C0) to hold AA. **Blue Mist** (#E7EDFB) is the only tint, for selected/active backgrounds.

### Secondary
- **Signal Clay** (#C2410C): Faults and only faults. Fault badges, active fault markers, the Stop control. White text on Clay clears AA (≈4.7:1). **Clay Deep** (#9A330A) for hover; **Clay Mist** (#FBEADF) for soft fault backgrounds.

### Tertiary
- **Progress Green** (#15803D): Improvement only — a downward (good) trend, a new best. Never decorative. **Green Deep** (#11652F) for small text.

### Neutral
- **Ink** (#16191B): Primary text. A near-black slate, never pure #000.
- **Ink Muted** (#565C61): Secondary text, captions, axis labels. Held to AA (≈5:1 on Paper) — never lighter, no washed-out gray.
- **Paper** (#F7F8F8): The app background. Cool off-white.
- **Surface** (#FFFFFF): Cards, panels, inputs.
- **Surface Sunken** (#EEF1F1): Inset tracks — timeline lanes, progress troughs.
- **Line** (#DDE1E1) / **Line Strong** (#C4C9C9): Hairline dividers and borders.

### Named Rules
**The One Voice Rule.** Needle Blue appears on ≤10% of any screen. Its rarity is what makes the active state read instantly. If two things are blue, one of them is wrong.

**The Clay-Means-Fault Rule.** Signal Clay is reserved exclusively for posture faults and the Stop control. Never use it for emphasis, decoration, or generic "danger." When a player sees clay, it means one thing.

## 3. Typography

**Display / Body Font:** IBM Plex Sans (with system-ui, sans-serif)
**Label / Data Font:** IBM Plex Mono (with ui-monospace, monospace)

**Character:** A calm humanist grotesque paired against its own monospace on a sans-vs-mono contrast axis. Plex reads as engineered and trustworthy without being cold — the typographic equivalent of a well-made instrument panel. Inter is forbidden (a named anti-reference); Plex is the deliberate opposite choice.

### Hierarchy
- **Display** (600, clamp(1.9–2.5rem), lh 1.1, -0.02em): Page titles (h1), one per screen.
- **Headline** (600, 1.25rem, lh 1.2): Section headings (h2), card-group titles.
- **Title** (600, 1rem, lh 1.3): Card titles, summary labels (h3).
- **Body** (400, 0.95rem, lh 1.55): Prose and UI text. Cap line length at 65–75ch.
- **Label** (Mono 500, 0.7rem, +0.06em, UPPERCASE): Eyebrow labels, metric captions, badge text.
- **Data** (Mono 500, 0.875rem): Every numeric readout — timers, durations, fault counts, rates, axis values.

### Named Rules
**The Mono-Numbers Rule.** Any value the instrument measures — time, count, rate, duration — is set in IBM Plex Mono. Prose is Sans, data is Mono. This single rule carries the instrument identity across every screen.

## 4. Elevation

Flat by default. Depth comes from tonal layering (Paper → Surface → Surface Sunken) and hairline borders, not from shadows at rest. Shadow is a **response to state**, never decoration — a soft ambient lift on hover or an active panel, nothing more.

### Shadow Vocabulary
- **Lift** (`box-shadow: 0 1px 2px rgba(16,25,28,0.04), 0 10px 24px -14px rgba(16,25,28,0.22)`): Hover/active state on interactive cards and the live panel. Diffuse and low; you should barely notice it.

### Named Rules
**The Flat-By-Default Rule.** Surfaces are flat at rest, separated by a 1px Line. If a card has a shadow when nothing is happening, the shadow is wrong. Reach for a hairline before a shadow.

## 5. Components

### Buttons
- **Shape:** Gently rounded (6px, `rounded.md`).
- **Primary:** Needle Blue fill, white text, padding 8px 20px. The Start action and primary CTAs.
- **Stop:** Signal Clay fill, white text — the only place Clay appears as an action, semantically "end / active."
- **Hover / Focus:** Background shifts to the -deep variant; 120ms ease-out. Focus shows a 2px Needle Blue ring with 2px offset — always visible, never removed.
- **Ghost:** Surface background, Ink text, 1px Line border. Secondary actions (Log out, toggles).

### Chips / Badges
- **Fault badge:** Signal Clay background, white uppercase Mono label, 4px radius, 4px 10px padding. Pairs an initials glyph with text — never color alone (a fault is readable without seeing the hue).
- **Label chip / eyebrow:** Mono uppercase, Ink Muted, no fill — a quiet caption, not a pill.

### Cards / Containers
- **Corner Style:** 8px (`rounded.lg`).
- **Background:** Surface (#FFFFFF) on Paper.
- **Shadow Strategy:** None at rest (see Elevation). Lift only on hover/selected.
- **Border:** 1px Line. Selected state: 1px Needle Blue (not a heavy 2px stripe).
- **Internal Padding:** 16px (`spacing.lg`); roomy panels 24px.

### Inputs / Fields
- **Style:** Surface background, 1px Line border, 6px radius, 10px 12px padding, 16px text (no mobile zoom).
- **Focus:** Border shifts to Needle Blue + 2px Blue ring. No glow.
- **Error:** Border and helper text in Signal Clay.

### Navigation
- **Style:** Top bar, wordmark left, links right, 1px Line underline. Plex Sans.
- **States:** Default Ink Muted; hover Ink; active Ink at 600 weight with a 2px Needle Blue underline. Mobile: links wrap, wordmark holds.

### Live Feedback Monitor (signature component)
The Practice screen's rolling 30s monitor. Surface panel, hairline header, four fixed lanes. Lane tracks are Surface Sunken; event bars are Ink at rest, the latest active bar lifts to Needle Blue. A recording dot pulses Blue while live (reduced-motion: static dot). Sustained-fault durations read in Mono. This component is where "calm instrument" is most visible — keep it quiet until there's something to show.

## 6. Do's and Don'ts

### Do:
- **Do** set every measured value (time, count, rate, duration) in IBM Plex Mono — the Mono-Numbers Rule.
- **Do** keep Needle Blue to ≤10% of a screen; let the accent stay rare and meaningful.
- **Do** separate surfaces with a 1px Line and tonal layering before reaching for a shadow.
- **Do** hold all text — muted included — to AA (4.5:1 body, 3:1 large); use the -deep color variants for small accent/signal/green text.
- **Do** give every animation a `prefers-reduced-motion: reduce` fallback; the camera feed is the only thing that should move freely.
- **Do** pair fault color with an icon/initials and text, so a fault is legible without relying on hue.

### Don't:
- **Don't** ship the **generic AI-SaaS** look: no Inter, no purple→blue gradients, no rounded cards stacked inside rounded cards.
- **Don't** drift into an **enterprise dashboard**: no gray-on-gray density, no chart-junk, no borders on everything.
- **Don't** add **gamified consumer** flourishes: no confetti, mascots, badges-as-rewards, or bouncy/elastic motion.
- **Don't** use Signal Clay for anything but faults and the Stop control (the Clay-Means-Fault Rule).
- **Don't** scream a fault. The old `#ff3333` alarm red is banned; faults are Signal Clay — clear and serious, not flashing.
- **Don't** nest cards or wrap a bordered box inside another bordered box. If you need separation, use a hairline or whitespace.
