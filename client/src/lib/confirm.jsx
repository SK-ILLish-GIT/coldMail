import toast from "react-hot-toast";

/**
 * Themed replacement for `window.confirm()`. Returns a Promise<boolean>.
 * Uses react-hot-toast's `toast.custom` so it inherits app styling and
 * stacks naturally with other toasts. Pin position to top-center so the
 * dialog can't be dismissed by accident.
 *
 * Usage:
 * if (!(await confirmAsync({ title: 'Delete?', danger: true }))) return;
 */
export function confirmAsync({
  title,
  description = "",
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  danger = false,
} = {}) {
  return new Promise((resolve) => {
    const id = toast.custom(
      (t) => (
        <div
          className={`pointer-events-auto card w-[22rem] max-w-[90vw] p-4 shadow-lift transition ${
            t.visible ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-2"
          }`}
        >
          <p className="text-sm font-semibold text-ui-fg">{title}</p>
          {description ? (
            <p className="mt-1 text-xs text-ui-fg-subtle">{description}</p>
          ) : null}
          <div className="mt-3 flex justify-end gap-2">
            <button
              type="button"
              className="btn-ghost btn-xs"
              onClick={() => {
                toast.dismiss(id);
                resolve(false);
              }}
            >
              {cancelLabel}
            </button>
            <button
              type="button"
              className={danger ? "btn-danger btn-xs" : "btn-primary btn-xs"}
              onClick={() => {
                toast.dismiss(id);
                resolve(true);
              }}
              autoFocus
            >
              {confirmLabel}
            </button>
          </div>
        </div>
      ),
      { duration: Infinity, position: "top-center" },
    );
  });
}
