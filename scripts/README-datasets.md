• Compatibility is only partial. The underlying v5/native protocol still works, but v5 introduced a broken finish
  experience and exposes older state-synchronisation weaknesses.

  Key findings:

  - Primary v5 regression: the header’s “Finish” confirmation says the trail will stop, but it never sends the
    Companion stop command. It then rejects the finish because Companion is still active. See findspot/src/pages/
    Session.tsx:554 and findspot/src/pages/Session.tsx:630. This matches the reported symptom.

  - Findspot changes Companion state optimistically. Clicking Start marks it active before Android confirms;
    clicking Stop clears it before Android actually stops or shares the recording. A cancelled permission prompt,
    failed deep link, failed stop, or cancelled share can therefore leave the two apps disagreeing. See findspot/
    src/pages/Session.tsx:804 and findspot/src/components/session/ActiveSessionWorkspace.tsx:280.

  - “Stop & finish” bypasses v5’s new finish-confirmation policy and finishes directly during import. See findspot/
    src/pages/CompanionImport.tsx:140.

  - There is a schema mismatch for the Companion’s 12-hour safety stop: Android produces maximum_duration, but
    Findspot’s accepted interruption reasons exclude it. See findspot/companion/android/app/src/main/java/uk/
    findspot/companion/RecordingService.java:35 and findspot/src/shared/companionRecording.ts:37.

  - The v5 tests only seed a fake “Companion active” flag and verify that finish is blocked. They do not exercise
    Android stop → share target → import → finish. The v5 handoff document explicitly records that physical
    Companion compatibility was not validated: findspot/docs/programmes/v5-handoff-2026-08-15.md:123.

  What is compatible:

  - Package name, start/stop deep links, session and finish query parameters match.
  - Android beta 1.0.0-beta.3 recordings match Findspot’s normal stopped-recording schema.
  - The deployed PWA share manifest (https://fenlanddavid.github.io/findspot/manifest.webmanifest) matches the
    Android MIME type and context handoff.

  - I simulated the complete production PWA half: share-target POST → recording validation → session association →
    trail import → active-state clear → finish. It succeeded and used the Companion stop time as the session end
    time.

  - Android source and the handoff/import protocol have not changed since v4.12; v5 changed the session UI around
    them.

  Verification completed:

  - 1,051 unit tests passed; 1 skipped.
  - All three existing Companion browser tests passed.
  - Production build passed.
  - Production-style service-worker handoff passed with no browser errors.
  - The live deployment matches the local v5 build.
  - No source files were changed.

  The appropriate fix is to make Companion finish a single acknowledged state machine: the v5 Finish action should
  invoke “stop and finish” when Companion is active, retain the active marker until a successful native return/
  import, handle cancellation explicitly, and add a true production handoff test.

