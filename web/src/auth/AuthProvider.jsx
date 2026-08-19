import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { supabase } from "../supabaseClient";

const AuthContext = createContext({ user: null, loading: true, signOut: async () => {} });

export function useAuth() {
  return useContext(AuthContext);
}

export default function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
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

  const signOut = useCallback(async () => {
    // Force local state to null immediately so the UI responds even if the
    // Supabase call is slow or fails (it still clears localStorage).
    setUser(null);
    await supabase.auth.signOut().catch(() => {});
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}
