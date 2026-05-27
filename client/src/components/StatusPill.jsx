const STATE_CLASS = {
  ok: "pill-emerald",
  down: "pill-rose",
  off: "pill-ink",
  loading: "pill-ink",
};

const DOT_CLASS = {
  ok: "bg-emerald-500 animate-pulse-dot",
  down: "bg-rose-500",
  off: "bg-ui-fg-subtle/50",
  loading: "bg-ui-fg-muted/60 animate-pulse-dot",
};

/**
 * Tiny"DB" /"AI" health pill for the app header.
 */
export default function StatusPill({
  label,
  state = "loading",
  title,
  className = "",
}) {
  return (
    <span
      className={`${STATE_CLASS[state] || "pill-ink"} ${className}`.trim()}
      title={title}
    >
      <span className={`status-dot ${DOT_CLASS[state] || DOT_CLASS.loading}`} />
      <span className="font-mono text-[10px] uppercase tracking-wider">
        {label}
      </span>
    </span>
  );
}
