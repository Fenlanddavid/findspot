# Android physical-device validation — 1 August 2026

## Device and build

- device: Google Pixel 10 Pro (`blazer`)
- Android: 17 (API 37)
- connection: authorised USB debugging
- initial APK: debug version 1.0.0, version code 1
- initial APK SHA-256: `7c2f06bcf8bfc7789647fec4ea0c379f2f2df06a21fb7c9964ac323621c33cfc`
- rebuilt APK SHA-256: `3636dbe7b2dc0c1c90d07ef401efb3c7a716d60365fdfff3902dad3612775901`
- rebuilt APK size: 2,321,057 bytes
- signed beta: version `1.0.0-beta.1`, version code 1
- signed beta APK SHA-256: `ac09a47adbeebde905769501adccac17d9581d6e7f2e23b42ba01c5a1e17c97c`
- signed beta APK size: 141,751 bytes
- signing certificate SHA-256: `8852a4c12f0921292416d2467df8de783c3ddf9b693744867cdaec3e5cdc3ce5`

The rebuilt APK adds branded adaptive launcher resources, shows the FindSpot
mark and PWA-matched wordmark in the Companion UI, and guards the
foreground-service startup race found during this run. It was installed as an
update so the completed physical-device recording remained intact.

The branded UI was visually inspected on the Pixel. The full FindSpot target
mark rendered beside a bold `FindSpot` wordmark with the same green, teal and
blue gradient and mobile proportions as the PWA. `COMPANION` is a secondary
subtitle rather than the primary brand.

## Short locked-screen walk

The user granted precise location and notification permission, started a
recording, disconnected the phone, locked the screen, walked, paused and
resumed, then stopped after returning.

| Evidence | Value |
|---|---|
| Recording UUID | `369981d4-dc55-477e-acce-a135e33ad3b1` |
| Started | 1 August 2026 18:04:59 BST |
| Stopped | 1 August 2026 18:24:16 BST |
| Elapsed | 19 minutes 17.493 seconds |
| Native observations | 76 |
| Sequence | 0 through 75, with no discontinuity |
| Provider | GPS |
| Mean horizontal accuracy | 13.52 metres |
| Maximum horizontal accuracy | 52.55 metres |
| Segments | 3, all closed |
| Export file SHA-256 | `fc22e8cba5a2e733276174e6e9a3d88e4f85b31d1da534cd483a3d46c011f190` |
| Canonical content hash | `sha256:89f8722ed59afdbb324dfe1ad9d5cae06c7bd99dcf0e37c17053f80ba7739332` |

The canonical content hash was recomputed independently from the exact JSON
read from the phone and matched the embedded value.

### Segment evidence

| Segment | Duration | Observations | Sequence | Meaning |
|---|---:|---:|---|---|
| 0 | 0.010 seconds | 0 | — | Erroneous startup boundary |
| 1 | 8 minutes 12.880 seconds | 32 | 0–31 | First walking portion |
| 2 | 10 minutes 27.719 seconds | 44 | 32–75 | Resumed walking portion |

The user initially associated the extra boundary with unplugging USB. The
timestamps disprove that: segment 0 closed only 10 milliseconds after the
recording was created and before USB was disconnected. The foreground service
later started through `RESUME`.

The cause was an activity/service startup race. `MainActivity.onResume()` could
see the newly persisted `recording` row while `RecordingService.isRunning` was
still false, classify it as `process_killed`, and close the segment before the
requested foreground service reached `onCreate()`. The rebuilt app records a
time-limited in-process start request before calling `startForegroundService()`;
recovery treats that request as live for five seconds. A true process restart
clears the process-local marker and retains the existing recovery behaviour.

## Foreground and permission evidence

Before the phone was disconnected, Android reported:

- precise and coarse location granted;
- notifications granted;
- `RecordingService` active in the foreground;
- foreground-service type `0x8` (location);
- ongoing `FindSpot is recording` notification;
- Pause and Stop notification actions;
- persisted observation count advancing.

