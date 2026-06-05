import { NavLink } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { supabase } from "../supabaseClient";

const linkStyle = ({ isActive }) => ({
  fontWeight: isActive ? 700 : 400,
  color: isActive ? "#111" : "#555",
  textDecoration: "none",
});

export default function Navbar() {
  const { user } = useAuth();

  return (
    <nav style={{ display: "flex", alignItems: "center", gap: 24, padding: "16px 0", borderBottom: "1px solid #ddd" }}>
      <span style={{ fontWeight: 700, fontSize: 20, marginRight: "auto" }}>VisioNotes</span>
      <NavLink to="/" style={linkStyle} end>Practice</NavLink>
      <NavLink to="/history" style={linkStyle}>History</NavLink>
      {user && (
        <button
          onClick={() => supabase.auth.signOut()}
          style={{
            background: "none",
            border: "1px solid #ccc",
            borderRadius: 6,
            padding: "6px 12px",
            cursor: "pointer",
            fontSize: 14,
            color: "#555",
          }}
        >
          Log out
        </button>
      )}
    </nav>
  );
}
