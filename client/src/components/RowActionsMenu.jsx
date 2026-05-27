import { useEffect, useRef, useState } from "react";

// Tone -> menu-item color classes. Mirrors the tone language used by the
// standalone buttons elsewhere so muscle-memory carries over (Edit = amber,
// Delete = rose, etc.).
const TONE_CLASS = {
  default: "text-ui-fg hover:bg-ui-inset/60",
  brand:
    "text-brand-700 dark:text-brand-300 hover:bg-brand-50 dark:hover:bg-brand-900/30",
  indigo:
    "text-indigo-700 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-900/30",
  amber:
    "text-amber-700 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-900/30",
  rose: "text-rose-700 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-900/30",
  emerald:
    "text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-900/30",
};

/**
 * Per-row overflow menu. Closes on outside-click, Escape, and after an item
 * is invoked. Flips above the trigger when there isn't enough viewport room
 * below — so the last row in a list doesn't clip the menu.
 *
 * items: Array<{
 * label: string,
 * onClick?: () => void,
 * href?: string, // if set, renders as an <a> menu item
 * target?: string, // pass-through for <a>
 * tone?: keyof TONE_CLASS,
 * disabled?: boolean,
 * separated?: boolean, // draws a divider above this item
 * }>
 */
export default function RowActionsMenu({ items, label = "More actions" }) {
  const [open, setOpen] = useState(false);
  const [placeAbove, setPlaceAbove] = useState(false);
  const wrapperRef = useRef(null);
  const buttonRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e) => {
      if (!wrapperRef.current?.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const handleToggle = () => {
    if (!open && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      const estimatedMenuHeight = Math.min(items.length * 36 + 12, 240);
      const spaceBelow = window.innerHeight - rect.bottom;
      setPlaceAbove(spaceBelow < estimatedMenuHeight + 16);
    }
    setOpen((v) => !v);
  };

  return (
    <div ref={wrapperRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={handleToggle}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        className="btn-ghost btn-sm min-w-[2rem] px-2.5"
        title={label}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="currentColor"
          className="h-4 w-4"
        >
          <circle cx="12" cy="5" r="1.6" />
          <circle cx="12" cy="12" r="1.6" />
          <circle cx="12" cy="19" r="1.6" />
        </svg>
      </button>
      {open && (
        <div
          role="menu"
          className={[
            "absolute right-0 z-40 min-w-[10rem] overflow-hidden rounded-lg border border-ui-border/70 bg-ui-panel shadow-lift anim-in",
            placeAbove ? "bottom-full mb-1" : "top-full mt-1",
          ].join("")}
        >
          <ul className="py-1">
            {items.map((it, idx) => {
              const tone = TONE_CLASS[it.tone || "default"];
              const baseClass = [
                "flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs font-medium transition disabled:opacity-50",
                tone,
              ].join("");
              return (
                <li key={`${it.label}-${idx}`}>
                  {it.separated && idx > 0 ? (
                    <div className="my-1 h-px bg-ui-inset" />
                  ) : null}
                  {it.href ? (
                    <a
                      role="menuitem"
                      href={it.href}
                      target={it.target}
                      rel={
                        it.target === "_blank"
                          ? "noopener noreferrer"
                          : undefined
                      }
                      onClick={() => setOpen(false)}
                      className={baseClass}
                    >
                      {it.label}
                    </a>
                  ) : (
                    <button
                      type="button"
                      role="menuitem"
                      disabled={it.disabled}
                      onClick={() => {
                        setOpen(false);
                        it.onClick?.();
                      }}
                      className={baseClass}
                    >
                      {it.label}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