After Stop, Android reported no remaining Companion foreground service and the
UI reported `Stopped`, 76 observations and three segments.

## Battery limitation

The first connected snapshot reported 52% and the final connected snapshot
reported 51%. Both snapshots reported charging because they were taken after
USB connection. The walk itself was unplugged, but this run is not a controlled
battery measurement and cannot satisfy the six-hour battery gate.

## Installed-PWA sharesheet result

The exact native JSON was created and the Android sharesheet opened. FindSpot
was absent. Android's package resolver confirmed that the installed FindSpot
WebAPK did not advertise an `ACTION_SEND` target for
`application/vnd.findspot.companion+json`.

The cause is deployment state rather than the local implementation. The
deployed `manifest.webmanifest` did not contain `share_target`; the local
production build does contain the multipart `/findspot/companion-share` target.
FindSpot must be deployed and the installed WebAPK refreshed before repeating
this gate.

## One-tap Companion handoff and naming

The PWA session action is now labelled `Track Session` rather than `Map
Session`. When no legacy browser track is active, its Android intent targets
the `uk.findspot.companion` package and the
`findspot-companion://record/start` deep link. Android dispatches that user tap
to the installed Companion. With location already granted and GPS enabled, the
native activity starts recording without an additional in-app confirmation.
Android permission or location settings still appear when the operating system
requires them.

If Companion is absent, the Android intent returns the user to FindSpot's
Companion import page instead of leaving a dead custom-scheme navigation. The
page explains that Companion is not installed, confirms that the session and
data are unchanged, preserves the originating session ID and states that a
signed public installer will be offered after device validation.

FindSpot's App settings now also contain an Android Companion download card.
The same download action is shown on the missing-Companion page. Both remain
bound to the same immutable, signed GitHub beta asset URL; the debug APK is not
distributed.

On iPhone, iPad and non-Android browsers, `Track Session` retains FindSpot's
foreground browser tracker rather than invoking an Android intent. FindSpot
states that the Android Companion is unavailable and reminds Apple users to
keep FindSpot open and the screen awake. Locked-screen iOS recording requires a
separate native iOS application and is outside this Android release.

Existing active browser tracks remain stoppable as `Stop Tracking`; the change
does not strand a legacy track already in progress.

The exact URI was then invoked on the updated Pixel. Android opened the warm
Companion activity in 53 milliseconds. The service received `ACTION_START`,
not recovery `RESUME`; Android reported one live foreground location service,
one open segment and an advancing observation count. The test was stopped after
two GPS observations. It closed as one segment, left no foreground service and
did not create an empty startup segment. This verifies the one-tap native
handoff and startup-race fix on the physical device.

## Automated verification after fixes

- focused Companion tests: 16 passed;
- PWA validation: 952 passed, 1 skipped;
- PWA production build: passed;
- browser smoke suite: all 21 tests passed across the full run and the corrected
  non-Android fallback rerun;
- Android `:app:testDebugUnitTest`: passed;
- Android `:app:assembleDebug`: passed;
- Android `:app:testReleaseUnitTest`: passed;
- Android release lint and R8: passed;
- Android `:app:assembleRelease`: passed;
- APK Signature Scheme v2 verification: passed with one signer;
- signed beta fresh-install emulator check: passed; the deep link started the
  location foreground service, one GPS observation persisted, and Stop closed
  one segment with no remaining service;
- Android resource compiler accepted the full logo, adaptive icon and Android
  13+ monochrome icon resources.

## Remaining release gates

- deploy the PWA build containing `share_target`;
- refresh or reinstall the FindSpot WebAPK and repeat native sharesheet import;
- six-hour locked-screen recording with controlled battery measurement;
- representative Samsung power-management validation;
- packet capture confirming zero application-level non-loopback traffic;
- Flag Fen detecting session;
- signed beta-to-next-version upgrade/retention validation.
