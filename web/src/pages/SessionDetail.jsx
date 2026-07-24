import { useEffect, useState, useRef, useCallback } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { getSession, deleteSession } from "../api";
import ConfirmDialog from "../components/ConfirmDialog";

const SIGNIFICANT_THRESHOLD_MS = 500;

function cssVar(name, fallback = "") {
  if (typeof window === "undefined") return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

const FAULT_VISUAL = {
  accent: "var(--signal)",
  fill: "var(--signal)",
  borderStyle: "solid",
  radius: 5,
};

function faultVisual() { return FAULT_VISUAL; }

function visualSwatchStyle(visual, size = 14) {
  return {
    width: size, height: size, borderRadius: visual.radius,
    background: visual.fill, border: `2px ${visual.borderStyle} ${visual.accent}`,
    display: "inline-block", boxSizing: "border-box",
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

// --- Timeline -------------------------------------------------------------------

function Timeline({ faults, sessionDurationMs, timeOrigin, playheadMs, onSeek }) {
  const canvasRef = useRef(null);
  const barHitboxesRef = useRef([]);
  const [hoveredBar, setHoveredBar] = useState(null);
  const draggingRef = useRef(false);

  // Convert canvas-local x → time ms
  const xToMs = useCallback((x, rect) => {
    const labelWidth = 130;
    const chartLeft = labelWidth + 8;
    const chartWidth = rect.width - chartLeft - 16;
    const frac = Math.max(0, Math.min(1, (x - chartLeft) / chartWidth));
    return frac * sessionDurationMs;
  }, [sessionDurationMs]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

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

    const palette = {
      fill: cssVar("--signal", "#c2410c"),
      laneEven: cssVar("--surface-sunken", "#eef1f1"),
      laneOdd: cssVar("--surface", "#ffffff"),
      tickMinor: cssVar("--line", "#dde1e1"),
      tickMajor: cssVar("--line-strong", "#c4c9c9"),
      label: cssVar("--ink", "#16191b"),
      axis: cssVar("--ink-muted", "#565c61"),
      barText: cssVar("--on-signal", "#ffffff"),
      playhead: cssVar("--accent", "#0e7c86"),
    };

    const lanes = {};
    for (const f of faults) {
      const key = `${f.hand ?? ""}_${f.fault_type}`;
      if (!lanes[key]) lanes[key] = { label: faultLabel(f.fault_type, f.hand), visual: faultVisual(), events: [] };
      lanes[key].events.push(f);
    }
    const laneKeys = Object.keys(lanes).sort();
    const labelWidth = 130;
    const chartLeft = labelWidth + 8;
    const chartWidth = W - chartLeft - 16;
    const laneHeight = Math.min(32, (H - 36) / Math.max(laneKeys.length, 1));
    const topPad = 8;
    const lanesBottom = topPad + laneKeys.length * laneHeight;
    const totalSeconds = Math.max(1, Math.ceil(sessionDurationMs / 1000));
    const secondsPerLabel = Math.max(1, Math.ceil(32 / (chartWidth / totalSeconds)));

    // Lane backgrounds
    for (let i = 0; i < laneKeys.length; i++) {
      const y = topPad + i * laneHeight;
      ctx.fillStyle = i % 2 === 0 ? palette.laneEven : palette.laneOdd;
      ctx.fillRect(chartLeft, y, chartWidth, laneHeight);
    }

    // Tick lines
    for (let second = 0; second <= totalSeconds; second++) {
      const tickMs = Math.min(second * 1000, sessionDurationMs);
      const x = chartLeft + (chartWidth * tickMs) / sessionDurationMs;
      const isMinute = second > 0 && second % 60 === 0;
      const isEndpoint = second === 0 || second === totalSeconds;
      ctx.strokeStyle = isMinute || isEndpoint ? palette.tickMajor : palette.tickMinor;
      ctx.lineWidth = isMinute || isEndpoint ? 1.25 : 1;
      ctx.beginPath(); ctx.moveTo(x, topPad); ctx.lineTo(x, lanesBottom); ctx.stroke();
    }
    ctx.lineWidth = 1;

    // Lanes + fault bars
    for (let i = 0; i < laneKeys.length; i++) {
      const lane = lanes[laneKeys[i]];
      const y = topPad + i * laneHeight;
      ctx.fillStyle = palette.label;
      ctx.font = '12px "IBM Plex Sans", system-ui, sans-serif';
      ctx.fillText(lane.label, 4, y + laneHeight / 2 + 4);

      for (const ev of lane.events) {
        const startFrac = (ev.timestamp_ms - timeOrigin) / sessionDurationMs;
        const durFrac = (ev.value || 0) / sessionDurationMs;
        const barX = chartLeft + startFrac * chartWidth;
        const barW = Math.max(2, durFrac * chartWidth);
        const alpha = (ev.value || 0) >= SIGNIFICANT_THRESHOLD_MS ? 0.95 : 0.38;
        const resolvedVisual = { fill: palette.fill, accent: palette.fill, radius: lane.visual.radius, textColor: palette.barText };
        drawFaultBar(ctx, barX, y + 3, barW, laneHeight - 6, resolvedVisual, alpha, "");

        const startMs = ev.timestamp_ms - timeOrigin;
        const endMs = startMs + (ev.value || 0);
        barHitboxes.push({ x1: barX - 3, x2: barX + barW + 3, y1: y + 1, y2: y + laneHeight - 1, label: lane.label, visual: lane.visual, startMs, endMs, durationMs: ev.value || 0 });
      }
    }
    barHitboxesRef.current = barHitboxes;

    // Time axis labels
    ctx.fillStyle = palette.axis;
    ctx.font = '500 12px "IBM Plex Mono", ui-monospace, monospace';
    for (let second = 0; second <= totalSeconds; second++) {
      const shouldLabel = second === 0 || second === totalSeconds || second % secondsPerLabel === 0;
      if (!shouldLabel) continue;
      const tickMs = Math.min(second * 1000, sessionDurationMs);
      const x = chartLeft + (chartWidth * tickMs) / sessionDurationMs;
      const label = secondTickLabel(second);
      const textWidth = ctx.measureText(label).width;
      const labelX = Math.min(chartLeft + chartWidth - textWidth, Math.max(chartLeft, x - textWidth / 2));
      ctx.fillText(label, labelX, lanesBottom + 16);
    }

    // Playhead — drawn last so it's always on top
    if (playheadMs != null && sessionDurationMs > 0) {
      const phX = chartLeft + (chartWidth * Math.min(playheadMs, sessionDurationMs)) / sessionDurationMs;
      ctx.save();
      ctx.strokeStyle = palette.playhead;
      ctx.lineWidth = 2;
      ctx.setLineDash([]);
      ctx.beginPath(); ctx.moveTo(phX, topPad - 2); ctx.lineTo(phX, lanesBottom + 2); ctx.stroke();
      // Diamond handle at top
      ctx.fillStyle = palette.playhead;
      ctx.beginPath();
      ctx.moveTo(phX, topPad - 7);
      ctx.lineTo(phX + 5, topPad - 2);
      ctx.lineTo(phX, topPad + 3);
      ctx.lineTo(phX - 5, topPad - 2);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }, [faults, sessionDurationMs, timeOrigin, playheadMs]);

  const seekFromEvent = useCallback((e) => {
    const canvas = canvasRef.current;
    if (!canvas || !onSeek) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    onSeek(xToMs(x, rect));
  }, [onSeek, xToMs]);

  const handleMouseDown = useCallback((e) => {
    draggingRef.current = true;
    seekFromEvent(e);
  }, [seekFromEvent]);

  const handleMouseMove = useCallback((e) => {
    if (draggingRef.current) { seekFromEvent(e); return; }
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const hit = barHitboxesRef.current.find((box) => x >= box.x1 && x <= box.x2 && y >= box.y1 && y <= box.y2);
    if (!hit) { setHoveredBar(null); return; }
    setHoveredBar({ ...hit, x: Math.min(rect.width - 12, Math.max(12, x)), y: Math.max(12, y) });
  }, [seekFromEvent]);

  const handleMouseUp = useCallback(() => { draggingRef.current = false; }, []);
  const handleMouseLeave = useCallback(() => { draggingRef.current = false; setHoveredBar(null); }, []);

  useEffect(() => {
    window.addEventListener("mouseup", handleMouseUp);
    return () => window.removeEventListener("mouseup", handleMouseUp);
  }, [handleMouseUp]);

  useEffect(() => {
    draw();
    window.addEventListener("resize", draw);
    const themeObserver = new MutationObserver(draw);
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => { window.removeEventListener("resize", draw); themeObserver.disconnect(); };
  }, [draw]);

  const laneCount = new Set(faults.map((f) => `${f.hand}_${f.fault_type}`)).size;
  const height = Math.max(80, 8 + laneCount * 32 + 28);

  return (
    <div style={{ position: "relative" }}>
      <canvas
        ref={canvasRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        style={{ width: "100%", height, display: "block", cursor: "crosshair" }}
      />
      {/* Hover tooltip */}
      <div style={{
        position: "absolute",
        left: hoveredBar ? hoveredBar.x : 0,
        top: hoveredBar ? hoveredBar.y : 0,
        transform: hoveredBar ? "translate(-50%, calc(-100% - 10px)) scale(1)" : "translate(-50%, calc(-100% - 4px)) scale(0.96)",
        opacity: hoveredBar ? 1 : 0,
        pointerEvents: "none",
        transition: "opacity 120ms ease, transform 120ms ease",
        background: "var(--ink)", color: "var(--surface)",
        borderRadius: "var(--r-md)", boxShadow: "0 8px 22px rgba(16,25,28,0.28)",
        padding: "8px 10px", minWidth: 180, zIndex: 2, fontSize: 12, lineHeight: 1.35,
      }}>
        {hoveredBar && (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 700, marginBottom: 3 }}>
              <span style={visualSwatchStyle(hoveredBar.visual, 10)} />
              {hoveredBar.label}
            </div>
            <div className="vn-data">{formatPreciseSecond(hoveredBar.startMs)} → {formatPreciseSecond(hoveredBar.endMs)}</div>
            <div style={{ color: "rgba(255,255,255,0.7)" }}>
              {formatPreciseSecond(hoveredBar.durationMs)} {hoveredBar.durationMs >= SIGNIFICANT_THRESHOLD_MS ? "sustained fault" : "brief blip"}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// --- "At this moment" panel -----------------------------------------------------

function PlayheadPanel({ faults, playheadMs, timeOrigin, sessionDurationMs }) {
  const timeLabel = secondTickLabel(Math.round(playheadMs / 1000));

  // Find all faults active at the playhead
  const active = faults.filter((f) => {
    const start = f.timestamp_ms - timeOrigin;
    const end = start + (f.value || 0);
    return playheadMs >= start && playheadMs <= end;
  });

  // Find the nearest upcoming fault
  const upcoming = faults
    .map((f) => ({ ...f, startMs: f.timestamp_ms - timeOrigin }))
    .filter((f) => f.startMs > playheadMs)
    .sort((a, b) => a.startMs - b.startMs)[0];

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap",
      padding: "10px 14px", background: "var(--surface-sunken)",
      borderRadius: "0 0 var(--r-lg) var(--r-lg)", borderTop: "1px solid var(--line)",
      fontSize: 13, minHeight: 44,
    }}>
      <span className="vn-data" style={{ color: "var(--accent)", fontWeight: 700, minWidth: 40 }}>
        {timeLabel}
      </span>
      {active.length > 0 ? (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {active.map((f, i) => (
            <span key={i} style={{
              display: "inline-flex", alignItems: "center", gap: 5,
              background: "var(--signal)", color: "var(--on-signal)",
              borderRadius: 5, padding: "2px 8px", fontWeight: 600, fontSize: 12,
            }}>
              {faultLabel(f.fault_type, f.hand)}
            </span>
          ))}
        </div>
      ) : (
        <span style={{ color: "var(--ink-muted)" }}>
          {upcoming
            ? <>No fault — next in <span className="vn-data">{formatPreciseSecond(upcoming.startMs - playheadMs)}</span></>
            : <span style={{ color: "var(--positive-deep)", fontWeight: 500 }}>Clean — no more faults</span>
          }
        </span>
      )}
      <span style={{ marginLeft: "auto", color: "var(--ink-muted)", fontSize: 12 }}>
        click or drag timeline to scrub
      </span>
    </div>
  );
}

function faultKey(fault) {
  return `${fault.hand ?? ""}_${fault.fault_type}`;
}

// --- Wrist diagram SVG ----------------------------------------------------------
// A side-profile arm: forearm enters from the left, meets the wrist joint, then
// the hand extends forward. `droop` (0–1) tilts the hand downward — 0 = neutral
// good arch, 1 = fully collapsed. Clearly labeled as an estimate.
function WristDiagram({ droop, label, sublabel, highlight }) {
  const W = 110, H = 80;
  // Forearm: fixed, enters from lower-left toward the wrist
  const wx = 58, wy = 38; // wrist pivot
  const fax = 8, fay = 62; // forearm far end
  // Hand direction: neutral = slight upward arch; collapsed = tilted down
  const neutralAngle = -0.18; // radians above horizontal (slight arch)
  const collapsedAngle = 0.52; // radians below horizontal (drooped)
  const handAngle = neutralAngle + droop * (collapsedAngle - neutralAngle);
  const handLen = 40;
  const hx = wx + Math.cos(handAngle) * handLen;
  const hy = wy + Math.sin(handAngle) * handLen;
  // Fingertip: curls slightly from the hand direction
  const ftLen = 16;
  const ftAngle = handAngle + 0.35 + droop * 0.2;
  const ftx = hx + Math.cos(ftAngle) * ftLen;
  const fty = hy + Math.sin(ftAngle) * ftLen;

  // Arc showing the wrist angle
  const arcR = 14;
  const arcStart = Math.atan2(fay - wy, fax - wx); // toward forearm
  const arcEnd = handAngle; // toward hand

  const arcPath = (() => {
    const x1 = wx + Math.cos(arcStart) * arcR;
    const y1 = wy + Math.sin(arcStart) * arcR;
    const x2 = wx + Math.cos(arcEnd) * arcR;
    const y2 = wy + Math.sin(arcEnd) * arcR;
    const large = Math.abs(arcEnd - arcStart) > Math.PI ? 1 : 0;
    return `M ${x1} ${y1} A ${arcR} ${arcR} 0 ${large} 1 ${x2} ${y2}`;
  })();

  const stroke = highlight ? "var(--signal)" : "var(--ink-muted)";
  const strokeW = highlight ? 2.5 : 2;

  return (
    <div style={{ textAlign: "center" }}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ display: "block", margin: "0 auto", overflow: "visible" }}>
        {/* Forearm */}
        <line x1={fax} y1={fay} x2={wx} y2={wy} stroke={stroke} strokeWidth={strokeW} strokeLinecap="round" />
        {/* Hand */}
        <line x1={wx} y1={wy} x2={hx} y2={hy} stroke={stroke} strokeWidth={strokeW} strokeLinecap="round" />
        {/* Fingertip */}
        <line x1={hx} y1={hy} x2={ftx} y2={fty} stroke={stroke} strokeWidth={strokeW * 0.7} strokeLinecap="round" />
        {/* Wrist joint dot */}
        <circle cx={wx} cy={wy} r={3.5} fill={stroke} />
        {/* Wrist angle arc */}
        <path d={arcPath} fill="none" stroke={highlight ? "var(--signal)" : "var(--line-strong)"} strokeWidth={1.5} strokeDasharray={highlight ? "none" : "3 2"} />
      </svg>
      <div style={{ fontSize: 13, fontWeight: 700, color: highlight ? "var(--signal)" : "var(--ink)", marginTop: 4 }}>{label}</div>
      <div style={{ fontSize: 11, color: "var(--ink-muted)", marginTop: 2 }}>{sublabel}</div>
    </div>
  );
}

// --- Session progress (before/after) -------------------------------------------
// Splits the session into first half vs second half and compares fault rates.
// Uses only the fault_events we already have — no extra data needed.
function SessionProgress({ allFaults, sessionDurationMs, timeOrigin }) {
  const significant = allFaults.filter((f) => (f.value || 0) >= SIGNIFICANT_THRESHOLD_MS);
  if (significant.length === 0 || sessionDurationMs < 30000) return null;

  const midMs = sessionDurationMs / 2;
  const halfMinutes = midMs / 60000;

  const firstHalf = significant.filter((f) => (f.timestamp_ms - timeOrigin) < midMs);
  const secondHalf = significant.filter((f) => (f.timestamp_ms - timeOrigin) >= midMs);

  const firstRate = halfMinutes > 0 ? firstHalf.length / halfMinutes : 0;
  const secondRate = halfMinutes > 0 ? secondHalf.length / halfMinutes : 0;
  const firstTotalMs = firstHalf.reduce((s, f) => s + (f.value || 0), 0);
  const secondTotalMs = secondHalf.reduce((s, f) => s + (f.value || 0), 0);

  // delta: negative = improved (fewer faults in second half)
  const improved = secondRate < firstRate;
  const deltaLabel = firstRate === 0
    ? null
    : `${Math.abs(Math.round((secondRate - firstRate) / firstRate * 100))}%`;

  // droop (0=good, 1=collapsed): map fault rate to droop. 0/min=0, 4+/min=1.
  const rateToDroop = (r) => Math.min(1, r / 4);
  const firstDroop = rateToDroop(firstRate);
  const secondDroop = rateToDroop(secondRate);

  const verdictColor = improved ? "var(--positive-deep)" : secondRate === firstRate ? "var(--ink-muted)" : "var(--signal-deep)";
  const verdict = improved
    ? `Fault rate dropped ${deltaLabel} in the second half — technique improving during this session.`
    : secondRate === firstRate
    ? "Fault rate was consistent across both halves."
    : `Fault rate rose ${deltaLabel} in the second half — fatigue may be affecting technique.`;

  return (
    <div style={{ marginBottom: 28 }}>
      <p className="vn-label" style={{ marginBottom: 10 }}>Session Progress</p>
      <div style={{
        border: "1px solid var(--line)", borderRadius: "var(--r-lg)",
        background: "var(--surface)", overflow: "hidden",
      }}>
        <div style={{ display: "flex", alignItems: "stretch", gap: 0 }}>
          {/* First half */}
          <div style={{ flex: 1, padding: "16px 20px", textAlign: "center" }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--ink-muted)", marginBottom: 12 }}>First half</div>
            <WristDiagram droop={firstDroop} label={`${firstHalf.length} fault${firstHalf.length !== 1 ? "s" : ""}`} sublabel={`${firstRate.toFixed(1)}/min · ${(firstTotalMs / 1000).toFixed(1)}s`} highlight={!improved && secondRate !== firstRate} />
          </div>

          {/* Arrow + delta */}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "0 8px", minWidth: 52 }}>
            <div style={{ fontSize: 20, color: "var(--line-strong)" }}>→</div>
            {deltaLabel && (
              <div style={{ marginTop: 4, fontSize: 12, fontWeight: 700, color: improved ? "var(--positive-deep)" : "var(--signal-deep)" }}>
                {improved ? "↓" : "↑"} {deltaLabel}
              </div>
            )}
          </div>

          {/* Second half */}
          <div style={{ flex: 1, padding: "16px 20px", textAlign: "center", borderLeft: "1px solid var(--line)" }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--ink-muted)", marginBottom: 12 }}>Second half</div>
            <WristDiagram droop={secondDroop} label={`${secondHalf.length} fault${secondHalf.length !== 1 ? "s" : ""}`} sublabel={`${secondRate.toFixed(1)}/min · ${(secondTotalMs / 1000).toFixed(1)}s`} highlight={improved} />
          </div>
        </div>

        {/* Verdict bar */}
        <div style={{ padding: "10px 20px", borderTop: "1px solid var(--line)", background: "var(--surface-sunken)", fontSize: 13, color: verdictColor, fontWeight: 500 }}>
          {verdict}
          <span style={{ color: "var(--ink-muted)", fontWeight: 400, fontSize: 11, marginLeft: 8 }}>
            (estimated from fault frequency — wrist diagrams are illustrative)
          </span>
        </div>
      </div>
    </div>
  );
}

