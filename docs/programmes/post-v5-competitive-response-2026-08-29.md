# Post-V5 competitive response

Recorded: 31 August 2026

Assessment supplied: 29 August 2026, revision 2

Assessment baseline: V5.0.8

Code baseline at reconciliation: V5.0.10

## Status and authority

This is the product and engineering disposition of the supplied Rodek US/UK assessment. Marketing and advertising are out of scope. The competitor's prices, tier contents, market count and protected-zone count came from single page captures and were not independently revalidated for this record. They are volatile research notes, not requirements; re-check them before any external use.

The durable decisions do not depend on those figures:

- deepen the UK-specific product rather than pursue multi-country template breadth;
- do not build accounts, cloud sync, community, marketplace, live crews, location broadcasting or subscriptions;
- do not turn incomplete reference data into a positive assertion;
- keep legal-reporting help available without a paid tier;
- prefer field utility and honest evidence over demo value or achievement framing.

The non-assertion rule in [`../features/scheduled-monuments-active-map.md`](../features/scheduled-monuments-active-map.md) and [`../SECURITY-THREAT-MODEL.md`](../SECURITY-THREAT-MODEL.md) is binding. FindSpot reports what is recorded and what it could not establish. It never says that detecting is clear, safe or permitted, and green never represents that claim.

## Current capability worth retaining

UK reporting support already resolves the relevant FLO and prepares the user's report through `src/services/flo.ts` and `src/components/PASReportModal.tsx`. `src/services/treasureClock.ts` models Scotland as notice rather than an England/Wales-style countdown, and `src/pages/LandAccess.tsx` retains the official reporting guidance. No code response is required. Ordinary feature communication should not omit this capability.

The session-map scheduled-monument depiction and a future session-start check answer different questions. Neither is a guard. Live Companion heritage alerts remain out: there is no geometry data channel, continuous monitoring has not passed the established battery posture, and a quiet alert system would imply coverage completeness.

## Ranked product work

### 1. Session-start protection card — implemented 31 August 2026

Extend `src/components/session/NewSessionStartCard.tsx` with a persistent, non-blocking protection summary.

- Read scheduled-monument information cache-only; session start must make no network request.
- Present recorded monument, checked with none recorded, and not checked/coverage unavailable as evidence states, not legality states.
- Treat unknown as the normal design case. Do not visually construct a reassuring default.
- Add daylight remaining from latitude, longitude, date and local astronomical calculation. It requires no network or new dataset.
- Keep weather out of V1. Any later proposal requires a separate utility decision plus `networkOrigins` and `NETWORK-PRIVACY.md` review because it discloses location to a third party.
- Never block the Start detecting action.

`src/services/session/sessionStartProtection.ts` owns the cache-only evidence resolution and local daylight calculation. `src/pages/Session.tsx` no longer warms the scheduled-monument cache on the new-session route; a cold or incomplete cache is rendered as not checked. The card remains persistent and non-blocking.

### 2. Recorded coverage percentage — implemented 31 August 2026

Expose a bounded percentage derived from existing recorded evidence in completed-session review and field history. This is a post-V5 ruling and a narrow supersession of the historical V5.0 decision to omit percentages from its new surfaces.

- Label the value as **recorded coverage** and as an estimate where the calculation is sampled.
- It describes evidence held by FindSpot, not everything the user searched and not a claim that an uncoloured area was never searched.
- `100%` is a numeric property of the recorded estimate only. It never becomes “field complete”, a badge, an achievement or a reason to stop searching.
- Keep all language behind `src/shared/coveragePresentation.ts`.
- Historical session presentation must use evidence reconstructable for that session; it must not substitute the permission's current aggregate.
- Do not reuse the legacy “No Gaps”/percentage control as the new presentation without reconciling its calculation and wording.

`trackedSectionCoverageFraction()` already returns a sampled ratio in `src/engines/coverage/sectionCoverageEngine.ts`. The detailed legacy trail UI also has a different percentage path. Implementation must first name which evidence and denominator the new number represents so two unlike percentages are not presented as interchangeable.

`recordedCoverageEstimate()` in `src/shared/coveragePresentation.ts` area-weights the current section geometry. A saved searched-area report contributes its section area; accepted tracking contributes its persisted sampled fraction; find-only evidence and stale geometry versions contribute nothing. Session Review uses only that session's observations. Permission history uses the aggregate recorded observations. The caveat remains visible and there is no completion badge.

