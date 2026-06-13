import { Routes, Route } from "react-router-dom";
import { useAuth } from "./auth/AuthProvider";
import Navbar from "./components/Navbar";
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
    return (
      <div className="vn-page" style={{ minHeight: "100vh" }}>
        <div style={{ display: "flex", justifyContent: "center", paddingTop: 76 }}>
          <ThemeToggle />
        </div>
        <div style={{ display: "flex", justifyContent: "center", paddingTop: "8vh" }}>
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
