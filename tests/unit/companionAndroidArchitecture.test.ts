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

  it('uses a distinct trail launcher icon and an in-app FindSpot mark', async () => {
    const manifest = await readFile(new URL('AndroidManifest.xml', ANDROID), 'utf8');
    const activity = await readFile(new URL(
      'java/uk/findspot/companion/MainActivity.java',
      ANDROID,
    ), 'utf8');
    const launcher = await readFile(new URL('res/mipmap-anydpi-v26/ic_launcher.xml', ANDROID), 'utf8');
    const launcherForeground = await readFile(new URL(
      'res/drawable/ic_launcher_foreground.xml',
      ANDROID,
    ), 'utf8');
    const launcherColours = await readFile(new URL('res/values/colors.xml', ANDROID), 'utf8');
    const logo = await readFile(new URL('res/drawable/findspot_logo.xml', ANDROID), 'utf8');
    expect(manifest).toContain('android:icon="@mipmap/ic_launcher"');
    expect(manifest).toContain('android:roundIcon="@mipmap/ic_launcher"');
    expect(launcher).toContain('@drawable/ic_launcher_foreground');
    expect(launcherForeground).toContain('M154,352 C154,270');
    expect(launcherForeground).not.toContain('M256,126 A130,130');
    expect(launcherColours).toContain('#0F172A');
    expect(activity).toContain('R.drawable.findspot_logo');
    expect(activity).toContain('TextView title = text("FindSpot", 24');
    expect(activity).toContain('new LinearGradient(');
    expect(activity).toContain('TextView companion = text("COMPANION", 10');
    expect(logo).toContain('#FF10B981');
    expect(logo).toContain('#FF0EA5E9');
  });

  it('routes start and stop controls through FindSpot while keeping recovery available', async () => {
    const manifest = await readFile(new URL('AndroidManifest.xml', ANDROID), 'utf8');
    const activity = await readFile(new URL(
      'java/uk/findspot/companion/MainActivity.java',
      ANDROID,
    ), 'utf8');
    const notifications = await readFile(new URL(
      'java/uk/findspot/companion/CompanionNotifications.java',
      ANDROID,
    ), 'utf8');
    expect(manifest).toContain('android:pathPrefix="/"');
    expect(manifest).toContain('android:name="android.intent.action.SEND"');
    expect(manifest).toContain('application/vnd.findspot.companion+json');
    expect(manifest).toContain('android:name=".CompanionControlActivity"');
    expect(manifest).toContain('android:theme="@style/ControlTheme"');
    expect(activity).toContain('private static final String CONTROL_START = "start"');
    expect(activity).toContain('private static final String CONTROL_STOP = "stop"');
    expect(activity).toContain('Companion is ready.');
    expect(activity).toContain('addPrimary("Open FindSpot", this::openFindSpot)');
    expect(activity).toContain('shareStoppedRecording(active.uuid(), 0)');
    expect(activity).toContain('sendDirectlyToFindSpot(share, uri)');
    expect(activity).toContain('returnControlResult("started")');
    expect(activity).toContain('returnControlResult("start_cancelled")');
    expect(activity).toContain('returnControlResult("stop_failed")');
    expect(activity).toContain('.appendQueryParameter("companionResult", result)');
    expect(activity).toContain('packageName.startsWith("org.chromium.webapk")');
    expect(activity).toContain('org.chromium.webapk.shell_apk.startUrl');
    expect(notifications).toContain('https://fenlanddavid.github.io/findspot/');
    expect(notifications).not.toContain('builder.addAction');
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
    expect(service).toContain('MAX_CONTINUOUS_RECORDING_MS = 12L * 60L * 60L * 1_000L');
    expect(service).toContain('CompanionNotifications.showSafetyStop(this)');
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
