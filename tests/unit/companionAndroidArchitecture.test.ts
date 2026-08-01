import { readdir, readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const ANDROID = new URL('../../companion/android/app/src/main/', import.meta.url);

describe('Android Companion architecture', () => {
  it('declares location foreground infrastructure without network or backup capability', async () => {
    const manifest = await readFile(new URL('AndroidManifest.xml', ANDROID), 'utf8');
    expect(manifest).toContain('android.permission.FOREGROUND_SERVICE_LOCATION');
    expect(manifest).toContain('android:foregroundServiceType="location"');
    expect(manifest).toContain('android:allowBackup="false"');
    expect(manifest).toContain('android:dataExtractionRules="@xml/data_extraction_rules"');
    expect(manifest).not.toContain('android.permission.INTERNET');
  });

  it('uses branded adaptive launcher resources and an in-app FindSpot mark', async () => {
    const manifest = await readFile(new URL('AndroidManifest.xml', ANDROID), 'utf8');
    const activity = await readFile(new URL(
      'java/uk/findspot/companion/MainActivity.java',
      ANDROID,
    ), 'utf8');
    const launcher = await readFile(new URL('res/mipmap-anydpi-v26/ic_launcher.xml', ANDROID), 'utf8');
    const logo = await readFile(new URL('res/drawable/findspot_logo.xml', ANDROID), 'utf8');
    expect(manifest).toContain('android:icon="@mipmap/ic_launcher"');
    expect(manifest).toContain('android:roundIcon="@mipmap/ic_launcher"');
    expect(launcher).toContain('@drawable/ic_launcher_foreground');
    expect(activity).toContain('R.drawable.findspot_logo');
    expect(activity).toContain('TextView title = text("FindSpot", 24');
    expect(activity).toContain('new LinearGradient(');
    expect(activity).toContain('TextView companion = text("COMPANION", 10');
    expect(logo).toContain('#FF10B981');
    expect(logo).toContain('#FF0EA5E9');
  });

  it('guards startup recovery while the foreground service request is in flight', async () => {
    const activity = await readFile(new URL(
      'java/uk/findspot/companion/MainActivity.java',
      ANDROID,
    ), 'utf8');
    const service = await readFile(new URL(
      'java/uk/findspot/companion/RecordingService.java',
      ANDROID,
    ), 'utf8');
    expect(activity).toContain('RecordingService.markStartRequested()');
    expect(activity).toContain('RecordingService.isRunningOrStarting()');
    expect(service).toContain('START_REQUEST_GRACE_NS');
    expect(service).toContain('clearStartRequested()');
  });

  it('commits delivered callbacks and preserves first-class segment rows', async () => {
    const store = await readFile(new URL(
      'java/uk/findspot/companion/RecordingStore.java',
      ANDROID,
    ), 'utf8');
    const service = await readFile(new URL(
      'java/uk/findspot/companion/RecordingService.java',
      ANDROID,
    ), 'utf8');
    expect(store).toContain('setWriteAheadLoggingEnabled(true)');
    expect(store).toContain('CREATE TABLE segments');
    expect(store).toContain('database.beginTransaction()');
    expect(service).toContain('store.appendLocation(recordingUuid, location');
    expect(service).toContain('.setMinUpdateDistanceMeters(5f)');
    expect(service).not.toMatch(/accuracy\s*[<>]=?\s*\d/);
  });

  it('contains no application network client imports', async () => {
    const sourceDirectory = new URL('java/uk/findspot/companion/', ANDROID);
    const files = (await readdir(sourceDirectory)).filter(name => name.endsWith('.java'));
    const sources = await Promise.all(files.map(name => readFile(new URL(name, sourceDirectory), 'utf8')));
    const combined = sources.join('\n');
    expect(combined).not.toMatch(/import\s+(java\.net|okhttp3|retrofit2|io\.ktor)/);
  });
});
