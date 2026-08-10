# Surface observations in Landscape investigations

## Decision and product boundary

Surface observations are local, user-authored records displayed only in the
`Landscape investigations` card on the Permission page. They do not appear in
FieldGuide: not on its map, in Glance, in Landscape Intelligence, in engine
evidence, or in interpretation detail.

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

## Permission scope

The Permission page reads all active observations whose `permissionId` matches
the displayed permission. Retired observations are excluded from the count,
list and pottery-plus-CBM combination.

There is no hidden proximity radius. Section identity is derived where
possible. The compact permission list does not decorate same-section records
with a distance. The pottery-and-CBM rule uses the same section where the
current section is known; otherwise it uses the same permission and states the
distance between the paired records.

## Capture flow

Opening capture uses the app's standard centred card dialog, constrained to the
same maximum dimensions as other card dialogs. Six field materials and four
abundance choices are large touch targets. Choosing abundance completes the
durable write, preserving the mandatory two-tap path.

Period / age is a clearly labelled optional section on that same card. It
shows up to three recently used period chips for the current permission and
`More…` for the full list. With no history, the fixed suggestions are Roman,
Medieval and Post-medieval. A period can be chosen before abundance, but the
valid base record is always written first and the period appended only after
that succeeds. Dismissing or losing the app before enrichment leaves the saved
record intact with an `unknown` period impression.

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

## Pottery and CBM combination

Confident frequent/dense pottery and CBM may produce the descriptive `Strong
structural activity signal` when they share the resolved area and their period
impressions agree, or either period is unknown. Conflicting known periods do
not combine. The wording is suggestive and never determines a villa, bathhouse,
settlement or other site type.

## Calibration boundary

Calibration is per device. No account, analytics or cross-device aggregation
path is introduced. Where one user's own record cannot satisfy a future,
pre-written evidence gate, the outcome is no weighting. Coverage must be the
denominator for any later co-occurrence analysis, reassessment rates must be
reported as lower bounds, and genuinely independent evidence must be used.

Engine characterization snapshots remain the hard boundary: any snapshot
change means surface observations have reached an engine and the change must
be reverted.
