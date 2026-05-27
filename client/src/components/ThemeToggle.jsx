import { useEffect, useState } from "react";

// Reads + persists the theme choice. Returns ['light' | 'dark', setter].
// Default is LIGHT; we only flip to dark if the user explicitly toggled it
// last time (saved in localStorage). OS preference is intentionally NOT
// honoured automatically — it's too easy to land in dark by surprise on a
// system that defaults to dark.
export function useTheme() {
  const [theme, setThemeState] = useState(() => {
    if (typeof window === "undefined") return "light";
    const saved = window.localStorage.getItem("coldmail.theme");
    if (saved === "light" || saved === "dark") return saved;
    return "light";
  });

  // Mirror the choice onto <html class="dark"> and persist.
  useEffect(() => {
    const root = document.documentElement;
    if (theme === "dark") root.classList.add("dark");
    else root.classList.remove("dark");
    try {
      window.localStorage.setItem("coldmail.theme", theme);
    } catch {
      // localStorage unavailable (private mode) — non-fatal.
    }
  }, [theme]);

  return [theme, setThemeState];
}

/**
 * Compact icon button that flips light <-> dark.
 */
export default function ThemeToggle({ theme, onToggle }) {
  const isDark = theme === "dark";
  return (
    <button
      type="button"
      onClick={onToggle}
      className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-ui-border/80 bg-ui-panel text-ui-fg-subtle shadow-sm transition hover:bg-ui-inset hover:text-ui-fg"
      title={isDark ? "Switch to light theme" : "Switch to dark theme"}
      aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
    >
      {isDark ? (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-4 w-4"
        >
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
        </svg>
      ) : (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-4 w-4"
        >
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
      )}
    </button>
  );
}
