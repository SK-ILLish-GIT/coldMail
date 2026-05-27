import { useEffect, useState } from "react";

import { tailorApi, overleafImportUrl } from "../../lib/tailorApi.js";
import { TagInput } from "../Tags.jsx";

// Build a more descriptive default name like"Senior Backend Engineer @ Stripe
// · 2026-05-23" so multiple tailored versions don't collide and the user can
// scan their resume library at a glance.
function defaultSaveName(session) {
  const date = new Date().toISOString().slice(0, 10);
  const role = (session?.targetRole || "").trim();
  const company = (session?.targetCompany || "").trim();
  if (role && company) return `${role} @ ${company} · ${date}`;
  if (company) return `${company} resume · ${date}`;
  if (role) return `${role} · ${date}`;
  return `tailored-resume · ${date}`;
}

function downloadBlob(buf, filename, mime) {
  const blob = new Blob([buf], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function base64ToBuf(b64) {
  const bin = atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) buf[i] = bin.charCodeAt(i);
  return buf;
}

export default function FinalActions({
  session,
  onRollback,
  onCompileMessage,
  // When true, the user has opted out of sending content to texlive.net —
  // hide compile actions and only allow local zip download.
  texliveOptOut = false,
}) {
  const [compiling, setCompiling] = useState(false);
  const [pdfUrl, setPdfUrl] = useState("");
  const [pdfBlobBuf, setPdfBlobBuf] = useState(null);
  const [compileLog, setCompileLog] = useState("");
  const [compileSummary, setCompileSummary] = useState("");
  const [savedId, setSavedId] = useState("");
  const [pageCount, setPageCount] = useState(0);
  const [tags, setTags] = useState([]);
  const [saveName, setSaveName] = useState(() => defaultSaveName(session));

  // Fetch auto-suggested tags when the panel mounts. The user can edit them
  // before clicking"Compile & save"; the server uses whatever the panel sends.
  useEffect(() => {
    let cancelled = false;
    tailorApi
      .autoTags(session.sessionId)
      .then((r) => {
        if (!cancelled && Array.isArray(r?.tags)) setTags(r.tags);
      })
      .catch(() => {
        /* non-fatal: user can still type tags manually */
      });
    return () => {
      cancelled = true;
    };
  }, [session.sessionId]);

  const compile = async ({ save = false } = {}) => {
    setCompiling(true);
    setCompileLog("");
    setCompileSummary("");
    try {
      const r = await tailorApi.compile(session.sessionId, {
        save,
        name: save ? saveName : undefined,
        // Only pass tags on save — they're persisted to the resume library.
        tags: save ? tags : undefined,
      });
      const buf = base64ToBuf(r.pdfBase64);
      setPdfBlobBuf(buf);
      const blob = new Blob([buf], { type: "application/pdf" });
      if (pdfUrl) URL.revokeObjectURL(pdfUrl);
      setPdfUrl(URL.createObjectURL(blob));
      setPageCount(r.pageCount || 0);
      if (save && r.saved) {
        setSavedId(r.saved.id);
        onCompileMessage?.(`Saved"${r.saved.name}" to your resume library.`);
      } else {
        onCompileMessage?.("PDF compiled. Preview is ready.");
      }
    } catch (err) {
      if (err.log) {
        setCompileLog(err.log);
        setCompileSummary(err.logSummary || "");
        const headline = err.logSummary?.split("\n")[0] || "See log below.";
        onCompileMessage?.(`Compilation failed on texlive.net. ${headline}`);
      } else {
        onCompileMessage?.(err.message || "Compile failed.");
      }
    } finally {
      setCompiling(false);
    }
  };

  const downloadPdf = () => {
    if (!pdfBlobBuf) return;
    downloadBlob(
      pdfBlobBuf,
      `${saveName || "tailored-resume"}.pdf`,
      "application/pdf",
    );
  };

  const downloadZip = () => {
    const link = document.createElement("a");
    link.href = tailorApi.zipUrl(session.sessionId);
    link.download = `${saveName || "tailored-resume"}.zip`;
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  const openOverleaf = () => {
    const abs = new URL(
      tailorApi.zipUrl(session.sessionId),
      window.location.origin,
    ).toString();
    window.open(overleafImportUrl(abs), "_blank", "noopener,noreferrer");
  };

  // Overleaf imports work by fetching the zip URL from Overleaf's servers, so
  // a localhost URL silently fails. Hide the button unless we're on a publicly
  // reachable hostname.
  const overleafReachable = (() => {
    if (typeof window === "undefined") return false;
    const h = window.location.hostname;
    return h && h !== "localhost" && h !== "127.0.0.1" && !h.endsWith(".local");
  })();

  return (
    <div className="surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h4 className="text-sm font-semibold text-ui-fg">Finalize</h4>
          <p className="mt-1 text-xs text-ui-fg-muted">
            Compile the tailored .tex files into a PDF via texlive.net, or
            download the sources.
          </p>
        </div>
        {pageCount > 0 ? (
          <span className={pageCount === 1 ? "pill-emerald" : "pill-amber"}>
            {pageCount} {pageCount === 1 ? "page" : "pages"}
          </span>
        ) : null}
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <div>
          <label className="label">Save name</label>
          <input
            className="input"
            value={saveName}
            onChange={(e) => setSaveName(e.target.value)}
            placeholder="tailored-resume"
          />
        </div>
        {texliveOptOut ? (
          <div className="flex items-end">
            <p className="callout-warning text-2xs">
              Compile disabled (texlive.net opt-out is on). Use Download .tex
              zip below and compile locally.
            </p>
          </div>
        ) : (
          <div className="flex items-end gap-2">
            <button
              className="btn-gradient flex-1"
              onClick={() => compile({ save: false })}
              disabled={compiling}
            >
              {compiling ? "Compiling..." : "Compile PDF"}
            </button>
            <button
              className="btn-primary"
              onClick={() => compile({ save: true })}
              disabled={compiling || !saveName.trim()}
            >
              Compile &amp; save
            </button>
          </div>
        )}
      </div>

      <div className="mt-3">
        <label className="label">
          Tags
          <span className="ml-1 font-normal normal-case tracking-normal text-ui-fg-muted">
            (auto-filled from your skills + JD keywords; used to auto-pick this
            resume on future JDs)
          </span>
        </label>
        <TagInput
          tags={tags}
          onChange={setTags}
          placeholder="backend, kubernetes, distributed-systems..."
        />
      </div>

      <p className="mt-2 text-2xs text-ui-fg-muted">
        Compiles via texlive.net (public LaTeX service). Your resume content is
        sent there to render the PDF.
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        {!texliveOptOut && (
          <button
            className="btn-secondary"
            onClick={downloadPdf}
            disabled={!pdfBlobBuf}
          >
            Download PDF
          </button>
        )}
        <button className="btn-secondary" onClick={downloadZip}>
          Download .tex zip
        </button>
        {!texliveOptOut && overleafReachable ? (
          <button
            className="btn-ghost"
            onClick={openOverleaf}
            title="Opens Overleaf and imports the zip from this app's public URL."
          >
            Open in Overleaf
          </button>
        ) : null}
        <button
          className="btn-danger ml-auto"
          onClick={onRollback}
          title="Restore every .tex file in this session to its pre-tailoring state."
        >
          Rollback all
        </button>
      </div>

      {savedId ? (
        <p className="mt-3 text-xs text-emerald-700 dark:text-emerald-300">
          Saved to library with id <code>{savedId}</code>. Find it in the
          Resumes tab.
        </p>
      ) : null}

      {pdfUrl ? (
        <div className="mt-4 overflow-hidden rounded-lg border border-ui-border/70">
          <iframe
            title="Tailored resume preview"
            src={pdfUrl}
            className="h-[70vh] w-full bg-white"
          />
        </div>
      ) : null}

      {compileSummary ? (
        <div className="mt-4 rounded-lg border border-rose-200/70 bg-rose-50/70 px-3 py-2 dark:border-rose-800/60 dark:bg-rose-900/20">
          <p className="text-xs font-semibold text-rose-800 dark:text-rose-200">
            LaTeX compile error
          </p>
          <pre className="mt-1 whitespace-pre-wrap break-words font-mono text-2xs text-rose-900 dark:text-rose-100">
            {compileSummary}
          </pre>
        </div>
      ) : null}

      {compileLog ? (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs font-medium text-rose-600 dark:text-rose-300">
            Full compile log (tail)
          </summary>
          <pre className="mt-2 max-h-64 overflow-auto rounded bg-ink-50 px-3 py-2 text-2xs text-ui-fg bg-ui-inset">
            {compileLog}
          </pre>
        </details>
      ) : null}
    </div>
  );
}
