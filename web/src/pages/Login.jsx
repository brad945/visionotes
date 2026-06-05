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
      <main style={{ padding: "64px 0", textAlign: "center" }}>
        <h1>Check your email</h1>
        <p>We sent a magic link to <strong>{email}</strong>. Click it to log in.</p>
      </main>
    );
  }

  return (
    <main style={{ padding: "64px 0", maxWidth: 360, margin: "0 auto" }}>
      <h1>Log in to VisioNotes</h1>
      <form onSubmit={handleLogin}>
        <input
          type="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          style={{
            width: "100%",
            padding: "10px 12px",
            fontSize: 16,
            borderRadius: 6,
            border: "1px solid #ccc",
            boxSizing: "border-box",
          }}
        />
        <button
          type="submit"
          style={{
            marginTop: 12,
            width: "100%",
            padding: "10px",
            fontSize: 16,
            borderRadius: 6,
            border: "none",
            background: "#0066cc",
            color: "#fff",
            cursor: "pointer",
          }}
        >
          Send magic link
        </button>
      </form>
      {error && <p style={{ color: "red", marginTop: 12 }}>{error}</p>}
    </main>
  );
}
