# Scheduled monuments on the active map

The active session map depicts scheduled-monument polygons from local Cache Storage. Session setup quietly prepares the small designation-only cache when connectivity is available, so users do not need to prepare the larger Field Guide offline pack. The map renderer remains strictly cache-only: it works without signal once prepared and cannot silently fall through to a live service. The layer is always present as base cartography, has no toggle, and never performs proximity, in/out, or live-position checks. It reuses Field Guide's exact 20 m Turf buffer geometry and orange buffer styling around the red recorded boundary. Tapping a rendered polygon or buffer opens only a compact identification label ("Scheduled monument", its recorded name when present, and the buffer distance for a buffer-only tap); it is not an inspection sheet or location verdict. This is a deliberate post-brief ruling: the original no-inspection constraint remains authoritative for sheets, distances, status, and in/out claims, but must not be used to remove the label-only popup. Its persistent, non-interactive attribution line uses a quiet source-and-date short form only for fully covered ready views; loading, partial, unavailable, not-cached, and error states always retain the full coverage text.

This does not replace the session-start protection check. They answer different questions:

- The map depicts where protected archaeology is recorded while the user is there.
- The start card records whether permission was checked before the user set off, while that answer can still change the decision.

Both surfaces state coverage honestly. Neither is a guard.

Heritage Guard (live proximity warnings in Companion) remains out of scope. Its blockers are unchanged:

- Companion has no geometry data channel; `ExternalIntentPolicy` permits only `/start` and `/stop` with a `session=` parameter.
- Continuous monitoring would invalidate the observed section 12 battery result; `RecordingService.java` deliberately uses the cheap 10-second/5-metre GPS configuration.
- Silence from an alert system reads as active reassurance, which current jurisdiction and offline-cache gaps cannot support.

The following v5 work remains independent and unaffected: the `AgreementModal.tsx` revoke race, the ungated `Permission.tsx` ratchet, `USE_R2_DESIGNATIONS` removal, the continuity default-alignment guard, and the legacy map-tap path behind `mapObjectSheetsEnabled`.
