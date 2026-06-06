import { useEffect, useState, useRef, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import { getSession } from "../api";

const SIGNIFICANT_THRESHOLD_MS = 500;

const FAULT_COLORS = {
  collapsed_wrist: { left: "#e63946", right: "#f4845f" },
  arm_posture: { left: "#457b9d", right: "#a8dadc" },
};

function faultColor(type, hand) {
  return FAULT_COLORS[type]?.[hand] ?? "#888";
}

function faultLabel(type, hand) {
  const t = type === "collapsed_wrist" ? "Wrist Collapsed" : "Arm Posture";
  const h = hand ? hand.charAt(0).toUpperCase() + hand.slice(1) : "";
  return `${h} ${t}`.trim();
}

function formatDuration(seconds) {
  if (seconds == null) return "—";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function formatMs(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}:${String(rem).padStart(2, "0")}`;
}

// --- Timeline chart (canvas-based) -----------------------------------------------

function Timeline({ faults, sessionDurationMs, timeOrigin }) {
  const canvasRef = useRef(null);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !faults.length) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);
    const W = rect.width;
    const H = rect.height;

    ctx.clearRect(0, 0, W, H);

    // Group faults into lanes by type+hand
    const lanes = {};
    for (const f of faults) {
      const key = `${f.hand ?? ""}_${f.fault_type}`;
      if (!lanes[key]) lanes[key] = { label: faultLabel(f.fault_type, f.hand), color: faultColor(f.fault_type, f.hand), events: [] };
      lanes[key].events.push(f);
    }

    const laneKeys = Object.keys(lanes).sort();
    const labelWidth = 130;
    const chartLeft = labelWidth + 8;
    const chartWidth = W - chartLeft - 16;
    const laneHeight = Math.min(28, (H - 30) / Math.max(laneKeys.length, 1));
    const topPad = 20;

    // Time axis
    ctx.fillStyle = "#999";
    ctx.font = "11px system-ui, sans-serif";
    const ticks = 5;
    for (let i = 0; i <= ticks; i++) {
      const x = chartLeft + (chartWidth * i) / ticks;
      const t = (sessionDurationMs * i) / ticks;
      ctx.fillText(formatMs(t), x - 12, topPad - 4);
      ctx.strokeStyle = "#eee";
      ctx.beginPath();
      ctx.moveTo(x, topPad);
      ctx.lineTo(x, topPad + laneKeys.length * laneHeight);
      ctx.stroke();
    }

    // Lanes
    for (let i = 0; i < laneKeys.length; i++) {
      const lane = lanes[laneKeys[i]];
      const y = topPad + i * laneHeight;

      // Label
      ctx.fillStyle = "#333";
      ctx.font = "12px system-ui, sans-serif";
      ctx.fillText(lane.label, 4, y + laneHeight / 2 + 4);

      // Background stripe
      ctx.fillStyle = i % 2 === 0 ? "#fafafa" : "#fff";
      ctx.fillRect(chartLeft, y, chartWidth, laneHeight);

      // Fault bars
      for (const ev of lane.events) {
        const startFrac = (ev.timestamp_ms - timeOrigin) / sessionDurationMs;
        const durFrac = (ev.value || 0) / sessionDurationMs;
        const barX = chartLeft + startFrac * chartWidth;
        const barW = Math.max(2, durFrac * chartWidth);

        ctx.fillStyle = lane.color;
        ctx.globalAlpha = (ev.value || 0) >= SIGNIFICANT_THRESHOLD_MS ? 0.9 : 0.3;
        ctx.fillRect(barX, y + 3, barW, laneHeight - 6);
        ctx.globalAlpha = 1;
      }
    }
  }, [faults, sessionDurationMs, timeOrigin]);

  useEffect(() => {
    draw();
    window.addEventListener("resize", draw);
    return () => window.removeEventListener("resize", draw);
  }, [draw]);

  const laneCount = new Set(faults.map((f) => `${f.hand}_${f.fault_type}`)).size;
  const height = Math.max(80, 20 + laneCount * 28 + 10);

  return (
    <canvas
      ref={canvasRef}
      style={{ width: "100%", height, display: "block" }}
    />
  );
}

// --- Legend -----------------------------------------------------------------------

function Legend({ faults }) {
  const seen = new Set();
  const items = [];
  for (const f of faults) {
    const key = `${f.hand}_${f.fault_type}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({ key, label: faultLabel(f.fault_type, f.hand), color: faultColor(f.fault_type, f.hand) });
  }
  return (
    <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 12, fontSize: 13 }}>
      {items.map((it) => (
        <span key={it.key} style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ width: 12, height: 12, borderRadius: 2, background: it.color, display: "inline-block" }} />
          {it.label}
        </span>
      ))}
      <span style={{ display: "flex", alignItems: "center", gap: 4, color: "#999" }}>
        <span style={{ width: 12, height: 12, borderRadius: 2, background: "#ccc", opacity: 0.3, display: "inline-block" }} />
        {"< 0.5s (minor)"}
      </span>
    </div>
  );
}

