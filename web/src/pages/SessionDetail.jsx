import { useEffect, useState, useRef, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import { getSession } from "../api";

const SIGNIFICANT_THRESHOLD_MS = 500;

const FAULT_VISUAL = {
  accent: "#333",
  fill: "#333",
  borderStyle: "solid",
  radius: 5,
};

function faultVisual() {
  return FAULT_VISUAL;
}

function visualSwatchStyle(visual, size = 14) {
  return {
    width: size,
    height: size,
    borderRadius: visual.radius,
    background: visual.fill,
    border: `2px ${visual.borderStyle} ${visual.accent}`,
    display: "inline-block",
    boxSizing: "border-box",
  };
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

function formatDuration(seconds) {
  if (seconds == null) return "—";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function secondTickLabel(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}:${String(s).padStart(2, "0")}` : `${s}s`;
}

function formatPreciseSecond(ms) {
  return `${(ms / 1000).toFixed(2)}s`;
}

function drawFaultBar(ctx, x, y, width, height, visual, alpha, label) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = visual.fill;
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, visual.radius);
  ctx.fill();

  if (label) {
    ctx.save();
    ctx.clip();
    const maxFontSize = Math.min(11, height - 5);
    const widthBasedFontSize = ((width - 4) / label.length) * 1.35;
    const fontSize = Math.max(4, Math.min(maxFontSize, widthBasedFontSize));
    ctx.globalAlpha = Math.min(1, alpha + 0.25);
    ctx.fillStyle = "#fff";
    ctx.font = `700 ${fontSize}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, x + width / 2, y + height / 2 + 0.2);
    ctx.restore();
  }

  ctx.globalAlpha = Math.min(1, alpha + 0.2);
  ctx.strokeStyle = visual.accent;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
}

// --- Timeline chart (canvas-based) -----------------------------------------------

