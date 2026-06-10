import { useRef, useState } from "react";
import useVision from "../vision/useVision";
import { startSession, endSession, postFaults } from "../api";

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

  const significantLiveEvents = liveEvents.filter((event) => (event.value || 0) >= 500);
  const liveSummary = significantLiveEvents.reduce((summary, event) => {
    const key = `${event.hand ?? ""}_${event.fault_type}`;
    if (!summary[key]) {
      summary[key] = {
        label: faultLabel(event.fault_type, event.hand),
        initials: faultInitials(event.fault_type, event.hand),
        count: 0,
        totalMs: 0,
      };
    }
    summary[key].count++;
    summary[key].totalMs += event.value || 0;
    return summary;
  }, {});
  const liveSummaryItems = Object.values(liveSummary);
  const totalLiveFaultMs = liveSummaryItems.reduce((sum, item) => sum + item.totalMs, 0);

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
        <section style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, marginBottom: 10 }}>
            <h2 style={{ margin: 0, fontSize: 18 }}>Live Feedback</h2>
            <span style={{ color: "#777", fontSize: 13 }}>
              {running ? `${significantLiveEvents.length} sustained event${significantLiveEvents.length !== 1 ? "s" : ""}` : "Start a session to collect feedback"}
            </span>
          </div>

          {running && liveSummaryItems.length > 0 ? (
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              {liveSummaryItems.map((item) => {
                const share = totalLiveFaultMs > 0 ? item.totalMs / totalLiveFaultMs : 0;
                const averageMs = item.count > 0 ? item.totalMs / item.count : 0;

                return (
                  <div
                    key={item.label}
                    style={{
                      background: "#fff",
                      border: "2px solid #333",
                      borderRadius: 8,
                      padding: "12px 16px",
                      minWidth: 180,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 13, color: "#555" }}>
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
                        {item.initials}
                      </span>
                      {item.label}
                    </div>

                    <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginTop: 8 }}>
                      <span style={{ fontSize: 28, fontWeight: 700, color: "#333" }}>{item.count}</span>
                      <span style={{ fontSize: 13, color: "#888" }}>
                        {(item.totalMs / 1000).toFixed(1)}s total
                      </span>
                    </div>

                    <div style={{ height: 6, background: "#eee", borderRadius: 999, overflow: "hidden", marginTop: 9 }}>
                      <div style={{
                        width: `${Math.max(3, Math.round(share * 100))}%`,
                        height: "100%",
                        background: "#333",
                        borderRadius: 999,
                      }} />
                    </div>

                    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginTop: 7, color: "#777", fontSize: 12 }}>
                      <span>{Math.round(share * 100)}% of fault time</span>
                      <span>{(averageMs / 1000).toFixed(1)}s avg</span>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div style={{
              border: "1px solid #e5e5e5",
              borderRadius: 8,
              background: "#fafafa",
              color: "#777",
              padding: "14px 16px",
              fontSize: 14,
            }}>
              {running ? "No sustained feedback yet. Brief blips under 0.5s stay out of this summary." : "Start a session and sustained posture notes will appear here in real time."}
            </div>
          )}
        </section>
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
