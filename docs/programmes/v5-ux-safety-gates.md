# V5 UX safety gates

Status: active decision record, 2026-08-16.

The authoritative Classic retirement and rollback decision is
`docs/adr/0002-retire-classic-active-session.md`.

This record originally separated reversible clarity work from migrations that
could weaken working FindSpot paths. The tranche improved session safety,
action predictability, trail status, settings visibility and Field Guide layer
organisation. Its later Classic retirement was a separate, explicit decision
after the automated parity gate closed.

## Finds route consolidation

Do not merge `/finds-box`, `/finds` and `/pending` by deleting or redirecting routes yet. First characterise every inbound link, query parameter, browser-back path, pending edit path and Significant/Signals tab. A future single surface must preserve list/map state, pending find completion, deep links and offline behaviour. Keep compatibility redirects after consolidation rather than breaking saved links.

## Permission decomposition

Do not create different behaviour for rally, club and individual permissions as a by-product of splitting `Permission.tsx`. Characterise the rendered actions and mutations for solo detectorists, organisers, club-day members and personal rally records first. Extract shared data/view-model hooks and persona wrappers incrementally; keep the database and permission mutation services authoritative.

## Classic session retirement — closed

The detecting workspace reached automated parity for:

- browser trail start, stop, resume and wake-lock warnings;
- Companion start, stop, import and stop-before-finish handling;
- finds, pending finds, undug signals, significant finds, observations and saved points;
- field notes, session notes, boundary status, trail review and trimming;
- finish confirmation, unfinished-session recovery and completed-session review;
- offline use and permission/field variations.

Automated parity and browser lifecycle tests passed. On 2026-08-16 the user explicitly authorised immediate retirement without waiting for the additional real field-session check. Classic, its escape action and its stored preference were removed in one bounded change.

Per ADR 0002, rollback now means code rollback to the prior release, not a
user-facing runtime switch.

## Preserved invariants

- No engine, scoring, hotspot or Field Guide analysis behaviour changes in this tranche.
- Historic layer defaults and data-fetch behaviour remain unchanged; only their controls are grouped.
- Paused trail status is derived from existing session tracks. No new durable state or Home/startup track query is introduced.
- Finish always requires the existing confirmation path.
