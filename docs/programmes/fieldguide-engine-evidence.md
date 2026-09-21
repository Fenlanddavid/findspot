# FieldGuide engine programme — evidence before expansion

Reviewed: 21 September 2026

Verified code baseline: v5.0.19, commit
`38fdff8b7535f8dc1ac8f01ae51303633a03c8ea`.
The supplied brief cites a 752-file dump with file-set SHA-256
`b2a19c6de3f70c935fb379df8f564d4d8b2476743703193c52f32818eb11a596`;
that dump's equivalence to this checkout has not been verified.

Status: implementation authorized by the user on 20 September 2026. The
context-only recommendation, replacement evidence card, durable capture and
initial diagnostics reader are implemented and verified locally in the working
tree. Remaining evidence gates are recorded below. No release was performed.

Scope: improve the existing measurement loop before extending scoring or
interpretation. No new datasets, scan stages or automatic weight adjustment.
Replace the existing performance presentation and permit one aggregate read
surface. Physical code deletion and dead-export cleanup remain separate;
disconnecting a misleading presentation is in scope.

## Position

FieldGuide should first record what it actually presented, preserve the evidence
needed to interpret outcomes, and make the denominator explicit.

The prediction ledger is the right foundation, but its current reader, recording
boundary and durable rollup are not yet a dependable measurement loop. Promoting
it unchanged would replace one misleading figure with another.

The first useful result is descriptive: among predictions with a particular
version, signal and search-evidence type, what was subsequently reported?
That does not establish that a signal caused a find, that a confidence label is a
probability, or that an interpretation changed a detectorist's behaviour.

## Corrections to the original findings

1. **Displayed explanations are already incomplete evidence.**
   `buildTerrainHotspots()` retains four prioritized explanations; later
   enrichment retains five. `HOTSPOT_EXPLANATION_WEIGHTS` controls explanation
   display priority, not numerical score contribution. Its 40 keys include
   descriptive and suppression tags and a generic `other` tag. Persisting
   `hotspot.explanation.map(item => item.tag)` would measure selected display
   reasons, not all contributing signals. The claimed 41 score-contribution
   sites needs a defined counting method before it is used as an audit fact.

2. **The existing evidence reader is stale.**
   `loadPredictionEvidenceCalibration()` counts `outcome === 'hit'`, while the
   current resolver writes `find_recorded`. It also groups every non-unvisited
   row by evidence type without excluding `legacyOutcome` or separating engine
   versions. It cannot be promoted unchanged.

3. **The persisted snapshot precedes geology.**
   `persistPostScanOutcomes()` records the historic result, including PAS where
   available. Geology is applied separately in `FieldGuideWorkspace` after
   historic enhancement. The ledger therefore does not reliably describe the
   final displayed score or band. The original claim that both modifiers move
   the recorded band is incorrect for this path.

4. **Uniform modifiers are not an absolute ordering invariant.**
   An equal additive modifier preserves order among equally eligible, unclipped
   targets. The actual implementation gates eligibility and clamps scores, so
   it can change relative ordering across gates or create ties. Recomputing
   confidence also risks replacing earlier edge, slope or field-reliability
   downgrades. The defensible criticism is the absence of measured incremental
   value, not that ordering can never change.

5. **The replacement ledger also uses broad spatial association.**
   `findMatchesPrediction()` accepts bounds containment or proximity within
   150 m. It adds useful permission and post-prediction time checks, but does not
   by itself establish precise location success or performance above chance.
   The twelve displayed features and the terrain engine's maximum of eight
   hotspots are different collections and must not be conflated.

6. **Long-term storage currently discards the proposed evidence.**
   Raw predictions and their evidence rows are swept after 180 days. Aggregates
   retain band-level counts, not scores or tags. Two seasons of useful tagged
   evidence will not accumulate unless retention changes before those rows
   expire. Version changes separate cohorts; they do not reset or delete the
   ledger.

