import { Routes, Route } from "react-router-dom";
import Navbar from "./components/Navbar";
import Practice from "./pages/Practice";
import History from "./pages/History";
import SessionDetail from "./pages/SessionDetail";

export default function App() {
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
