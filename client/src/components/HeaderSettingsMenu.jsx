import { useEffect, useRef, useState } from "react";

import GeminiModelPicker from "./GeminiModelPicker.jsx";
import StatusPill from "./StatusPill.jsx";
import ThemeToggle from "./ThemeToggle.jsx";

export default function HeaderSettingsMenu({
  health,
  theme,
  onToggleTheme,
  onAiPillClick,
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onPointer = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPointer);
    };
  }, [open]);

  const dbState = health.loading ? "loading" : health.ok ? "ok" : "down";
  const aiState = health.loading
    ? "loading"
    : health.features?.aiEnrich
      ? "ok"
      : "off";

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-ui-border/80 bg-ui-panel text-ui-fg-subtle shadow-sm transition hover:bg-ui-inset hover:text-ui-fg"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Settings and status"
        title="Settings"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="currentColor"
          className="h-4 w-4"
          aria-hidden
        >
          <circle cx="5" cy="12" r="1.75" />
          <circle cx="12" cy="12" r="1.75" />
          <circle cx="19" cy="12" r="1.75" />
        </svg>
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-1 w-[min(100vw-2rem,20rem)] rounded-lg border border-ui-border/80 bg-ui-panel py-2 shadow-lg"
        >
          <p className="px-3 pb-1 text-2xs font-semibold uppercase tracking-wider text-ui-fg-muted">
            Status
          </p>
          <div className="grid grid-cols-2 gap-2 px-3 pb-3">
            <StatusPill
              label="DB"
              state={dbState}
              className="w-full justify-center"
              title={
                health.loading
                  ? "Checking server health..."
                  : health.ok
                    ? `MongoDB connected (${health.storage || "mongodb"})`
                    : "Server or database unreachable"
              }
            />
            <button
              type="button"
              onClick={onAiPillClick}
              className="flex min-w-0 justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
              title={
                health.features?.aiEnrich
                  ? `AI enabled (${[
                      health.features?.aiProviders?.gemini ? "Gemini" : null,
                      health.features?.aiProviders?.groq ? "Groq" : null,
                    ]
                      .filter(Boolean)
                      .join(", ") || "configured"})`
                  : "AI off — click to copy API key hints"
              }
            >
              <StatusPill
                label="AI"
                state={aiState}
                className="w-full justify-center"
              />
            </button>
          </div>

          <div className="border-t border-ui-border/70" />
          <p className="px-3 pb-1 pt-2 text-2xs font-semibold uppercase tracking-wider text-ui-fg-muted">
            Appearance
          </p>
          <div className="flex items-center justify-between gap-2 px-3 pb-2">
            <span className="text-xs text-ui-fg-subtle">
              {theme === "dark" ? "Dark mode" : "Light mode"}
            </span>
            <ThemeToggle theme={theme} onToggle={onToggleTheme} />
          </div>

          {health.features?.aiEnrich ? (
            <>
              <div className="border-t border-ui-border/70" />
              <p className="px-3 pb-1 pt-2 text-2xs font-semibold uppercase tracking-wider text-ui-fg-muted">
                AI model
              </p>
              <div className="px-1 pb-2">
                <GeminiModelPicker
                  aiEnabled
                  variant="menu"
                  onModelChange={() => setOpen(false)}
                />
              </div>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
