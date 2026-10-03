# Oukitel WP26 tracker report — handoff (2026-10-03)

Status: Ben's follow-up has been reviewed and the failures have been reproduced locally. FindSpot recovery/startup fixes passed local verification and are prepared for release as 5.0.22 at the user's request. GitHub Actions is the authoritative record for the full browser, Worker, Android Companion and deployment gates. The user prefers continuing the investigation without further requests to Ben; the earlier evidence requests below are historical.

## Report

- Tester uses an Oukitel WP26 on Android 13. Companion and the in-app FindSpot tracker were reported as not working since about Monday 2026-09-28.
- When trying to end a Companion recording, Android shows: `No Companion recording is active.`
- The user reports the same flow works on a Pixel 10 Pro.
- Original screenshots are at `/home/david/Pictures/Screenshots/Screenshot From 2026-10-02 23-39-36.png` and `/home/david/Pictures/Screenshots/Screenshot From 2026-10-02 23-40-27.png`.
- The tester's exact in-app tracker symptom or error is not yet known. The user has requested a screenshot.

## Findings from code review

- `MainActivity.stopFromFindSpot()` shows that toast only when `RecordingStore.activeRecording()` returns null. The latter includes `recording`, `paused`, and `interrupted` rows; it excludes stopped rows. The toast therefore means no open recording was found in Companion's local database at that moment. It does not by itself prove a permission or battery issue.
- FindSpot stores `fs_companion_active_session` after a Companion start acknowledgement. While that marker is set for a session, the session UI shows Companion controls in place of `Start in FindSpot`. A stale marker could therefore account for the user's description that both trackers are unavailable. If `Start in FindSpot` is visible but errors when tapped, that is a separate symptom to diagnose from its exact message.
- The browser tracker uses `navigator.geolocation.watchPosition` and waits for its first GPS fix. It reports distinct errors for denied permission, unavailable position, and timeout. Companion requires precise Android location permission and an enabled GPS provider before starting; its service records interruptions if location permission or GPS is lost after start.
- No Companion code changed in the recent release. On 2026-10-03, local `HEAD` and upstream both pointed to `1330472` (`fix: add Scotland LiDAR and prepare v5.0.21`). The temporary recovery UI edits made during investigation were reverted at the user's request. Only pre-existing user edits to `docs/permission-decompose-stage0-checklist.md` and `scripts/README-datasets.md` remained before this handoff note.

## Original evidence requests (superseded by local reproduction)

1. Screenshot of the FindSpot session's Trail recording area: is `Start in FindSpot` absent, or visible and failing? Capture the exact error text if it fails.
2. Open Companion directly from the phone's app launcher and capture its state (`Recording`, `Interrupted`, `Stopped`, or ready) and raw GPS observation count. Do not uninstall or clear app data before checking for a saved trail.
3. If both trackers really fail to obtain location, check device Location, precise location permission for Companion and the browser, and the browser's site location permission for FindSpot. Do not assume these are the cause until the screenshots show the failure mode.

At the original handoff, no app files, release notes, version numbers, commits, or remote branches had been changed for this report.

## Follow-up from Ben (2026-10-03)

Ben reports that he already reinstalled Companion to try to fix the problem. Finishing the recording from FindSpot still produces the previously supplied `No Companion recording is active.` message, leaving him unable to start another Companion trail. He also confirms that tapping Start in FindSpot appears to do nothing and produces no visible error.

### Updated assessment

- The code confirms a recovery gap: Companion returns `stop_failed` when no open recording exists. FindSpot clears the pending stop command but deliberately retains `fs_companion_active_session`. New Companion starts in other visits remain unavailable while that marker persists. The normal successful import path clears the marker; there is no dedicated recovery action for a missing recording.
- Reinstalling Companion does not reconcile the separate FindSpot recording marker. This explains how the stuck state can persist after reinstalling, but does not establish what caused the original failure. The earlier screenshot already showed the missing-recording message, and the precise timing of the reinstall is unknown.
- The browser start handler waits for `startTracking()` before displaying its success message. There is no explicit starting indicator on the Start in FindSpot button. Startup awaits the wake lock request, then the first GPS fix and its database write. GPS errors are forwarded to the page, but an exception saving the first fix is only stored in tracking status and logged; it does not reject the startup promise. These are diagnostic possibilities, not a confirmed explanation for Ben's browser symptom.
- In the Record tab, the current visit's Companion recording controls replace Start in FindSpot. Establish whether Ben's browser attempt is in a different visit, and inspect the whole screen for a notice above the controls.

