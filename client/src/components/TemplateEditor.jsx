import { forwardRef } from "react";

import VariableChips from "./VariableChips.jsx";

/**
 * HTML template editor. Renders without its own card wrapper so it can be
 * embedded inside the tabbed Compose body.
 *
 * `inputRef` is forwarded to the underlying textarea so VariableChips can
 * insert tokens at the cursor.
 */
const TemplateEditor = forwardRef(function TemplateEditor(
  { value, onChange, detectedVars = [] },
  inputRef,
) {
  return (
    <div className="flex flex-col gap-3 p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-ui-fg">HTML body</p>
          <p className="hint">
            Plain HTML with{""}
            <code className="rounded bg-ui-inset px-1 font-mono text-2xs">{`{{vars}}`}</code>
            {""}
            for personalisation.
          </p>
        </div>
        <VariableChips inputRef={inputRef} extra={detectedVars} />
      </div>

      <textarea
        ref={inputRef}
        id="template"
        className="input-mono min-h-[480px]"
        placeholder="<h2>Hello {{name}}</h2>"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
      />

      {detectedVars.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-2xs uppercase tracking-wider text-ui-fg-muted">
            Detected:
          </span>
          {detectedVars.map((v) => (
            <span key={v} className="pill-brand font-mono">{`{{${v}}}`}</span>
          ))}
        </div>
      )}
    </div>
  );
});

export default TemplateEditor;
