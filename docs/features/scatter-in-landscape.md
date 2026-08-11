# Surface observations in Landscape investigations

## Decision and product boundary

Surface observations are local, user-authored records displayed in the
Permission experience and its `Landscape investigations` card. They do not
appear in FieldGuide engines, engine evidence, scores, targets or predictions.

They never change a FieldGuide score, confidence value, target, rank, list
order, hotspot or engine result. This decision may be revisited only through
the per-device calibration-readiness gate, never through UI convenience,
tie-breaking or incremental numerical influence.

The active-session page retains a `Record surface find` shortcut directly
below Add Find / Finish Session. That is a capture entry point, not a display
or interpretation surface.

## Canonical implementation names

- IndexedDB and backup table: `surfaceObservations`. The records are individual
  observations; a scatter is a descriptive relationship resolved from them.
- Read/write and permission-scoped presentation resolver:
  `src/services/surfaceScatter.ts`.
- Permission-card integration:
  `src/components/surfaceScatter/PermissionSurfaceObservations.tsx`, mounted by
  `OutstandingQuestionsCard.tsx`.
- Capture and disclosure UI:
  `src/components/surfaceScatter/ObservedByYouBlock.tsx`.
- Plain display formatters:
  `src/components/surfaceScatter/surfaceScatterPresentation.ts`.

No Surface Scatter component belongs under `src/components/fieldGuide`, and
FieldGuide components must not import the service or observation UI.
`SurfaceScatterCard.tsx` does not exist. Documentation must not use the earlier
draft table name `surfaceScatters`.

## Period vocabulary

Capture follows the PAS broad-period vocabulary: Palaeolithic, Mesolithic,
Neolithic, Bronze Age, Iron Age, Roman, Early Medieval, Medieval,
Post-medieval, Modern and Unknown. This provides one direct mapping to the
public-record vocabulary already consumed by FindSpot.

Schema v44 normalizes two superseded draft values without creating a user
reassessment or changing observation timestamps:

- `anglo_saxon` becomes `early_medieval` because it is a vocabulary synonym;
- broad `prehistoric` becomes `unknown` because it cannot honestly be narrowed
  to Palaeolithic, Mesolithic or Neolithic after the event.

The same normalization runs before validating an older backup. Reassessment
snapshots are normalized as well, preventing a vocabulary-only transition from
being counted later as an identification correction.

## Observation context and provenance

`lat`/`lon` remain the canonical observation geometry. Optional extent is an
approximate diameter/spread and never replaces that point. Visibility, ground
condition and a bounded 500-character note are contextual enrichment. Context
edits cannot change assessment fields; later material, abundance, confidence
or period changes must use the reassessment service.

New captures copy the live session's ID and ISO date/time fields into immutable
`originSession*` provenance. The live `sessionId` may be cleared when its
Session is deleted, but the origin ID remains and is deliberately not a foreign
key. Only distinct origin IDs count as recorded visits. Unsessioned records are
reported separately and never grouped into invented visits.

## Permission scope

The Permission page reads all active observations whose `permissionId` matches
the displayed permission. Retired observations are excluded from the count,
list and pottery-plus-CBM combination.

Section identity is derived where possible. The compact permission list does
not decorate same-section records with a distance. Spatial relationships use
canonical coordinates. Deterministic cluster algorithm v1 creates connected
components with a documented 50 m recorded-position edge and reports maximum
pairwise recorded-position distance as spread. Singleton points are not called
clusters.

## Capture flow

Opening capture uses the app's standard centred card dialog, constrained to the
same maximum dimensions as other card dialogs. Six field materials and four
abundance choices are large touch targets. Choosing abundance completes the
durable write, preserving the mandatory two-tap path.

After the durable base write the user can finish immediately, add details or
attach a local photo. Add Details shows context, identification confidence and
optional period chips. The service keeps an in-memory creation capability so
only the active capture flow can enrich the original assessment. Closing or
losing that UI ends the capability; later assessment changes are reassessments.

The capture-time dating-confidence default is `fairly_sure`. It renders as
`Possible Roman — your impression` and remains adjustable in review.
Capture-time enrichment is part of the original observation and does not
create a reassessment; a later review edit does.

## Permission-card presentation

- At zero observations, `Record surface find` is the only affordance. There is
  no count, empty state or observation wording because missing records are not
  evidence of absence on the ground.
- At one or more observations, `Your observations (n)` is one collapsed row.
  Its trailing add icon records another observation. The expanded state has
  the explicit provenance heading `Observed by you`, the records and a full
  record action.
- Each row uses one line for material and abundance. Period impression and
  reassessment provenance use a second line only when present. `unknown`
  creates no label or placeholder.
- A `fairly_sure` period is presented as possible. A confident period remains
  explicitly the user's impression.
- Surface observations remain a visually separate strand within the
  Landscape investigations card. They do not enter an investigation's
  supporting or contradicting evidence, confidence, priority, ordering or
  timeline.

## Permission map, summary and relationships

The dedicated Surface Observations map plots exact recorded coordinates. Every
live material value has its own colour/glyph, including distinct CBM and field
drain symbols. Marker size represents abundance only. Selecting a point can
show its GPS-accuracy circle, detail, context, original/current assessment,
reassessment history and private photos.

Permission and cluster summaries report observation/material counts, first and
latest observation, distinct saved visits and unsessioned records separately.
Retired records remain stored but are excluded. Permanent deletion removes the
observation and its exclusively owned local media.

## Pottery and CBM combination

Nearby pottery and CBM may produce `Nearby material association` within the
documented clustering distance. It reports only that both were recorded and
the approximate distance between their recorded positions. Period agreement
is not assumed and no occupation, building or site type is inferred.

## Private media and export boundary

Surface photos use the existing local `media` table through
`surfaceObservationId`. They are included only in an explicit full private ZIP
backup. Surface observations and photos are excluded from permission/landowner
reports, rally packages, shared packages, analytics and diagnostic telemetry.

## Calibration boundary

Calibration is per device. No account, analytics or cross-device aggregation
path is introduced. Where one user's own record cannot satisfy a future,
pre-written evidence gate, the outcome is no weighting. Coverage must be the
denominator for any later co-occurrence analysis, reassessment rates must be
reported as lower bounds, and genuinely independent evidence must be used.

Engine characterization snapshots remain the hard boundary: any snapshot
change means surface observations have reached an engine and the change must
be reverted.
