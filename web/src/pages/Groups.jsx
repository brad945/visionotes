import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { loadGroups, removeGroup } from "../groups";

function formatDate(iso) {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function Groups() {
  const [groups, setGroups] = useState(loadGroups);
  const navigate = useNavigate();

  function visualize(group) {
    navigate(`/visualize?ids=${group.ids.join(",")}`);
  }

  function remove(id) {
    setGroups(removeGroup(id));
  }

  return (
    <main style={{ padding: "32px 0" }}>
      <p className="vn-label" style={{ marginBottom: 6 }}>Groups</p>
      <h1 style={{ marginBottom: 20 }}>Saved Groups</h1>

      {groups.length === 0 ? (
        <div className="vn-card" style={{ textAlign: "center", padding: "40px 24px" }}>
          <p style={{ fontWeight: 600, marginBottom: 6 }}>No groups yet</p>
          <p className="vn-muted" style={{ marginBottom: 20 }}>
            Pick a few sessions in History and choose "Visualize together" to make one.
          </p>
          <button type="button" className="vn-btn vn-btn--primary" onClick={() => navigate("/history")}>
            Make a group
          </button>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 12 }}>
          {groups.map((g) => (
            <div key={g.id} className="vn-card" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
                <div>
                  <div style={{ fontWeight: 600 }}>{g.name}</div>
                  <div className="vn-data" style={{ color: "var(--ink-muted)", fontSize: 12, marginTop: 2 }}>
                    {g.ids.length} session{g.ids.length === 1 ? "" : "s"} · {formatDate(g.savedAt)}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => remove(g.id)}
                  aria-label={`Delete group ${g.name}`}
                  style={{ background: "none", border: "none", padding: "0 4px", cursor: "pointer", color: "var(--ink-muted)", fontSize: 18, lineHeight: 1 }}
                >
                  ×
                </button>
              </div>
              <button type="button" className="vn-btn vn-btn--primary" onClick={() => visualize(g)} style={{ width: "100%" }}>
                Visualize
              </button>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
