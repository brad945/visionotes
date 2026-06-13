import { useEffect, useState, useRef, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import { getSession } from "../api";

const SIGNIFICANT_THRESHOLD_MS = 500;

// Read a CSS custom property off :root so canvas (which can't use var()) and DOM
// share one source of truth with tokens.css.
function cssVar(name, fallback = "") {
  if (typeof window === "undefined") return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

// Faults are Signal Clay everywhere (the Clay-Means-Fault rule). var() strings for DOM.
const FAULT_VISUAL = {
  accent: "var(--signal)",
  fill: "var(--signal)",
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
    ctx.fillStyle = visual.textColor || "#fff";
    ctx.font = `700 ${fontSize}px "IBM Plex Mono", ui-monospace, monospace`;
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

    // Resolve design tokens once for this paint (canvas needs concrete colors).
    const palette = {
      fill: cssVar("--signal", "#c2410c"),
      laneEven: cssVar("--surface-sunken", "#eef1f1"),
      laneOdd: cssVar("--surface", "#ffffff"),
      tickMinor: cssVar("--line", "#dde1e1"),
      tickMajor: cssVar("--line-strong", "#c4c9c9"),
      label: cssVar("--ink", "#16191b"),
      axis: cssVar("--ink-muted", "#565c61"),
      barText: cssVar("--on-signal", "#ffffff"),
    };

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
      ctx.fillStyle = i % 2 === 0 ? palette.laneEven : palette.laneOdd;
      ctx.fillRect(chartLeft, y, chartWidth, laneHeight);
    }

    for (let second = 0; second <= totalSeconds; second++) {
      const tickMs = Math.min(second * 1000, sessionDurationMs);
      const x = chartLeft + (chartWidth * tickMs) / sessionDurationMs;
      const isMinute = second > 0 && second % 60 === 0;
      const isEndpoint = second === 0 || second === totalSeconds;
      ctx.strokeStyle = isMinute || isEndpoint ? palette.tickMajor : palette.tickMinor;
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
      ctx.fillStyle = palette.label;
      ctx.font = '12px "IBM Plex Sans", system-ui, sans-serif';
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
        const resolvedVisual = { fill: palette.fill, accent: palette.fill, radius: lane.visual.radius, textColor: palette.barText };
        drawFaultBar(ctx, barX, y + 3, barW, laneHeight - 6, resolvedVisual, alpha, barLabel);

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
    ctx.fillStyle = palette.axis;
    ctx.font = '500 12px "IBM Plex Mono", ui-monospace, monospace';
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
    // The canvas reads design tokens at paint time, so a light/dark theme flip
    // (data-theme on <html>) must trigger a repaint — SVG re-resolves var()
    // live, but canvas does not.
    const themeObserver = new MutationObserver(draw);
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => {
      window.removeEventListener("resize", draw);
      themeObserver.disconnect();
    };
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
          background: "var(--ink)",
          color: "var(--surface)",
          borderRadius: "var(--r-md)",
          boxShadow: "0 8px 22px rgba(16, 25, 28, 0.28)",
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
            <div className="vn-data">{formatPreciseSecond(hoveredBar.startMs)} to {formatPreciseSecond(hoveredBar.endMs)}</div>
            <div style={{ color: "rgba(255,255,255,0.7)" }}>
              {formatPreciseSecond(hoveredBar.durationMs)} {hoveredBar.durationMs >= SIGNIFICANT_THRESHOLD_MS ? "sustained fault" : "brief blip"}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function faultKey(fault) {
  return `${fault.hand ?? ""}_${fault.fault_type}`;
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

  if (loading) return <main style={{ padding: "32px 0" }} className="vn-muted">Loading…</main>;
  if (error) return <main style={{ padding: "32px 0", color: "var(--signal-deep)" }}>Error: {error}</main>;

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
      summary[key] = {
        key,
        label: faultLabel(f.fault_type, f.hand),
        initials: faultInitials(f.fault_type, f.hand),
        visual: faultVisual(f.fault_type, f.hand),
        count: 0,
        totalMs: 0,
      };
    }
    summary[key].count++;
    summary[key].totalMs += f.value || 0;
  }
  const summaryItems = Object.values(summary);
  const totalSignificantMs = summaryItems.reduce((sum, item) => sum + item.totalMs, 0);
  const hasSummarySelection = selectedFaultKeys.size > 0;

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

  function focusSummaryCard(key) {
    toggleFaultKey(key);
    setShowDetailed(true);
  }

  return (
    <main style={{ padding: "32px 0" }}>
      <Link to="/history" style={{ fontSize: 14 }}>← Back to History</Link>

      <h1 style={{ marginTop: 12 }}>Session Detail</h1>

      <div style={{ display: "flex", gap: 32, flexWrap: "wrap", margin: "12px 0 24px", fontSize: "0.95rem" }}>
        <div><span className="vn-label">Started</span><div className="vn-data" style={{ marginTop: 2 }}>{new Date(session.started_at).toLocaleString()}</div></div>
        <div><span className="vn-label">Duration</span><div className="vn-data" style={{ marginTop: 2 }}>{formatDuration(session.duration_seconds)}</div></div>
        <div><span className="vn-label">Significant faults</span><div className="vn-data" style={{ marginTop: 2 }}>{significant.length}</div></div>
      </div>

      {/* Summary cards — only sustained faults (>0.5s) */}
      {Object.keys(summary).length > 0 ? (
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 24 }}>
          {summaryItems.map((s) => {
            const isSelected = selectedFaultKeys.has(s.key);
            const isDimmed = hasSummarySelection && !isSelected;
            const share = totalSignificantMs > 0 ? s.totalMs / totalSignificantMs : 0;
            const averageMs = s.count > 0 ? s.totalMs / s.count : 0;

            return (
            <div
              key={s.key}
              role="button"
              tabIndex={0}
              aria-pressed={isSelected}
              onClick={() => focusSummaryCard(s.key)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  focusSummaryCard(s.key);
                }
              }}
              style={{
                background: "var(--surface)",
                border: `1px solid ${isSelected ? "var(--signal)" : "var(--line)"}`,
                borderRadius: "var(--r-lg)",
                padding: "12px 16px",
                minWidth: 180,
                textAlign: "left",
                cursor: "pointer",
                font: "inherit",
                color: "inherit",
                opacity: isDimmed ? 0.45 : 1,
                transform: isSelected ? "translateY(-2px)" : "none",
                boxShadow: isSelected ? "var(--shadow-lift)" : "none",
                transition: "opacity 140ms var(--ease-out), transform 140ms var(--ease-out), box-shadow 140ms var(--ease-out), border-color 140ms var(--ease-out)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 13, color: "var(--ink-muted)" }}>
                  <span className="vn-data" style={{
                    width: 24,
                    height: 20,
                    borderRadius: 5,
                    background: "var(--signal)",
                    color: "var(--on-signal)",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: 0,
                    lineHeight: 1,
                    flex: "0 0 auto",
                  }}>
                    {s.initials}
                  </span>
                  {s.label}
                </div>
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => focusSummaryCard(s.key)}
                  onClick={(event) => event.stopPropagation()}
                  aria-label={`Show only ${s.label}`}
                  className="vn-accent-control"
                  style={{
                    width: 18,
                    height: 18,
                    margin: 0,
                    cursor: "pointer",
                    flex: "0 0 auto",
                  }}
                />
              </div>

              <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginTop: 8 }}>
                <span className="vn-data" style={{ fontSize: 28, fontWeight: 700, color: "var(--signal)" }}>{s.count}</span>
                <span className="vn-data" style={{ fontSize: 13, color: "var(--ink-muted)" }}>
                  {(s.totalMs / 1000).toFixed(1)}s total
                </span>
              </div>

              <div style={{
                height: 6,
                background: "var(--surface-sunken)",
                borderRadius: 999,
                overflow: "hidden",
                marginTop: 9,
              }}>
                <div style={{
                  width: `${Math.max(3, Math.round(share * 100))}%`,
                  height: "100%",
                  background: "var(--signal)",
                  borderRadius: 999,
                }} />
              </div>

              <div className="vn-data" style={{ display: "flex", justifyContent: "space-between", gap: 12, marginTop: 7, color: "var(--ink-muted)", fontSize: 12 }}>
                <span>{Math.round(share * 100)}% of fault time</span>
                <span>{(averageMs / 1000).toFixed(1)}s avg</span>
              </div>
            </div>
            );
          })}
        </div>
      ) : (
        <p style={{ color: "var(--positive-deep)", fontWeight: 500, marginBottom: 24 }}>No significant faults ({">"} 0.5s) — nice session!</p>
      )}

      {/* Detailed timeline toggle */}
      {allFaults.length > 0 && (
        <>
          <button
            onClick={() => setShowDetailed(!showDetailed)}
            className="vn-btn vn-btn--ghost"
            style={{ marginBottom: 16 }}
          >
            {showDetailed ? "Hide" : "Show"} Detailed Timeline
            <span className="vn-data" style={{ fontSize: 12, color: "var(--ink-muted)", marginLeft: 6 }}>
              ({allFaults.length} total event{allFaults.length !== 1 ? "s" : ""})
            </span>
          </button>

          {showDetailed && (
            <div style={{ border: "1px solid var(--line)", borderRadius: "var(--r-lg)", padding: 16, background: "var(--surface)" }}>
              <Timeline faults={visibleFaults} sessionDurationMs={sessionDurationMs} timeOrigin={timeOrigin} />
              <p className="vn-muted" style={{ fontSize: 12, marginTop: 8, marginBottom: 0 }}>
                Solid bars = sustained faults ({">"} 0.5s). Faded bars = brief blips ({"<"} 0.5s).
              </p>
            </div>
          )}
        </>
      )}
    </main>
  );
}
