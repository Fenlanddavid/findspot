# FieldGuide supporting historic context

## Confirmed scan paths

- `FieldGuideWorkspace.executeScan` calls `runFieldGuideScan`, which runs the
  terrain coordinator then supplies its result to `runHistoricPhase` through
  `scanContextFromTerrain`. The terrain footprint is the fixed 3 × 3 Z16 tiles,
  with a small protection-query buffer. Standalone historic scans use the
  captured viewport footprint. Historic context lookups can extend farther.
- The terrain coordinator either processes seven tile sources or reuses cached
  raw clusters. Both branches fetch designation records again (from downloaded
  data when offline) and reconstruct contextualised clusters. Raw observations,
  availability, per-source processing status and completeness now pass into the
  historic phase. A successful overall scan does not establish source success.
- `runHistoricScanPipeline` obtains OSM context, NHLE scheduled monuments, AIM
  aerial records and routes. Its historic cache contains source responses,
  rather than panel summaries. Both cache hits and fresh retrieval now call
  `buildSupportingContext` with the same completed evidence snapshot.
- Previously `Sites` counted `pasFinds`: despite that variable's name, these are
  nearby OSM heritage features merged with NHLE monument mirrors, not public PAS
  records or personal finds. AIM records reached terrain enrichment and ALIE,
  but were absent from that counter. The new count explicitly describes
  deduplicated OSM heritage, scheduled monument and aerial mapping records in
  the scan and surrounding query area. Public PAS cells and personal finds
  keep their separate presentation and evidence policies.
- `runHistoricPhase` is the sole active caller of `calculatePotentialScore`.
  The hook initially sets terrain and imagery to zero; no later setter fills
  either from completed terrain assessments. Its proximity calculation could
  assign 35 historic points for a monument, while both panel implementations
  called that low density and selected their heading using three scores >= 50.
  The score itself is not a record-density measure.
- The old monument test used a representative coordinate (usually the first
  polygon vertex) within 600 m of the centre. The hook now accepts full NHLE
  geometry, checks footprint intersection/containment and calculates proximity
  to geometry. Point-only callers retain point proximity. NHLE mirrors are not
  separately added as independent heritage evidence in that calculation.
- Roman-road retrieval uses a bounding-box query padded by the shared historic
  context radius. Returned features can contain several segments; a return
  alone establishes neither a crossing nor proximity. Exact geometry now
  determines intersection, nearby context within 2 km of the footprint, or a
  broader query-only return. Parent IDs and source references group segments.
- The completed historic snapshot is held in workspace state and consumed by
  both `HistoricLayerManager` and `FieldGuideMap`. The original centre also
  anchors historic requests and the ALIE input; map movement cannot silently
  switch the interpretation to another location. The drift guard still checks
  the current map position before applying hotspot enrichment.

## Summary and engine behaviour

`supportingContext.ts` separates recorded heritage, historic routes, terrain,
imagery, environmental clues and dataset limitations. Source outcomes are
supporting observations, no additional corroboration, unavailable, not assessed,
failed or incomplete. Tile observations do not establish a specific
archaeological process. The heading acknowledges recorded context independently
of interpretation confidence. Spatially unverified query returns are described
as such, rather than asserted to occur within the footprint.

`SupportingContextEvidence` provides the shared counters, route explanations,
assessment descriptions and limitations. Record details retain source identity,
record type, supplied dates/evidence and spatial uncertainty. The existing
OSM/NHLE mirror relationship rule is retained, with authoritative NHLE geometry
preserved. Split roads are counted by route identity, not feature count.

ALIE already received NHLE/AIM features and routes. Its typed adapter now uses
deduplicated records/routes and also carries the full factual recorded context,
including OSM heritage and segment provenance. These extra facts are excluded
from weighted process evidence. The ALIE cache version changed because the
persisted output contract changed; its input signature includes the context
snapshot. Protection checks retain their independent gate. A verified scheduled
boundary overlap is also visible directly in the supporting panel while ALIE
loads. The supporting panel no longer gives road-edge detecting advice or
creates synthetic Roman-road finds for period counts.

## Cache handling

New terrain cache writes retain `sourceStatus` alongside availability and
completeness. Old cache entries without processing details are invalidated through
the existing cache mutation when online, with an explicit log explaining the
fresh source assessment. Offline, their evidence remains available with
incomplete assessments and an explanation that a fresh scan is required; loaded
data is not invented as a completed negative assessment. Historic source caches
are summarised again on each scan.
Cached unnamed routes without enough parent/reference/name identity are
refetched from the existing generation-scoped asset, which can still be served
from offline Cache Storage. If retrieval fails, route assessment is incomplete.
No legacy heading or proximity-derived density label is reused.

