import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Quick-insert dropdown for template variables. Clicking a token inserts it at
 * the target field's caret position. Rendered as a small dropdown (instead of
 * a row of chips) so it stays compact and scales as more tokens are added.
 *
 * The menu is portalled with fixed positioning so it's never clipped by an
 * `overflow` ancestor (Compose form / template modal both scroll internally).
 *
 * Props:
 * - inputRef: ref to the <input>/<textarea> to insert into
 * - extra: string[] of extra token names to offer (merged with the defaults)
 */
const DEFAULT_VARS = ["name", "company", "email"];
const MENU_WIDTH = 192;

export default function VariableChips({ inputRef, extra = [] }) {
  const all = Array.from(new Set([...DEFAULT_VARS, ...extra]));

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

  const insert = (token) => {
    const el = inputRef?.current;
    if (!el) return;
    const value = el.value || "";
    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? value.length;
    const before = value.slice(0, start);
    const after = value.slice(end);
    const insertion = `{{${token}}}`;
    const next = before + insertion + after;

    // React-controlled inputs need the native setter to dispatch a change event
    const proto = Object.getPrototypeOf(el);
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (setter) setter.call(el, next);
    else el.value = next;
    el.dispatchEvent(new Event("input", { bubbles: true }));

    requestAnimationFrame(() => {
      const caret = start + insertion.length;
      el.focus();
      el.setSelectionRange(caret, caret);
    });
  };

  const handleToggle = () => {
    if (!open && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      const estimatedHeight = Math.min(all.length * 32 + 16, 280);
      const spaceBelow = window.innerHeight - rect.bottom;
      const placeAbove = spaceBelow < estimatedHeight + 16;
      setCoords({
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
        className="inline-flex items-center gap-1 rounded-md bg-ui-inset px-2 py-0.5 text-2xs font-medium text-ui-fg-muted transition hover:bg-brand-50 hover:text-brand-700 dark:hover:bg-brand-900/30 dark:hover:text-brand-300"
        title="Insert a merge variable at the cursor"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-3 w-3"
        >
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
        Insert variable
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`}
        >
          <polyline points="6 9 12 15 18 9" />
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
              width: MENU_WIDTH,
            }}
            className="z-[60] max-h-[280px] overflow-auto rounded-lg border border-ui-border/70 bg-ui-panel py-1 shadow-lift anim-in"
          >
            {all.map((v) => (
              <button
                key={v}
                type="button"
                role="menuitem"
                onClick={() => {
                  insert(v);
                  setOpen(false);
                }}
                className="flex w-full items-center px-3 py-1.5 text-left font-mono text-xs text-ui-fg transition hover:bg-ui-inset/60"
              >
                {`{{${v}}}`}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}