### Suggested follow-up before the user's preference for local investigation

1. Open Companion directly from its app icon and report whether it says ready, stopped, interrupted, or recording.
2. Establish whether Start in FindSpot is being tried in the same visit or a different one. A brief screen recording of the tap and following 20 seconds, including the top of the page, would show whether the page changes or reports an error.

At that checkpoint only this investigation note had been updated.

## Local reproduction and fixes

The user subsequently asked to investigate without bothering Ben again. The local reproduction demonstrated:

- A `stop_failed` return leaves the visit marked as Companion recording with no recovery action. The browser reproduction confirmed that FindSpot's Start control remains unavailable.
- Rejecting the first GPS database write leaves `startTracking()` pending. A test injecting `Storage is full` reproduced this before the fix.
- A wake-lock request that never resolves prevents registration of the GPS watch. A local test reproduced zero watch registrations before the fix.
- If the browser never delivers a GPS success or error, startup has no application deadline. A fake-clock test reproduced an unsettled start after 20 seconds.

These explain reproducible failure paths in the app. They do not prove which browser startup path Ben encountered or the original reason his Companion recording went missing. Do not describe this as a confirmed Oukitel permission or battery problem.

### Implemented locally

- `Recover stuck recording` lets the user explicitly reset the current visit's Companion status after a missing-recording message or reinstall. Cancellation preserves the status. Reset clears the active and pending markers atomically, refuses a conflicting visit, and leaves visits, finds and trails intact. No failed stop is automatically treated as a successful import.
- Saved Companion trails can be imported from the active recording panel. Another visit offers `Open Companion visit`; the session route is keyed by pathname so that navigation loads the correct visit state.
- Browser startup displays progress and cancellation. It has a 20-second application deadline, starts GPS independently of the wake lock, surfaces first-write errors, and supports retry after failure/cancellation.
- Late GPS callbacks cannot revive a cancelled attempt. A late wake lock is released if its recording has ended. First-point writes are serialised, and cancellation during the first transaction rolls it back.

### Verification

- Before the fix: 3 of 4 startup regression tests failed (silent first-write failure, stalled wake lock, unbounded GPS wait); the browser recovery test could not find any recovery control.
- `npm test`: all checks passed; 162 test files, 1,334 tests passed and 1 skipped. The sandbox blocked the date check's subprocess, so the full command was rerun outside the sandbox successfully.
- Phone-sized browser checks: 4 passed, covering recovery, reload, record/stop/finish, retained notes/trails, cancellation, silent-GPS deadline, first-write failure/retry, and navigation from another visit back to the stuck Companion visit.
- Existing browser tracking lifecycle, premature Companion finish guard, idempotent segmented import, and missing-Companion return: 4 passed.
- Final production build passed. Production Companion share/import checks: 2 passed, including stop acknowledgement and automatic finish at the Companion stop time. Total targeted browser checks: 10 passed.

### Release preparation

- FindSpot version 5.0.22; package, lockfile and release metadata prepared with `npm run release:prepare -- 5.0.22`.
- Update message: `Recover stuck Companion recordings and fix trails that fail to start.`
- Release-note guard and type check passed against v5.0.21.
- Worker type generation checks, Worker type checks and 10 Worker tests passed.
- Production dependency audit passed the CI high-severity threshold; it reported one low-severity DOMPurify advisory.
- GitHub must pass its full unit/Worker suite, browser suite, production Companion/PWA handoff suite and `companion_android` job before deployment. The local environment has no Java/Android SDK, so the native gate is verified in GitHub Actions.
- No Companion Android code or native version change is required for these FindSpot fixes. The repository's native build remains 1.0.0-beta.4, versionCode 4.

Pre-existing user edits in `docs/permission-decompose-stage0-checklist.md` and `scripts/README-datasets.md` remain untouched and are excluded from this release commit.
