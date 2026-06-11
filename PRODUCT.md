# Product

## Register

product

## Users

Pianists practicing at a **real acoustic/digital piano** with a webcam pointed at their hands and arms. Primary user is the project owner (a pianist learning full-stack development), but the design serves any intermediate-to-advanced player who practices alone and wants technique feedback they'd normally only get from a teacher.

Their context is mid-practice: hands on the keys, eyes mostly on the music or the keyboard, only **glancing** at the screen between phrases. They are not sitting and reading the UI — the screen is peripheral. The job to be done: notice and correct posture/technique faults (collapsed wrist, poor arm posture) in the moment, then review whether they're improving across sessions.

## Product Purpose

VisioNotes watches a pianist's hands/arms through a webcam while they play a real piano and coaches **posture and technique** in real time. It is explicitly **not** note detection, not an air-piano, not a game. The pipeline is: pre-trained hand/pose model → joint-angle geometry → real-time fault feedback → session logging → progress over time.

Success looks like: a player catches a collapsed wrist seconds after it happens, adjusts, and over weeks sees their fault counts trend down in the history view. The product earns its place by being a trustworthy practice instrument, not a novelty.

## Brand Personality

**Calm precision.** Three words: quiet, exact, trustworthy. The interface should feel like a well-made professional tool — a tuner, a DAW meter, a measurement instrument — not a consumer app and not an enterprise dashboard. Confident and data-forward, but restrained: it states what it sees plainly and gets out of the way during practice. Feedback on faults is clear and matter-of-fact, never alarming, never cheerleading.

## Anti-references

- **Generic AI SaaS** — Inter + purple→blue gradients + rounded cards everywhere. The default "AI slop" look. Avoid entirely.
- **Enterprise dashboard** — dense gray-on-gray Bootstrap/Material admin panels, chart-junk, joyless density.
- **Gamified consumer app** — Duolingo-style mascots, confetti, badges, bouncy cartoon energy. Too playful; undermines the "serious practice instrument" trust.

## Design Principles

1. **Practice flow is sacred.** The UI must never pull focus from the piano. Real-time feedback is glanceable and peripheral — readable in a half-second sidelong look, never demanding a full read.
2. **Earn trust through precision.** This is a measurement instrument. Show exact, honest readouts; never overclaim what the vision pipeline can see (no per-finger key-press detection — it's out of scope and the UI should not imply it exists).
3. **Calm over loud.** Restraint by default. Signal a fault clearly without alarm, color-screaming, or gamified noise. The quiet state is the normal state.
4. **Show improvement, don't nag.** Coach, don't scold. Surface what changed and how trends move over sessions; frame data as progress, not failure.
5. **Defensible craft.** Every visual and structural choice is intentional and explainable — the owner must be able to defend each decision in an interview. No cargo-culted patterns.

## Accessibility & Inclusion

- **WCAG AA contrast** — all body text ≥ 4.5:1, large text ≥ 3:1. Muted/placeholder text held to the same bar, not the usual washed-out gray.
- **Reduced-motion safe** — every animation ships with a `prefers-reduced-motion: reduce` fallback. This matters more than usual: the app itself is a live visual feed, so motion in the chrome must never compete with or distract from the camera view.
