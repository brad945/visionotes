import { useState } from "react";
import { supabase } from "../supabaseClient";

export default function Login() {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState(null);

  const handleLogin = async (e) => {
    e.preventDefault();
    setError(null);
    const { error: authError } = await supabase.auth.signInWithOtp({ email });
    if (authError) {
      setError(authError.message);
    } else {
      setSubmitted(true);
    }
  };

  if (submitted) {
    return (
      <main style={{ padding: "96px 0", textAlign: "center", maxWidth: 420, margin: "0 auto" }}>
        <p className="vn-label" style={{ marginBottom: 12 }}>Magic link sent</p>
        <h1>Check your email</h1>
        <p className="vn-muted" style={{ marginTop: 12 }}>
          We sent a magic link to <strong style={{ color: "var(--ink)" }}>{email}</strong>. Click it to log in.
        </p>
      </main>
    );
  }

  return (
    <main style={{ padding: "96px 0", maxWidth: 360, margin: "0 auto" }}>
      <p className="vn-label" style={{ marginBottom: 12 }}>VisioNotes</p>
      <h1>Log in</h1>
      <p className="vn-muted" style={{ margin: "8px 0 24px" }}>
        Enter your email and we'll send you a one-tap magic link.
      </p>
      <form onSubmit={handleLogin}>
        <input
          type="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          className="vn-input"
        />
        <button type="submit" className="vn-btn vn-btn--primary" style={{ marginTop: 12, width: "100%" }}>
          Send magic link
        </button>
      </form>
      {error && (
        <p style={{ color: "var(--signal-deep)", marginTop: 12, fontSize: "0.875rem" }}>{error}</p>
      )}
    </main>
  );
}
