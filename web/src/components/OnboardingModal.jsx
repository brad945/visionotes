import { useState } from "react";

const STEPS = [
  {
    title: "Real-time posture coaching",
    body: "VisioNotes watches your hands and arms through your webcam while you play and flags technique issues as they happen — no wearables, no MIDI, just your camera.",
  },
  {
    title: "What we detect",
    body: null, // custom content
  },
  {
    title: "You're ready",
    body: "Start a session, play normally, and posture faults will appear live. After you stop, you'll get a full breakdown with a timeline you can scrub through.",
  },
];

const FAULTS = [
  {
    label: "Collapsed wrist",
    description: "Wrist drops below the knuckle plane under the keys — the most common injury risk.",
    color: "var(--signal)",
    bg: "var(--signal-soft)",
  },
  {
    label: "Arm posture",
    description: "Elbow drifts too far from the body or shoulder rises — adds tension to the whole arm.",
    color: "var(--accent)",
    bg: "var(--accent-soft)",
  },
];

export default function OnboardingModal({ onDone }) {
  const [step, setStep] = useState(0);
  const isLast = step === STEPS.length - 1;
  const s = STEPS[step];

  return (
    <>
      {/* backdrop */}
      <div
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.55)",
          zIndex: "var(--z-overlay)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
        }}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Getting started with VisioNotes"
          style={{
            background: "var(--surface)",
            border: "1px solid var(--line)",
            borderRadius: "var(--r-xl)",
            boxShadow: "var(--shadow-lift)",
            width: "100%",
            maxWidth: 480,
            padding: "32px 32px 28px",
            display: "flex",
            flexDirection: "column",
            gap: 20,
          }}
        >
          {/* step indicator */}
          <div style={{ display: "flex", gap: 6 }}>
            {STEPS.map((_, i) => (
              <span
                key={i}
                style={{
                  height: 3,
                  flex: 1,
                  borderRadius: 999,
                  background: i <= step ? "var(--accent)" : "var(--line)",
                  transition: "background var(--dur) var(--ease-out)",
                }}
              />
            ))}
          </div>

          {/* content */}
          <div>
            <h2 style={{ margin: "0 0 10px", fontSize: "1.25rem" }}>{s.title}</h2>

            {step === 1 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <p style={{ margin: "0 0 4px", color: "var(--ink-muted)", fontSize: "0.9rem", lineHeight: 1.5 }}>
                  We track two posture faults in real time:
                </p>
                {FAULTS.map((f) => (
                  <div
                    key={f.label}
                    style={{
                      padding: "12px 14px",
                      borderRadius: "var(--r-lg)",
                      background: f.bg,
                      border: `1px solid ${f.color}22`,
                    }}
                  >
                    <div style={{ fontWeight: 600, fontSize: "0.9rem", color: f.color, marginBottom: 3 }}>
                      {f.label}
                    </div>
                    <div style={{ fontSize: "0.85rem", color: "var(--ink-muted)", lineHeight: 1.5 }}>
                      {f.description}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p style={{ margin: 0, color: "var(--ink-muted)", fontSize: "0.9rem", lineHeight: 1.6 }}>
                {s.body}
              </p>
            )}
          </div>

          {/* actions */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 4 }}>
            {step > 0 ? (
              <button
                className="vn-btn vn-btn--ghost"
                onClick={() => setStep((p) => p - 1)}
                style={{ fontSize: "0.875rem" }}
              >
                Back
              </button>
            ) : (
              <span />
            )}
            <button
              className="vn-btn vn-btn--primary"
              onClick={() => {
                if (isLast) {
                  localStorage.setItem("vn-onboarded", "1");
                  onDone();
                } else {
                  setStep((p) => p + 1);
                }
              }}
            >
              {isLast ? "Start practicing" : "Next"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
