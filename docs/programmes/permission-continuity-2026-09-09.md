# Know your permission better with every visit

Baseline: v5.0.14, commit `64953c1`, clean working tree before this programme.
This supplements the existing V5 brief; it does not reopen the retired Classic
workspace decision. No accounts, analytics or automatic field-record uploads.

## Audit and disposition

| Existing capability | Gap | Disposition |
| --- | --- | --- |
| Permission Pulse inside collapsed investigations | Last visit and open questions hidden together | Move the same Pulse outside the disclosure and the consolidated card before detailed records; reuse its live queries and direct links |
| Session history, finds, observations and notes | Last-visit summary omitted today's visit and observations | Extend Pulse with recorded date, open status, observations and note excerpt; keep full records authoritative |
| Outstanding Questions, fieldwork notes, protection gates | Further detail needs a deliberate action | Keep the investigation workflow; overview action expands it; never bypass protection gates |
| Quick Start and independent find recording | Welcome → task choice → explanation → completion → destination | Add direct scan and record actions on welcome and task choice; retain optional help and completion flags |
| Regional calibration and process engine | Age/lithology mixed with present terrain; geology generated water/edge signals | Restrict classification to explicit superficial deposits, abstain on mixed/unsupported context, remove manufactured signals in scoring and wet-ground explanations |
| Hydrology adapter | One hydro observation also becomes water and wetland flags | Count the strongest water contribution once |
| ZIP/JSON exports and validated atomic restore | Shared history and download-as-saved status; inconsistent concurrent reads | Distinct prepared histories and explicit external-copy confirmation; consistent export snapshot |
| Rally export | Download displayed as delivery | Retain historical field losslessly; label it export preparation, never delivery |
| Map / Record / Session / Guide | Map failures only logged; small tracking messages | Visible fallback with Record and visit access; separate session and trail status, larger warnings |
| Session finish and review, Quick Find, tracking gaps | Existing canonical services already cover these workflows | Retain; verify existing behaviour rather than introduce new models |

## Delivery decisions

Phase A corrects classification, downstream signals, rally status and backups.
Weights remain provisional: no archaeological tuning is claimed. Chalk and
granite do not independently establish upland or moorland; these contexts use
neutral regional adjustment. Existing measured terrain still contributes through
its own engine inputs. Peat/alluvium regional adjustments are still provisional
deposit context, not observations of present wetness or proof of activity.
The ALIE cache version changes so old output is not silently reused as new output.

Phase B modifies the existing permission summary instead of adding a competing
overview or score. Obligations remain visible. Recorded visits, observed records,
and open FieldGuide investigations have distinct language. The latest visit and
open investigation count remain visible even when obligations fill the summary.
Same-date visits are ordered by their recorded start time before stable ID ties. Reopened, edited and
deleted records are read live, with no persistent presentation snapshot.

Phase C adds the map fallback and readable status without changing tracking
durability. Session notes remain available after a failed save. GPS messages are
persistent text instead of repeating assertive screen-reader alerts as seconds
change. Device reliability remains a separate validation question.

## Backup consistency and recovery

Records-only exports read all included tables in one readonly transaction. Full
exports use the same transaction to copy media one row at a time into a separate
temporary IndexedDB database. Concurrent writes, including from another tab,
queue during capture. Archive compression then runs on the captured media, after
the live transaction has released its locks. The final archive remains a Blob;
the original photo library is not retained in a second JavaScript array.

The temporary snapshot requires extra local disk space. Quota or copy failures
fail the export; they do not replace live records. A finally block deletes the
snapshot after success or failure. Abandoned export stages older than 24 hours
are cleaned on the next export, matching the restore staging lifecycle. They are
not exposed as recovery backups. Large-library time, disk pressure and memory
behaviour require real-device testing.

