import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { supabase } from "../supabaseClient";

const AuthContext = createContext({ user: null, loading: true, signOut: async () => {} });

// TEMP (testing): in LOCAL DEV ONLY, skip the email magic-link and auto-log-in as a mock user,
// so the Supabase email rate limit can't block testing. import.meta.env.DEV is FALSE in the
// production build, so this NEVER activates on the deployed site. Remove when done testing.
const DEV_BYPASS_AUTH = import.meta.env.DEV;
const DEV_MOCK_USER = { id: "00000000-0000-0000-0000-000000000000", email: "dev@local.test" };

export function useAuth() {
  return useContext(AuthContext);
}

export default function AuthProvider({ children }) {
  const [user, setUser] = useState(DEV_BYPASS_AUTH ? DEV_MOCK_USER : null);
  const [loading, setLoading] = useState(!DEV_BYPASS_AUTH);

  useEffect(() => {
    if (DEV_BYPASS_AUTH) return; // bypass on: skip real auth wiring entirely

    // Check current session on mount
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      setLoading(false);
    });

    // Listen for auth state changes (login, logout, token refresh)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setUser(session?.user ?? null);
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  // Logout that also works under the dev bypass (where there's no real Supabase session to
  // clear): just drop the mock user so the login screen shows. A refresh re-applies the bypass.
  const signOut = useCallback(async () => {
    if (DEV_BYPASS_AUTH) { setUser(null); return; }
    await supabase.auth.signOut();
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}
