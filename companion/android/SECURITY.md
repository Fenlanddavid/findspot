# Companion component exposure

FindSpot Companion has no network permission and stores recordings locally until the user shares them.

Exported Android components:

- `MainActivity` is exported because it is the launcher activity. Intent data is ignored unless it passes the control-link policy.
- `CompanionControlActivity` is an alias exported for `findspot-companion://record/start` and `/stop`. Custom schemes are not caller authentication; every action, path and parameter is validated and the recording state machine remains authoritative.
- `RebootReceiver` is exported so Android can deliver `BOOT_COMPLETED`. It ignores every other action, only interrupts an already-persisted active recording, and never creates a recording.

`RecordingService` and `FileProvider` are deliberately non-exported. Recording JSON shared back to FindSpot is validated by the PWA before it reaches IndexedDB.
