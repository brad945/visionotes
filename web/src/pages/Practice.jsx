import { useRef, useState } from "react";
import useVision from "../vision/useVision";
import { startSession, endSession, postFaults } from "../api";

export default function Practice() {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const [running, setRunning] = useState(false);
  const [saving, setSaving] = useState(false);
  const sessionRef = useRef(null); // { id, startedAt }
  const { isLoading, error, faults, start, stop } = useVision(
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
      </div>

      {error && (
        <p style={{ color: "red", fontWeight: 600 }}>{error}</p>
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
