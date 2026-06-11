import { NavLink } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { supabase } from "../supabaseClient";

const linkStyle = ({ isActive }) => ({
  fontWeight: isActive ? 600 : 400,
  color: isActive ? "var(--ink)" : "var(--ink-muted)",
  textDecoration: "none",
  padding: "4px 0",
  borderBottom: `2px solid ${isActive ? "var(--accent)" : "transparent"}`,
  transition: "color var(--dur-fast) var(--ease-out)",
});

export default function Navbar() {
  const { user } = useAuth();

  return (
    <nav style={{ display: "flex", alignItems: "center", gap: 24, padding: "16px 0", borderBottom: "1px solid var(--line)" }}>
      <span style={{ fontWeight: 700, fontSize: 20, letterSpacing: "-0.02em", marginRight: "auto" }}>VisioNotes</span>
      <NavLink to="/" style={linkStyle} end>Practice</NavLink>
      <NavLink to="/history" style={linkStyle}>History</NavLink>
      <NavLink to="/visualize" style={linkStyle}>Visualize</NavLink>
      {user && (
        <button onClick={() => supabase.auth.signOut()} className="vn-btn vn-btn--ghost">
          Log out
        </button>
      )}
    </nav>
  );
}