## Coverage limits

- OSM and statutory designation records are not a complete archaeological
  inventory; public PAS cells describe recording activity in a wider area.
- AIM's static index provides bounding-box extents, not full monument geometry
  or a stable monument ID. Identical records are deduplicated by their content;
  distinct records with identical extents and attributes cannot be distinguished.
  Legacy AIM responses with unspecified geometry detail remain explicitly
  uncertain. Project coverage is reported separately, including unmapped,
  partial and unknown areas.
- Historic route identity uses a source reference/parent identity where supplied,
  and the existing named-route fallback otherwise. This is not a cross-dataset
  canonical road gazetteer. Source confidence classes and all grouped segments
  remain available.
- Rendered terrain and imagery observations do not establish occupation,
  archaeological significance, an archaeological process or a finds hotspot.
  Failed checks and sparse returns do not establish unrestricted land.

## Regression coverage

`supportingContext.test.tsx` covers A–J from the brief, polygon holes, point-only
semantics, broader-query roads, source processing failure, incomplete coverage,
cross-source mirrors, AIM extents and the active panel rendering. Its Flag Fen
scenario is clearly labelled synthetic and is not surveyed Flag Fen geometry.
`historicContextPipeline.test.ts` exercises fresh/cache parity, scan-centre
anchoring, failed retrieval and legacy route-identity refresh through the actual
historic coordinator. `potentialScoreContext.test.ts` checks geometry recognition
with the unchanged 35-point monument contribution. Roman-road tests verify split
parent identities. The mobile browser regression checks the new heading,
spatial explanation and explicit imagery assessment; the protected-boundary
browser regression retains its boundary visibility and target protection checks.
`terrainAssessmentCache.test.ts` checks online invalidation, offline preservation
and retention of known source failures.

## Changed files

| Area | Files |
| --- | --- |
| Shared evidence and geometry | `src/services/fieldguide/supportingContext.ts`, `src/services/fieldguide/historicContextSpatial.ts` |
| Panel views and completed snapshot | `src/components/fieldGuide/SupportingContextEvidence.tsx`, `HistoricLayerManager.tsx`, `FieldGuideMap.tsx`, `FieldGuideWorkspace.tsx`, `FieldGuideContext.tsx` |
| Scan pipeline and legacy proximity | `src/hooks/usePotentialScore.ts`, `src/services/fieldguide/historicScanCoordinator.ts`, `historicScanSupport.ts`, `scanOrchestrator.ts`, `terrainScanCoordinator.ts`, `terrainScanSupport.ts` |
| Source and cache contracts | `src/services/historicScanService.ts`, `romanRoadService.ts`, `persistenceValidation.ts`, `src/pages/fieldGuideTypes.ts`, `src/db.ts` |
| Wider interpretation context | `src/services/fieldguide/landscapeInterpretation/signalAdapters.ts`, `src/types/landscapeInterpretation.ts`, `src/workers/landscapeInterpretation.worker.ts`, `src/domain/engineVersions.ts` |
| Tests | `tests/unit/supportingContext.test.tsx`, `historicContextPipeline.test.ts`, `potentialScoreContext.test.ts`, `terrainAssessmentCache.test.ts`, `romanRoadService.test.ts`, `fieldGuideArchitectureCharacterization.test.ts`, `tests/regression.spec.ts` |
| Report | `docs/programmes/fieldguide-historic-context-fix.md` |

## Validation results

- `npm run test:unit -- --maxWorkers=2`: 167 files passed; 1,382 tests passed,
  one existing skip. The default parallel run hit a download-safety test timeout
  while browser tests were also running; the bounded full run passed.
- Focused mobile completed-scan browser regression: passed, including the new
  heading, route relationship, imagery assessment and stale asset checks.
- Focused scheduled-boundary browser regression: passed, including a valid
  cached terrain snapshot, boundary visibility, target selection and protection.
- `npm run build`: TypeScript and production/PWA build passed. Existing large
  chunk and Vite deprecation warnings remain.
- Type floor, casing, explicit-any, hooks, architecture coverage, DOM safety,
  download safety, date locale and network-origin checks passed. Date checking
  needed an unsandboxed rerun after its subprocess was blocked by the sandbox.
- Scoped `git diff --check`: passed. Pre-existing unrelated documentation edits
  were preserved.
