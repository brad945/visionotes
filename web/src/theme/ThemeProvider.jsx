/**
 * ThemeProvider — light/dark theme controller.
 *
 * Source of truth is the `data-theme` attribute on <html>, which flips the token
 * values in tokens.css. We default to the OS `prefers-color-scheme` and keep
 * following it until the user makes an explicit choice (which we persist to
 * localStorage). The anti-FOUC inline script in index.html sets the same
 * attribute before React mounts; it MUST use the same STORAGE_KEY as here.
 */

import { createContext, useContext, useEffect, useRef, useState, useCallback } from "react";
import { flushSync } from "react-dom";

const STORAGE_KEY = "vn-theme"; // keep in sync with the inline script in index.html

const ThemeContext = createContext({ theme: "light", toggleTheme: () => {} });

export function useTheme() {
  return useContext(ThemeContext);
}

function getInitialTheme() {
  if (typeof window === "undefined") return "light";
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === "light" || stored === "dark") return stored;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyDom(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", theme === "dark" ? "#0e1315" : "#f7f8f8");
}

export default function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(getInitialTheme);
  const themeRef = useRef(theme);
  themeRef.current = theme;

  // Apply on mount + any non-toggle change (e.g. following the OS preference).
  useEffect(() => {
    applyDom(theme);
  }, [theme]);

  // Follow OS changes only while the user hasn't made an explicit choice.
  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!mq) return;
    const onChange = (e) => {
      if (!localStorage.getItem(STORAGE_KEY)) setTheme(e.matches ? "dark" : "light");
    };
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);

  const toggleTheme = useCallback(() => {
    const next = themeRef.current === "dark" ? "light" : "dark";
    try {
      localStorage.setItem(STORAGE_KEY, next); // explicit choice → persist, stop following OS
    } catch {
      /* storage unavailable (private mode) */
    }

    // Apply React + DOM changes synchronously so the View Transition snapshots
    // the new theme, then cross-fades the whole screen old→new.
    const commit = () => {
      flushSync(() => setTheme(next));
      applyDom(next);
    };

    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (document.startViewTransition && !reduce) {
      document.startViewTransition(commit);
    } else {
      commit();
    }
  }, []);

  return <ThemeContext.Provider value={{ theme, toggleTheme }}>{children}</ThemeContext.Provider>;
}