7. **Outcome evidence cannot evaluate interpretation utility alone.**
   Recording tags and finds does not record which narrative was read or whether
   it changed a search decision. W5 needs its own evaluation question; it cannot
   automatically inherit a verdict from signal-level outcome comparisons.

## W1 — Record complete, reproducible prediction snapshots

### Decision

Extend prediction recording with:

- The score and confidence actually presented at the agreed recording boundary.
- A complete, deduplicated set of stable evidence keys captured before display
  prioritization, carried through every enrichment stage. Distinguish scoring,
  suppression and contextual keys; do not infer scoring contribution from
  explanation priority weights or from display prose.
- A capture-format version and enough scan/target identity to make repeated
  persistence of the same result idempotent. An intentional new scan is a new
  exposure, but not automatically an independent location trial.

Keep `explanationTags` if useful for display auditing, but name that purpose
explicitly. It must not substitute for complete evidence capture. Tag presence
supports association analysis; numerical attribution or counterfactual rescoring
would additionally require actual contributions and sufficient scoring inputs.
Do not claim those capabilities from tags alone.

Define one recording boundary shared with presentation. If delayed context can
still change score or confidence, finalize it before recording or explicitly
version the presented snapshots. Do not silently label a pre-geology score
“post-modifier”. Record only results actually surfaced and keep permission scope
explicit; wholly unscoped predictions cannot automatically acquire outcomes.

Repeated scans and overlapping targets can share a later find. Preserve enough
identity to expose this dependence. Report prediction exposures as exposures,
not counts of independent finds or independent experiments.

### Compatibility and retention

Old fields remain absent/unknown. Do not backfill tags, scores or search evidence
from today's engine. Missing evidence capture is excluded from tag denominators;
it is distinct from a known empty tag set.

Additive record properties need not imply an IndexedDB version migration unless
indexes or stores change. Backup validation, export/restore and durable rollup
must preserve the new contract. Validate finite scores, key formats and count
invariants without making historical keys depend on today's display wording.

Specify and implement the durable evidence contract with capture, rather than
waiting for W4's presentation. Retain tagged surfaced/searched/associated-find
counts with compatible version and evidence dimensions. Keep the identities or
cohort summaries needed for the comparisons actually promised. Marginal tag
totals alone cannot recover co-occurrence, within-permission comparisons or
independent sample counts after raw records disappear.

If the bounded rollup cannot support a proposed analysis, narrow that analysis
or explicitly agree a retention change. Do not promise later analysis of data
the programme discards.

## W2 — Choose a coherent role for scan-wide context

### Finding

Geology supplies one centroid-derived class scalar; PAS supplies one cell-level
boost. Neither is demonstrated local evidence of where to search within that
scan. Equally, failure to distinguish locations within one scan does not prove
that regional context has no predictive value across scans.

The current geology class table spans -9 to +9; its wider defensive clamp does
not establish a defect. The 18-point difference between the extreme classes is
an unvalidated scoring assumption. Retain the existing `_raw` signature unless
a separate API decision requires otherwise.

### Accepted ruling

Use a clarified version of option (a): retain geology and PAS as displayed
context and remove their numerical influence from both hotspot score and
confidence. Keep their availability and context evidence recordable. Leaving a
context-adjusted score beside a context-free band creates two competing notions
of strength and does not fully reduce the scoring surface.

The user accepted this tightening of the original option (a). Existing class
scalars remain available for historical reference; no class recalibration is made.

If numerical modifiers are retained instead, choose option (b) and specify it
fully: capture base and final scores/bands, modifier eligibility, applied deltas,
unavailable context, and modifier/configuration versions. Persist the same final
snapshot that presentation uses. Two band labels alone cannot distinguish PAS
from geology effects or explain unchanged bands.

Evaluate modifier associations within compatible cohorts. Paired base/final
labels describe reclassification on the same observed outcomes; they do not
prove causal benefit or account for searches the displayed advice discouraged.

Preserve all applicable confidence suppressors at the final evaluation boundary.
Test cases where a modifier previously recomputed a downgraded band.

