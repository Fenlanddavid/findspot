# V5 active-session parity audit

Date: 2026-08-16<br>
Ruling: action parity and automated lifecycle validation verified; Classic retired by product decision on 2026-08-16.

Authority: `docs/adr/0002-retire-classic-active-session.md` records the accepted
retirement and release-rollback decision.

This audit covers the controls available while a session is unfinished. Finished-session review, reporting and track trimming remain shared with the existing completed-session surface and are not candidates for removal with the active Classic renderer.

| Classic capability | V5 equivalent | Ruling |
|---|---|---|
| Return to permission | Session menu → Open permission | Equivalent |
| Set/view GPS | Automatic live location dot and accuracy/heading on Map | Deliberate replacement; do not restore a GPS button |
| Start/stop browser tracking | Record → Start in FindSpot / Stop FindSpot trail | Equivalent |
| Fullscreen tracking | Record → Low distraction | Equivalent; uses the same tracking overlay |
| Start/stop Companion | Record → Use Companion beta / Stop Companion | Equivalent |
| Stop Companion and finish | Record → Stop & finish | Equivalent native handoff |
| Import Companion trail | Record → Import a Companion trail | Equivalent |
| Add find | Record/Map → Find | Equivalent quick capture with Add full details |
| Open every session find | Session → Finds count → session-only list | Equivalent |
| Pending finds | Header count and Session pending action | Equivalent |
| Undug signal | Record → Undug signal | Equivalent |
| Significant find | Record → Record significant find | Equivalent |
| Surface observation | Record → Surface observation | Equivalent |
| Save/mark location | Record → Mark location / Mark start | Equivalent and expanded |
| Field notes | Record → Visit conditions → Field notes | Equivalent |
| Stubble/ploughed/pasture | Record → Visit conditions | Equivalent |
| Coverage percentage/gaps | Record → Show coverage gaps on map | Equivalent; opens Map when enabled |
| Session notes | Session → Quick session note | Equivalent, append-only to protect earlier notes |
| Finish session | Header Finish or Session → Review and finish | Equivalent; both use confirmation |

## Behavioural invariants

- The session remains authoritative in IndexedDB and unfinished until confirmed finish succeeds.
- Browser tracking may stop or be interrupted without finishing the session.
- A recorded but inactive browser trail is labelled `Trail paused`; a session with no trail is labelled `Trail not started`.
- Companion state is session-scoped. FindSpot refuses to finish while Companion is still marked active.
- Offline mode must not prevent local notes, condition changes, navigation or session recovery.
- Reload/startup closes a stale browser-track pointer without closing or losing its session.

## Retirement position

This closes the action-inventory and automated lifecycle gates. Chromium covers browser start/pause/resume, stale-track reload recovery, offline local writes, Home resume and the session-scoped Companion finish guard. The user then explicitly authorised retirement before the additional real field-session check. The Classic active renderer, escape action and workspace preference were removed together; finished-session review and reporting remain unchanged.
