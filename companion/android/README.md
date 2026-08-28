# FindSpot Companion for Android

This is the native Phase 1 hardware recorder. It contains no maps,
archaeological records, interpretation engines, analytics, account or network
client.

Open `companion/android` in Android Studio, use JDK 17, install Android SDK 35,
and build the `app` configuration. The project deliberately has no `INTERNET`
permission. AndroidX Core is used only for secure `FileProvider` export.

Run `./gradlew testDebugUnitTest --no-daemon` for the JVM regression suite.
The deployment workflow runs this with a configured Android SDK before a web
release can proceed.

The app supports:

- location foreground-service recording while locked;
- immediate SQLite WAL commits for every delivered callback;
- pause/resume segmentation;
- interrupted-process and reboot recovery;
- canonical hashed JSON export compatible with FindSpot;
- segmented GPX 1.1 export;
- Android Sharesheet handoff to FindSpot;
- FindSpot-controlled start, stop and automatic session import;
- a 12-hour continuous-recording safety cutoff with recovery notification;
- 30-day retention for exported stopped recordings and indefinite retention
  for unexported recordings.

The localhost API is an optional later enhancement and is not compiled into
this file-transport release.

Device acceptance work is listed in
[`docs/companion/phase1-implementation.md`](../../docs/companion/phase1-implementation.md).

The Android 15 emulator build, integration and recovery results from 31 July
2026 are recorded in
[`docs/companion/android-emulator-validation-2026-07-31.md`](../../docs/companion/android-emulator-validation-2026-07-31.md).