Land scoring semantics and W1 capture under one coordinated
`HOTSPOT_ENGINE_VERSION` change. Preserve historical cohorts; never clear the
ledger to create a clean start. Version evidence semantics separately when they
change independently of scoring.

## W3 — Replace the accuracy claim with a repaired evidence summary

### Finding

The `${permissionId}:${geohash6}` key merges multiple hotspots. Within 24 hours
the writer replaces their matched find IDs rather than combining the cell's
matches. An older row may initially take the union branch, but the next hotspot
in the same write pass sees its freshly updated timestamp and can overwrite it.

A permission whose matching hotspots occupy one cell cannot meet the two-cell
reliability threshold, however many finds it contains. How common that is needs
permission-footprint data; “most users indefinitely” is not established by code.

The spatial association fraction has neither a searched-area comparison nor an
exposure baseline. Its linear transformation into “Engine Calibration” does not
calibrate the engine. Fixing the key alone would not validate that claim.

### Accepted ruling

Retire this accuracy/calibration presentation and replace it in the existing card
with a repaired prediction-evidence summary. Disconnecting the old presentation
does not require deleting its functions or stored records. The collision remains
a separate data-integrity issue for factual consumers of `FindHotspotSignal`;
retirement must not imply that those records are now correct.

Before promotion, use one explicit counting policy across the raw reader and
rollup:

- Recognize current outcomes and exclude audit-only legacy outcomes.
- Separate engine/capture/evidence versions wherever semantics differ.
- Report surfaced predictions, accepted search reports and associated finds
  explicitly. An accepted search report without a logged find is not an explicit
  report of no relevant find.
- Show tracked visits separately. GPS proximity is evidence of a visit, not
  proof that the target was searched. Tracked-only find associations are also a
  separate count, not a searched-trial success rate.
- Only reported or mixed predictions satisfying the agreed search-evidence
  rules enter the searched denominator. Apply the same search eligibility rule
  to positives and negatives; a find must not bypass a report-quality threshold.
- Keep find-only associations separate. Unvisited, unresolved and unscoped
  predictions must not become misses.

The current rollup already excludes tracked-only rows from its searched counts,
so its tracked searched/hit fields do not constitute a usable tracked success
rate. Repair reader/rollup disagreement rather than displaying those zeros as
measured failure.

Use wording such as “associated finds among reported searches”. State that the
existing spatial rule includes nearby finds. Neither this fraction nor a simple
permission-area baseline establishes performance above chance: search effort,
access, overlap, reporting and exposure time affect the comparison.

Render the replacement when prediction evidence exists, independently of the
old card's finds/undug-signal gate. Empty, find-only and tracked-only states must
remain understandable without a calibration badge.

Undug conversion may remain as a separate factual summary of resolved dug
signals, with open and dismissed counts visible. It measures the recorded dug
subset, not scan accuracy; remove arbitrary success colours or grades.

## W4 — Preserve evidence now; read aggregates before judging them

### Decision

Split this workstream into storage correctness and presentation.

**W4a belongs in the initial capture release.** Preserve the evidence defined in
W1 before TTL deletion. Rollup must be atomic and repeatable without double
counting. Refresh the same scope that will be swept: current coverage commands
refresh one permission and then call a global sweep, which is not a guarantee
that every expiring prediction has just been reconciled.

Historical aggregates cannot acquire dimensions that were never retained.
Label them as legacy/limited rather than treating absent counters as observed
zeros. Separate incompatible aggregate formats and outcome rules as well as
engine versions. A changed reader cannot repair already frozen counts.

**W4b is one aggregate read surface, initially diagnostics-only.** It may be
built as soon as capture and counting semantics are stable. No accumulated
successes are needed to verify empty states, denominators and conservation of
counts. Evidence volume gates interpretation and weight changes, not the
existence of the reader.

Show surfaced, searched and associated-find counts, evidence type, cohort/version
and observation period. Explain that swept counts are frozen. Do not pool fresh
live exposures and expired predictions into an apparently equal-follow-up cohort;
if both are shown, distinguish their age and follow-up windows and avoid double
counting. The present aggregate table contains expired predictions only.