// --- Main component -------------------------------------------------------------

export default function SessionDetail() {
  const { sessionId } = useParams();
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedFaultKeys, setSelectedFaultKeys] = useState(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [playheadMs, setPlayheadMs] = useState(0);
  const navigate = useNavigate();

  useEffect(() => {
    getSession(sessionId)
      .then(setSession)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [sessionId]);

  async function handleDelete() {
    setDeleting(true);
    setError(null);
    try {
      await deleteSession(sessionId);
      navigate("/history");
    } catch (e) {
      setError(`Delete failed: ${e.message}`);
      setDeleting(false);
      setConfirmOpen(false);
    }
  }

  useEffect(() => {
    setSelectedFaultKeys(new Set());
    setPlayheadMs(0);
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

  // Summary cards
  const summary = {};
  for (const f of significant) {
    const key = faultKey(f);
    if (!summary[key]) {
      summary[key] = { key, label: faultLabel(f.fault_type, f.hand), initials: faultInitials(f.fault_type, f.hand), visual: faultVisual(), count: 0, totalMs: 0 };
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
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  return (
    <main style={{ padding: "32px 0" }}>
      <Link to="/history" style={{ fontSize: 14 }}>← Back to History</Link>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, marginTop: 12 }}>
        <h1 style={{ margin: 0 }}>Session Detail</h1>
        <button type="button" className="vn-btn vn-btn--ghost" onClick={() => setConfirmOpen(true)}>Delete</button>
      </div>

      {error && <p style={{ color: "var(--signal-deep)", marginTop: 12, fontSize: "0.875rem" }}>{error}</p>}

      <ConfirmDialog
        open={confirmOpen}
        title="Delete this session?"
        message="This session and its fault data will be permanently removed. This can't be undone."
        confirmLabel="Delete"
        busy={deleting}
        onConfirm={handleDelete}
        onCancel={() => !deleting && setConfirmOpen(false)}
      />

      {/* Meta row */}
      <div style={{ display: "flex", gap: 32, flexWrap: "wrap", margin: "12px 0 24px", fontSize: "0.95rem" }}>
        <div><span className="vn-label">Started</span><div className="vn-data" style={{ marginTop: 2 }}>{new Date(session.started_at).toLocaleString()}</div></div>
        <div><span className="vn-label">Duration</span><div className="vn-data" style={{ marginTop: 2 }}>{formatDuration(session.duration_seconds)}</div></div>
        <div><span className="vn-label">Significant faults</span><div className="vn-data" style={{ marginTop: 2 }}>{significant.length}</div></div>
      </div>

      {/* Before/after progress */}
      <SessionProgress allFaults={allFaults} sessionDurationMs={sessionDurationMs} timeOrigin={timeOrigin} />

      {/* Summary cards */}
      {summaryItems.length > 0 ? (
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 28 }}>
          {summaryItems.map((s) => {
            const isSelected = selectedFaultKeys.has(s.key);
            const isDimmed = hasSummarySelection && !isSelected;
            const share = totalSignificantMs > 0 ? s.totalMs / totalSignificantMs : 0;
            const averageMs = s.count > 0 ? s.totalMs / s.count : 0;
            return (
              <div
                key={s.key}
                role="button" tabIndex={0} aria-pressed={isSelected}
                onClick={() => toggleFaultKey(s.key)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleFaultKey(s.key); } }}
                style={{
                  background: "var(--surface)", border: `1px solid ${isSelected ? "var(--signal)" : "var(--line)"}`,
                  borderRadius: "var(--r-lg)", padding: "12px 16px", minWidth: 180,
                  textAlign: "left", cursor: "pointer", font: "inherit", color: "inherit",
                  opacity: isDimmed ? 0.45 : 1,
                  transform: isSelected ? "translateY(-2px)" : "none",
                  boxShadow: isSelected ? "var(--shadow-lift)" : "none",
                  transition: "opacity 140ms var(--ease-out), transform 140ms var(--ease-out), box-shadow 140ms var(--ease-out), border-color 140ms var(--ease-out)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 13, color: "var(--ink-muted)" }}>
                    {s.label}
                  </div>
                  <input type="checkbox" checked={isSelected} onChange={() => toggleFaultKey(s.key)} onClick={(e) => e.stopPropagation()} aria-label={`Show only ${s.label}`} className="vn-accent-control" style={{ width: 18, height: 18, margin: 0, cursor: "pointer", flex: "0 0 auto" }} />
                </div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginTop: 8 }}>
                  <span className="vn-data" style={{ fontSize: 28, fontWeight: 700, color: "var(--signal)" }}>{s.count}</span>
                  <span className="vn-data" style={{ fontSize: 13, color: "var(--ink-muted)" }}>{(s.totalMs / 1000).toFixed(1)}s total</span>
                </div>
                <div style={{ height: 6, background: "var(--surface-sunken)", borderRadius: 999, overflow: "hidden", marginTop: 9 }}>
                  <div style={{ width: `${Math.max(3, Math.round(share * 100))}%`, height: "100%", background: "var(--signal)", borderRadius: 999 }} />
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
        <p style={{ color: "var(--positive-deep)", fontWeight: 500, marginBottom: 28 }}>No significant faults ({">"} 0.5s) — nice session!</p>
      )}

      {/* Timeline — always visible */}
      {allFaults.length > 0 ? (
        <div>
          <p className="vn-label" style={{ marginBottom: 10 }}>
            Fault Timeline
            {hasSummarySelection && (
              <span style={{ marginLeft: 8, fontWeight: 400, color: "var(--ink-muted)", textTransform: "none", letterSpacing: 0, fontSize: 12 }}>
                — filtered to selected fault type{selectedFaultKeys.size > 1 ? "s" : ""}
              </span>
            )}
          </p>
          <div style={{ border: "1px solid var(--line)", borderRadius: "var(--r-lg)", background: "var(--surface)", overflow: "hidden" }}>
            <div style={{ padding: "12px 16px 0" }}>
              <Timeline
                faults={visibleFaults}
                sessionDurationMs={sessionDurationMs}
                timeOrigin={timeOrigin}
                playheadMs={playheadMs}
                onSeek={setPlayheadMs}
              />
            </div>
            <PlayheadPanel
              faults={visibleFaults}
              playheadMs={playheadMs}
              timeOrigin={timeOrigin}
              sessionDurationMs={sessionDurationMs}
            />
          </div>
          <p className="vn-muted" style={{ fontSize: 12, marginTop: 8 }}>
            Solid bars = sustained faults ({">"} 0.5s). Faded bars = brief blips. Click a card above to filter.
          </p>
        </div>
      ) : (
        <p className="vn-muted">No fault events recorded for this session.</p>
      )}
    </main>
  );
}
