const ICONS = {
  mail: (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 7l9 6 9-6" />
    </svg>
  ),
  template: (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="3" width="18" height="18" rx="2.5" />
      <path d="M3 9h18" />
      <path d="M9 21V9" />
    </svg>
  ),
};

export default function EmptyState({
  icon = "mail",
  title,
  description,
  action,
}) {
  return (
    <div className="grid place-items-center px-6 py-14 text-center">
      <div className="icon-brand-muted mx-auto flex h-12 w-12 items-center justify-center rounded-2xl shadow-soft">
        <span className="h-6 w-6">{ICONS[icon] || ICONS.mail}</span>
      </div>
      <h3 className="mt-3 text-sm font-semibold text-ui-fg">{title}</h3>
      {description && (
        <p className="mt-1 max-w-sm text-sm text-ui-fg-muted">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