Per-tag views belong in this same surface after sufficient compatible evidence
exists. Zero denominators display no rate. Any sufficiency threshold must be
defined for a particular comparison, not presented as universal reliability.
No single-number verdict, grade, badge or automatic weight adjustment.

## W5 — Hold interpretation expansion; define a separate evaluation

The landscape and interpretation stacks are layered, with inputs flowing between
them. Source-file byte counts indicate maintenance size, not measured runtime
cost or product value. Do not cut layers merely because their outputs overlap,
and do not extend them without a concrete evidence question.

Signal evidence can identify hypotheses worth reviewing. It cannot establish
whether a narrative helped somebody choose, understand or change a search.
Evaluate that with a separately agreed method, such as structured field-session
review comparing the advice with the detectorist's decision and reasoning.
No new tracking or product surface is authorized here.

W5 can remain on hold while that method is defined. It need not wait for signal
pruning, and pruning does not automatically satisfy its evidence requirement.

## Sequence and acceptance gates

| Order | Work | Gate |
| --- | --- | --- |
| 1 | W3: disconnect unsupported accuracy claims; repair the ledger reader before promoting it. | Current outcome handling, version separation and explicit denominators verified. |
| 2 | W1 + chosen W2 policy + W4a durable capture. | One coordinated scoring-version change; stable snapshot identity; no lost evidence at sweep. |
| 3 | W4b diagnostics reader. | Count reconciliation and honest empty/limited-data states; no requirement to wait a season. |
| 4 | Human review of signal associations and proposed pruning. | Compatible cohorts, sufficient independent permissions/visits, understood overlap and search/reporting bias. |
| Separate | W5 interpretation review. | Agreed method that can assess usefulness of advice. |

“Two seasons” is a planning possibility, not an evidence gate. Repeated scans of
the same places cannot manufacture independent evidence, however large the row
count. Correlated tags and selection of only surfaced/searched targets limit
what marginal rates can support. Pruning should follow a documented hypothesis
and a deliberate comparison, not an automatic ranking of tag hit rates.

The initial implementation must verify:

- Complete evidence survives explanation truncation and enrichment.
- Recorded score/band matches the presented snapshot; replay does not duplicate
  a scan result; intentional rescans remain distinguishable.
- Current finds count correctly; legacy, unvisited, tracked-only and find-only
  records follow the agreed policy; report thresholds apply consistently.
- Overlapping predictions and shared finds are identified as dependent evidence.
- Missing capture fields remain unknown, including after backup/restore.
- Raw-to-aggregate counts reconcile by compatible cohort; tagged evidence
  survives expiry; repeated sweeps do not double count; refreshed scope matches
  swept scope.
- The replacement card works with no finds, only tracked visits, only find
  associations, and insufficient search reports.

## Accepted implementation decisions

1. Geology and PAS remain regional context and cannot change hotspot score,
   confidence or order. The compatibility functions remain callable. Historic
   enrichment reapplies the original local confidence suppressors.
2. The existing performance card now presents explicit prediction/search/find
   counts. Undug outcomes remain a separate factual summary, without grades.
3. Capture v1 retains the final score/band, all explanation tags before display
   truncation, actual raw contributions by scoring branch, suppression keys and
   contextual keys. Raw contributions precede dimension caps and are not a
   counterfactual replay model. Geology availability is captured at presentation
   time, including pending/disabled states; later contextual display changes do
   not revise the immutable prediction score or band.
4. A scan result owns its UUID and surfaced timestamp. Prediction identity uses
   engine + scan + hotspot, and retries never replace prior outcomes. Deliberate
   rescans create separate exposures. Previously recorded rows are not backfilled.
5. Evidence v2 applies the same search-report acceptance threshold with or without
   finds/tracking. Explicit negative reports remain search evidence after a later
   find. Tracked-only and find-only associations remain outside searched rates.
