# FindSpot UI refinement handover

Continued the interrupted working tree on 11 September 2026. The supplied baseline filename was not present in the repository; the existing implementation, pending changes, tests and saved before screenshots were inspected and retained. This work is local and has not been deployed.

## Changes by workstream

1. **Finds map:** marker updates are independent of camera movement. The first located result set fits once; later fitting uses “Show all results”. Centre, zoom and basemap persist in project-scoped session storage through the existing client-storage facade. Selection lives in the collection URL and clears when a record disappears from the matching set. Nearby/coincident points open a chooser with title, code, period and date. An accessible record list provides another selection route. Empty/locationless results and failed imagery have explanatory text and a Gallery route.
2. **Capture GPS:** the frozen capture retains coordinates, accuracy, original fix time, capture time and actual source. Quality is evaluated against capture time; the elapsed-time counter does not degrade it. Unknown fix times remain unknown. Explicit refresh creates a new snapshot; failure preserves the previous one. Live session-tracking safeguards are unchanged.
3. **Recording:** a fixed save area sits above measured primary navigation and the visible keyboard viewport. Measured bottom padding allows the last fields to scroll above it. Quick capture uses a full-width secondary action when only one exists. Both recording surfaces preview photos and support replacement/removal. Full-record photos now remain staged in memory and commit atomically with the record. Failed writes retain the draft and media; save guards prevent simultaneous writes. Finishing a session-linked pending record returns to that session. Existing optional Quick/Full sections remain available without clearing hidden values.
4. **Browsing:** compact record-type navigation, search and record-state controls replace the stacked statistic cards. Permission ID, dates, period, material and type live in Filters, with a count. All chips are removable; visit chips resolve local names and dates. Date-range errors are explicit. Newest found, oldest found and recently edited sorting happens before the 60-record page limit. Gallery and Map share the same filtered set and URL state.
5. **FieldGuide:** stronger interpretation headlines, quieter supporting clues and consistent evidence disclosure. Uncertainty and source failures remain visible. Supporting numerical evidence is disclosed rather than competing with the headline. No scoring, inference, archaeological evidence or interpretation-engine changes were made for presentation.
6. **Permissions:** the shared permission enrichment query supplies the active visit identity. One central action rule selects Resume visit or Start visit. Starting goes through the existing visit setup route; it does not start tracking from the card. No optional boundary, contact or other setup field blocks starting. Permission names wrap; default coordinate overlays are removed. Coverage explanation is a touch/keyboard disclosure. Add find, FieldGuide, details and pinning remain available.
7. **Shared styling:** reusable primary/secondary/destructive buttons, inputs, messages, metadata and filter chips; visible focus, minimum touch sizes and reduced-motion support. Quick capture supports light and dark themes. Shared modal scroll locking and record-edit error/discard behaviour from the interrupted session are retained.

## Reused components and state owners

- `FindsBox` owns URL search/filter/sort/view/selection; `FindsMap` owns its MapLibre instance; `findsMapState` retains optional project-scoped camera state.
- Existing `pagePersistence`, `enrichPermissions`, `chooseCurrentUnfinishedSession` and `findMutations` remain the data boundary.
- Existing `fileToBlob` and `ScaledImage` remain the photo processing/rendering pipeline. `useObjectUrl` releases the quick-sheet preview URL.
- `SessionQuickFindSheet` owns the frozen location and unsaved quick-capture fields. `captureLocationStatus` separates quality from elapsed-time wording.
- Existing Quick/Full recording sections and `ConfirmModal` remain. The existing route tree is hosted in React Router's data router so the recording page can use its supported navigation blocker, including browser Back. `useRecordNavigationGuard` also protects page unload while dirty or saving.
- `useRecordingViewport` measures save/navigation dimensions; shared `.ui-*` patterns live in `index.css`.

## Data and compatibility

No IndexedDB schema/version change and no backup-format change. Capture uses existing optional `locationFixAt`, `locationFrozenAt`, `locationMethod` and `gpsAccuracyM` fields. Older records still load without these fields. Full backup round-trip and rollback-compatibility tests retain the provenance fields. Camera state is optional session UI state, excluded from backups and isolated by project. No new packages, accounts, analytics, remote storage or sharing behaviour.

