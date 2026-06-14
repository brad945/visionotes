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

export default function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(getInitialTheme);
  const firstRun = useRef(true);
  const fadeTimer = useRef(null);

  // Apply the theme to <html> + sync the mobile browser-chrome color.
  useEffect(() => {
    const root = document.documentElement;

    // On a real switch (not initial mount), add .vn-theming so every element
    // eases its colors during the change, then remove it once the fade is done.
    if (!firstRun.current) {
      root.classList.add("vn-theming");
      clearTimeout(fadeTimer.current);
      fadeTimer.current = setTimeout(() => root.classList.remove("vn-theming"), 550);
    }
    firstRun.current = false;

    root.setAttribute("data-theme", theme);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", theme === "dark" ? "#0e1315" : "#f7f8f8");
  }, [theme]);

  useEffect(() => () => clearTimeout(fadeTimer.current), []);

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
    setTheme((t) => {
      const next = t === "dark" ? "light" : "dark";
      try {
        localStorage.setItem(STORAGE_KEY, next); // explicit choice → persist, stop following OS
      } catch {
        /* storage unavailable (private mode) — theme still applies for the session */
      }
      return next;
    });
  }, []);

  return <ThemeContext.Provider value={{ theme, toggleTheme }}>{children}</ThemeContext.Provider>;
}
