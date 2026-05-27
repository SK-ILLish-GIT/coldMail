function Delta({ before, after, suffix = "" }) {
  const diff = Math.round((after - before) * 10) / 10;
  const tone =
    diff > 0
      ? "text-emerald-600 dark:text-emerald-300"
      : diff < 0
        ? "text-rose-600 dark:text-rose-300"
        : "text-ui-fg-muted";
  const sign = diff > 0 ? "+" : "";
  return (
    <span className={`text-xs font-medium ${tone}`}>
      {sign}
      {diff}
      {suffix}
    </span>
  );
}

function Bar({ value, max = 100 }) {
  const pct = Math.max(0, Math.min(100, Math.round((value / max) * 100)));
  return (
    <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-ui-inset">
      <div className="h-full bg-brand-600 dark:bg-brand-500/90" style={{ width: `${pct}%` }} />
    </div>
  );
}

export default function ScorePanel({ initial, current }) {
  const missing = current?.missingKeywords?.slice(0, 12) || [];
  return (
    <div className="card p-5">
      <h3 className="text-base font-semibold text-ui-fg">Scores</h3>

      <div className="mt-3 grid gap-3">
        <div>
          <div className="flex items-baseline justify-between">
            <span className="text-xs font-medium text-ui-fg-subtle">
              JD match
            </span>
            <span className="text-sm font-semibold text-ui-fg">
              {current.jdMatchPct}%{""}
              <Delta
                before={initial.jdMatchPct}
                after={current.jdMatchPct}
                suffix="%"
              />
            </span>
          </div>
          <Bar value={current.jdMatchPct} max={100} />
        </div>
        <div>
          <div className="flex items-baseline justify-between">
            <span className="text-xs font-medium text-ui-fg-subtle">
              ATS score
            </span>
            <span className="text-sm font-semibold text-ui-fg">
              {current.atsScore}
              {""}
              <Delta before={initial.atsScore} after={current.atsScore} />
            </span>
          </div>
          <Bar value={current.atsScore} max={100} />
        </div>
      </div>

      {missing.length ? (
        <div className="mt-4">
          <p className="label">Missing JD keywords</p>
          <div className="flex flex-wrap gap-1.5">
            {missing.map((k) => (
              <span
                key={k.keyword}
                className="pill-amber"
                title={`Appears ${k.count}x in JD`}
              >
                {k.keyword}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {current?.atsChecks?.length ? (
        <details className="mt-4 text-xs text-ui-fg-muted">
          <summary className="cursor-pointer font-medium">
            ATS checklist
          </summary>
          <ul className="mt-2 space-y-1">
            {current.atsChecks.map((c, i) => (
              <li
                key={i}
                className={
                  c.pass
                    ? "text-emerald-700 dark:text-emerald-300"
                    : "text-rose-700 dark:text-rose-300"
                }
              >
                {c.pass ? "PASS" : "FAIL"} · {c.label}
                {c.detail ? ` (${c.detail})` : ""}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
