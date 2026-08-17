# ADR 0002: Retire the Classic active Session

Status: Accepted

Date: 2026-08-16

## Decision

Classic active Session is retired. The automated parity gate replaced the
planned reversible-preview gate by explicit product decision on 16 August
2026. Rollback of the workspace now means code rollback to the prior release,
not a user-facing runtime switch.

This decision supersedes every V5 planning or handoff clause that requires a
Classic escape, a workspace preview preference, switch-off during an active
session, or continued runtime reachability of the Classic active-session
renderer.

## Context

The original V5 programme brief deliberately required a reversible preview
while the focused active-session workspace had not yet demonstrated parity.
That was the correct safety posture at the time: the Classic renderer contained
working recording, tracking, finishing and recovery paths that could not be
removed on visual confidence alone.

The action inventory, unit tests and automated browser lifecycle checks later
established parity for the canonical session operations. The product decision
on 16 August 2026 explicitly accepted that automated gate and authorised
immediate retirement without waiting for an additional real field-session
check. The renderer, its escape action and its stored preview preference were
then removed together.

## Consequences

- The focused workspace is the sole UI for an unfinished session.
- FindSpot carries no dormant Classic active-session renderer, runtime escape
  or Settings switch.
- Previously stored preview preferences are migration debris and are removed;
  they do not select a UI.
- Finished-session review, reports and the canonical Session data model remain
  in place. Retiring the renderer does not retire those workflows or records.
- A qualifying regression is handled through the release process by restoring
  the prior release in code. It is not handled by asking the user to select a
  second active-session UI at runtime.
- The automated parity and lifecycle checks are now the regression fence for
  the replacement. Removing or weakening them requires a new explicit product
  decision.

## Evidence

- `docs/programmes/v5-session-parity-audit.md`
- `docs/programmes/v5-ux-safety-gates.md`
- `docs/programmes/v5-shipped-state-inventory.md`
