import { useRef, useState } from "react";
import useVision from "../vision/useVision";
import { startSession, endSession, postFaults, postLandmarks } from "../api";
import FaultList from "../components/FaultList";
import OnboardingModal from "../components/OnboardingModal";

// Map the active fault label strings from useVision into the shape FaultList
// expects. `id` is derived from the fault's identity (stable across frames) so
// the listbox's roving focus/active option survives the 4x/sec state updates.
// Identical labels are collapsed: MediaPipe occasionally tags both hands with
// the same handedness (or "Unknown"), which would otherwise yield duplicate ids
// / React keys and break the listbox's focus management.
function toFaultItems(labels) {
  const seen = new Set();
  const items = [];
  for (const label of labels) {
    const id = label.toLowerCase().replace(/\s+/g, "-");
    if (seen.has(id)) continue;
    seen.add(id);
    items.push({ id, label, severity: label.includes("wrist") ? "error" : "warn" });
  }
  return items;
}

const SIGNIFICANT_THRESHOLD_MS = 500;
const LIVE_WINDOW_MS = 30_000;
const FEEDBACK_LANES = [
  { key: "left_arm_posture", hand: "left", fault_type: "arm_posture" },
  { key: "left_collapsed_wrist", hand: "left", fault_type: "collapsed_wrist" },
  { key: "right_arm_posture", hand: "right", fault_type: "arm_posture" },
  { key: "right_collapsed_wrist", hand: "right", fault_type: "collapsed_wrist" },
];

export default function Practice() {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  // phase: "idle" | "framing" | "running"
  const [phase, setPhase] = useState("idle");
  const [saving, setSaving] = useState(false);
  const [liveFeedbackEnabled, setLiveFeedbackEnabled] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(() => !localStorage.getItem("vn-onboarded"));
  const sessionRef = useRef(null); // { id, startedAt }
  const { isLoading, error, faults, liveEvents, handsDetected, poseDetected, start, stop } = useVision(
    videoRef,
    canvasRef
  );

  // Step 1: open camera + start detection (no backend session yet)
  const handleSetupCamera = async () => {
    try {
      await start();
      setPhase("framing");
    } catch (e) {
      console.error("Failed to start camera:", e);
    }
  };

  // Step 2: camera looks good — create the backend session and start recording
  const handleConfirmFraming = async () => {
    try {
      const { session_id } = await startSession();
      sessionRef.current = { id: session_id, startedAt: Date.now() };
      setPhase("running");
    } catch (e) {
      console.error("Failed to start session:", e);
    }
  };

  const handleStop = async () => {
    const { events, landmarkFrames } = stop();
    setPhase("idle");
    setSaving(true);

    try {
      const { id, startedAt } = sessionRef.current;
      const durationSeconds = Math.round((Date.now() - startedAt) / 1000);

      await Promise.all([
        endSession(id, durationSeconds, events.length),
        postFaults(id, events),
        postLandmarks(id, landmarkFrames),
      ]);
    } catch (e) {
      console.error("Failed to save session:", e);
    } finally {
      sessionRef.current = null;
      setSaving(false);
    }
  };

  const running = phase === "running";
  const framing = phase === "framing";

  return (
    <main style={{ padding: "32px 0" }}>
      {showOnboarding && <OnboardingModal onDone={() => setShowOnboarding(false)} />}
      <p className="vn-label" style={{ marginBottom: 6 }}>Live Session</p>
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 16, flexWrap: "wrap" }}>
        <h1 style={{ margin: 0 }}>Practice</h1>
        {phase === "idle" && (
          <button
            onClick={handleSetupCamera}
            disabled={isLoading || saving}
            className="vn-btn vn-btn--primary"
            style={{ cursor: isLoading || saving ? "wait" : undefined }}
          >
            {isLoading ? "Loading models…" : saving ? "Saving…" : "Start Session"}
          </button>
        )}
        {running && (
          <button onClick={handleStop} className="vn-btn vn-btn--stop">Stop</button>
        )}
        {(running || framing) && (
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "0.875rem", color: "var(--ink-muted)" }}>
            <input
              type="checkbox"
              checked={liveFeedbackEnabled}
              onChange={(e) => setLiveFeedbackEnabled(e.target.checked)}
              className="vn-accent-control"
              style={{ width: 16, height: 16, margin: 0 }}
            />
            Enable live feedback
          </label>
        )}
      </div>

      {error && (
        <p style={{ color: "var(--signal-deep)", fontWeight: 600 }}>{error}</p>
      )}

      {liveFeedbackEnabled && running && (
        <LiveFeedbackPanel running={running} events={liveEvents} />
      )}

      {running && (
        <section style={{ marginBottom: 16 }}>
          <p className="vn-label" style={{ marginBottom: 6 }}>Posture Faults</p>
          <FaultList faults={toFaultItems(faults)} />
        </section>
      )}

      {/* Video + canvas overlay */}
      <div style={{ position: "relative", display: "inline-block", background: "#000", borderRadius: "var(--r-lg)", overflow: "hidden" }}>
        <video
          ref={videoRef}
          style={{ display: "block", maxWidth: "100%", transform: "scaleX(-1)" }}
          playsInline
          muted
        />
        <canvas
          ref={canvasRef}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            transform: "scaleX(-1)",
          }}
        />
        {framing && (
          <FramingOverlay
            handsDetected={handsDetected}
            poseDetected={poseDetected}
            onConfirm={handleConfirmFraming}
          />
        )}
      </div>

      {framing && <PostureTip />}

      {phase === "idle" && !isLoading && !saving && (
        <p className="vn-muted" style={{ marginTop: 12 }}>
          Press <strong style={{ color: "var(--ink)" }}>Start Session</strong> to begin webcam posture tracking.
        </p>
      )}
    </main>
  );
}

