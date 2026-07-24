# Session coverage by section

## Product contract

At session end, a user may record which stable land sections they searched.
The review never displays FieldGuide predictions. It remains available for 48
hours from the session's original `endTime`; after that it is read-only.
Skipping creates no record and leaves predictions unvisited.

The permission coverage view is useful independently of prediction calibration.
Its language is deliberately evidence-aware:

- reported and tracked sections are search coverage;
- a GPS find marks activity at a location, not whole-section coverage;
- an empty section says "No coverage recorded", never "never searched".

## Section identity

Every mapped field is split into globally stable H3 cells clipped to its
boundary. Candidate resolutions are measured against the actual clipped field,
with a target of roughly three useful sections, so an ordinary small field does
not collapse into one all-or-nothing selection. The selected H3 resolution is
retained across ordinary boundary edits.

Legacy whole-field sections are retired on reconciliation. Existing
whole-field `reported` evidence is transferred to the replacement sections,
because that report explicitly meant the whole field; the legacy observation
is removed after the equivalent child observations are written atomically.

Each section retains an append-only geometry history:

- `currentGeometryVersion` identifies the shape used for new observations;
- observations reference `sectionGeometryVersion`;
- changed boundaries append a version instead of rewriting historical meaning;
- removed fields retire their sections rather than orphaning observations.

Section geometry is durable user history, not a cache.

## Evidence model

`sessionCoverage` stores independent observations. Its identity is:

`sessionId + sectionId + sectionGeometryVersion + evidence`

Evidence sources may coexist:

| Source | Permission map | Negative prediction evidence |
|---|---|---|
| `reported` | Search coverage | Yes, under the size/session rule |
| `tracked` | Search coverage | Yes, only when the hotspot-specific track threshold is met |
| `find-visited` | Activity marker | Never |

Saving a review changes only `reported` rows. Objective track and find
observations are recomputed from their source records and are not erased by the
review UI.

The existing **Show Gaps** view combines its precise track-derived coverage
with reported sections. Orange gaps therefore mean no track or reported search
evidence. The UI explicitly says when reports are included; reported area is
retained as a separate contribution and is not relabelled as GPS coverage.
Find-only activity does not remove a gap.

Every observation records the session start and end evidence window. Reported
coverage qualifies only for predictions surfaced before the session began.
Tracked resolution continues to use track points recorded after the prediction
was surfaced.

## Initial resolution policy

- A matched find resolves `hit` with the existing bounds-or-150-metre rule.
- Hotspot-specific tracked coverage at or above 20% resolves immediately.
- A reported section up to 10,000 m² resolves after one independent session.
- A larger reported section resolves after three unique session confirmations.
- Duplicate observations from one session count once.
- Find-only visits never resolve `searched_no_find`.
- Existing non-unvisited outcomes are not transitioned; a committed hit is
  permanent.

Raw predictions retain `resolutionEvidence`. Long-lived aggregates preserve
tracked, reported, mixed and find-only counts separately so their reliability is
not collapsed into a single rate.

## Persistence and lifecycle

`permissionSections` and `sessionCoverage` are backed-up user-data tables.
Old exports without either table normalize them to empty arrays. Restore
validation checks geometry versions and observation relationships.

Session deletion removes its observations. Permission deletion removes its
sections and observations. Field deletion retires sections. The integrity audit
checks permission, session, section and geometry-version references.

All UI reads use `pagePersistence`. Writes and evidence reconciliation use
`coverageMutations.ts`. Prediction resolution rules remain pure and database
free in the coverage engine.

## Guardrails and verification

- Characterization tests pin the pre-feature session outcomes and hit rule.
- The v40-to-v41 migration fixture asserts existing predictions remain intact.
- Backup fixtures and full ZIP round trips populate both tables.
- Property tests compare bounded arbitrary evidence sequences with an
  independent model.
- The property invariants include hit permanence, unique-session confirmation,
  temporal eligibility and no negative resolution without search evidence.
- New source files contain no explicit `any`.
