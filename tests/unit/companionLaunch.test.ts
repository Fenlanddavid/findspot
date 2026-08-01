import { describe, expect, it } from 'vitest';
import {
  buildCompanionRecordingIntent,
  companionFallbackPath,
  COMPANION_DOWNLOAD_URL,
  COMPANION_PACKAGE_NAME,
  COMPANION_RECORDING_URL,
  isAndroidUserAgent,
} from '../../src/services/companionLaunch';

describe('Companion launch handoff', () => {
  it('uses the Android deep link accepted by the native recorder', () => {
    expect(COMPANION_RECORDING_URL).toBe('findspot-companion://record/start');
  });

  it('does not offer a direct APK sideload while Play distribution is pending', () => {
    expect(COMPANION_DOWNLOAD_URL).toBe('');
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
  });

  it('preserves the session identity in the no-Companion fallback', () => {
    expect(companionFallbackPath('session-1', '/findspot/')).toBe(
      '/findspot/companion-import?companion=missing&session=session-1',
    );
  });
});
