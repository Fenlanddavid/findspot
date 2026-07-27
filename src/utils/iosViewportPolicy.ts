export type ViewportNavigatorSignals = Pick<
  Navigator,
  "userAgent" | "platform" | "maxTouchPoints"
>;

export function isIOSViewportDevice(
  signals: ViewportNavigatorSignals,
): boolean {
  return /iPad|iPhone|iPod/i.test(signals.userAgent)
    || (signals.platform === "MacIntel" && signals.maxTouchPoints > 1);
}

/**
 * Prevents iOS Safari from automatically magnifying controls whose existing
 * visual design uses text below 16px. This is deliberately scoped to Apple
 * touch devices so Android and desktop retain their current viewport policy.
 *
 * Modern iOS still permits the user's explicit accessibility zoom gestures;
 * this directive suppresses the automatic zoom that occurs on control focus.
 */
export function applyIOSFocusZoomPolicy(
  documentRef: Document = document,
  navigatorRef: ViewportNavigatorSignals = navigator,
): boolean {
  if (!isIOSViewportDevice(navigatorRef)) return false;

  const viewport = documentRef.querySelector<HTMLMetaElement>('meta[name="viewport"]');
  if (!viewport) return false;

  const directives = viewport.content
    .split(",")
    .map(directive => directive.trim())
    .filter(Boolean)
    .filter(directive => !/^maximum-scale\s*=/i.test(directive));

  directives.push("maximum-scale=1.0");
  viewport.content = directives.join(", ");
  return true;
}
