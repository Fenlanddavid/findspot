# Session coverage by section

## Product contract

At session end, a user may record which stable land sections they searched.
The searched-area map opens automatically after finishing and remains optional.
The latest eligible session can also be edited from the relevant sub-field's
**Ground coverage** action during the 48-hour recall window.
Opening that action goes straight to the selectable map; there is no separate
edit mode or edit button. **Done** saves without closing the panel so further
adjustments remain one tap away.
Eligible whole-permission sessions remain editable from the relevant sub-field;
editing one field preserves any reports belonging to the session's other fields.
The review never displays FieldGuide predictions. It remains available for 48
hours from the session's original `endTime`; after that it is read-only.
Choosing **Not now** creates no record and leaves predictions unvisited.

## Review interaction

The user-facing task is expressed entirely in detectorist language:

- the collapsed card is **Searched areas**;
- opening it asks, “Which parts of the field did you search today?”;
- **Done** saves marked areas and collapses to the saved count;
- **Not now** and **Close** discard every unsaved toggle;
- reopening within 48 hours restores only the last saved selection;
- tapping a saved green area while editing removes the green state immediately;
- sessions without a usable mapped boundary do not show a dead-end review.

Tracked areas are visibly already counted and cannot be toggled. Marked,
tracked and find-location areas use both colour and map symbols, with explicit
accessible state labels. A find location remains selectable if the user also
searched that surrounding area.

Prediction resolution still runs after **Done**, but its counts and terminology
never appear in the user experience. They remain available through diagnostics
and developer calibration surfaces.

The coverage view lives with each sub-field beside **Locate**, **Show Gaps** and
the session actions. A permission with one unsplit boundary keeps the same view
inside its boundary-and-fields panel. It is useful independently of prediction calibration.
Its language is deliberately evidence-aware:

- reported and tracked sections are search coverage;
- a GPS find marks activity at a location, not whole-section coverage;
- an empty section says "Not marked", never "never searched".

## Section identity

Every mapped field is split into globally stable H3 cells clipped to its
boundary. Candidate resolutions are measured against the actual clipped field,
with a target of roughly six useful sections, so an ordinary small field does
not collapse into one all-or-nothing selection. The selected H3 resolution is
retained across ordinary boundary edits.

Older coarse sections are retired on reconciliation. Existing `reported`
evidence is transferred only to finer areas substantially overlapped by the
original selected area. A legacy whole-field report therefore transfers to all
replacement areas. Old observations are removed after their equivalent finer
observations are written atomically.

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
- Browser acceptance proves the review stays within the tap budget, **Not now**
  writes nothing, saved selections reopen, unmapped sessions hide the review,
  and permission-level **Show Gaps** includes saved reports.