Full-record media staging changes when a photo is committed, not its stored format. The record and media write share an IndexedDB transaction. Cancelled replacement selections leave the prior photo intact; discarding the page cannot delete committed media. Unsaved photo blobs remain in memory until save/discard; they do not survive a forced browser/process termination.

## Screenshots

All before images below were already captured by the interrupted session. After images were refreshed and visually reviewed on 12 September using a seeded phone viewport (390 × 844), with populated records, locationless pending records and missing photos. The recording tutorial is dismissed; permission captures now focus on the long-named permission with an active visit. These deliberate fixture/view differences mean the earlier images are historical references rather than pixel-diff baselines.

[Open the screenshot gallery](screenshots/index.html) for all seven screens in light and dark mode, plus full-page versions of Finds, Filters, Permissions and Full recording (22 updated PNGs total).

| Journey | Before light | After light | Before dark | After dark |
|---|---|---|---|---|
| Finds | [Before](screenshots/before-finds-light.png) | [After](screenshots/after-finds-light.png) | [Before](screenshots/before-finds-dark.png) | [After](screenshots/after-finds-dark.png) |
| Full record | [Before](screenshots/before-record-light.png) | [After](screenshots/after-record-light.png) | [Before](screenshots/before-record-dark.png) | [After](screenshots/after-record-dark.png) |
| Quick capture | [Before](screenshots/before-capture-light.png) | [After](screenshots/after-capture-light.png) | [Before](screenshots/before-capture-dark.png) | [After](screenshots/after-capture-dark.png) |
| Permissions | [Before](screenshots/before-permissions-light.png) | [After](screenshots/after-permissions-light.png) | [Before](screenshots/before-permissions-dark.png) | [After](screenshots/after-permissions-dark.png) |

Additional captures: [Filters light](screenshots/after-filters-light.png) / [dark](screenshots/after-filters-dark.png), [Finds map light](screenshots/after-map-light.png) / [dark](screenshots/after-map-dark.png), and [FieldGuide light](screenshots/after-fieldguide-light.png) / [dark](screenshots/after-fieldguide-dark.png). FieldGuide shows the ready-to-scan state; this set does not include a completed interpretation. No further screenshot work remains for this capture set.

## Verification

Resumed verification on 12 September 2026, following the request to skip further screenshot work.

- `npm test`: passed. Type checking and the type-floor, casing, any, hooks, architecture, DOM-safety and network-origin checks passed; 151 unit-test files passed (1,257 tests passed, one skipped).
- `npm run build`: passed in the interrupted session's final run on 11 September; no application source has changed since that build.
- Chromium smoke, regression, refinement and UI-brief interaction suites: **76 passed** in 7.5 minutes with two workers. This includes map retention/overlap selection, combined filtering and sorting, frozen GPS and refresh failures, photo/save recovery, browser Back, narrow/enlarged layouts, active-visit recovery, offline actions and backup restoration.
- The paused-visit lifecycle smoke test passed in isolation in 29.7 seconds. Its timeout is now 60 seconds to accommodate two tracking starts, reload recovery and the offline round trip; all behaviour assertions remain in place.
- Removed the refinement suite's unconditional screenshot captures. The separate screenshot suite is excluded from this verification run.
- Screenshot follow-up, 12 September: both expanded `uiBriefVisual.spec.ts` theme runs passed (1.2 minutes); captured 14 phone viewport images and eight full-page images. Log: `/tmp/findspot-ui-screenshots.log`. The user subsequently requested this screenshot work after previously deferring it.
- `git diff --check`: passed. Test logs: `/tmp/findspot-ui-resumed-checks.log` and `/tmp/findspot-ui-resumed-browser.log`; prior build log: `/tmp/findspot-ui-final-build.log`.

## Browser limits and device follow-up

Browser inspection uses Linux Chromium with phone viewports, mocked geolocation and file input. It verifies rendered geometry and interaction, including 320-pixel width, enlarged text, reduced motion, short viewport and light/dark states. It does **not** constitute testing on physical Android Chrome or iPhone Safari.

Physical-device acceptance remains to be checked for native camera cancellation/retake, iOS keyboard and safe-area behaviour, and installed Safari/Android display mode. The code handles empty file selections without replacing the existing image and follows VisualViewport where available, but those native interactions cannot be certified by desktop emulation. No Safari/WebKit executable or connected phones are available in this environment.
