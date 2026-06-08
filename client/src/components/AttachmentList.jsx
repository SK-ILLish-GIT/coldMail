import { useRef, useState } from "react";
import toast from "react-hot-toast";

const MAX_FILES = 5;
const MAX_FILE_BYTES = 10 * 1024 * 1024;

function isPdf(file) {
  if (!file) return false;
  if (file.type === "application/pdf") return true;
  return /\.pdf$/i.test(file.name || "");
}

function fmtSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function AttachmentList({ files, onChange }) {
  const inputRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);

  const add = (incoming) => {
    const list = Array.from(incoming || []);
    if (!list.length) return;

    const accepted = [];
    for (const f of list) {
      if (!isPdf(f)) {
        toast.error(`"${f.name}" isn’t a PDF — skipped.`);
        continue;
      }
      if (f.size > MAX_FILE_BYTES) {
        toast.error(`"${f.name}" is over 10 MB — skipped.`);
        continue;
      }
      // Dedupe by name + size
      const dup = files.find((x) => x.name === f.name && x.size === f.size);
      if (!dup) accepted.push(f);
    }
    if (!accepted.length) return;

    const next = [...files, ...accepted].slice(0, MAX_FILES);
    if (files.length + accepted.length > MAX_FILES) {
      toast.error(`Max ${MAX_FILES} attachments. Some files were dropped.`);
    }
    onChange(next);
  };

  const removeAt = (i) => {
    const next = files.filter((_, idx) => idx !== i);
    onChange(next);
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    add(e.dataTransfer?.files);
  };

  return (
    <div>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className={[
          "flex flex-wrap items-center justify-between gap-3 rounded-xl border-2 border-dashed bg-ui-inset/50 px-4 py-3 transition",
          dragOver ? "border-brand-400 bg-brand-50/60" : "border-ui-border",
        ].join(" ")}
      >
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-ui-panel text-ui-fg-muted ring-1 ring-inset ring-ink-200">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-4 w-4"
            >
              <path d="M21.44 11.05L12.25 20.24a6 6 0 0 1-8.49-8.49l8.57-8.57a4 4 0 0 1 5.66 5.66l-8.58 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
            </svg>
          </span>
          <div>
            <p className="text-sm font-medium text-ink-800">
              {files.length
                ? `${files.length} PDF${files.length === 1 ? "" : "s"} attached`
                : "Attach PDFs"}
            </p>
            <p className="text-xs text-ui-fg-muted">
              PDF only · max {MAX_FILES} files · 10 MB each. Drop here or
              browse.
            </p>
          </div>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf"
          multiple
          className="hidden"
          onChange={(e) => {
            add(e.target.files);
            // Reset so re-selecting the same file fires onChange.
            if (inputRef.current) inputRef.current.value = "";
          }}
        />
        <button
          type="button"
          className="btn-secondary btn-xs"
          onClick={() => inputRef.current?.click()}
          disabled={files.length >= MAX_FILES}
        >
          {files.length ? "Add more" : "Browse"}
        </button>
      </div>

      {files.length > 0 && (
        <ul className="mt-2 space-y-1.5">
          {files.map((f, i) => (
            <li
              key={`${f.name}-${f.size}-${i}`}
              className="flex items-center justify-between gap-3 rounded-lg border border-ui-border/70 bg-ui-panel px-3 py-2 shadow-soft"
            >
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-rose-50 text-rose-600">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="h-3.5 w-3.5"
                  >
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                  </svg>
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink-800">
                    {f.name}
                  </p>
                  <p className="text-2xs text-ui-fg-muted">{fmtSize(f.size)}</p>
                </div>
              </div>
              <button
                type="button"
                className="btn-ghost btn-xs"
                onClick={() => removeAt(i)}
                aria-label={`Remove ${f.name}`}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-3.5 w-3.5"
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
