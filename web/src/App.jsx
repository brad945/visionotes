import { Routes, Route } from "react-router-dom";
import { useAuth } from "./auth/AuthProvider";
import Navbar from "./components/Navbar";
import Login from "./pages/Login";
import Practice from "./pages/Practice";
import History from "./pages/History";
import SessionDetail from "./pages/SessionDetail";

export default function App() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div style={{ fontFamily: "system-ui, sans-serif", padding: 64, textAlign: "center" }}>
        Loading…
      </div>
    );
  }

  if (!user) {
    return (
      <div style={{ fontFamily: "system-ui, sans-serif", maxWidth: 960, margin: "0 auto", padding: "0 16px" }}>
        <Login />
      </div>
    );
  }

  return (
    <div style={{ fontFamily: "system-ui, sans-serif", maxWidth: 960, margin: "0 auto", padding: "0 16px" }}>
      <Navbar />
      <Routes>
        <Route path="/" element={<Practice />} />
        <Route path="/history" element={<History />} />
        <Route path="/history/:sessionId" element={<SessionDetail />} />
      </Routes>
    </div>
  );
}
