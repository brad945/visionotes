import { useState } from "react";
import { supabase } from "../supabaseClient";

export default function Login({ splash = false }) {
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
      <main style={{ textAlign: "center", maxWidth: 420, margin: "0 auto" }}>
        <p className="vn-label" style={{ marginBottom: 12 }}>Link sent</p>
        <h1>Check your email</h1>
        <p className="vn-muted" style={{ marginTop: 12 }}>
          We sent a login link to <strong style={{ color: "var(--ink)" }}>{email}</strong>. Click it to log in.
        </p>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 360, margin: "0 auto", textAlign: "center" }}>
      {/* The 3D "key" send button is identical in BOTH themes (dark key on the
          light/dark splash); only the input below adapts to splash. */}
      <style>{`
        .login-send-btn {
          /* curved surface: lit at the top, falling into shadow at the bottom */
          background: linear-gradient(180deg, rgba(70,76,82,0.92), rgba(28,32,36,0.88));
          color: #f2f4f8;
          border: 1px solid rgba(255,255,255,0.1);
          border-top-color: rgba(255,255,255,0.3);   /* lit top edge */
          -webkit-backdrop-filter: blur(6px);
          backdrop-filter: blur(6px);
          /* deep solid side/ledge + ambient drop + top-highlight & bottom inner
             bevel = chunky raised 3D key. Purely visual — the button never moves. */
          box-shadow:
            0 6px 0 rgba(14,16,18,0.95),
            0 13px 26px rgba(0,0,0,0.58),
            inset 0 2px 0 rgba(255,255,255,0.22),
            inset 0 -5px 9px rgba(0,0,0,0.5);
          transition: box-shadow 120ms ease, background 120ms ease;
        }
        .login-send-btn:hover {
          background: linear-gradient(180deg, rgba(84,90,96,0.96), rgba(36,40,44,0.92));
          box-shadow:
            0 6px 0 rgba(14,16,18,0.95),
            0 20px 34px rgba(0,0,0,0.62),
            inset 0 2px 0 rgba(255,255,255,0.3),
            inset 0 -5px 9px rgba(0,0,0,0.5);
        }
        .login-send-btn:active {
          /* ledge collapses + strong inner shadow = pressed in. Still no movement. */
          background: linear-gradient(180deg, rgba(26,30,34,0.92), rgba(40,45,50,0.92));
          box-shadow:
            0 2px 0 rgba(14,16,18,0.9),
            0 3px 9px rgba(0,0,0,0.45),
            inset 0 4px 9px rgba(0,0,0,0.62),
            inset 0 1px 0 rgba(255,255,255,0.06);
        }
      `}</style>
      <p className="vn-label" style={{ marginBottom: 12 }}>VisioNotes</p>
      <h1>Log in</h1>
      <p className="vn-muted" style={{ margin: "8px 0 24px" }}>
        Enter your email and we'll send you a login link.
      </p>
      <form onSubmit={handleLogin}>
        <input
          type="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          className="vn-input"
          style={
            splash
              ? {
                  textAlign: "left",
                  background: "rgba(255,255,255,0.06)",
                  borderColor: "rgba(255,255,255,0.18)",
                  backdropFilter: "blur(6px)",
                  WebkitBackdropFilter: "blur(6px)",
                }
              : { textAlign: "left" }
          }
        />
        <button
          type="submit"
          className="vn-btn login-send-btn"
          style={{ marginTop: 12, width: "100%" }}
        >
          Send link
        </button>
      </form>
      {error && (
        <p style={{ color: "var(--signal-deep)", marginTop: 12, fontSize: "0.875rem" }}>{error}</p>
      )}
    </main>
  );
}
