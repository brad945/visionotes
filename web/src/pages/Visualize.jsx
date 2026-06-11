import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { getSession, listSessions } from "../api";

const SIGNIFICANT_THRESHOLD_MS = 500;
const CATEGORY_ORDER = [
  { key: "left_arm_posture", hand: "left", fault_type: "arm_posture" },
  { key: "left_collapsed_wrist", hand: "left", fault_type: "collapsed_wrist" },
  { key: "right_arm_posture", hand: "right", fault_type: "arm_posture" },
  { key: "right_collapsed_wrist", hand: "right", fault_type: "collapsed_wrist" },
];

function faultKey(fault) {
  return `${fault.hand ?? ""}_${fault.fault_type}`;
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

function formatDate(iso) {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function shortDate(iso) {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function formatDuration(seconds) {
  if (seconds == null) return "0s";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function formatRate(value) {
  return Number.isFinite(value) ? value.toFixed(1) : "0.0";
}

function summarizeSession(session) {
  const significant = (session.fault_events || []).filter((event) => (event.value || 0) >= SIGNIFICANT_THRESHOLD_MS);
  const durationSeconds = Math.max(1, session.duration_seconds || 0);
  const totalMs = significant.reduce((sum, event) => sum + (event.value || 0), 0);
  const rate = significant.length / (durationSeconds / 60);
  const categories = {};

  for (const item of CATEGORY_ORDER) {
    categories[item.key] = {
      ...item,
      count: 0,
      totalMs: 0,
      label: faultLabel(item.fault_type, item.hand),
      initials: faultInitials(item.fault_type, item.hand),
    };
  }

  for (const event of significant) {
    const key = faultKey(event);
    if (!categories[key]) {
      categories[key] = {
        key,
        hand: event.hand,
        fault_type: event.fault_type,
        count: 0,
        totalMs: 0,
        label: faultLabel(event.fault_type, event.hand),
        initials: faultInitials(event.fault_type, event.hand),
      };
    }
    categories[key].count++;
    categories[key].totalMs += event.value || 0;
  }

  return {
    ...session,
    significantCount: significant.length,
    totalMs,
    rate,
    categories,
  };
}

export default function Visualize() {
  const [sessions, setSessions] = useState([]);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [details, setDetails] = useState({});
  const [loading, setLoading] = useState(true);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    listSessions()
      .then((rows) => {
        setSessions(rows);
        setSelectedIds(new Set(rows.slice(0, 5).map((session) => session.id)));
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const missing = [...selectedIds].filter((id) => !details[id]);
    if (missing.length === 0) return;

    setLoadingDetails(true);
    Promise.all(missing.map((id) => getSession(id)))
      .then((rows) => {
        setDetails((current) => {
          const next = { ...current };
          for (const row of rows) next[row.id] = row;
          return next;
        });
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoadingDetails(false));
  }, [selectedIds, details]);

  const selectedSessions = useMemo(() => {
    return sessions
      .filter((session) => selectedIds.has(session.id) && details[session.id])
      .map((session) => summarizeSession(details[session.id]))
      .reverse();
  }, [sessions, selectedIds, details]);

  const selectedNewestFirst = [...selectedSessions].reverse();
  const bestSession = selectedSessions.reduce((best, session) => (
    !best || session.rate < best.rate ? session : best
  ), null);
  const latest = selectedSessions[selectedSessions.length - 1];
  const previous = selectedSessions[selectedSessions.length - 2];
  const latestDelta = latest && previous ? latest.rate - previous.rate : 0;

  function toggleSession(id) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (loading) return <main style={{ padding: "32px 0" }}>Loading growth data...</main>;
  if (error) return <main style={{ padding: "32px 0", color: "red" }}>Error: {error}</main>;

  return (
    <main style={{ padding: "32px 0" }}>
      <div style={{ display: "flex", alignItems: "end", justifyContent: "space-between", gap: 16, marginBottom: 18 }}>
        <div>
          <h1 style={{ margin: 0 }}>Visualize Growth</h1>
          <p style={{ color: "#666", margin: "8px 0 0" }}>
            Choose sessions, compare fault rate, and spot what is improving.
          </p>
        </div>
        <span style={{ color: "#777", fontSize: 13 }}>
          {selectedIds.size} selected{loadingDetails ? " / loading..." : ""}
        </span>
      </div>

      {sessions.length === 0 ? (
        <p style={{ color: "#888" }}>No sessions yet. Go to <Link to="/">Practice</Link> to start one.</p>
      ) : (
        <>
          <SessionPicker sessions={sessions} selectedIds={selectedIds} onToggle={toggleSession} />

          {selectedSessions.length === 0 ? (
            <div style={{ border: "1px solid #e5e5e5", borderRadius: 8, padding: 18, color: "#777", background: "#fafafa" }}>
              Select at least one session to draw your growth view.
            </div>
          ) : (
            <>
              <MetricStrip latest={latest} previous={previous} bestSession={bestSession} delta={latestDelta} />
              <TrendPanel sessions={selectedSessions} />
              <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.1fr) minmax(280px, 0.9fr)", gap: 16, marginTop: 16 }}>
                <CategoryBreakdown sessions={selectedSessions} />
                <SessionRace sessions={selectedNewestFirst} />
              </div>
            </>
          )}
        </>
      )}
    </main>
  );
}

function SessionPicker({ sessions, selectedIds, onToggle }) {
  return (
    <section style={{ marginBottom: 18 }}>
      <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4 }}>
        {sessions.map((session) => {
          const selected = selectedIds.has(session.id);
          return (
            <label
              key={session.id}
              style={{
                minWidth: 172,
                border: selected ? "2px solid #333" : "1px solid #ddd",
                borderRadius: 8,
                padding: "10px 12px",
                background: selected ? "#fff" : "#fafafa",
                cursor: "pointer",
                opacity: selected ? 1 : 0.65,
                transition: "opacity 140ms ease, border-color 140ms ease",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input
                  type="checkbox"
                  checked={selected}
                  onChange={() => onToggle(session.id)}
                  style={{ width: 16, height: 16, margin: 0, accentColor: "#555" }}
                />
                <strong style={{ fontSize: 13 }}>{formatDate(session.started_at)}</strong>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, color: "#777", fontSize: 12 }}>
                <span>{formatDuration(session.duration_seconds)}</span>
                <span>{session.total_faults || 0} faults</span>
              </div>
            </label>
          );
        })}
      </div>
    </section>
  );
}

function MetricStrip({ latest, previous, bestSession, delta }) {
  const improving = previous && delta < 0;
  const steady = previous && Math.abs(delta) < 0.1;

  const metrics = [
    {
      label: "Latest pace",
      value: `${formatRate(latest?.rate || 0)}/min`,
      note: latest ? formatDate(latest.started_at) : "No session",
    },
    {
      label: "Momentum",
      value: previous ? `${delta > 0 ? "+" : ""}${formatRate(delta)}/min` : "New baseline",
      note: !previous ? "Select more logs" : steady ? "Holding steady" : improving ? "Fewer faults than last" : "More faults than last",
    },
    {
      label: "Best selected",
      value: `${formatRate(bestSession?.rate || 0)}/min`,
      note: bestSession ? formatDate(bestSession.started_at) : "No session",
    },
  ];

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 12, marginBottom: 16 }}>
      {metrics.map((metric) => (
        <div key={metric.label} style={{ border: "1px solid #e5e5e5", borderRadius: 8, padding: 14, background: "#fff" }}>
          <div style={{ color: "#777", fontSize: 12, textTransform: "uppercase", fontWeight: 700 }}>{metric.label}</div>
          <div style={{ fontSize: 30, fontWeight: 800, marginTop: 4 }}>{metric.value}</div>
          <div style={{ color: "#777", fontSize: 12, marginTop: 2 }}>{metric.note}</div>
        </div>
      ))}
    </div>
  );
}

