import { useRef, useState } from "react";
import useVision from "../vision/useVision";
import { startSession, endSession, postFaults } from "../api";

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
  const [running, setRunning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [liveFeedbackEnabled, setLiveFeedbackEnabled] = useState(false);
  const sessionRef = useRef(null); // { id, startedAt }
  const { isLoading, error, faults, liveEvents, start, stop } = useVision(
    videoRef,
    canvasRef
  );

  const handleStart = async () => {
    try {
      const { session_id } = await startSession();
      sessionRef.current = { id: session_id, startedAt: Date.now() };
      await start();
      setRunning(true);
    } catch (e) {
      console.error("Failed to start session:", e);
    }
  };

  const handleStop = async () => {
    const events = stop();
    setRunning(false);
    setSaving(true);

    try {
      const { id, startedAt } = sessionRef.current;
      const durationSeconds = Math.round((Date.now() - startedAt) / 1000);

      // Send summary + faults in parallel
      await Promise.all([
        endSession(id, durationSeconds, events.length),
        postFaults(id, events),
      ]);
    } catch (e) {
      console.error("Failed to save session:", e);
    } finally {
      sessionRef.current = null;
      setSaving(false);
    }
  };

  return (
    <main style={{ padding: "32px 0" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 16 }}>
        <h1 style={{ margin: 0 }}>Practice</h1>
        <button
          onClick={running ? handleStop : handleStart}
          disabled={isLoading || saving}
          style={{
            padding: "8px 20px",
            fontSize: 16,
            borderRadius: 6,
            border: "none",
            cursor: isLoading || saving ? "wait" : "pointer",
            background: running ? "#cc3333" : "#0066cc",
            color: "#fff",
          }}
        >
          {isLoading
            ? "Loading models…"
            : saving
              ? "Saving…"
              : running
                ? "Stop"
                : "Start Session"}
        </button>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, color: "#555" }}>
          <input
            type="checkbox"
            checked={liveFeedbackEnabled}
            onChange={(event) => setLiveFeedbackEnabled(event.target.checked)}
            style={{ width: 16, height: 16, margin: 0, accentColor: "#555" }}
          />
          Enable live feedback
        </label>
      </div>

      {error && (
        <p style={{ color: "red", fontWeight: 600 }}>{error}</p>
      )}

      {liveFeedbackEnabled && (
        <LiveFeedbackPanel running={running} events={liveEvents} />
      )}

      {/* Fault labels */}
      {faults.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          {faults.map((f, i) => (
            <span
              key={i}
              style={{
                display: "inline-block",
                background: "#ff3333",
                color: "#fff",
                padding: "4px 12px",
                borderRadius: 4,
                marginRight: 8,
                fontSize: 14,
                fontWeight: 600,
                textTransform: "uppercase",
              }}
            >
              {f}
            </span>
          ))}
        </div>
      )}

      {/* Video + canvas overlay */}
      <div style={{ position: "relative", display: "inline-block", background: "#000", borderRadius: 8, overflow: "hidden" }}>
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
      </div>

      {!running && !isLoading && !saving && (
        <p style={{ color: "#888", marginTop: 12 }}>
          Press <strong>Start Session</strong> to begin webcam posture tracking.
        </p>
      )}
    </main>
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
      `}</style>
      <div style={{
        border: "1px solid #e5e5e5",
        borderRadius: 8,
        background: "#fff",
        overflow: "hidden",
      }}>
        <div style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
          padding: "12px 14px",
          borderBottom: "1px solid #eee",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <span style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: running ? "#333" : "#aaa",
              animation: running ? "livePulse 1.2s ease-in-out infinite" : "none",
              flex: "0 0 auto",
            }} />
            <h2 style={{ margin: 0, fontSize: 18 }}>Live Feedback</h2>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 14, color: "#777", fontSize: 13 }}>
            <span>{running ? "Last 30s" : "Paused"}</span>
            <strong style={{ color: "#333" }}>{formatLiveTime(totalLiveMs)} total</strong>
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
              <div style={{ color: "#777", fontSize: 13, marginTop: 10 }}>
                No sustained feedback yet. Brief blips under 0.5s stay out of this monitor.
              </div>
            )}
          </div>
        ) : (
          <div style={{ color: "#777", padding: "14px 16px", fontSize: 14 }}>
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
        <InitialsBadge>{faultInitials(lane.fault_type, lane.hand)}</InitialsBadge>
        <span style={{
          color: active ? "#222" : "#666",
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
        background: "#f7f7f7",
        border: "1px solid #e8e8e8",
        borderRadius: 6,
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
              background: tick === 3 ? "#bbb" : "#e2e2e2",
            }}
          />
        ))}
        {events.map((event, index) => {
          const eventStart = Math.max(event.timestamp_ms, windowStart);
          const eventEnd = Math.min(event.timestamp_ms + (event.value || 0), nowMs || LIVE_WINDOW_MS);
          const left = ((eventStart - windowStart) / windowDuration) * 100;
          const width = Math.max(1.5, ((eventEnd - eventStart) / windowDuration) * 100);
          const isLatest = active && index === events.length - 1;

          return (
            <span
              key={`${event.timestamp_ms}-${index}`}
              title={`${faultLabel(event.fault_type, event.hand)}: ${formatLiveTime(event.value || 0)}`}
              style={{
                position: "absolute",
                left: `${Math.max(0, Math.min(100, left))}%`,
                width: `${Math.max(1.5, Math.min(100, width))}%`,
                top: 6,
                bottom: 6,
                borderRadius: 999,
                background: "#333",
                opacity: isLatest ? 1 : 0.72,
                boxShadow: isLatest ? "0 0 0 3px rgba(0, 0, 0, 0.12)" : "none",
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
          background: "#333",
        }} />
      </div>
      <div style={{ color: active ? "#222" : "#777", fontSize: 12, fontWeight: active ? 700 : 500, textAlign: "right" }}>
        {formatLiveTime(totalMs)}
      </div>
    </>
  );
}

function InitialsBadge({ children }) {
  return (
    <span style={{
      width: 24,
      height: 20,
      borderRadius: 5,
      background: "#333",
      color: "#fff",
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      fontSize: 10,
      fontWeight: 800,
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
