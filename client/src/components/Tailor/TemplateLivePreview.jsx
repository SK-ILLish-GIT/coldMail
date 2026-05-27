export function buildPreviewSrcDoc(body) {
  const safeBody = String(body || "");
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="color-scheme" content="light"><style>
 html,body{margin:0;padding:0;background:#ffffff;color:#1f2937;}
 body{font:15px/1.65 ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;padding:18px 20px;}
 a{color:#2563eb;}
 p{margin:0 0 14px;}
 </style></head><body>${safeBody}</body></html>`;
}

/** Full-height live preview panel for template tailor flows. */
export default function TemplateLivePreview({
  subject = "",
  body = "",
  hint = "Updates as you approve suggestions.",
  emptyMessage = "(empty body)",
}) {
  const empty = !body?.trim();

  return (
    <div className="surface flex h-full min-h-0 flex-col p-4">
      <p className="shrink-0 text-2xs font-semibold uppercase tracking-[0.08em] text-ui-fg-muted">
        Live preview
      </p>
      <p className="mt-1 shrink-0 truncate text-sm font-medium text-ui-fg">
        {subject || (
          <span className="italic text-ui-fg-muted">(no subject)</span>
        )}
      </p>
      {hint ? (
        <p className="mt-0.5 shrink-0 text-2xs text-ui-fg-muted">{hint}</p>
      ) : null}
      <div className="mt-3 flex min-h-0 flex-1 flex-col">
        {empty ? (
          <div className="grid flex-1 place-items-center rounded-md border border-dashed border-ui-border bg-ui-panel-muted/80 px-3 py-6 text-center text-xs text-ui-fg-muted">
            {emptyMessage}
          </div>
        ) : (
          <iframe
            title="Template live preview"
            srcDoc={buildPreviewSrcDoc(body)}
            sandbox=""
            className="preview-frame min-h-0 w-full flex-1 rounded-md border border-ui-border/80"
          />
        )}
      </div>
    </div>
  );
}

/** Two-column shell: scrollable left, fixed full-height preview on the right (lg+). */
export function TemplateTailorSplit({ left, preview, header = null }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {header}
      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(440px,50%)] lg:gap-0">
        <div className="min-h-0 overflow-y-auto lg:pr-5">{left}</div>
        <aside className="flex min-h-[min(50vh,420px)] flex-col border-t border-ui-border/70 pt-4 lg:min-h-0 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-5">
          {preview}
        </aside>
      </div>
    </div>
  );
}
