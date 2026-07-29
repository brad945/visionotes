import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { listSessions, deleteSession } from "../api";
import ConfirmDialog from "../components/ConfirmDialog";

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
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const selectAllRef = useRef(null);
  const navigate = useNavigate();

  function visualizeSelected() {
    if (!selectedIds.size) return;
    navigate(`/visualize?ids=${[...selectedIds].join(",")}`);
  }

  useEffect(() => {
    listSessions()
      .then(setSessions)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const allSelected = sessions.length > 0 && selectedIds.size === sessions.length;
  const someSelected = selectedIds.size > 0 && !allSelected;

  // Native checkboxes can't show "indeterminate" via an attribute.
  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = someSelected;
  }, [someSelected]);

  function toggleOne(id) {
    setSelectedIds((cur) => {
      const next = new Set(cur);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelectedIds(allSelected ? new Set() : new Set(sessions.map((s) => s.id)));
  }

  async function confirmDelete() {
    const ids = [...selectedIds];
    if (!ids.length) return;
    setDeleting(true);
    setError(null);
    const results = await Promise.allSettled(ids.map((id) => deleteSession(id)));
    const ok = new Set(ids.filter((_, i) => results[i].status === "fulfilled"));
    setSessions((rows) => rows.filter((r) => !ok.has(r.id)));
    setSelectedIds((cur) => new Set([...cur].filter((id) => !ok.has(id))));
    const failed = ids.length - ok.size;
    if (failed) setError(`${failed} session${failed > 1 ? "s" : ""} couldn't be deleted.`);
    setDeleting(false);
    setConfirmOpen(false);
  }

  if (loading) return <main style={{ padding: "32px 0" }} className="vn-muted">Loading sessions…</main>;
  if (error && sessions.length === 0)
    return <main style={{ padding: "32px 0", color: "var(--signal-deep)" }}>Error: {error}</main>;

  const thStyle = { padding: "10px 12px", textAlign: "left" };
  const tdStyle = { padding: "12px 12px", verticalAlign: "middle" };
  const count = selectedIds.size;

  return (
    <main style={{ padding: "32px 0" }}>
      <p className="vn-label" style={{ marginBottom: 6 }}>History</p>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, marginBottom: 20, minHeight: 40, flexWrap: "wrap" }}>
        <h1 style={{ margin: 0 }}>Session History</h1>
        {count > 0 && (
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" className="vn-btn vn-btn--primary" onClick={visualizeSelected}>
              Visualize together ({count})
            </button>
            <button type="button" className="vn-btn vn-btn--stop" onClick={() => setConfirmOpen(true)}>
              Delete selected ({count})
            </button>
          </div>
        )}
      </div>

      {error && sessions.length > 0 && (
        <p style={{ color: "var(--signal-deep)", marginBottom: 12, fontSize: "0.875rem" }}>{error}</p>
      )}

      {sessions.length === 0 ? (
        <div style={{
          marginTop: 40,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 12,
          padding: "48px 32px",
          border: "1px dashed var(--line-strong)",
          borderRadius: "var(--r-xl)",
          textAlign: "center",
        }}>
          <p style={{ margin: 0, fontWeight: 600, fontSize: "1.05rem", color: "var(--ink)" }}>No sessions yet</p>
          <p style={{ margin: 0, color: "var(--ink-muted)", fontSize: "0.9rem", maxWidth: 320, lineHeight: 1.6 }}>
            Complete a practice session and it will appear here with a full fault breakdown.
          </p>
          <Link to="/" className="vn-btn vn-btn--primary" style={{ marginTop: 4 }}>Start your first session</Link>
        </div>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.95rem" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--line-strong)" }}>
              <th style={{ ...thStyle, width: 40 }}>
                <input
                  ref={selectAllRef}
                  type="checkbox"
                  className="vn-accent-control"
                  checked={allSelected}
                  onChange={toggleAll}
                  aria-label="Select all sessions"
                  style={{ width: 16, height: 16, margin: 0, cursor: "pointer" }}
                />
              </th>
              <th className="vn-label" style={thStyle}>Date</th>
              <th className="vn-label" style={thStyle}>Duration</th>
              <th className="vn-label" style={thStyle}>Faults</th>
              <th style={thStyle}></th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((s) => {
              const checked = selectedIds.has(s.id);
              return (
                <tr
                  key={s.id}
                  style={{
                    borderBottom: "1px solid var(--line)",
                    background: checked ? "var(--surface-sunken)" : "transparent",
                  }}
                >
                  <td style={tdStyle}>
                    <input
                      type="checkbox"
                      className="vn-accent-control"
                      checked={checked}
                      onChange={() => toggleOne(s.id)}
                      aria-label={`Select session from ${formatDate(s.started_at)}`}
                      style={{ width: 16, height: 16, margin: 0, cursor: "pointer" }}
                    />
                  </td>
                  <td style={tdStyle}>{formatDate(s.started_at)}</td>
                  <td style={tdStyle} className="vn-data">{formatDuration(s.duration_seconds)}</td>
                  <td style={tdStyle} className="vn-data">{s.total_faults}</td>
                  <td style={{ ...tdStyle, textAlign: "right" }}>
                    <Link to={`/history/${s.id}`} style={{ fontWeight: 500 }}>
                      View →
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <ConfirmDialog
        open={confirmOpen}
        title={`Delete ${count} session${count > 1 ? "s" : ""}?`}
        message={`The selected session${count > 1 ? "s" : ""} and their fault data will be permanently removed. This can't be undone.`}
        confirmLabel={`Delete ${count}`}
        busy={deleting}
        onConfirm={confirmDelete}
        onCancel={() => !deleting && setConfirmOpen(false)}
      />
    </main>
  );
}
