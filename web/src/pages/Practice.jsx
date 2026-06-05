import { useRef, useState } from "react";
import useVision from "../vision/useVision";

export default function Practice() {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const [running, setRunning] = useState(false);
  const { isLoading, error, faults, start, stop } = useVision(
    videoRef,
    canvasRef
  );

  const handleToggle = async () => {
    if (running) {
      const events = stop();
      console.log("Session fault events:", events);
      setRunning(false);
    } else {
      await start();
      setRunning(true);
    }
  };

  return (
    <main style={{ padding: "32px 0" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 16 }}>
        <h1 style={{ margin: 0 }}>Practice</h1>
        <button
          onClick={handleToggle}
          disabled={isLoading}
          style={{
            padding: "8px 20px",
            fontSize: 16,
            borderRadius: 6,
            border: "none",
            cursor: isLoading ? "wait" : "pointer",
            background: running ? "#cc3333" : "#0066cc",
            color: "#fff",
          }}
        >
          {isLoading ? "Loading models…" : running ? "Stop" : "Start Session"}
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

      {!running && !isLoading && (
        <p style={{ color: "#888", marginTop: 12 }}>
          Press <strong>Start Session</strong> to begin webcam posture tracking.
        </p>
      )}
    </main>
  );
}