6. Aggregate format v2 retains one compact frozen exposure per row in the existing
   aggregate table, keyed `v2:<prediction-id>`. It retains scoring evidence,
   geometry, scan/target/permission identity, associated find IDs and report session
   IDs while discarding raw outcome history and resolution-link records at sweep.
   This intentionally trades the former constant-size band rollup for storage
   proportional to exposures so co-occurrence and repeated locations remain
   inspectable. The 180-day raw TTL is unchanged; archived snapshots remain until
   permission deletion or complete data replacement. Legacy band aggregates remain
   separate and explicitly limited.
7. Coverage commands sweep only the permission they just refreshed. Live and
   frozen records share one counting policy. Frozen outcomes do not later change
   when a source find/report is edited or deleted; that limitation is stated in
   diagnostics. Deleting a permission removes its frozen snapshots as well.
8. The existing Settings → Backup → Advanced tools → Export Log download is the
   sole aggregate read surface. Its JSON now contains `entries` and
   `predictionEvidence`, separated into live, frozen and legacy cohorts. It exports
   cohort counts, version/period boundaries and repeated-find indicators, without
   exporting snapshot coordinates or find/permission identities. Per-tag analysis
   and weight pruning remain gated on field evidence; W5 remains on hold.

## Implementation verification

Completed 21 September 2026 after resuming the rate-limited session:

- Full unit suite with two workers: 160 files passed, 1,323 tests passed and one
  existing skip (60.70 seconds). This includes evidence capture, replay,
  permission-scoped sweep, backup restore, scoring, denominator and card states.
  The previously timed-out download-safety test passed without weakening its
  assertions or changing its timeout.
- All application static checks passed: TypeScript, type floor, file casing,
  explicit-any and hooks baselines, architecture coverage, DOM safety, download
  safety, date formatting and network origins. The date-check subprocess required
  execution outside the sandbox after `spawnSync grep EPERM`.
- Nix Chromium: all 32 tests in `tests/predictionEvidence.spec.ts` and
  `tests/regression.spec.ts` passed with one worker (2.2 minutes). Evidence-card
  screenshots at 390px and 1280px were inspected; counts remain on one line.
  These are browser viewport checks, not physical-device evidence.
- Final production build passed, including 118 PWA precache entries.
- Logs: `/tmp/findspot-evidence-unit-approved.log`,
  `/tmp/findspot-evidence-browser-nix.log` and
  `/tmp/findspot-evidence-build.log`. Browser screenshots are under the ignored
  `test-results/` directory.

The initial implementation checkpoint is closed locally. Per-tag interpretation,
weight pruning and W5 remain gated as described above; no field evidence or
physical-device verification is inferred from automated tests. No deployment was
performed during this verification session. The unrelated transcript in
`scripts/README-datasets.md` was preserved, including its existing trailing blank
line reported by `git diff --check`.

## Source anchors for the review

- `src/engines/hotspot/hotspotEngine.ts`: explanation truncation, score caps,
  confidence suppressors and modifier application.
- `src/engines/hotspot/hotspotExplanations.ts`: display priorities and tag keys.
- `src/services/fieldguide/postScanOrchestrator.ts` and
  `src/components/fieldGuide/FieldGuideWorkspace.tsx`: recording/geology boundary.
- `src/services/predictionCalibration.ts`: stale raw reader.
- `src/engines/coverage/sectionCoverageEngine.ts`: resolution, scope, time and
  spatial association rules.
- `src/services/hotspotPredictionService.ts`: prediction identity and TTL rollup.
- `src/services/sessionCoverageCommands.ts`: refresh/sweep scope.
- `src/services/findHotspotService.ts`: cell key and overwrite/union branches.
- `src/services/fieldguide/scanAccuracy.ts` and
  `src/components/ScanAccuracyCard.tsx`: current metric and presentation.
- `src/db.ts`, `src/services/persistenceValidation/backup.ts` and
  `tests/unit/hotspotPredictionService.test.ts`: storage and existing contracts.
