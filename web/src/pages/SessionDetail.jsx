import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { getSession } from "../api";

function formatDuration(seconds) {
  if (seconds == null) return "—";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function formatTimestamp(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}:${String(rem).padStart(2, "0")}`;
}

export default function SessionDetail() {
  const { sessionId } = useParams();
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    getSession(sessionId)
      .then(setSession)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [sessionId]);

  if (loading) return <main style={{ padding: "32px 0" }}>Loading…</main>;
  if (error) return <main style={{ padding: "32px 0", color: "red" }}>Error: {error}</main>;

  const faults = session.fault_events || [];

  // Count faults by type+hand
  const summary = {};
  for (const f of faults) {
    const key = `${f.hand ?? ""} ${f.fault_type}`.trim();
    summary[key] = (summary[key] || 0) + 1;
  }

  return (
    <main style={{ padding: "32px 0" }}>
      <Link to="/history" style={{ color: "#0066cc", fontSize: 14 }}>← Back to History</Link>

      <h1 style={{ marginTop: 12 }}>Session Detail</h1>

      <div style={{ display: "flex", gap: 32, marginBottom: 24, fontSize: 15 }}>
        <div>
          <strong>Started:</strong>{" "}
          {new Date(session.started_at).toLocaleString()}
        </div>
        <div>
          <strong>Duration:</strong> {formatDuration(session.duration_seconds)}
        </div>
        <div>
          <strong>Total faults:</strong> {session.total_faults}
        </div>
      </div>

      {/* Fault summary */}
      {Object.keys(summary).length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <h2 style={{ fontSize: 18 }}>Fault Breakdown</h2>
          <div style={{ display: "flex", gap: 16 }}>
            {Object.entries(summary).map(([label, count]) => (
              <div
                key={label}
                style={{
                  background: "#fff3f3",
                  border: "1px solid #ffcccc",
                  borderRadius: 6,
                  padding: "8px 16px",
                  fontSize: 14,
                }}
              >
                <strong style={{ textTransform: "capitalize" }}>{label.replace("_", " ")}</strong>
                <div style={{ fontSize: 24, fontWeight: 700, color: "#cc3333" }}>{count}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Fault event log */}
      <h2 style={{ fontSize: 18 }}>Fault Events</h2>
      {faults.length === 0 ? (
        <p style={{ color: "#888" }}>No faults recorded — nice session!</p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          <thead>
            <tr style={{ borderBottom: "2px solid #ddd", textAlign: "left" }}>
              <th style={{ padding: "6px 12px" }}>Time</th>
              <th style={{ padding: "6px 12px" }}>Type</th>
              <th style={{ padding: "6px 12px" }}>Hand</th>
            </tr>
          </thead>
          <tbody>
            {faults.map((f) => (
              <tr key={f.id} style={{ borderBottom: "1px solid #eee" }}>
                <td style={{ padding: "6px 12px", fontFamily: "monospace" }}>
                  {formatTimestamp(f.timestamp_ms)}
                </td>
                <td style={{ padding: "6px 12px", textTransform: "capitalize" }}>
                  {f.fault_type.replace("_", " ")}
                </td>
                <td style={{ padding: "6px 12px", textTransform: "capitalize" }}>
                  {f.hand ?? "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