function PostureTip() {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;
  return (
    <>
      <style>{`
        @keyframes postureCardIn {
          0%   { transform: translate(110%, -110%) rotate(40deg) scale(1.6); opacity: 0; }
          60%  { transform: translate(-6%, 4%) rotate(-4deg) scale(1.08); opacity: 1; }
          80%  { transform: translate(2%, -2%) rotate(-1.5deg) scale(0.98); }
          100% { transform: translate(0, 0) rotate(-2deg) scale(1); opacity: 1; }
        }
        .posture-card {
          animation: postureCardIn 0.65s cubic-bezier(0.22, 1, 0.36, 1) forwards;
          transform-origin: top right;
        }
      `}</style>
      <div
        className="posture-card"
        style={{
          position: "fixed",
          top: 80,
          right: 24,
          zIndex: 150,
          width: 580,
          background: "#fffde7",
          border: "1.5px solid #e0c84a",
          borderRadius: 10,
          boxShadow: "0 8px 32px rgba(0,0,0,0.22), 0 2px 6px rgba(0,0,0,0.12)",
          padding: "12px 12px 14px",
          color: "#2a2200",
        }}
      >
        <button
          onClick={() => setDismissed(true)}
          aria-label="Dismiss"
          style={{
            position: "absolute",
            top: 7,
            right: 9,
            background: "none",
            border: "none",
            cursor: "pointer",
            fontSize: 15,
            color: "#7a6800",
            lineHeight: 1,
            padding: 2,
          }}
        >✕</button>
        <img
          src="/piano.jpeg"
          alt="Correct vs wrong piano posture"
          style={{ width: "100%", borderRadius: 6, display: "block", marginBottom: 10 }}
        />
        <p style={{ margin: 0, fontSize: "0.78rem", lineHeight: 1.5, fontWeight: 500, color: "#3a2e00" }}>
          Try to mirror the <strong>right posture</strong> as much as possible!
        </p>
      </div>
    </>
  );
}

