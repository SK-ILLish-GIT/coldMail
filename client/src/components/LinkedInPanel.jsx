import { useState } from "react";
import toast from "react-hot-toast";

import { api } from "../lib/api.js";
import EnrichPanel from "./EnrichPanel.jsx";
import Spinner from "./Spinner.jsx";

// Common job-title tokens that often appear after the name in LinkedIn slugs.
// Stop tokenisation when we hit one of these.
const TITLE_STOP = new Set([
  "software",
  "engineer",
  "developer",
  "manager",
  "designer",
  "intern",
  "associate",
  "senior",
  "lead",
  "head",
  "founder",
  "cofounder",
  "ceo",
  "cto",
  "coo",
  "cfo",
  "specialist",
  "consultant",
  "analyst",
  "data",
  "scientist",
  "phd",
  "mba",
  "pm",
  "product",
  "marketing",
  "sales",
  "finance",
  "student",
  "graduate",
  "aspiring",
  "researcher",
  "engineering",
]);

// Best-effort: pull a likely Full Name out of a linkedin.com/in/<slug> URL.
// Strips a trailing alphanumeric hash (LinkedIn appends one for uniqueness),
// drops anything starting from the first job-title-ish token, and title-cases
// the rest. The user can always edit afterwards.
export function parseLinkedInSlug(input) {
  if (!input) return "";
  let slug = "";
  const m = String(input).match(/linkedin\.com\/in\/([^/?#]+)/i);
  if (m) {
    try {
      slug = decodeURIComponent(m[1]);
    } catch {
      slug = m[1];
    }
  } else {
    // Allow pasting a bare slug too.
    slug = String(input)
      .trim()
      .replace(/^\/+|\/+$/g, "");
  }
  if (!slug) return "";

  // Trailing 6+ char alphanumeric hash like"-a1b2c3d4". Require at least
  // one digit in the suffix so we don't accidentally strip real surnames
  // (e.g."-dupont" or"-johnson") that happen to be 6+ letters.
  slug = slug.replace(/-(?=[a-z0-9]*\d)[a-z0-9]{6,}$/i, "");

  const rawTokens = slug
    .split(/[-_]+/)
    .map((t) => t.trim())
    .filter((t) => t && !/^\d+$/.test(t));

  const nameTokens = [];
  for (const t of rawTokens) {
    if (TITLE_STOP.has(t.toLowerCase())) break;
    nameTokens.push(t);
    if (nameTokens.length >= 3) break; // first/middle/last is plenty
  }
  return nameTokens
    .map((t) => t.charAt(0).toUpperCase() + t.slice(1).toLowerCase())
    .join("");
}

function splitName(full) {
  const parts = (full || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: "", lastName: "" };
  if (parts.length === 1) return { firstName: parts[0], lastName: parts[0] };
  return { firstName: parts[0], lastName: parts[parts.length - 1] };
}

export default function LinkedInPanel({
  name,
  setName,
  company,
  setCompany,
  subject,
  template,
  jobLink = "",
  attachmentArgs = { extraPayload: {}, files: [] },
  aiEnabled = false,
}) {
  const [url, setUrl] = useState("");
  const [enriching, setEnriching] = useState(false);
  const [enrichResult, setEnrichResult] = useState(null);

  const extractFromUrl = () => {
    const parsed = parseLinkedInSlug(url);
    if (!parsed) {
      toast.error(
        "Could not parse a name from that URL. Paste a /in/<slug> profile link.",
      );
      return;
    }
    setName(parsed);
    toast.success(`Name set to"${parsed}". Edit if needed.`);
  };

  const canFind = aiEnabled && name.trim() && company.trim() && !enriching;

  const findEmails = async () => {
    if (!aiEnabled)
      return toast.error("AI is disabled. Set GEMINI_API_KEY on the server.");
    if (!name.trim()) return toast.error("Name is required.");
    if (!company.trim()) return toast.error("Company is required.");

    const { firstName, lastName } = splitName(name.trim());
    setEnriching(true);
    try {
      const res = await api.enrichEmail({
        firstName,
        lastName,
        company: company.trim(),
      });
      setEnrichResult(res);
      if (!res.candidates?.length) {
        toast.error("AI returned no usable candidates.");
      }
    } catch (err) {
      toast.error(err.message || "AI lookup failed");
    } finally {
      setEnriching(false);
    }
  };

  const clearResults = () => setEnrichResult(null);

  return (
    <fieldset className="space-y-4">
      <legend className="label !mb-2">LinkedIn profile</legend>

      <div>
        <label className="label" htmlFor="li-url">
          LinkedIn URL
        </label>
        <div className="flex gap-2">
          <input
            id="li-url"
            type="url"
            className="input flex-1"
            placeholder="https://www.linkedin.com/in/john-doe-a1b2c3d4"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <button
            type="button"
            className="btn-secondary btn-xs whitespace-nowrap"
            onClick={extractFromUrl}
            disabled={!url.trim()}
            title="Parse the name from the profile slug"
          >
            Extract name
          </button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="li-name">
            Full name
          </label>
          <input
            id="li-name"
            type="text"
            className="input"
            placeholder="John Doe"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              clearResults();
            }}
          />
        </div>
        <div>
          <label className="label" htmlFor="li-company">
            Company
          </label>
          <input
            id="li-company"
            type="text"
            className="input"
            placeholder="Acme Inc."
            value={company}
            onChange={(e) => {
              setCompany(e.target.value);
              clearResults();
            }}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="btn-secondary btn-xs"
          onClick={findEmails}
          disabled={!canFind}
          title={
            !aiEnabled
              ? "AI is disabled on the server"
              : !name.trim() || !company.trim()
                ? "Fill name + company first"
                : "Ask AI for likely email addresses"
          }
        >
          {enriching ? (
            <Spinner />
          ) : (
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
              <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z" />
            </svg>
          )}
          {enriching ? "Asking AI..." : "Find emails with AI"}
        </button>
        {!aiEnabled && (
          <span className="hint">AI disabled — set GEMINI_API_KEY.</span>
        )}
      </div>

      {enrichResult && (
        <div className="anim-in">
          <EnrichPanel
            result={enrichResult}
            recipientName={name}
            company={company}
            subject={subject}
            template={template}
            jobLink={jobLink}
            attachmentArgs={attachmentArgs}
          />
        </div>
      )}
    </fieldset>
  );
}
