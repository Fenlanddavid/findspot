export const COMPANION_PACKAGE_NAME = 'uk.findspot.companion';
export const COMPANION_RECORDING_URL = 'findspot-companion://record/start';
export const COMPANION_STOP_URL = 'findspot-companion://record/stop';
export type CompanionControlAction = 'start' | 'stop';

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
  finishSession = false,
): string {
  const params = new URLSearchParams({ companion: 'missing' });
  if (sessionId) params.set('session', sessionId);
  if (finishSession) params.set('finish', '1');
  return `${basePath}companion-import?${params.toString()}`;
}

function companionControlQuery(sessionId?: string, finishSession = false): string {
  const params = new URLSearchParams();
  if (sessionId) params.set('session', sessionId);
  if (finishSession) params.set('finish', '1');
  const query = params.toString();
  return query ? `?${query}` : '';
}

export function buildCompanionControlIntent(
  action: CompanionControlAction,
  fallbackUrl: string,
  sessionId?: string,
  finishSession = false,
): string {
  return `intent://record/${action}${companionControlQuery(sessionId, finishSession)}#Intent;`
    + 'scheme=findspot-companion;'
    + `package=${COMPANION_PACKAGE_NAME};`
    + `S.browser_fallback_url=${encodeURIComponent(fallbackUrl)};end`;
}

export function buildCompanionRecordingIntent(fallbackUrl: string): string {
  return buildCompanionControlIntent('start', fallbackUrl);
}

export function companionControlHref(
  action: CompanionControlAction,
  sessionId?: string,
  finishSession = false,
): string {
  const baseUrl = action === 'start' ? COMPANION_RECORDING_URL : COMPANION_STOP_URL;
  const directUrl = `${baseUrl}${companionControlQuery(sessionId, finishSession)}`;
  const fallbackPath = companionFallbackPath(sessionId, import.meta.env.BASE_URL, finishSession);
  if (typeof window === 'undefined') return directUrl;
  if (!isAndroidUserAgent()) return fallbackPath;
  return buildCompanionControlIntent(
    action,
    new URL(fallbackPath, window.location.origin).href,
    sessionId,
    finishSession,
  );
}

export function companionRecordingHref(sessionId?: string): string {
  return companionControlHref('start', sessionId);
}
