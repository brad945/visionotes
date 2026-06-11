import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { listSessions } from "../api";

function formatDuration(seconds) {
  if (seconds == null) return "—";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function formatDate(iso) {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function History() {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    listSessions()
      .then(setSessions)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <main style={{ padding: "32px 0" }} className="vn-muted">Loading sessions…</main>;
  if (error) return <main style={{ padding: "32px 0", color: "var(--signal-deep)" }}>Error: {error}</main>;

  const thStyle = { padding: "10px 12px", textAlign: "left" };
  const tdStyle = { padding: "12px 12px", verticalAlign: "middle" };

  return (
    <main style={{ padding: "32px 0" }}>
      <p className="vn-label" style={{ marginBottom: 6 }}>History</p>
      <h1 style={{ marginBottom: 20 }}>Session History</h1>

      {sessions.length === 0 ? (
        <p className="vn-muted">No sessions yet. Go to <Link to="/">Practice</Link> to start one.</p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.95rem" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--line-strong)" }}>
              <th className="vn-label" style={thStyle}>Date</th>
              <th className="vn-label" style={thStyle}>Duration</th>
              <th className="vn-label" style={thStyle}>Faults</th>
              <th style={thStyle}></th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((s) => (
              <tr key={s.id} style={{ borderBottom: "1px solid var(--line)" }}>
                <td style={tdStyle}>{formatDate(s.started_at)}</td>
                <td style={tdStyle} className="vn-data">{formatDuration(s.duration_seconds)}</td>
                <td style={tdStyle} className="vn-data">{s.total_faults}</td>
                <td style={{ ...tdStyle, textAlign: "right" }}>
                  <Link to={`/history/${s.id}`} style={{ fontWeight: 500 }}>
                    View →
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
