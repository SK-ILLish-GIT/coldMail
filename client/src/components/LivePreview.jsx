import { useMemo } from 'react';

import { renderTemplate } from '../lib/render.js';

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
  attachmentCount = 0,
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
    <div className="flex flex-col">
      <header className="flex flex-wrap items-start justify-between gap-3 px-5 py-3.5">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-ink-900 dark:text-white">
            {renderedSubject || (
              <span className="font-normal italic text-ink-400 dark:text-ink-500">No subject</span>
            )}
          </p>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-ink-500 dark:text-ink-400">
            {to && (
              <span className="truncate">
                To <span className="font-medium text-ink-700 dark:text-ink-200">{to}</span>
              </span>
            )}
            {attachmentCount > 0 && (
              <span className="inline-flex items-center gap-1">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-3 w-3"
                >
                  <path d="M21.44 11.05L12.25 20.24a6 6 0 0 1-8.49-8.49l8.57-8.57a4 4 0 0 1 5.66 5.66l-8.58 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                </svg>
                {attachmentCount} attachment{attachmentCount === 1 ? '' : 's'}
              </span>
            )}
          </div>
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

      <div className="border-t border-ink-200/60 dark:border-ink-800 bg-ink-100/60 dark:bg-ink-800/40 p-4">
        {empty ? (
          <div className="grid h-[520px] place-items-center rounded-lg border border-dashed border-ink-300 dark:border-ink-700 bg-white dark:bg-ink-900 text-center text-sm text-ink-500 dark:text-ink-400">
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
            className="preview-frame h-[520px] w-full rounded-lg border border-ink-200 dark:border-ink-700 bg-white"
          />
        )}
      </div>
    </div>
  );
}
