export const COMPANION_PACKAGE_NAME = 'uk.findspot.companion';
export const COMPANION_RECORDING_URL = 'findspot-companion://record/start';

// Immutable signed beta asset. Never point this at a debug APK or a mutable
// workspace build.
export const COMPANION_DOWNLOAD_URL =
  'https://github.com/Fenlanddavid/findspot/releases/download/companion-v1.0.0-beta.1/findspot-companion-v1.0.0-beta.1.apk';

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
