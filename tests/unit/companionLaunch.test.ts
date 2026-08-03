import { describe, expect, it } from 'vitest';
import {
  buildCompanionRecordingIntent,
  buildCompanionControlIntent,
  companionControlHref,
  companionFallbackPath,
  COMPANION_DOWNLOAD_URL,
  COMPANION_PACKAGE_NAME,
  COMPANION_RECORDING_URL,
  COMPANION_STOP_URL,
  isAndroidUserAgent,
} from '../../src/services/companionLaunch';

describe('Companion launch handoff', () => {
  it('uses the Android deep link accepted by the native recorder', () => {
    expect(COMPANION_RECORDING_URL).toBe('findspot-companion://record/start');
    expect(COMPANION_STOP_URL).toBe('findspot-companion://record/stop');
  });

  it('offers the Google Play internal-test opt-in instead of a direct APK', () => {
    expect(COMPANION_DOWNLOAD_URL).toBe(
      'https://play.google.com/apps/internaltest/4701707452582884992',
    );
  });

  it('limits the native launch handoff to Android devices', () => {
    expect(isAndroidUserAgent('Mozilla/5.0 (Linux; Android 17; Pixel 10 Pro)')).toBe(true);
    expect(isAndroidUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X)')).toBe(false);
    expect(isAndroidUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')).toBe(false);
  });

  it('targets the Companion package and falls back into FindSpot when it is absent', () => {
    const fallback = 'https://fenlanddavid.github.io/findspot/companion-import?companion=missing&session=session-1';
    const intent = buildCompanionRecordingIntent(fallback);
    expect(COMPANION_PACKAGE_NAME).toBe('uk.findspot.companion');
    expect(intent).toContain('intent://record/start#Intent;scheme=findspot-companion;');
    expect(intent).toContain('package=uk.findspot.companion;');
    expect(intent).toContain(`S.browser_fallback_url=${encodeURIComponent(fallback)};end`);
    expect(buildCompanionControlIntent('stop', fallback)).toContain('intent://record/stop#Intent;');
    expect(buildCompanionControlIntent('stop', fallback, 'session-1', true))
      .toContain('intent://record/stop?session=session-1&finish=1#Intent;');
  });

  it('builds server-safe direct controls for both native actions', () => {
    expect(companionControlHref('start', 'session-1')).toBe(`${COMPANION_RECORDING_URL}?session=session-1`);
    expect(companionControlHref('stop', 'session-1')).toBe(`${COMPANION_STOP_URL}?session=session-1`);
    expect(companionControlHref('stop', 'session-1', true))
      .toBe(`${COMPANION_STOP_URL}?session=session-1&finish=1`);
  });

  it('preserves the session identity in the no-Companion fallback', () => {
    expect(companionFallbackPath('session-1', '/findspot/')).toBe(
      '/findspot/companion-import?companion=missing&session=session-1',
    );
    expect(companionFallbackPath('session-1', '/findspot/', true)).toBe(
      '/findspot/companion-import?companion=missing&session=session-1&finish=1',
    );
  });
});
