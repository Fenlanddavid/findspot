# FindSpot V5 shipped-state inventory

Recorded: 2026-08-15<br>
Home baseline: 1,033 lines<br>
Session baseline: 1,746 lines

Classic active-session retirement and rollback are governed by
`docs/adr/0002-retire-classic-active-session.md`.

This inventory is the implementation record for the composition change. Existing
domain records and routes remain authoritative.

## Home

| Shipped item | V5 disposition | Reason |
| --- | --- | --- |
| Trust line | Retained; recommended backup action sits beside it | Local-only storage explains why backup is the user's responsibility. |
| Today heading and continuation copy | Retained | V5 fills the existing promise instead of adding another section. |
| Active-session next move | Replaced by the detecting-now primary card | Adds unmistakable state plus Resume, Quick Find and Log Signal. |
| Adaptive quick actions | Retained as zero-context fallback | New and zero-history users do not receive an empty continuation state. |
| Statutory Treasure prompt | Retained as the highest-priority secondary item | Legal reporting work must not be hidden by composition changes. |
| Pending finds | Retained below the contextual block | Keeps the queue accessible without competing for the return-card slot. |
| Backup banner | Moved from the global Home banner into the contextual/trust composition | Avoids duplicate warnings and follows the existing teal card language except at urgent. |
| Field Guide offline-pack suggestion | Removed from Home startup | Pack inspection belongs in its workflow and must not scan on launch. |
| Stale-coverage next move | Removed from Home | It used percentage and absence language that cannot be guaranteed from gapped GPS evidence. |
| Rally, permission and install suggestions | Existing destination routes retained; no longer compete for the continuation slot | V5 uses that slot only for resumption and authoritative obligations. |
| Finds strip, Field Guide card, club/rally shortcut, Permissions and Latest Finds | Retained in shipped order | Preserves existing workflows and landmarks. |

## Session

| Shipped item | V5 disposition | Reason |
| --- | --- | --- |
| Session record and tracking fields | Retained as authoritative | No parallel active-session model. |
| Tracking `startTime` | Retained as legacy trail-start evidence | New `sessionStartedAt` and `activatedAt` prevent it being mistaken for visit start. |
| Existing active-session composition | Retired after parity and lifecycle tests | The focused workspace is now the sole unfinished-session surface. |
| Browser and Companion tracking | Retained | Workspace does not require a Companion version or Companion itself. |
| Find, significant find, surface observation and undug signal actions | Retained in Record | No new mutation path. |
| Saved point | Existing canonical mutation exposed in Record | Context is inherited from the active session and latest usable location. |
| Session map | Demand-mounted in Map and destroyed on tab exit | Bounds battery, heat and animation cost. |
| Field Guide | Dedicated one-tap workspace destination | Matches the top-level access baseline. |
| Finish | Pinned in the workspace header and Session view | Never hidden in overflow navigation. |
| Coverage percentage | Omitted from the workspace and V5 review | Detailed legacy coverage remains available, but the new presentation does not overclaim precision. |
| Session completion | Authoritative finish write occurs before derived review work | Review failure cannot leave a completed visit open. |
| Review | Derived from durable session records and reopenable | No duplicate snapshot model. |

## Build validation posture

Automated unit, architecture, restore, build and browser checks are release
inputs.

At the time this inventory was recorded, detectorist cohorts, weekend
observation, interviews and physical battery soaks were intentionally not
part of the implementation run. That is no longer the whole position.
Author-run field validation and a physical-device restore drill were
completed and accepted on 25 August 2026; the record is in
`docs/programmes/v5-handoff-2026-08-15.md` under "Manual validation —
position at 25 August 2026" and "Durability drill record".

Detectorist cohorts, continuity-comprehension work, interviews and instrumented
battery and thermal measurement against a device matrix were not performed.
The 25 August product ruling accepts Continuity default-on and retires its
two-weekend cohort as a V5 launch gate; that cohort remains optional future
research. The other evidence gaps remain outstanding. None is represented as
an activity that passed.
