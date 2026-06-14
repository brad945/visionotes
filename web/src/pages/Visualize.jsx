import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { getSession, listSessions } from "../api";

const SIGNIFICANT_THRESHOLD_MS = 500;

// Saved session groups (per-browser via localStorage).
const GROUPS_KEY = "vn-session-groups";
function loadGroups() {
  try {
    const v = JSON.parse(localStorage.getItem(GROUPS_KEY));
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
function persistGroups(groups) {
  try {
    localStorage.setItem(GROUPS_KEY, JSON.stringify(groups));
  } catch {
    /* storage unavailable */
  }
}

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
  const [searchParams] = useSearchParams();
  const [savedGroups, setSavedGroups] = useState(loadGroups);
  const [naming, setNaming] = useState(false);
  const [groupName, setGroupName] = useState("");

  function saveGroup() {
    const ids = [...selectedIds];
    if (!ids.length) return;
    const name = groupName.trim() || `Group of ${ids.length}`;
    const group = {
      id: (crypto.randomUUID && crypto.randomUUID()) || String(Date.now()),
      name,
      ids,
      savedAt: new Date().toISOString(),
    };
    const next = [group, ...savedGroups];
    setSavedGroups(next);
    persistGroups(next);
    setNaming(false);
    setGroupName("");
  }

  function loadGroup(group) {
    const existing = new Set(sessions.map((s) => s.id));
    setSelectedIds(new Set(group.ids.filter((id) => existing.has(id))));
  }

  function deleteGroup(id) {
    const next = savedGroups.filter((g) => g.id !== id);
    setSavedGroups(next);
    persistGroups(next);
  }

  useEffect(() => {
    // Sessions chosen in the History tab arrive as ?ids=a,b,c — pre-select those;
    // otherwise default to the 5 most recent.
    const requested = (searchParams.get("ids") || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    listSessions()
      .then((rows) => {
        setSessions(rows);
        const ids = new Set(rows.map((r) => r.id));
        const preselect = requested.filter((id) => ids.has(id));
        setSelectedIds(
          new Set(preselect.length ? preselect : rows.slice(0, 5).map((session) => session.id))
        );
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

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

  if (loading) return <main style={{ padding: "32px 0" }} className="vn-muted">Loading growth data...</main>;
  if (error) return <main style={{ padding: "32px 0", color: "var(--signal-deep)" }}>Error: {error}</main>;

  return (
    <main style={{ padding: "32px 0" }}>
      <p className="vn-label" style={{ marginBottom: 6 }}>Growth</p>
      <div style={{ display: "flex", alignItems: "end", justifyContent: "space-between", gap: 16, marginBottom: 18, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ margin: 0 }}>Visualize Growth</h1>
          <p className="vn-muted" style={{ margin: "8px 0 0" }}>
            Choose sessions, compare fault rate, and spot what is improving.
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span className="vn-data" style={{ color: "var(--ink-muted)", fontSize: 13 }}>
            {selectedIds.size} selected{loadingDetails ? " / loading..." : ""}
          </span>
          {selectedIds.size > 0 && !naming && (
            <button
              type="button"
              className="vn-btn vn-btn--primary"
              onClick={() => {
                setGroupName(`Group of ${selectedIds.size}`);
                setNaming(true);
              }}
            >
              Save group
            </button>
          )}
        </div>
      </div>

      {naming && (
        <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
          <input
            className="vn-input"
            style={{ maxWidth: 260 }}
            value={groupName}
            onChange={(e) => setGroupName(e.target.value)}
            placeholder="Group name"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") saveGroup();
              if (e.key === "Escape") { setNaming(false); setGroupName(""); }
            }}
          />
          <button type="button" className="vn-btn vn-btn--primary" onClick={saveGroup}>Save</button>
          <button type="button" className="vn-btn vn-btn--ghost" onClick={() => { setNaming(false); setGroupName(""); }}>
            Cancel
          </button>
        </div>
      )}

      {savedGroups.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 18 }}>
          <span className="vn-label">Saved</span>
          {savedGroups.map((g) => (
            <span
              key={g.id}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                border: "1px solid var(--line)",
                borderRadius: "var(--r-pill)",
                padding: "3px 4px 3px 12px",
                background: "var(--surface)",
              }}
            >
              <button
                type="button"
                onClick={() => loadGroup(g)}
                title={`Load "${g.name}"`}
                style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: "var(--ink)", font: "inherit" }}
              >
                {g.name} <span className="vn-muted">({g.ids.length})</span>
              </button>
              <button
                type="button"
                onClick={() => deleteGroup(g.id)}
                aria-label={`Delete saved group ${g.name}`}
                style={{ background: "none", border: "none", padding: "0 4px", cursor: "pointer", color: "var(--ink-muted)", fontSize: 16, lineHeight: 1 }}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      {sessions.length === 0 ? (
        <p className="vn-muted">No sessions yet. Go to <Link to="/">Practice</Link> to start one.</p>
      ) : (
        <>
          <SessionPicker sessions={sessions} selectedIds={selectedIds} onToggle={toggleSession} />

          {selectedSessions.length === 0 ? (
            <div className="vn-card vn-muted">
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
                border: `1px solid ${selected ? "var(--accent)" : "var(--line)"}`,
                borderRadius: "var(--r-lg)",
                padding: "10px 12px",
                background: selected ? "var(--surface)" : "var(--paper)",
                cursor: "pointer",
                opacity: selected ? 1 : 0.65,
                transition: "opacity 140ms var(--ease-out), border-color 140ms var(--ease-out)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input
                  type="checkbox"
                  checked={selected}
                  onChange={() => onToggle(session.id)}
                  className="vn-accent-control"
                  style={{ width: 16, height: 16, margin: 0 }}
                />
                <strong style={{ fontSize: 13 }}>{formatDate(session.started_at)}</strong>
              </div>
              <div className="vn-data" style={{ display: "flex", justifyContent: "space-between", marginTop: 8, color: "var(--ink-muted)", fontSize: 12 }}>
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

  const momentumTone = !previous || steady
    ? "var(--ink)"
    : improving
      ? "var(--positive-deep)"
      : "var(--signal-deep)";

  const metrics = [
    {
      label: "Latest pace",
      value: `${formatRate(latest?.rate || 0)}/min`,
      note: latest ? formatDate(latest.started_at) : "No session",
      tone: "var(--ink)",
    },
    {
      label: "Momentum",
      value: previous ? `${delta > 0 ? "+" : ""}${formatRate(delta)}/min` : "New baseline",
      note: !previous ? "Select more logs" : steady ? "Holding steady" : improving ? "Fewer faults than last" : "More faults than last",
      tone: momentumTone,
    },
    {
      label: "Best selected",
      value: `${formatRate(bestSession?.rate || 0)}/min`,
      note: bestSession ? formatDate(bestSession.started_at) : "No session",
      tone: "var(--ink)",
    },
  ];

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 12, marginBottom: 16 }}>
      {metrics.map((metric) => (
        <div key={metric.label} style={{ border: "1px solid var(--line)", borderRadius: "var(--r-lg)", padding: 14, background: "var(--surface)" }}>
          <div className="vn-label">{metric.label}</div>
          <div className="vn-data" style={{ fontSize: 28, fontWeight: 700, marginTop: 6, color: metric.tone }}>{metric.value}</div>
          <div className="vn-muted" style={{ fontSize: 12, marginTop: 2 }}>{metric.note}</div>
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
    <section style={{ border: "1px solid var(--line)", borderRadius: "var(--r-lg)", background: "var(--surface)", padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 8 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: "1.125rem" }}>Fault Pace Trend</h2>
          <p className="vn-muted" style={{ margin: "4px 0 0", fontSize: 13 }}>Lower is better: sustained faults per minute.</p>
        </div>
        <div className="vn-label" style={{ whiteSpace: "nowrap" }}>Oldest → newest</div>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} style={{ width: "100%", display: "block" }} role="img" aria-label="Fault pace trend">
        <text x="18" y={padTop + chartHeight / 2} textAnchor="middle" fontSize="12" style={{ fill: "var(--ink-muted)" }} transform={`rotate(-90 18 ${padTop + chartHeight / 2})`}>
          faults / min
        </text>
        {yTicks.map((value) => {
          const y = padTop + chartHeight - (value / maxRate) * chartHeight;
          return (
            <g key={value}>
              <line x1={padLeft} x2={width - padRight} y1={y} y2={y} style={{ stroke: "var(--line)" }} />
              <text x={padLeft - 10} y={y + 4} textAnchor="end" fontSize="11" style={{ fill: "var(--ink-muted)", fontFamily: "var(--font-mono)" }}>
                {formatRate(value)}
              </text>
            </g>
          );
        })}
        <line x1={padLeft} x2={width - padRight} y1={padTop + chartHeight} y2={padTop + chartHeight} style={{ stroke: "var(--line-strong)" }} />
        <line x1={padLeft} x2={padLeft} y1={padTop} y2={padTop + chartHeight} style={{ stroke: "var(--line-strong)" }} />
        <path d={path} fill="none" style={{ stroke: "var(--accent)" }} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        {points.map((point, index) => (
          <g key={point.session.id}>
            <circle cx={point.x} cy={point.y} r="6" style={{ fill: "var(--surface)", stroke: "var(--accent)" }} strokeWidth="3" />
            <text x={point.x} y={point.y - 14} textAnchor="middle" fontSize="12" style={{ fill: "var(--ink)", fontFamily: "var(--font-mono)", fontWeight: 600 }}>
              {formatRate(point.session.rate)}
            </text>
            <line x1={point.x} x2={point.x} y1={padTop + chartHeight} y2={padTop + chartHeight + 5} style={{ stroke: "var(--line-strong)" }} />
            <text x={point.x} y={padTop + chartHeight + 20} textAnchor="middle" fontSize="11" style={{ fill: "var(--ink-muted)", fontFamily: "var(--font-mono)", fontWeight: 600 }}>
              S{index + 1}
            </text>
            <text x={point.x} y={padTop + chartHeight + 35} textAnchor="middle" fontSize="10" style={{ fill: "var(--ink-muted)" }}>
              {shortDate(point.session.started_at)}
            </text>
          </g>
        ))}
        <text x={padLeft + chartWidth / 2} y={height - 4} textAnchor="middle" fontSize="12" style={{ fill: "var(--ink-muted)" }}>
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
    <section style={{ border: "1px solid var(--line)", borderRadius: "var(--r-lg)", background: "var(--surface)", padding: 16 }}>
      <h2 style={{ margin: 0, fontSize: "1.125rem" }}>What To Train Next</h2>
      <p className="vn-muted" style={{ margin: "4px 0 14px", fontSize: 13 }}>Largest bars are where practice time is leaking.</p>
      <div style={{ display: "grid", gap: 12 }}>
        {totals.map((item) => (
          <div key={item.key}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
              <InitialsBadge>{item.initials}</InitialsBadge>
              <span style={{ fontSize: 13, color: "var(--ink-muted)", flex: 1 }}>{item.label}</span>
              <strong className="vn-data" style={{ fontSize: 12 }}>{(item.totalMs / 1000).toFixed(1)}s</strong>
            </div>
            <div style={{ height: 10, background: "var(--surface-sunken)", borderRadius: 999, overflow: "hidden" }}>
              <div style={{ width: `${Math.max(2, (item.totalMs / maxMs) * 100)}%`, height: "100%", background: "var(--signal)", borderRadius: 999 }} />
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
    <section style={{ border: "1px solid var(--line)", borderRadius: "var(--r-lg)", background: "var(--surface)", padding: 16 }}>
      <h2 style={{ margin: 0, fontSize: "1.125rem" }}>Session Race</h2>
      <p className="vn-muted" style={{ margin: "4px 0 14px", fontSize: 13 }}>X-axis is sustained faults per minute. Shorter bars win.</p>
      <div style={{ display: "grid", gridTemplateColumns: "86px 1fr 48px", columnGap: 10, rowGap: 9, alignItems: "center" }}>
        <div />
        <div style={{ position: "relative", height: 24, borderBottom: "1px solid var(--line-strong)" }}>
          {ticks.map((tick) => (
            <span
              key={tick}
              className="vn-data"
              style={{
                position: "absolute",
                left: `${(tick / maxRate) * 100}%`,
                bottom: 0,
                transform: "translateX(-50%)",
                color: "var(--ink-muted)",
                fontSize: 10,
              }}
            >
              {formatRate(tick)}
            </span>
          ))}
          <span className="vn-label" style={{ position: "absolute", right: 0, top: -2, fontSize: 10 }}>faults/min</span>
        </div>
        <div />
        {sessions.map((session) => (
          <div key={session.id} style={{ display: "contents" }}>
            <div style={{ color: "var(--ink-muted)", fontSize: 12, whiteSpace: "nowrap" }}>{shortDate(session.started_at)}</div>
            <div style={{ height: 18, background: "var(--surface-sunken)", borderRadius: 999, overflow: "hidden", position: "relative" }}>
              {ticks.slice(1).map((tick) => (
                <span
                  key={tick}
                  style={{
                    position: "absolute",
                    left: `${(tick / maxRate) * 100}%`,
                    top: 0,
                    bottom: 0,
                    width: 1,
                    background: "var(--line)",
                  }}
                />
              ))}
              <div style={{
                width: `${Math.max(4, (session.rate / maxRate) * 100)}%`,
                height: "100%",
                background: "var(--signal)",
                borderRadius: 999,
                position: "relative",
                zIndex: 1,
              }} />
            </div>
            <strong className="vn-data" style={{ fontSize: 12, textAlign: "right" }}>{formatRate(session.rate)}</strong>
          </div>
        ))}
      </div>
    </section>
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