// --- Main component --------------------------------------------------------------

export default function SessionDetail() {
  const { sessionId } = useParams();
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showDetailed, setShowDetailed] = useState(false);

  useEffect(() => {
    getSession(sessionId)
      .then(setSession)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [sessionId]);

  if (loading) return <main style={{ padding: "32px 0" }}>Loading…</main>;
  if (error) return <main style={{ padding: "32px 0", color: "red" }}>Error: {error}</main>;

  const allFaults = session.fault_events || [];
  const significant = allFaults.filter((f) => (f.value || 0) >= SIGNIFICANT_THRESHOLD_MS);
  const sessionDurationMs = (session.duration_seconds || 1) * 1000;
  const timeOrigin = allFaults.length > 0
    ? Math.min(...allFaults.map((f) => f.timestamp_ms))
    : 0;

  // Group significant faults by type+hand for summary cards
  const summary = {};
  for (const f of significant) {
    const key = `${f.hand ?? ""}_${f.fault_type}`;
    if (!summary[key]) {
      summary[key] = { label: faultLabel(f.fault_type, f.hand), color: faultColor(f.fault_type, f.hand), count: 0, totalMs: 0 };
    }
    summary[key].count++;
    summary[key].totalMs += f.value || 0;
  }

  return (
    <main style={{ padding: "32px 0" }}>
      <Link to="/history" style={{ color: "#0066cc", fontSize: 14 }}>← Back to History</Link>

      <h1 style={{ marginTop: 12 }}>Session Detail</h1>

      <div style={{ display: "flex", gap: 32, marginBottom: 24, fontSize: 15 }}>
        <div><strong>Started:</strong> {new Date(session.started_at).toLocaleString()}</div>
        <div><strong>Duration:</strong> {formatDuration(session.duration_seconds)}</div>
        <div><strong>Significant faults:</strong> {significant.length}</div>
      </div>

      {/* Summary cards — only sustained faults (>0.5s) */}
      {Object.keys(summary).length > 0 ? (
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 24 }}>
          {Object.values(summary).map((s) => (
            <div
              key={s.label}
              style={{
                background: "#fff",
                border: `2px solid ${s.color}`,
                borderRadius: 8,
                padding: "10px 18px",
                minWidth: 140,
              }}
            >
              <div style={{ fontSize: 13, color: "#555" }}>{s.label}</div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginTop: 4 }}>
                <span style={{ fontSize: 28, fontWeight: 700, color: s.color }}>{s.count}</span>
                <span style={{ fontSize: 13, color: "#888" }}>
                  {(s.totalMs / 1000).toFixed(1)}s total
                </span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p style={{ color: "#888", marginBottom: 24 }}>No significant faults ({">"} 0.5s) — nice session!</p>
      )}

      {/* Detailed timeline toggle */}
      {allFaults.length > 0 && (
        <>
          <button
            onClick={() => setShowDetailed(!showDetailed)}
            style={{
              background: "none",
              border: "1px solid #ccc",
              borderRadius: 6,
              padding: "6px 14px",
              cursor: "pointer",
              fontSize: 14,
              color: "#555",
              marginBottom: 16,
            }}
          >
            {showDetailed ? "Hide" : "Show"} Detailed Timeline
            <span style={{ fontSize: 12, color: "#999", marginLeft: 6 }}>
              ({allFaults.length} total event{allFaults.length !== 1 ? "s" : ""})
            </span>
          </button>

          {showDetailed && (
            <div style={{ border: "1px solid #eee", borderRadius: 8, padding: 16, background: "#fafafa" }}>
              <Legend faults={allFaults} />
              <Timeline faults={allFaults} sessionDurationMs={sessionDurationMs} timeOrigin={timeOrigin} />
              <p style={{ fontSize: 12, color: "#999", marginTop: 8, marginBottom: 0 }}>
                Solid bars = sustained faults ({">"} 0.5s). Faded bars = brief blips ({"<"} 0.5s).
              </p>
            </div>
          )}
        </>
      )}
    </main>
  );
}
