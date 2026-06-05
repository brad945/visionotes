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

  if (loading) return <main style={{ padding: "32px 0" }}>Loading sessions…</main>;
  if (error) return <main style={{ padding: "32px 0", color: "red" }}>Error: {error}</main>;

  return (
    <main style={{ padding: "32px 0" }}>
      <h1>Session History</h1>

      {sessions.length === 0 ? (
        <p style={{ color: "#888" }}>No sessions yet. Go to <Link to="/">Practice</Link> to start one.</p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 15 }}>
          <thead>
            <tr style={{ borderBottom: "2px solid #ddd", textAlign: "left" }}>
              <th style={{ padding: "8px 12px" }}>Date</th>
              <th style={{ padding: "8px 12px" }}>Duration</th>
              <th style={{ padding: "8px 12px" }}>Faults</th>
              <th style={{ padding: "8px 12px" }}></th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((s) => (
              <tr key={s.id} style={{ borderBottom: "1px solid #eee" }}>
                <td style={{ padding: "8px 12px" }}>{formatDate(s.started_at)}</td>
                <td style={{ padding: "8px 12px" }}>{formatDuration(s.duration_seconds)}</td>
                <td style={{ padding: "8px 12px" }}>{s.total_faults}</td>
                <td style={{ padding: "8px 12px" }}>
                  <Link to={`/history/${s.id}`} style={{ color: "#0066cc" }}>
                    View
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