function FramingOverlay({ handsDetected, poseDetected, onConfirm }) {
  const checks = [
    {
      label: "Hands visible",
      ok: handsDetected,
      tip: "Point camera at your hands from the side",
    },
    {
      label: "Arm in frame",
      ok: poseDetected,
      tip: "Pull back so your elbow is visible",
    },
  ];

  const allGood = handsDetected && poseDetected;

  return (
    <div style={{
      position: "absolute",
      inset: 0,
      background: "rgba(0,0,0,0.62)",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      gap: 16,
      padding: 24,
    }}>
      <p style={{ color: "#fff", fontWeight: 600, fontSize: "0.9rem", margin: 0, letterSpacing: "0.04em", textTransform: "uppercase", opacity: 0.7 }}>
        Camera Setup
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 8, width: "100%", maxWidth: 280 }}>
        {checks.map(({ label, ok, tip }) => (
          <div key={label} style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            background: ok ? "rgba(21,128,61,0.25)" : "rgba(0,0,0,0.35)",
            border: `1px solid ${ok ? "rgba(21,128,61,0.6)" : "rgba(255,255,255,0.12)"}`,
            borderRadius: 8,
            padding: "10px 14px",
            transition: "background 300ms, border-color 300ms",
          }}>
            <span style={{
              width: 18,
              height: 18,
              borderRadius: "50%",
              background: ok ? "#15803d" : "rgba(255,255,255,0.15)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
              fontSize: 11,
              color: "#fff",
              transition: "background 300ms",
            }}>
              {ok ? "✓" : ""}
            </span>
            <div>
              <div style={{ color: ok ? "#4ade80" : "#fff", fontSize: "0.85rem", fontWeight: 600 }}>{label}</div>
              {!ok && <div style={{ color: "rgba(255,255,255,0.55)", fontSize: "0.78rem", marginTop: 1 }}>{tip}</div>}
            </div>
          </div>
        ))}
      </div>

      <button
        className="vn-btn vn-btn--primary"
        onClick={onConfirm}
        disabled={!allGood}
        style={{ opacity: allGood ? 1 : 0.4, cursor: allGood ? "pointer" : "not-allowed", marginTop: 4 }}
      >
        {allGood ? "Start recording" : "Waiting for camera…"}
      </button>
    </div>
  );
}

function LiveFeedbackPanel({ running, events }) {
  const nowMs = events.reduce((latest, event) => (
    Math.max(latest, event.timestamp_ms + (event.value || 0))
  ), 0);
  const windowStart = Math.max(0, nowMs - LIVE_WINDOW_MS);
  const significantEvents = events.filter((event) => (event.value || 0) >= SIGNIFICANT_THRESHOLD_MS);
  const activeKeys = new Set(
    significantEvents
      .filter((event) => nowMs > 0 && Math.abs((event.timestamp_ms + (event.value || 0)) - nowMs) < 350)
      .map((event) => faultKey(event))
  );
  const totalLiveMs = significantEvents.reduce((sum, event) => sum + (event.value || 0), 0);

  return (
    <section style={{ marginBottom: 16 }}>
      <style>{`
        @keyframes livePulse {
          0%, 100% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.28); opacity: 0.55; }
        }
        @media (prefers-reduced-motion: reduce) {
          .vn-live-dot { animation: none !important; }
        }
      `}</style>
      <div style={{
        border: "1px solid var(--line)",
        borderRadius: "var(--r-lg)",
        background: "var(--surface)",
        overflow: "hidden",
      }}>
        <div style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
          padding: "12px 14px",
          borderBottom: "1px solid var(--line)",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <span className="vn-live-dot" style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: running ? "var(--accent)" : "var(--line-strong)",
              animation: running ? "livePulse 1.2s ease-in-out infinite" : "none",
              flex: "0 0 auto",
            }} />
            <h2 style={{ margin: 0, fontSize: "1.125rem" }}>Live Feedback</h2>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 14, color: "var(--ink-muted)", fontSize: 13 }}>
            <span className="vn-label" style={{ color: "var(--ink-muted)" }}>{running ? "Last 30s" : "Paused"}</span>
            <strong className="vn-data" style={{ color: "var(--ink)" }}>{formatLiveTime(totalLiveMs)} total</strong>
          </div>
        </div>

        {running ? (
          <div style={{ padding: "12px 14px 14px" }}>
            <div style={{ display: "grid", gridTemplateColumns: "148px minmax(220px, 1fr) 72px", gap: 10, alignItems: "center" }}>
              {FEEDBACK_LANES.map((lane) => {
                const laneEvents = significantEvents.filter((event) => faultKey(event) === lane.key);
                const laneTotalMs = laneEvents.reduce((sum, event) => sum + (event.value || 0), 0);
                const isActive = activeKeys.has(lane.key);

                return (
                  <LiveFeedbackLane
                    key={lane.key}
                    lane={lane}
                    events={laneEvents}
                    nowMs={nowMs}
                    windowStart={windowStart}
                    totalMs={laneTotalMs}
                    active={isActive}
                  />
                );
              })}
            </div>
            {significantEvents.length === 0 && (
              <div style={{ color: "var(--ink-muted)", fontSize: 13, marginTop: 10 }}>
                No sustained feedback yet. Brief blips under 0.5s stay out of this monitor.
              </div>
            )}
          </div>
        ) : (
          <div style={{ color: "var(--ink-muted)", padding: "14px 16px", fontSize: 14 }}>
            Start a session and sustained posture notes will stream here.
          </div>
        )}
      </div>
    </section>
  );
}