An estimated sweep time remains out. It can be considered later from mapped area and an observed, adequately sampled pace, and must be omitted when evidence is weak.

### 3. Iron or junk patches — implemented 31 August 2026

Add an iron/junk observation kind using the existing observation location, GPS accuracy, section, extent and map-object rendering path.

`SurfaceObservation.observationKind` now distinguishes material observations from `iron_patch` rows without a schema/index migration. The active-session control captures location only on save, stores approximate extent and an optional note, and renders an orange marker and approximate spread. Backup validation and detail/presentation paths recognise the kind. Iron patches are deliberately excluded from archaeological surface-scatter clustering. `extent` remains an approximate spread, never replacement geometry.

### 4. AIM project coverage — implemented 31 August 2026

Ingest Historic England AIM project-coverage geometry and distinguish:

1. mapped and AIM features recorded;
2. mapped and no AIM features returned;
3. not mapped, coverage unknown or source unavailable.

`AIMResponse.projectCoverage` records `mapped`, `partial`, `not_mapped` or `unknown`. Normal online scans query Historic England's Project Area layer with the scan bounding box while monument features retain the static R2 path. Offline-only reads stay explicitly unknown until project-area geometry is included in packs. Terrain and historic scan logs now narrate the coverage state even when zero monument features are returned.

### 5. Session replay — implemented 31 August 2026

Provide read-only playback of the recorded trail, with finds, signals, observations and saved points appearing by their authoritative timestamps. Editing remains in the existing record surfaces, not the replay.

Session Review now contains a collapsible, read-only 30-second playback. It uses recorded trail timestamps, `foundAt` with `createdAt` fallback for finds, creation time for signals and saved points, and observation time for surface/iron observations. Explicit track gaps remain separate segments. The replay has accessible play/pause and scrub controls and performs no writes.

### 6. Historical OS overlays — existing capability reconciled

The assessment missed an existing capability. `mapLayerRegistry.ts` already serves named National Library of Scotland 1-inch second-edition and 6-inch second-edition tile collections as the OS 1895 and OS 1900 overlays. They are present in both Field Guide and the session map, are mutually exclusive, and have adjustable opacity. The origin is already registered in `networkOrigins` and documented in `NETWORK-PRIVACY.md`.

No duplicate ingestion was added. Before adding offline caching or republishing these tiles, settle and record the exact collection-level caching/redistribution terms; current direct viewport delivery and NLS attribution remain unchanged.

### 7. 3D terrain — rejected; 2D relief implemented

Do not treat existing hillshade layers as elevation data. MapLibre terrain requires an encoded DEM, with material storage, transfer, GPU and battery consequences. Prefer multi-scale local-relief products derived from the DTM: they support low-amplitude earthwork reading without continuous 3D rendering cost.

FindSpot now exposes Esri World Hillshade as a **Multi-angle relief** overlay, with adjustable opacity in Field Guide and the session map. The tiled service is based on a multidirectional hillshade algorithm and works as a broad terrain-reading backdrop; it must not be presented as Environment Agency 1m LiDAR or as a substitute for a future UK local-relief product. It improves landform reading without adding a DEM, national preprocessing/storage, or continuous 3D GPU rendering.

Any later 3D experiment remains Field Guide-only, online-only, opt-in and limited to pre-encoded areas. It is excluded from offline packs and the active session map unless later evidence changes the ruling.

## Explicit exclusions

- clear-to-detect or equivalent positive legality status;
- 100% completion badges;
- cloud backup or sync;
- community feed, marketplace, finds museum or leaderboards;
- live crews, find-a-mate or availability/location broadcasting;
- shared hazard or ordnance network;
- country breadth pursued at the expense of UK evidence depth;
- subscription tiers;
- duplicate landowner-permit work where existing agreement generation suffices.

## Sequence

| State | Work |
| --- | --- |
| Complete | Legality non-assertion rule; session-start evidence/daylight; recorded coverage percentage; iron/junk patches; AIM project coverage; read-only replay. |
| Reconciled | Historical OS overlays already existed; no duplicate ingestion. Collection-level terms still gate offline caching or republication. |
| Complete | Working multi-angle 2D relief overlay, explicitly identified as Esri World Hillshade. |
| Rejected | 3D terrain on the active session map. |

The existing V5 code items remain independent: the `AgreementModal.tsx` revoke race, `Permission.tsx` size ratchet, `USE_R2_DESIGNATIONS` removal, continuity default-alignment guard and legacy map-tap path behind `mapObjectSheetsEnabled`.
