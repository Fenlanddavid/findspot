export const COMPANION_PACKAGE_NAME = 'uk.findspot.companion';
export const COMPANION_RECORDING_URL = 'findspot-companion://record/start';

// Keep direct sideloading disabled. Public Android builds are distributed
// through Google Play so security protections do not need to be weakened.
// Internal testers install through Google Play's immutable opt-in URL.
export const COMPANION_DOWNLOAD_URL = 'https://play.google.com/apps/internaltest/4701707452582884992';

export function isAndroidUserAgent(userAgent = (
  typeof navigator === 'undefined' ? '' : navigator.userAgent
)): boolean {
  return /Android/i.test(userAgent);
}

export function companionFallbackPath(
  sessionId?: string,
  basePath = import.meta.env.BASE_URL,
): string {
  const params = new URLSearchParams({ companion: 'missing' });
  if (sessionId) params.set('session', sessionId);
  return `${basePath}companion-import?${params.toString()}`;
}

export function buildCompanionRecordingIntent(fallbackUrl: string): string {
  return 'intent://record/start#Intent;'
    + 'scheme=findspot-companion;'
    + `package=${COMPANION_PACKAGE_NAME};`
    + `S.browser_fallback_url=${encodeURIComponent(fallbackUrl)};end`;
}

export function companionRecordingHref(sessionId?: string): string {
  const fallbackPath = companionFallbackPath(sessionId);
  if (typeof window === 'undefined') return COMPANION_RECORDING_URL;
  if (!isAndroidUserAgent()) return fallbackPath;
  return buildCompanionRecordingIntent(new URL(fallbackPath, window.location.origin).href);
}
