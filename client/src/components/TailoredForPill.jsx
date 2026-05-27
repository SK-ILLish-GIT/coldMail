// Small, dense pill that shows the JD context that produced a tailored item
// (resume PDF or email template). Render only when `tailoredFor` is set.
//
// Examples:
//"Tailored for Senior Backend Engineer @ Stripe · +14 ATS"
//"Tailored for Stripe · 2 paragraphs edited"
//"Tailored · 2026-05-23"

function fmtDate(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString();
  } catch {
    return "";
  }
}

function buildHeadline(t) {
  const parts = [];
  if (t.role) parts.push(t.role);
  if (t.company) parts.push(`@ ${t.company}`);
  if (!parts.length && t.seniority) parts.push(t.seniority);
  return parts.join("");
}

export default function TailoredForPill({ tailoredFor }) {
  if (!tailoredFor || typeof tailoredFor !== "object") return null;
  const headline = buildHeadline(tailoredFor) || "a JD";

  // ATS delta (resumes only).
  let scoreSuffix = null;
  if (
    typeof tailoredFor.atsScoreInitial === "number" &&
    typeof tailoredFor.atsScoreFinal === "number"
  ) {
    const delta = tailoredFor.atsScoreFinal - tailoredFor.atsScoreInitial;
    if (delta !== 0) {
      const sign = delta > 0 ? "+" : "";
      scoreSuffix = `${sign}${delta} ATS`;
    }
  }
  // Otherwise, show edit count (templates).
  let editsSuffix = null;
  if (!scoreSuffix && typeof tailoredFor.appliedCount === "number") {
    const n = tailoredFor.appliedCount;
    if (n > 0) editsSuffix = `${n} edit${n === 1 ? "" : "s"}`;
  }
  const date = fmtDate(tailoredFor.savedAt);

  return (
    <span
      className="inline-flex max-w-full items-center gap-1.5 truncate rounded-full bg-brand-50 px-2 py-0.5 text-2xs font-medium text-brand-700 ring-1 ring-inset ring-brand-100 dark:bg-brand-900/30 dark:text-brand-200 dark:ring-brand-800/50"
      title={
        tailoredFor.jdPreview
          ? `JD: ${tailoredFor.jdPreview}\nSaved: ${date}`
          : `Saved: ${date}`
      }
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-3 w-3 shrink-0"
        aria-hidden
      >
        <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z" />
      </svg>
      <span className="truncate">
        Tailored for {headline}
        {scoreSuffix ? <> · {scoreSuffix}</> : null}
        {editsSuffix ? <> · {editsSuffix}</> : null}
      </span>
    </span>
  );
}
