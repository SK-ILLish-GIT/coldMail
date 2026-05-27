import { useMemo } from 'react';

import { renderTemplate } from '../lib/render.js';

function fmtSize(bytes) {
  if (!bytes || bytes < 1) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function AttachmentDetails({ attachment }) {
  return (
    <div className="shrink-0 border-t border-ink-200/60 bg-white/80 px-4 py-3 dark:border-ink-800 dark:bg-ink-900/60">
      <p className="text-2xs font-semibold uppercase tracking-[0.08em] text-ink-500 dark:text-ink-400">
        Attachment
      </p>
      {!attachment ? (
        <p className="mt-1 text-xs text-ink-500 dark:text-ink-400">
          No file attached — pick a saved resume or upload a PDF in the form.
        </p>
      ) : (
        <div className="mt-2 space-y-2 text-xs text-ink-700 dark:text-ink-200">
          <div className="flex items-start gap-2">
            <span className="pill-ink shrink-0">
              {attachment.kind === 'resume' ? 'Library' : 'Device'}
            </span>
            <p className="min-w-0 font-medium text-ink-900 dark:text-white">{attachment.name}</p>
          </div>
          {attachment.filename && attachment.filename !== attachment.name ? (
            <p className="font-mono text-2xs text-ink-500 dark:text-ink-400">
              File: {attachment.filename}
            </p>
          ) : null}
          <p className="text-2xs text-ink-500 dark:text-ink-400">
            {attachment.mimeType || 'application/pdf'}
            {attachment.size ? ` · ${fmtSize(attachment.size)}` : null}
          </p>
          {attachment.tags?.length ? (
            <p className="text-2xs text-ink-500 dark:text-ink-400">
              Tags: {attachment.tags.join(', ')}
            </p>
          ) : null}
          {attachment.tailoredFor ? (
            <p className="text-2xs text-ink-500 dark:text-ink-400">
              Tailored for:{' '}
              {[attachment.tailoredFor.role, attachment.tailoredFor.company]
                .filter(Boolean)
                .join(' · ') || 'JD match'}
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}

/**
 * Live preview of the current email, re-rendered as the user types.
 * Sandboxed iframe so template HTML cannot execute scripts or navigate the host.
 *
 * Renders without its own card wrapper so it can be embedded inside the
 * tabbed Compose body.
 */
export default function LivePreview({
  subject,
  template,
  vars,
  to,
  attachment = null,
  onOpenFull,
}) {
  const renderedSubject = useMemo(
    () => (subject ? renderTemplate(subject, vars) : ''),
    [subject, vars]
  );
  const renderedHtml = useMemo(
    () => (template ? renderTemplate(template, vars) : ''),
    [template, vars]
  );

  const empty = !template?.trim();

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="shrink-0 flex flex-wrap items-start justify-between gap-3 px-5 py-3.5">
        <div className="min-w-0 flex-1">
          <p className="text-2xs font-semibold uppercase tracking-[0.08em] text-ink-500 dark:text-ink-400">
            Live preview
          </p>
          <p className="mt-0.5 truncate text-sm font-semibold text-ink-900 dark:text-white">
            {renderedSubject || (
              <span className="font-normal italic text-ink-400 dark:text-ink-500">No subject</span>
            )}
          </p>
          {to ? (
            <p className="mt-0.5 truncate text-2xs text-ink-500 dark:text-ink-400">
              To <span className="font-medium text-ink-700 dark:text-ink-200">{to}</span>
            </p>
          ) : null}
        </div>
        {onOpenFull && (
          <button
            type="button"
            className="btn-ghost btn-xs shrink-0"
            onClick={onOpenFull}
            title="Open full-screen preview"
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
              <path d="M15 3h6v6" />
              <path d="M10 14L21 3" />
              <path d="M21 14v7H3V3h7" />
            </svg>
            Expand
          </button>
        )}
      </header>

      <div className="flex min-h-0 flex-1 flex-col bg-ink-50/30 dark:bg-ink-900/20">
        <div className="flex min-h-0 flex-1 flex-col p-4">
          {empty ? (
            <div className="grid min-h-[280px] flex-1 place-items-center rounded-lg border border-dashed border-ink-300 bg-white dark:border-ink-700 dark:bg-ink-900 text-center text-sm text-ink-500 dark:text-ink-400">
              <div className="max-w-xs">
                <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-brand-50 to-brand-100 text-brand-600 dark:from-brand-900/40 dark:to-brand-800/40 dark:text-brand-300">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="h-5 w-5"
                  >
                    <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                </div>
                <p className="mt-3 font-medium text-ink-800 dark:text-ink-100">Nothing to preview yet</p>
                <p className="mt-1 text-xs">
                  Pick a template or edit the body — the preview updates live.
                </p>
              </div>
            </div>
          ) : (
            <iframe
              title="Live email preview"
              srcDoc={renderedHtml}
              sandbox=""
              className="preview-frame min-h-[320px] w-full flex-1 rounded-lg border border-ink-200 bg-white dark:border-ink-700"
            />
          )}
        </div>
        <AttachmentDetails attachment={attachment} />
      </div>
    </div>
  );
}