function TrendPanel({ sessions }) {
  const maxRate = Math.max(1, ...sessions.map((session) => session.rate));
  const width = 760;
  const height = 260;
  const padLeft = 58;
  const padRight = 24;
  const padTop = 28;
  const padBottom = 52;
  const chartWidth = width - padLeft - padRight;
  const chartHeight = height - padTop - padBottom;
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((ratio) => maxRate * ratio);
  const points = sessions.map((session, index) => {
    const x = sessions.length === 1
      ? width / 2
      : padLeft + (index * chartWidth) / (sessions.length - 1);
    const y = padTop + chartHeight - (session.rate / maxRate) * chartHeight;
    return { x, y, session };
  });
  const path = points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");

  return (
    <section style={{ border: "1px solid #e5e5e5", borderRadius: 8, background: "#fff", padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 8 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18 }}>Fault Pace Trend</h2>
          <p style={{ margin: "4px 0 0", color: "#777", fontSize: 13 }}>Lower is better: sustained faults per minute.</p>
        </div>
        <div style={{ color: "#777", fontSize: 12 }}>Oldest {"->"} newest</div>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} style={{ width: "100%", display: "block" }} role="img" aria-label="Fault pace trend">
        <text x="18" y={padTop + chartHeight / 2} textAnchor="middle" fontSize="12" fontWeight="700" fill="#555" transform={`rotate(-90 18 ${padTop + chartHeight / 2})`}>
          faults / min
        </text>
        {yTicks.map((value) => {
          const y = padTop + chartHeight - (value / maxRate) * chartHeight;
          return (
            <g key={value}>
              <line x1={padLeft} x2={width - padRight} y1={y} y2={y} stroke="#eee" />
              <text x={padLeft - 10} y={y + 4} textAnchor="end" fontSize="11" fill="#666">
                {formatRate(value)}
              </text>
            </g>
          );
        })}
        <line x1={padLeft} x2={width - padRight} y1={padTop + chartHeight} y2={padTop + chartHeight} stroke="#aaa" />
        <line x1={padLeft} x2={padLeft} y1={padTop} y2={padTop + chartHeight} stroke="#aaa" />
        <path d={path} fill="none" stroke="#333" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
        {points.map((point, index) => (
          <g key={point.session.id}>
            <circle cx={point.x} cy={point.y} r="7" fill="#fff" stroke="#333" strokeWidth="3" />
            <text x={point.x} y={point.y - 14} textAnchor="middle" fontSize="12" fontWeight="700" fill="#555">
              {formatRate(point.session.rate)}
            </text>
            <line x1={point.x} x2={point.x} y1={padTop + chartHeight} y2={padTop + chartHeight + 5} stroke="#aaa" />
            <text x={point.x} y={padTop + chartHeight + 20} textAnchor="middle" fontSize="11" fontWeight="700" fill="#555">
              S{index + 1}
            </text>
            <text x={point.x} y={padTop + chartHeight + 35} textAnchor="middle" fontSize="10" fill="#777">
              {shortDate(point.session.started_at)}
            </text>
          </g>
        ))}
        <text x={padLeft + chartWidth / 2} y={height - 4} textAnchor="middle" fontSize="12" fontWeight="700" fill="#555">
          selected sessions
        </text>
      </svg>
    </section>
  );
}

