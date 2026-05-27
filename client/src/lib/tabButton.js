/** Prevent mouse clicks from focusing tabs (stops focus-ring layout jump). */
export function tabMouseDown(e) {
  if (e.button === 0) e.preventDefault();
}

/** Run handler then drop focus so the focus ring never paints on click. */
export function tabClick(handler) {
  return (e) => {
    handler(e);
    e.currentTarget.blur();
  };
}