function LiveFeedbackLane({ lane, events, nowMs, windowStart, totalMs, active }) {
  const windowDuration = Math.max(1, nowMs - windowStart || LIVE_WINDOW_MS);

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
        <span style={{
          color: active ? "var(--ink)" : "var(--ink-muted)",
          fontSize: 13,
          fontWeight: active ? 700 : 500,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}>
          {faultLabel(lane.fault_type, lane.hand)}
        </span>
      </div>
      <div style={{
        position: "relative",
        height: 28,
        background: "var(--surface-sunken)",
        border: "1px solid var(--line)",
        borderRadius: "var(--r-md)",
        overflow: "hidden",
      }}>
        {[0, 1, 2, 3].map((tick) => (
          <span
            key={tick}
            style={{
              position: "absolute",
              left: `${(tick / 3) * 100}%`,
              top: 0,
              bottom: 0,
              width: 1,
              background: tick === 3 ? "var(--line-strong)" : "var(--line)",
            }}
          />
        ))}
        {events.map((event, index) => {
          // Use raw positions — container has overflow:hidden so pills clip naturally
          // at the left edge instead of clamping (which made tails look stuck).
          const left = ((event.timestamp_ms - windowStart) / windowDuration) * 100;
          const width = Math.max(1.5, ((event.value || 0) / windowDuration) * 100);
          const isLatest = active && index === events.length - 1;

          return (
            <span
              key={`${event.timestamp_ms}-${index}`}
              title={`${faultLabel(event.fault_type, event.hand)}: ${formatLiveTime(event.value || 0)}`}
              style={{
                position: "absolute",
                left: `${left}%`,
                width: `${width}%`,
                top: 6,
                bottom: 6,
                borderRadius: 999,
                background: isLatest ? "var(--accent)" : "var(--ink)",
                opacity: isLatest ? 1 : 0.72,
                boxShadow: isLatest ? "0 0 0 3px var(--accent-soft)" : "none",
                transition: "left 180ms linear, width 180ms linear",
              }}
            />
          );
        })}
        <span style={{
          position: "absolute",
          right: 0,
          top: 0,
          bottom: 0,
          width: 2,
          background: "var(--accent)",
        }} />
      </div>
      <div className="vn-data" style={{ color: active ? "var(--ink)" : "var(--ink-muted)", fontSize: 12, fontWeight: active ? 700 : 500, textAlign: "right" }}>
        {formatLiveTime(totalMs)}
      </div>
    </>
  );
}

function InitialsBadge({ children }) {
  return (
    <span className="vn-data" style={{
      width: 24,
      height: 20,
      borderRadius: 5,
      background: "var(--ink)",
      color: "var(--surface)",
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      fontSize: 10,
      fontWeight: 700,
      letterSpacing: 0,
      lineHeight: 1,
      flex: "0 0 auto",
    }}>
      {children}
    </span>
  );
}

function faultLabel(type, hand) {
  const t = type === "collapsed_wrist" ? "Wrist Collapsed" : "Arm Posture";
  const h = hand ? hand.charAt(0).toUpperCase() + hand.slice(1) : "";
  return `${h} ${t}`.trim();
}

function faultInitials(type, hand) {
  const handInitial = hand?.charAt(0).toUpperCase() ?? "";
  const typeInitial = type === "collapsed_wrist" ? "W" : "A";
  return `${handInitial}${typeInitial}`;
}

function faultKey(event) {
  return `${event.hand ?? ""}_${event.fault_type}`;
}

function formatLiveTime(ms) {
  return `${(ms / 1000).toFixed(1)}s`;
}