The cross-database copy uses `Dexie.waitFor` only around the separate staging
write, never around source operations or compression. See the
[Dexie transaction guidance](https://dexie.org/docs/Dexie/Dexie.waitFor()).

Prepared and externally checked are different states. Records-only confirmation
does not clear full-backup responsibility. Legacy `lastBackupDate` is retained but
not promoted to confirmed full protection. The timestamp used for confirmation is
capture start, so intervening edits are not incorrectly covered by confirmation.

## Before/after journey evidence

| Journey | Before, from code | After, checked in browser |
| --- | --- | --- |
| First scan | Four choices/confirmations before FieldGuide | One direct welcome action; no profile |
| First record | Help path led to permission creation | Direct find form; default permission available |
| Return to permission | Pulse hidden in collapsed investigations; today's date omitted | Recorded visit/date and unresolved count visible above detailed records without expansion |
| Rally download | `submittedAt` rendered “Data sent” | “Export prepared”; delivery explicitly unconfirmed |
| Records-only backup | Shared “Backup saved” and last-backup date | Prepared JSON history; photographs explicitly excluded |
| Concurrent full export | Manifest and live photo rows read at different times | Archive uses one consistent captured state |
| Map rendering fails | Console error or incomplete map | Persistent fallback links to Record and saved visit |

Automated checks establish software behaviour only. Browser screenshots and
check results are recorded with the final implementation handoff. They do not
establish that detectorists understand the result better outdoors.

## Software verification, 10 September 2026

The interrupted session was recovered from its saved transcript and the existing
working changes. Final review corrected the remaining geology-to-wet-ground
explanation, removed the rally dialog's unverified download-storage claim, moved
the consolidated permission card above detailed records, and ordered same-date
visits by their recorded start time.

- `npm test`: passed all repository checks and 1,245 unit tests across 149 files;
  one existing test skipped.
- `npm run build`: passed, including service-worker generation. Vite reported
  its large-chunk advisory; the build completed successfully.
- Onboarding, permission trust and full smoke browser run: 40 checks passed in
  Chromium, including start/pause/resume tracking, quick recording, session
  review/coverage, backup/restore, restore preview and rally workflows.
- Final focused browser run: eight checks passed, covering offline visit content,
  recoverable note-save failure with WebGL unavailable, actual exported photo
  bytes, historical and new rally export wording, valid/invalid restore,
  scheduled-boundary visibility with an overlapping tappable target, and the
  relocated permission overview with supporting panels still collapsed.
- Focused export cases exercise writes from another connection during capture
  and compression, both backup kinds, photo-byte fidelity, staging quota failure,
  cleanup, and the distinction between prepared and user-confirmed backups.
- The regional development cases check classification, downstream process
  signals, wet-ground explanations, duplicate hydrology contributions and
  confidence under sparse/contradictory evidence. The five frozen synthetic
  evaluation cases passed their existing software assertions.

Offline browser checks explicitly load the visit route before disconnecting;
they check the local summary and visit content, not just a changed URL.
Production app-shell precaching remains covered by its existing separate suite.

Reviewed Chromium captures at a 390 × 844 viewport:
[permission overview](assets/permission-continuity-2026-09-10/permission-overview.png),
[map fallback](assets/permission-continuity-2026-09-10/map-fallback.png), and
[backup preparation and confirmation](assets/permission-continuity-2026-09-10/backup-prepared.png).
These captures use synthetic records. This handoff is local implementation and
verification; no deployment or release publication was performed.

## Archaeological evaluation protocol

Development cases live in `tests/fixtures/regionalBenchmark.ts`. Separate frozen
evaluation cases live in `tests/fixtures/regionalEvaluation.ts`; their outputs
must not be used to retune this version. If a case drives a later correction,
move it into development and obtain a fresh held-out replacement.

These synthetic cases check software evidence handling across peat, alluvial,
chalk, clay, upland, sparse and misleading inputs. They are not archaeological
ground truth or an independently selected representative evaluation sample.

Before any archaeological weight tuning, collect licensed evidence packets with
source, location/scale, age/freshness, missing datasets, contradictory observations
and protection context. A reviewer first records plausible interpretations,
alternatives, confidence limits and a distinguishing field observation without
seeing the engine preference. Reveal the engine only after that judgment is
recorded. Log useful results, misleading results and reasons for disagreement.

Review record: case ID; evidence packet/version; reviewer and date; initial
judgment; engine/version/output; useful/misleading/inconclusive; disagreement
reason; action; development or held-out membership.

Archaeological review: **pending**. No reviewer recruited or contacted and no
weights validated. Automated correctness must be reported separately.

## Outdoor and first-use validation protocol

Observe a small consented group without coaching on representative Android and
iPhone devices, including browser and installed-app use, sunlight, offline use,
poor GPS, interrupted tracking and map failure. Record device/OS/browser, task
completion, time, hesitation, mistaken taps, uncertainty and recovery. Do not use
production analytics or collect private field records without consent.

Tasks: open the first useful Guide result without a profile; explain one supported
finding or why data is unavailable; select a next step; start/resume a visit;
identify whether the session is open and the trail is recording; record a find;
recover from GPS interruption; switch Map/Guide; finish and review the visit;
identify the photo-inclusive backup and transfer it to another device.

Compare the same tasks before and after, counterbalance order and record whether
any help was needed. Fewer screens is only a software result, not proof of
understanding. Never infer undetected ground from missing tracks.

Outdoor usability, locked-screen reliability and large-library export testing:
**pending**. These require physical devices and participants. A release must
describe that limit and must not claim archaeological or device validation from
unit or headless-browser results.

## Practical release notes

- Open scanning or find recording directly from Quick Start.
- See recorded visits and unresolved investigations without expanding several panels.
- Regional descriptions no longer turn ancient marine bedrock into water evidence.
- Full and records-only backups have clear labels and separate export history.
- Full backups capture consistent records and photos even when another tab changes them.
- Rally exports accurately show preparation instead of claiming delivery or successful download storage.
- Read session/trail status more easily and keep recording when the map fails.
