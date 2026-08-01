# Android emulator validation — 31 July 2026

## Result

The Phase 1 Android Companion built, installed and passed the available
end-to-end integration and recovery checks on Android 15 (API 35).

This run validates the application workflow and Android service/recovery
behaviour in a software emulator. It does not replace the six-hour physical
device, battery, real-GNSS, OEM power-management or Flag Fen acceptance work.

## Build

- JDK 17
- Gradle 8.14.4
- Android Gradle Plugin 8.7.3
- compile/target SDK 35
- Android Build Tools 34.0.0 and 35.0.0
- tasks: `:app:assembleDebug` and `:app:testDebugUnitTest`
- result: 38 tasks completed successfully
- native JSON unit test: passed
- APK: `companion/android/app/build/outputs/apk/debug/app-debug.apk`
- APK size: 2,266,770 bytes
- SHA-256: `7c2f06bcf8bfc7789647fec4ea0c379f2f2df06a21fb7c9964ac323621c33cfc`

The build exposed and fixed two portability/compile defects: an invalid Java
lambda token in `MainActivity` and use of the unavailable `Files.writeString`
API in `ExportFiles`. Export now uses an Android-compatible UTF-8
`FileOutputStream` followed by `FileDescriptor.sync()`.

## Locked-screen recording

The APK was installed on an Android 15 x86_64 emulator. Location permission was
granted and a recording was started through the Companion deep link. Android
reported the recorder as a foreground service with service type `0x8`
(location) and an ongoing notification with Pause and Stop actions.

With the display reporting `mWakefulness=Asleep`, simulated GNSS positions
were alternated across more than the five-metre acquisition threshold every
30 seconds for ten continuous minutes.

- state remained `recording`
- active segment remained 5
- sequence advanced from 8 to 28
- 20 callbacks were committed during the interval
- foreground location service remained active
- display remained asleep
- the final recording contained 28 observations
- normal Stop changed state to `stopped`
- all six segments had non-null end timestamps
- SQLite reported WAL journal mode

Pause and Resume were also exercised through the UI. Every Resume created a
new segment, and no observation bridged a segment boundary.

## Native JSON to FindSpot

A separate completed native recording was exported through the Android Share
JSON action and the exact generated file was passed to the running FindSpot PWA
import pipeline.

| Evidence | Value |
|---|---|
| Recording UUID | `ba35957d-778e-4a4f-a8ac-325fecc46d3e` |
| Native file size | 3,388 bytes |
| Content hash | `sha256:78aef46155aaa4444831c29a168ccc097bf3cba0663a402ed3f2dc7154fb196a` |
| Native segments | 3 |
| Native observations | 9 |
| Derived FindSpot tracks | segments 0, 1 and 2 |
| Immutable recordings | 1 |
| Import-ledger entries | 1 |
| Repeated import | `Already safely imported` |
| Browser errors | none |

The three derived track records seen after the repeated import were the same
three deterministic segment tracks. No additional track, immutable recording,
ledger entry or coverage contribution was created.

The lean emulator image did not contain a browser/PWA registered as an Android
share target, so the Android sharesheet could not complete the final receiver
selection. The generated cache file itself was read unchanged from the
Companion and imported into FindSpot in Chromium. A physical-device check with
the installed FindSpot PWA remains required for the final sharesheet handoff.

## Recovery matrix

| Failure | Observed state after reopening | Automatic restart | Result |
|---|---|---|---|
| Process killed with `SIGKILL` | `interrupted / process_killed` | no | pass |
| Device reboot | `interrupted / device_reboot` | no | pass |
| Location disabled | `interrupted / location_disabled` | no | pass |
| Fine-location permission revoked | `interrupted / permission_revoked` | no | pass |

The controlled reboot naturally delivered `BOOT_COMPLETED`. The Companion
posted its recovery notification and did not start `RecordingService`. The
notification invited the user to resume, close or discard. Each recovery
Resume created a new segment.

An Android shell `force-stop` was not used as the process-death assertion:
force-stop marks the package stopped and changes later broadcast behaviour.
The process-death case instead killed the application PID directly, which
produced the expected `process_killed` classification on the next normal
launch.

## Remaining release acceptance

The following require representative physical Android devices:

- six-hour locked-screen recording with real GNSS movement;
- measured and documented battery consumption;
- OEM battery-optimisation testing, including at least Samsung and Pixel;
- installed-PWA Web Share Target selection and import;
- packet capture confirming zero application-level non-loopback traffic;
- real detecting-session validation at Flag Fen;
- signed release build and upgrade/retention testing.

The emulator had no KVM or GPU acceleration, so its timing, thermal and battery
figures are intentionally not treated as product evidence.
