/**
 * Quick-insert chips for template variables. Clicking inserts the token at
 * the textarea/input's caret position.
 */
const DEFAULT_VARS = ["name", "company", "email"];

export default function VariableChips({ inputRef, extra = [] }) {
  const all = Array.from(new Set([...DEFAULT_VARS, ...extra]));

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

  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className="text-2xs uppercase tracking-wider text-ui-fg-muted">
        Insert:
      </span>
      {all.map((v) => (
        <button
          key={v}
          type="button"
          onClick={() => insert(v)}
          className="rounded-md bg-ui-inset px-1.5 py-0.5 font-mono text-2xs text-ui-fg transition hover:bg-brand-50 dark:hover:bg-brand-900/30 hover:text-brand-700 dark:hover:text-brand-300 hover:ring-1 hover:ring-inset hover:ring-brand-100 dark:hover:ring-brand-800"
          title={`Insert {{${v}}} at cursor`}
        >
          {`{{${v}}}`}
        </button>
      ))}
    </div>
  );
}