function Timeline({ faults, sessionDurationMs, timeOrigin }) {
  const canvasRef = useRef(null);
  const barHitboxesRef = useRef([]);
  const [hoveredBar, setHoveredBar] = useState(null);

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
    const barHitboxes = [];

    // Group faults into lanes by type+hand
    const lanes = {};
    for (const f of faults) {
      const key = `${f.hand ?? ""}_${f.fault_type}`;
      if (!lanes[key]) lanes[key] = { label: faultLabel(f.fault_type, f.hand), visual: faultVisual(f.fault_type, f.hand), events: [] };
      lanes[key].events.push(f);
    }

    const laneKeys = Object.keys(lanes).sort();
    const labelWidth = 130;
    const chartLeft = labelWidth + 8;
    const chartWidth = W - chartLeft - 16;
    const laneHeight = Math.min(28, (H - 30) / Math.max(laneKeys.length, 1));
    const topPad = 8;
    const lanesBottom = topPad + laneKeys.length * laneHeight;

    // One vertical guide per second makes the event timing easier to scan.
    const totalSeconds = Math.max(1, Math.ceil(sessionDurationMs / 1000));
    const secondsPerLabel = Math.max(1, Math.ceil(32 / (chartWidth / totalSeconds)));

    // Lane backgrounds
    for (let i = 0; i < laneKeys.length; i++) {
      const y = topPad + i * laneHeight;
      ctx.fillStyle = i % 2 === 0 ? "#fafafa" : "#fff";
      ctx.fillRect(chartLeft, y, chartWidth, laneHeight);
    }

    for (let second = 0; second <= totalSeconds; second++) {
      const tickMs = Math.min(second * 1000, sessionDurationMs);
      const x = chartLeft + (chartWidth * tickMs) / sessionDurationMs;
      const isMinute = second > 0 && second % 60 === 0;
      const isEndpoint = second === 0 || second === totalSeconds;
      ctx.strokeStyle = isMinute || isEndpoint ? "#9f9f9f" : "#d4d4d4";
      ctx.lineWidth = isMinute || isEndpoint ? 1.25 : 1;
      ctx.beginPath();
      ctx.moveTo(x, topPad);
      ctx.lineTo(x, lanesBottom);
      ctx.stroke();
    }
    ctx.lineWidth = 1;

    // Lanes
    for (let i = 0; i < laneKeys.length; i++) {
      const lane = lanes[laneKeys[i]];
      const y = topPad + i * laneHeight;

      // Label
      ctx.fillStyle = "#333";
      ctx.font = "12px system-ui, sans-serif";
      ctx.fillText(lane.label, 4, y + laneHeight / 2 + 4);

      // Fault bars
      for (const ev of lane.events) {
        const startFrac = (ev.timestamp_ms - timeOrigin) / sessionDurationMs;
        const durFrac = (ev.value || 0) / sessionDurationMs;
        const barX = chartLeft + startFrac * chartWidth;
        const barW = Math.max(2, durFrac * chartWidth);

        const alpha = (ev.value || 0) >= SIGNIFICANT_THRESHOLD_MS ? 0.95 : 0.38;
        const barLabel = (ev.value || 0) >= SIGNIFICANT_THRESHOLD_MS
          ? faultInitials(ev.fault_type, ev.hand)
          : "";
        drawFaultBar(ctx, barX, y + 3, barW, laneHeight - 6, lane.visual, alpha, barLabel);

        const startMs = ev.timestamp_ms - timeOrigin;
        const endMs = startMs + (ev.value || 0);
        barHitboxes.push({
          x1: barX - 3,
          x2: barX + barW + 3,
          y1: y + 1,
          y2: y + laneHeight - 1,
          label: lane.label,
          visual: lane.visual,
          startMs,
          endMs,
          durationMs: ev.value || 0,
        });
      }
    }
    barHitboxesRef.current = barHitboxes;

    // Time axis labels at bottom
    ctx.fillStyle = "#555";
    ctx.font = "600 12px system-ui, sans-serif";
    for (let second = 0; second <= totalSeconds; second++) {
      const shouldLabel = second === 0 || second === totalSeconds || second % secondsPerLabel === 0;
      if (!shouldLabel) continue;

      const tickMs = Math.min(second * 1000, sessionDurationMs);
      const x = chartLeft + (chartWidth * tickMs) / sessionDurationMs;
      const label = secondTickLabel(second);
      const textWidth = ctx.measureText(label).width;
      const labelX = Math.min(
        chartLeft + chartWidth - textWidth,
        Math.max(chartLeft, x - textWidth / 2)
      );
      ctx.fillText(label, labelX, lanesBottom + 16);
    }
  }, [faults, sessionDurationMs, timeOrigin]);

  const handleMouseMove = useCallback((event) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const hit = barHitboxesRef.current.find((box) => (
      x >= box.x1 && x <= box.x2 && y >= box.y1 && y <= box.y2
    ));

    if (!hit) {
      setHoveredBar(null);
      return;
    }

    setHoveredBar({
      ...hit,
      x: Math.min(rect.width - 12, Math.max(12, x)),
      y: Math.max(12, y),
    });
  }, []);

  const handleMouseLeave = useCallback(() => {
    setHoveredBar(null);
  }, []);

  useEffect(() => {
    draw();
    window.addEventListener("resize", draw);
    return () => window.removeEventListener("resize", draw);
  }, [draw]);

  const laneCount = new Set(faults.map((f) => `${f.hand}_${f.fault_type}`)).size;
  const height = Math.max(80, 8 + laneCount * 28 + 24);

  return (
    <div style={{ position: "relative" }}>
      <canvas
        ref={canvasRef}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        style={{ width: "100%", height, display: "block", cursor: hoveredBar ? "pointer" : "default" }}
      />
      <div
        style={{
          position: "absolute",
          left: hoveredBar ? hoveredBar.x : 0,
          top: hoveredBar ? hoveredBar.y : 0,
          transform: hoveredBar ? "translate(-50%, calc(-100% - 10px)) scale(1)" : "translate(-50%, calc(-100% - 4px)) scale(0.96)",
          opacity: hoveredBar ? 1 : 0,
          pointerEvents: "none",
          transition: "opacity 120ms ease, transform 120ms ease",
          background: "#111",
          color: "#fff",
          borderRadius: 6,
          boxShadow: "0 8px 22px rgba(0, 0, 0, 0.22)",
          padding: "8px 10px",
          minWidth: 180,
          zIndex: 2,
          fontSize: 12,
          lineHeight: 1.35,
        }}
      >
        {hoveredBar && (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 700, marginBottom: 3 }}>
              <span style={visualSwatchStyle(hoveredBar.visual, 10)} />
              {hoveredBar.label}
            </div>
            <div>{formatPreciseSecond(hoveredBar.startMs)} to {formatPreciseSecond(hoveredBar.endMs)}</div>
            <div style={{ color: "#cfcfcf" }}>
              {formatPreciseSecond(hoveredBar.durationMs)} {hoveredBar.durationMs >= SIGNIFICANT_THRESHOLD_MS ? "sustained fault" : "brief blip"}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// --- Legend -----------------------------------------------------------------------

function faultKey(fault) {
  return `${fault.hand ?? ""}_${fault.fault_type}`;
}

function Legend({ faults, selectedKeys, onToggle }) {
  const seen = new Set();
  const items = [];
  for (const f of faults) {
    const key = faultKey(f);
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({ key, label: faultLabel(f.fault_type, f.hand), visual: faultVisual(f.fault_type, f.hand) });
  }
  const hasSelection = selectedKeys.size > 0;

  return (
    <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 12, fontSize: 13 }}>
      {items.map((it) => {
        const checked = selectedKeys.has(it.key);
        const isDimmed = hasSelection && !checked;

        return (
          <label
            key={it.key}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 7,
              color: "#222",
              cursor: "pointer",
              font: "inherit",
              opacity: isDimmed ? 0.35 : 1,
              transition: "opacity 140ms ease",
            }}
          >
            <input
              type="checkbox"
              checked={checked}
              onChange={() => onToggle(it.key)}
              style={{
                width: 16,
                height: 16,
                margin: 0,
                accentColor: "#555",
                cursor: "pointer",
              }}
            />
            {it.label}
          </label>
        );
      })}
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
  const [selectedFaultKeys, setSelectedFaultKeys] = useState(new Set());

  useEffect(() => {
    getSession(sessionId)
      .then(setSession)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [sessionId]);

  useEffect(() => {
    setSelectedFaultKeys(new Set());
  }, [sessionId]);

  if (loading) return <main style={{ padding: "32px 0" }}>Loading…</main>;
  if (error) return <main style={{ padding: "32px 0", color: "red" }}>Error: {error}</main>;

  const allFaults = session.fault_events || [];
  const visibleFaults = selectedFaultKeys.size > 0
    ? allFaults.filter((f) => selectedFaultKeys.has(faultKey(f)))
    : allFaults;
  const significant = allFaults.filter((f) => (f.value || 0) >= SIGNIFICANT_THRESHOLD_MS);
  const sessionDurationMs = (session.duration_seconds || 1) * 1000;
  const timeOrigin = allFaults.length > 0
    ? Math.min(...allFaults.map((f) => f.timestamp_ms))
    : 0;

  // Group significant faults by type+hand for summary cards
  const summary = {};
  for (const f of significant) {
    const key = faultKey(f);
    if (!summary[key]) {
      summary[key] = { label: faultLabel(f.fault_type, f.hand), visual: faultVisual(f.fault_type, f.hand), count: 0, totalMs: 0 };
    }
    summary[key].count++;
    summary[key].totalMs += f.value || 0;
  }

  function toggleFaultKey(key) {
    setSelectedFaultKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
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
                border: `2px ${s.visual.borderStyle} ${s.visual.accent}`,
                borderRadius: 8,
                padding: "10px 18px",
                minWidth: 140,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 13, color: "#555" }}>
                <span style={visualSwatchStyle(s.visual, 14)} />
                {s.label}
              </div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginTop: 4 }}>
                <span style={{ fontSize: 28, fontWeight: 700, color: s.visual.accent }}>{s.count}</span>
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
              <Legend faults={allFaults} selectedKeys={selectedFaultKeys} onToggle={toggleFaultKey} />
              <Timeline faults={visibleFaults} sessionDurationMs={sessionDurationMs} timeOrigin={timeOrigin} />
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
