import { useMemo, useRef, useState } from "react";
import Papa from "papaparse";
import toast from "react-hot-toast";

const REQUIRED_COLUMN = "email";

function StatusDot({ status }) {
  if (!status) return null;
  if (status.status === "sending") {
    return (
      <svg
        className="inline h-3 w-3 animate-spin text-ui-fg-muted"
        viewBox="0 0 24 24"
        fill="none"
        aria-label="Sending"
      >
        <circle
          cx="12"
          cy="12"
          r="10"
          stroke="currentColor"
          strokeOpacity="0.25"
          strokeWidth="3"
        />
        <path
          d="M22 12a10 10 0 0 1-10 10"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
        />
      </svg>
    );
  }
  if (status.status === "drafted") {
    return (
      <span
        className="status-dot bg-emerald-500"
        title="Saved to Gmail Drafts"
        aria-label="Drafted"
      />
    );
  }
  if (status.status === "failed") {
    return (
      <span
        className="status-dot bg-rose-500"
        title={status.error || "Failed"}
        aria-label="Failed"
      />
    );
  }
  if (status.status === "pending") {
    return (
      <span
        className="status-dot bg-ink-300 dark:bg-ink-600"
        title="Queued"
        aria-label="Queued"
      />
    );
  }
  return null;
}

export default function CsvUploader({
  recipients,
  onChange,
  sendStatuses = {},
}) {
  const inputRef = useRef(null);
  const [filename, setFilename] = useState("");
  const [dragOver, setDragOver] = useState(false);

  // Stable column order derived from the first row. We keep this in state so
  // the table layout doesn't reshuffle if a row briefly has fewer keys after
  // an edit.
  const columns = useMemo(() => {
    if (!recipients.length) return [];
    return Object.keys(recipients[0]);
  }, [recipients]);

  const parse = (file) => {
    if (!file) return;
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => h.trim().toLowerCase(),
      complete: (results) => {
        const headers = results.meta.fields || [];
        if (!headers.includes(REQUIRED_COLUMN)) {
          toast.error(`CSV must include an"${REQUIRED_COLUMN}" column.`);
          return;
        }
        const rows = (results.data || [])
          .map((r) => {
            const out = {};
            for (const k of Object.keys(r)) {
              out[k] = typeof r[k] === "string" ? r[k].trim() : r[k];
            }
            return out;
          })
          .filter((r) => r.email);

        if (!rows.length) {
          toast.error("No rows with an email address were found.");
          return;
        }
        setFilename(file.name);
        onChange(rows);
        toast.success(
          `Loaded ${rows.length} recipient${rows.length === 1 ? "" : "s"}.`,
        );
      },
      error: (err) => toast.error(`CSV parse error: ${err.message}`),
    });
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer?.files?.[0];
    if (file) parse(file);
  };

  const clear = () => {
    setFilename("");
    onChange([]);
    if (inputRef.current) inputRef.current.value = "";
  };

  const updateCell = (rowIdx, key, value) => {
    onChange(
      recipients.map((r, i) => (i === rowIdx ? { ...r, [key]: value } : r)),
    );
  };

  const removeRow = (rowIdx) => {
    onChange(recipients.filter((_, i) => i !== rowIdx));
  };

  return (
    <fieldset className="space-y-4">
      <legend className="label !mb-2">Bulk recipients</legend>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className={[
          "rounded-xl border-2 border-dashed bg-ui-inset/50 px-5 py-6 transition",
          dragOver
            ? "border-brand-400 bg-brand-50/50 dark:bg-brand-900/30"
            : "border-ui-border",
        ].join(" ")}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-ui-fg">
              {recipients.length
                ? `${recipients.length} recipient${recipients.length === 1 ? "" : "s"} loaded`
                : "Drop a CSV file here"}
            </p>
            <p className="mt-0.5 text-xs text-ui-fg-muted">
              Required column:{""}
              <code className="rounded bg-ink-200/70 px-1 font-mono">
                email
              </code>
              . Optional:{""}
              <code className="rounded bg-ink-200/70 px-1 font-mono">name</code>
              ,{""}
              <code className="rounded bg-ink-200/70 px-1 font-mono">
                company
              </code>
              , plus any custom
              <code className="ml-1 rounded bg-ink-200/70 px-1 font-mono">{`{{column}}`}</code>
              {""}
              tokens.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <input
              ref={inputRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => parse(e.target.files?.[0])}
            />
            <button
              type="button"
              className="btn-secondary btn-xs"
              onClick={() => inputRef.current?.click()}
            >
              {recipients.length ? "Replace CSV" : "Browse files"}
            </button>
            {recipients.length > 0 && (
              <button
                type="button"
                className="btn-ghost btn-xs"
                onClick={clear}
              >
                Clear
              </button>
            )}
          </div>
        </div>
      </div>

      {recipients.length > 0 && (
        <div className="anim-in">
          <p className="mb-2 text-2xs uppercase tracking-wider text-ui-fg-muted">
            <span className="font-mono text-ui-fg">
              {filename || "recipients.csv"}
            </span>
            {""}· {recipients.length} row
            {recipients.length === 1 ? "" : "s"} · click any cell to edit
          </p>
          <div className="max-h-64 overflow-auto rounded-lg border border-ui-border bg-ui-panel">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-ink-50 text-ui-fg-muted">
                <tr>
                  <th className="px-2 py-2 w-6"></th>
                  {columns.map((k) => (
                    <th
                      key={k}
                      className="px-3 py-2 font-semibold uppercase tracking-wider text-2xs"
                    >
                      {k}
                    </th>
                  ))}
                  <th className="px-3 py-2 w-12"></th>
                </tr>
              </thead>
              <tbody>
                {recipients.map((r, i) => {
                  const status = r.email
                    ? sendStatuses[String(r.email).toLowerCase()]
                    : null;
                  return (
                    <tr key={i} className="border-t border-ink-100">
                      <td className="px-2 py-1 text-center align-middle">
                        <StatusDot status={status} />
                      </td>
                      {columns.map((k) => (
                        <td key={k} className="px-1 py-1 text-ui-fg">
                          <input
                            type="text"
                            className="w-full rounded border border-transparent bg-transparent px-2 py-1 text-xs hover:border-ui-border focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-200 dark:hover:border-ink-700 dark:focus:border-brand-400 dark:focus:ring-brand-900/40"
                            value={r[k] ?? ""}
                            onChange={(e) => updateCell(i, k, e.target.value)}
                            aria-label={`Row ${i + 1} ${k}`}
                          />
                        </td>
                      ))}
                      <td className="px-2 py-1 text-right">
                        <button
                          type="button"
                          className="btn-ghost btn-xs text-rose-700 hover:bg-rose-50 dark:text-rose-300 dark:ring-rose-800/50 dark:bg-rose-900/20 dark:hover:bg-rose-900/40"
                          onClick={() => removeRow(i)}
                          title="Remove this row"
                          aria-label={`Remove row ${i + 1}`}
                        >
                          ×
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </fieldset>
  );
}
