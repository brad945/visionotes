import { Routes, Route } from "react-router-dom";
import { useAuth } from "./auth/AuthProvider";
import { useTheme } from "./theme/ThemeProvider";
import Navbar from "./components/Navbar";
import HeroField from "./components/HeroField";
import ThemeToggle from "./components/ThemeToggle";
import Login from "./pages/Login";
import Practice from "./pages/Practice";
import History from "./pages/History";
import SessionDetail from "./pages/SessionDetail";
import Visualize from "./pages/Visualize";
import Groups from "./pages/Groups";

export default function App() {
  const { user, loading } = useAuth();
  const { theme } = useTheme();

  if (loading) {
    return (
      <div className="vn-muted" style={{ padding: 64, textAlign: "center" }}>
        Loading…
      </div>
    );
  }

  if (!user) {
    // The particle splash shows in BOTH themes (HeroField recolors itself): dark
    // dots on light, light/mint dots on dark. The form + scrim + toggle adapt.
    const dark = theme === "dark";
    return (
      <div
        style={{
          minHeight: "100vh",
          position: "relative",
          overflow: "hidden",
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "center",
          background: dark ? "#07090d" : "#f3f6f7", // bg lives here now; the hand floats on top
        }}
      >
        <HeroField background overlay followCursor scale={0.5} />
        <div style={{ position: "absolute", top: 76, left: 0, right: 0, zIndex: 3, display: "flex", justifyContent: "center", transform: "translateX(90px)" }}>
          <ThemeToggle
            style={
              dark
                ? {
                    background: "rgba(255,255,255,0.06)",
                    borderColor: "rgba(255,255,255,0.18)",
                    color: "#f2f4f8",
                    backdropFilter: "blur(6px)",
                    WebkitBackdropFilter: "blur(6px)",
                  }
                : undefined
            }
          />
        </div>
        <div style={{ position: "relative", zIndex: 2, marginTop: 132, padding: "0 16px", transform: "translateX(400px)" }}>
          <Login splash={dark} />
        </div>
      </div>
    );
  }

  return (
    <div className="vn-page">
      <Navbar />
      <Routes>
        <Route path="/" element={<Practice />} />
        <Route path="/history" element={<History />} />
        <Route path="/history/:sessionId" element={<SessionDetail />} />
        <Route path="/visualize" element={<Visualize />} />
        <Route path="/groups" element={<Groups />} />
      </Routes>
    </div>
  );
}