function CategoryBreakdown({ sessions }) {
  const totals = CATEGORY_ORDER.map((category) => {
    const totalMs = sessions.reduce((sum, session) => sum + (session.categories[category.key]?.totalMs || 0), 0);
    const count = sessions.reduce((sum, session) => sum + (session.categories[category.key]?.count || 0), 0);
    return {
      ...category,
      label: faultLabel(category.fault_type, category.hand),
      initials: faultInitials(category.fault_type, category.hand),
      totalMs,
      count,
    };
  });
  const maxMs = Math.max(1, ...totals.map((item) => item.totalMs));

  return (
    <section style={{ border: "1px solid #e5e5e5", borderRadius: 8, background: "#fff", padding: 16 }}>
      <h2 style={{ margin: 0, fontSize: 18 }}>What To Train Next</h2>
      <p style={{ margin: "4px 0 14px", color: "#777", fontSize: 13 }}>Largest bars are where practice time is leaking.</p>
      <div style={{ display: "grid", gap: 12 }}>
        {totals.map((item) => (
          <div key={item.key}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
              <InitialsBadge>{item.initials}</InitialsBadge>
              <span style={{ fontSize: 13, color: "#555", flex: 1 }}>{item.label}</span>
              <strong style={{ fontSize: 12 }}>{(item.totalMs / 1000).toFixed(1)}s</strong>
            </div>
            <div style={{ height: 10, background: "#eee", borderRadius: 999, overflow: "hidden" }}>
              <div style={{ width: `${Math.max(2, (item.totalMs / maxMs) * 100)}%`, height: "100%", background: "#333", borderRadius: 999 }} />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function SessionRace({ sessions }) {
  const maxRate = Math.max(1, ...sessions.map((session) => session.rate));
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((ratio) => maxRate * ratio);

  return (
    <section style={{ border: "1px solid #e5e5e5", borderRadius: 8, background: "#fff", padding: 16 }}>
      <h2 style={{ margin: 0, fontSize: 18 }}>Session Race</h2>
      <p style={{ margin: "4px 0 14px", color: "#777", fontSize: 13 }}>X-axis is sustained faults per minute. Shorter bars win.</p>
      <div style={{ display: "grid", gridTemplateColumns: "86px 1fr 48px", columnGap: 10, rowGap: 9, alignItems: "center" }}>
        <div />
        <div style={{ position: "relative", height: 24, borderBottom: "1px solid #ccc" }}>
          {ticks.map((tick) => (
            <span
              key={tick}
              style={{
                position: "absolute",
                left: `${(tick / maxRate) * 100}%`,
                bottom: 0,
                transform: "translateX(-50%)",
                color: "#777",
                fontSize: 10,
              }}
            >
              {formatRate(tick)}
            </span>
          ))}
          <span style={{ position: "absolute", right: 0, top: -2, color: "#777", fontSize: 10 }}>faults/min</span>
        </div>
        <div />
        {sessions.map((session) => (
          <div key={session.id} style={{ display: "contents" }}>
            <div style={{ color: "#555", fontSize: 12, whiteSpace: "nowrap" }}>{shortDate(session.started_at)}</div>
            <div style={{ height: 18, background: "#f1f1f1", borderRadius: 999, overflow: "hidden", position: "relative" }}>
              {ticks.slice(1).map((tick) => (
                <span
                  key={tick}
                  style={{
                    position: "absolute",
                    left: `${(tick / maxRate) * 100}%`,
                    top: 0,
                    bottom: 0,
                    width: 1,
                    background: "#ddd",
                  }}
                />
              ))}
              <div style={{
                width: `${Math.max(4, (session.rate / maxRate) * 100)}%`,
                height: "100%",
                background: "#333",
                borderRadius: 999,
                position: "relative",
                zIndex: 1,
              }} />
            </div>
            <strong style={{ fontSize: 12, textAlign: "right" }}>{formatRate(session.rate)}</strong>
          </div>
        ))}
      </div>
    </section>
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
