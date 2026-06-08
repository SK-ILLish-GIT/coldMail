import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

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

// Approximate width of the menu (min-w-[10rem]); used to right-align it to
// the trigger when positioned via the fixed-coordinate portal.
const MENU_WIDTH = 160;

/**
 * Per-row overflow menu. Closes on outside-click, Escape, and after an item
 * is invoked. Rendered in a portal with fixed positioning so it's never
 * clipped by an `overflow-hidden` ancestor (e.g. a card), and flips above the
 * trigger when there isn't enough viewport room below.
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
  const [coords, setCoords] = useState(null);
  const buttonRef = useRef(null);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e) => {
      if (
        !buttonRef.current?.contains(e.target) &&
        !menuRef.current?.contains(e.target)
      ) {
        setOpen(false);
      }
    };
    const onKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    // The fixed-positioned menu would drift if the page scrolls, so close it.
    const onScrollOrResize = () => setOpen(false);
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [open]);

  const handleToggle = () => {
    if (!open && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      const estimatedMenuHeight = Math.min(items.length * 36 + 12, 240);
      const spaceBelow = window.innerHeight - rect.bottom;
      const placeAbove = spaceBelow < estimatedMenuHeight + 16;
      setCoords({
        placeAbove,
        // Right-align the menu to the trigger's right edge.
        left: Math.max(8, rect.right - MENU_WIDTH),
        top: placeAbove ? undefined : rect.bottom + 4,
        bottom: placeAbove ? window.innerHeight - rect.top + 4 : undefined,
      });
    }
    setOpen((v) => !v);
  };

  return (
    <div className="relative">
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
      {open &&
        coords &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            style={{
              position: "fixed",
              left: coords.left,
              top: coords.top,
              bottom: coords.bottom,
            }}
            className="z-[60] min-w-[10rem] overflow-hidden rounded-lg border border-ui-border/70 bg-ui-panel shadow-lift anim-in"
          >
            <ul className="py-1">
              {items.map((it, idx) => {
                const tone = TONE_CLASS[it.tone || "default"];
                const baseClass = [
                  "flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs font-medium transition disabled:opacity-50",
                  tone,
                ].join(" ");
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
          </div>,
          document.body,
        )}
    </div>
  );
}
