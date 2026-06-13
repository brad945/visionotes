import { Routes, Route } from "react-router-dom";
import { useAuth } from "./auth/AuthProvider";
import Navbar from "./components/Navbar";
import HeroField from "./components/HeroField";
import ThemeToggle from "./components/ThemeToggle";
import Login from "./pages/Login";
import Practice from "./pages/Practice";
import History from "./pages/History";
import SessionDetail from "./pages/SessionDetail";
import Visualize from "./pages/Visualize";

export default function App() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="vn-muted" style={{ padding: 64, textAlign: "center" }}>
        Loading…
      </div>
    );
  }

  if (!user) {
    // Dark, branded splash: the particle field auto-assembles behind the login
    // form. Forced to the dark token set so the login text stays legible on the
    // near-black field, regardless of the app-wide theme.
    return (
      <div
        data-theme="dark"
        style={{
          minHeight: "100vh",
          position: "relative",
          overflow: "hidden",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <HeroField auto background followCursor scale={0.5} autoDelayMs={300} autoDurationMs={1500} />
        {/* Soft center scrim so the form reads over the moving particles. */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 1,
            pointerEvents: "none",
            background:
              "radial-gradient(ellipse 56% 48% at 50% 50%, rgba(7,9,13,0.7), rgba(7,9,13,0) 70%)",
          }}
        />
        <div style={{ position: "absolute", top: 76, left: 0, right: 0, zIndex: 3, display: "flex", justifyContent: "center" }}>
          <ThemeToggle />
        </div>
        <div style={{ position: "relative", zIndex: 2, transform: "translateY(-40px)", padding: "0 16px" }}>
          <Login />
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
      </Routes>
    </div>
  );
}
