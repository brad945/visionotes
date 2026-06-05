import { useParams } from "react-router-dom";

export default function SessionDetail() {
  const { sessionId } = useParams();

  return (
    <main style={{ padding: "32px 0" }}>
      <h1>Session Detail</h1>
      <p>Fault events for session <code>{sessionId}</code> will appear here (Phase 3f).</p>
    </main>
  );
}
