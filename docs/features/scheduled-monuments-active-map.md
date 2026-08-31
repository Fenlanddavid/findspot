# Scheduled monuments on the active map

The active session map depicts scheduled-monument polygons from local Cache Storage. Session setup quietly prepares the small designation-only cache when connectivity is available, so users do not need to prepare the larger Field Guide offline pack. The map renderer remains strictly cache-only: it works without signal once prepared and cannot silently fall through to a live service. The layer is always present as base cartography, has no toggle, and never performs proximity, in/out, or live-position checks. It renders only the recorded boundary; the Field Guide's derived 20 m analysis buffer is deliberately absent because it has no statutory meaning and could imply that the other side of the line is a safe margin. Tapping a rendered polygon opens only a compact identification label ("Scheduled monument" and its recorded name when present); it is not an inspection sheet or location verdict. This is a deliberate post-brief ruling: the original no-inspection constraint remains authoritative for sheets, distances, status, and in/out claims, but must not be used to remove the label-only popup. Its persistent, non-interactive attribution line uses a quiet source-and-date short form only for fully covered ready views; loading, partial, unavailable, not-cached, and error states always retain the full coverage text.

This does not replace the session-start protection check. They answer different questions:

- The map depicts where protected archaeology is recorded while the user is there.
- The start card records whether permission was checked before the user set off, while that answer can still change the decision.

Both surfaces state coverage honestly. Neither is a guard.

## Binding non-assertion rule

FindSpot never displays a **clear**, **safe**, **permitted** or equivalent positive state for detecting legality. Green must not be used to communicate such a state. This applies to the map, session start, Field Guide and every other user-facing surface.

FindSpot may state what a reviewed source records, the source and date of that data, whether the requested area is covered by the dataset, and what could not be checked. It must not characterise the remainder. In particular:

- no recorded monument in the returned data means only that none was recorded in that response;
- missing, partial, stale or unavailable coverage is an explicit unknown, never a pass;
- the absence or silence of a warning is not evidence that detecting is lawful;
- permission, other designations and current legal requirements remain separate questions.

The product must not make a positive legality claim and then rely on a disclaimer to retract it. The interface itself remains fail-safe: it reports known records and explicit limits without deciding that the user is clear to detect.

Heritage Guard (live proximity warnings in Companion) remains out of scope. Its blockers are unchanged:

- Companion has no geometry data channel; `ExternalIntentPolicy` permits only `/start` and `/stop` with a `session=` parameter.
- Continuous monitoring would invalidate the observed section 12 battery result; `RecordingService.java` deliberately uses the cheap 10-second/5-metre GPS configuration.
- Silence from an alert system reads as active reassurance, which current jurisdiction and offline-cache gaps cannot support.

The following v5 work remains independent and unaffected: the `AgreementModal.tsx` revoke race, the ungated `Permission.tsx` ratchet, `USE_R2_DESIGNATIONS` removal, the continuity default-alignment guard, and the legacy map-tap path behind `mapObjectSheetsEnabled`.
