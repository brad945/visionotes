import { NavLink } from "react-router-dom";

const linkStyle = ({ isActive }) => ({
  fontWeight: isActive ? 700 : 400,
  color: isActive ? "#111" : "#555",
  textDecoration: "none",
});

export default function Navbar() {
  return (
    <nav style={{ display: "flex", alignItems: "center", gap: 24, padding: "16px 0", borderBottom: "1px solid #ddd" }}>
      <span style={{ fontWeight: 700, fontSize: 20, marginRight: "auto" }}>VisioNotes</span>
      <NavLink to="/" style={linkStyle} end>Practice</NavLink>
      <NavLink to="/history" style={linkStyle}>History</NavLink>
    </nav>
  );
}
