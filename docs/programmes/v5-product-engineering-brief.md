# FindSpot V5.0 — Product and engineering brief

Revision: 2

Date: 15 August 2026

Grounded against: FindSpot 4.12.24 on `main`

Status: proposed programme brief

Governance notice: this is the original planning brief. For the retirement of
the Classic active Session and the meaning of workspace rollback,
`docs/adr/0002-retire-classic-active-session.md` is authoritative. Its accepted
decision supersedes the reversible-preview, Classic escape and runtime-switch
requirements originally recorded here.

## 1. Product proposition

FindSpot helps you pick up where you left off. When a detecting session is
active, FindSpot becomes a workspace designed for detecting.

V5 has two required, visible improvements:

1. Home provides one clear, truthful way back into current or recent work.
2. An active session changes the composition of the app so ordinary field
   actions remain immediate, legible and understandable outdoors.

Session review and visible data protection support those improvements.
Continuity is an optional, independently validated enhancement to the Home
return card. It is not required to justify V5 and must not be forced through a
weak gate.

## 2. What counts as an improvement

V5 is not justified by new tabs, renamed screens, extracted services or a
restyle on their own.

The release must make these user tasks materially clearer or easier than in
4.12.24:

- resume an unfinished session;
- return to the most relevant recent permission;
- distinguish an active session from a GPS trail that is recording;
- record an ordinary find, significant find, undug signal, surface observation
  or saved point without re-entering known context;
- open FieldGuide in one tap during a session;
- finish a session without review or derived work endangering completion;
- reopen the completed review later;
- understand why local data needs an external backup.

Before the V5 release decision, representative users must be able to complete
those tasks through the candidate more easily or with no new confusion. If the
candidate only redistributes existing controls, it has not met the visible
improvement bar.

## 3. Release posture

The intended V5.0 shape is:

- contextual Home return surface;
- active detecting workspace;
- close-first, retrievable session review;
- visible backup responsibility and a verified restore;
- release automation and programme evidence;
- no coverage percentages in the new Home, workspace or review surfaces;
- continuity only if its independent behavioural gate passes.

Continuity HOLD does not block V5.0. The active workspace carries the major
version.

Map-first HOLD does not block the active workspace. The programme falls back to
the demand-mounted four-tab composition.

Active-workspace HOLD does block V5.0. In that case, ship the completed
durability, review and release-discipline work as 4.13 and continue developing
the workspace. Do not relabel an insufficiently visible release as V5 because
the date is approaching.

## 4. Scope constraint

V5 is a new composition and presentation layer over the canonical FindSpot
domain records.

Not permitted:

- replacement data model;
- second active-session or session model;
- replacement FieldGuide engine;
- parallel recommendation or continuity store;
- accounts, cloud sync or behavioural analytics;
- map-engine rewrite;
- unreviewed irreversible navigation replacement;
- new direct UI-to-Dexie mutation paths;
- copied task rows or persisted V5 presentation snapshots.

Additive indexes, explicit provenance fields and durable user preferences are
permitted where the existing model cannot support an honest query or rollback.
Existing records remain authoritative.

## 5. Shipped-state inventory gate

The current Home and Session implementations contain more behaviour than their
most obvious screenshots show. Before changing either surface, V5-A records a
disposition for every shipped item.

The Home inventory includes at least:

- trust line and application-level backup banner;
- Today heading and existing “Continue where you left off” copy;
- statutory significant-find reporting reminder;
- active-session card and its Quick Find and Log Signal actions;
- first-run steps;
- adaptive quick actions;
- installation prompt;
- pending-find prompt and separate pending-find banner;
- offline FieldGuide pack prompt;
- upcoming-rally prompt;
- stale-permission coverage prompt;
- new-permission prompt;
- Finds stat strip;
- FieldGuide card;
- Run a club dig or rally card;
- Permissions heading, search and cards;
- Latest Finds.

The active-session inventory includes at least:

- browser and Companion tracking controls;
- tracking import;
- active/recording status;
- find, significant-find, undug-signal and surface-observation actions;
- field and ground context;
- coverage and gap controls;
- map and track display;
- finish, report, reopen and delete paths;
- session finds and pending finds;
- application navigation and FieldGuide access.

Each item is marked retain, merge, relocate, replace or remove, with a reason
and a verified remaining route. Statutory, safety, data-protection and ordinary
recording actions cannot disappear as an incidental result of recomposition.

## 6. Contextual Home

“Today” remains reserved for the existing Home heading. The slot stays where
users already look; V5 does not add a second continuation region above it.

Inside the slot, V5 presents one primary work surface:

1. an active-session card when an unfinished current session exists;
2. otherwise a return card for the permission selected by the deterministic
   rules in section 8;
3. otherwise the existing zero-history quick actions, without an empty
   “nothing to continue” state.

The return card contains:

- permission name;
- last-visit date or another exact, honest activity date;
- a primary open action;
- when continuity qualifies, one optional reason to return, derived from the
  authoritative source on that same permission.

Example without continuity:

> North Meadow<br>
> Last visit 9 August<br>
> Open permission

Example with continuity:

> North Meadow<br>
> Last visit 9 August<br>
> You left a signal open here<br>
> View signal

Continuity is part of the return card, not a competing card. Disabling
continuity removes the reason and restores the ordinary permission action; it
does not remove the V5 return card or alter any source record.

One exceptional surface may appear alongside the primary work surface. Its
order is:

1. statutory or safety obligation;
2. urgent backup;
3. important backup;
4. pending record requiring completion.

A recommended backup is a compact affordance adjacent to the trust line, not a
warning-filled contextual card. Existing lower-priority suggestions are
retained, merged or moved according to the inventory gate rather than competing
for this slot.

The duplicate Home club/rally card is a candidate for removal because the
header already exposes Club/Rally. It may be removed only after the inventory
gate verifies that the remaining route is clear and no club/rally workflow is
lost.

Everything below Today retains its established sequence unless the inventory
records a specific justified removal. Permissions must not move lower in the
common case.

## 7. Home density and visual acceptance

The binding constraint is height, not merely card count.

Before V5-B, record at 380 CSS pixels wide:

- viewport height and device-pixel ratio;
- font-size/accessibility setting;
- seeded database fixture;
- top coordinate of the Permissions heading;
- rendered height of the Today block;
- whether the club/rally card is present in the baseline fixture.

For the common established-user fixture, the V5 Permissions heading must not
sit lower than the recorded 4.12.24 baseline. The Today block receives a fixed
maximum-height budget derived from that measurement.

The visual change comes from clearer hierarchy and state, not added height:

- one bordered panel using the existing light/dark card treatments;
- teal for the primary action and active FindSpot state;
- amber reserved for find emphasis or an established warning treatment;
- text as well as colour for every recording and obligation state;
- no red or amber filled card for a recommended backup;
- no carousel or nested scrolling inside Today.

The density check runs in browser automation and is repeated on a real device.

## 8. Deterministic return selection

Home selects one permission in this order:

1. the permission belonging to the resolved current unfinished session;
2. otherwise the permission with the most recent completed session;
3. otherwise the permission with the most recent relevant user-authored
   activity;
4. stable tie-break by creation timestamp and then ID.

V5-A defines the exact timestamp for each step and its fallback. It also
resolves the existing ambiguity between `date`, `createdAt`, `startTime`,
`endTime` and `updatedAt`.

Continuity does not initially select a different, older permission. It may only
explain a return card already selected by these rules. Letting continuity
change permission selection is a separate post-validation product decision;
it must never appear as an incidental resolver side effect.

IndexedDB iteration order is never used as a tie-break. Query tests assert both
the result and the query shape for one, fifteen and identical-timestamp
permissions.

## 9. Current unfinished session

The current model can contain more than one unfinished session. V5-A defines a
single deterministic resolver without adding an ActiveSession domain object.

The resolver must specify:

- the timestamp and tie-break used to choose the current session;
- how other unfinished sessions remain reachable;
- how a reopened historic session participates;
- how browser and Companion tracking pointers influence presentation without
  becoming a second source of session truth;
- how reload, restore and release rollback reconstruct the same authoritative
  session state.

Starting a session records one unambiguous session-start timestamp. Tracking
start remains a separate concept. Existing sessions use a documented safe
fallback and are never assigned fabricated precision.

## 10. Active detecting workspace

Engineering name: `activeSessionWorkspace`. Public copy describes the state as
“Detecting” where a label is needed; the workspace itself does not require a
new branded noun.

The safe baseline composition is:

> Map · Record · Session · Guide

The ordinary application header and five-item navigation give way to the
workspace composition while it is active. A persistent compact status region
shows permission, elapsed session time and the distinct trail-recording state.
The permission remains reachable from the workspace menu; the retired Classic
active-session composition is no longer exposed.

### Map

Uses the existing session map and data sources. It may show:

- current location;
- active trail;
- selected permission and field/section boundary;
- current-session finds;
- relevant user-recorded markers.

It is not the full FieldGuide map and does not run a FieldGuide scan by
default. When Map is not visible in the safe four-tab composition, expensive
rendering and map updates are suspended or unmounted while durable tracking
continues through its existing service.

### Record

Keeps ordinary field actions visible with large outdoor targets:

- find;
- significant find;
- undug signal;
- surface observation;
- saved point.

Permission, session, field and available location context are inherited. The
user is not asked again for context FindSpot already holds. Existing mutation
services remain authoritative.

### Session

Shows a glanceable summary:

- permission and field;
- session start and elapsed time;
- finds, pending finds, surface observations and open signals;
- reliable walked distance;
- browser or Companion tracking state.

No coverage percentage appears. Finish Session is pinned and always reachable;
it is not hidden in a More menu.

### Guide

FieldGuide remains one tap away. The existing FieldGuide route, engine and
established destination remain intact. Opening Guide must not end, replace or
silently pause the session or its durable tracking.

## 11. Recording-state language and treatment

“Session active” and “trail recording” are different states and must never rely
on one coloured dot.

Prototype at least two treatments before field preview. Each must include:

- persistent text label;
- distinct shape or layout, not colour alone;
- elapsed or last-fix context where useful;
- explicit stopped, starting, recording, interrupted and error states;
- legibility in sunlight and dark mode;
- behaviour with browser tracking, Companion tracking and no tracking.

Users must be able to answer both “Is my session still open?” and “Is my GPS
trail recording?” at a glance. Repeated uncertainty about either is HOLD.

## 12. Map-shape performance gate

A persistent map-first workspace is an optional composition, not the definition
of V5. It is materially riskier than a demand-mounted Map tab because a live map
may remain open for several hours.

V5-A prototypes and compares:

1. persistent map-first;
2. four-tab workspace with the map expensive lifecycle active only while Map is
   visible;
3. the current 4.12.24 active Session screen as the baseline.

Before running the comparison, record pass thresholds and representative
devices. The matrix includes low- and mid-range Android, iPhone/PWA, browser
tracking, Companion tracking, no tracking, weak network, offline operation and
repeated background/foreground cycles.

Run foreground soaks representative of a normal session, including a three-hour
case. Record:

- battery drain relative to the current screen;
- device heat and thermal throttling;
- main-thread long tasks and visible jank;
- frame stability during trail and marker updates;
- memory growth and whether it reaches a plateau;
- map initialization and return-to-tab latency;
- background/foreground recovery;
- location and track correctness;
- network requests while stationary and offline.

Decision rule:

- persistent map-first passes the predefined thresholds with no correctness or
  thermal concern: it may enter the field preview;
- result is ambiguous or worse: use the demand-mounted four-tab composition;
- both compositions fail ordinary-session usability: active workspace HOLD.

The field preview confirms real-world cost; it is not the first sustained map
test.

**Outcome, recorded 25 August 2026.** The instrumented comparison in this
section was not run. The demand-mounted four-tab composition was selected as
the conservative option without it, and shipped in V5.0.

Field validation followed release rather than preceding it. A six-hour author
session on a pre-5.0.5 build surfaced the defects fixed in 5.0.1–5.0.5. A
four-hour author session on 5.0.5 showed no thermal rise, a device cold to
the touch and negligible battery drain.

The gate is closed on observed cost, not measured cost. The selected
composition is the one this section's decision rule would have chosen for an
ambiguous or absent result, so the outcome is consistent with the rule even
though the comparison did not run. Persistent map-first was never evaluated
and remains unqualified: it may not enter a field preview without the
measurement this section describes.

## 13. Session finish and review

The order is binding:

1. request finish;
2. stop or reconcile active tracking safely;
3. write the durable session end;
4. confirm the write;
5. derive the review;
6. offer the review.

Derived coverage, outcome, comparison, reporting or review work never precedes
or gates the durable finish. If derivation fails, the session remains finished
and the user receives an honest bounded message.

Review is skippable and remains reachable from the completed session. It is
derived from canonical records rather than stored as a duplicate snapshot.

The basic V5 review includes:

- duration;
- finds and pending finds;
- surface observations;
- open undug signals framed as “still open”;
- reliable walked distance;
- links to existing reports where applicable.

Historical coverage may be shown qualitatively only when it can be reconstructed
from `sessionCoverage` for that session. Current permission coverage is never
substituted for historical session evidence.

## 14. Coverage integrity gate

The new V5 Home, active workspace, return reason and session review contain no
coverage percentages. Coverage is not used as the visible novelty of V5.

Existing detailed coverage tooling is included in the shipped-state inventory
and is not removed merely to make V5 look different. Its disposition follows
the integrity result:

- bounded correction: bump the calculation version, recompute affected derived
  rows and retain percentages only in the existing detailed coverage workflow,
  clearly labelled as estimates;
- correction not bounded, or historical rows not reconstructable: suppress the
  affected percentages and use shared qualitative language.

Home prompts, continuity, the active workspace and review never turn an
estimated percentage into a claim about where the user has or has not searched.

Allowed:

- “Little FindSpot search coverage has been recorded here.”
- “This section has limited recorded coverage.”

Forbidden:

- “You haven't searched here.”
- “This area is unsearched.”

The strings live behind shared presentation constants.

V5-A assesses and, if bounded, corrects the GRID-LITE integrity problem. At a
minimum the assessment covers:

- browser track lines and section interpolation crossing persisted GPS gaps;
- inaccurate fixes keeping liveness alive without producing accepted points;
- Companion segment boundaries;
- calculation-version bump;
- lazy recomputation and stale historical tracked rows;
- prediction/calibration consequences;
- restore behaviour;
- regression and property tests.

If the correction is bounded, fix it and permit only qualitative
coverage-dependent V5 behaviour outside the existing detailed tool. If it is
not bounded, remove all new coverage-dependent behaviour from V5.0 and suppress
unreliable classic estimates. Coverage continuity is excluded from V5.0 in
either case and may return only after separate evidence.

## 15. Continuity preview

Continuity surfaces genuine unresolved user-authored business. It is not a
recommendation or prediction engine.

V5.0 validation source: open undug signals only.

An eligible signal:

- belongs to the permission already selected for the return card;
- belongs to an active, reachable permission;
- has status `open`;
- is no more than 12 months old at resolution time;
- has an authoritative action into its existing workflow.

Within that permission, choose the most recent `createdAt`; ties resolve by ID.
Resolve at most one reason. The source record is never copied. Resolving or
dismissing it through the authoritative workflow removes the reason
automatically.

Switch: `v5ContinuityPreview`.

The switch is a durable, backed-up user preference. It controls presentation
only. Switching it off removes the reason from the V5 return card and changes
no domain state. The preview provides no copied task, persistent continuity
dismissal or separate continuity history.

**Product ruling, recorded 25 August 2026.** Continuity is accepted as shipped
default-on for all users, with the durable Settings toggle retained. The public
default is `true` in both storage initialisation and Home's fallback; those
surfaces must remain aligned.

The planned validation with roughly 15–20 genuinely active opt-in detectorists
over two normal detecting weekends was not run. Its numeric behavioural
threshold and HOLD rule are retired as V5 launch and GO gates by product
decision. The programme may still run later as optional product research, but
its absence does not make the shipped default provisional and must not be
represented as evidence that the cohort passed.

The acceptance basis is the deliberately bounded behaviour: one reason at
most, derived from an authoritative open signal on the already-selected
permission; no copied task or domain mutation; automatic disappearance after
resolution; and a backed-up user control that removes the presentation. Source
correctness, understandable wording, automatic disappearance and absence of
Home regression remain ordinary quality requirements rather than a separate
cohort gate.

Later sources—questions, explicitly retained saved points and provably
incomplete surface observations—enter one at a time after a separate explicit
product and evidence decision. Surface observation continuity requires an
explicit authoritative capture-flow
provenance field for future records; unknown historic provenance surfaces
nothing.

## 16. Active workspace parity and retirement

The planned reversible preview was superseded by the accepted decision in
`docs/adr/0002-retire-classic-active-session.md`. The automated parity gate
became the retirement gate; there is no user-facing workspace switch or
Classic active-session escape.

The parity matrix exercises:

- start, resume, reload and restore;
- every Record action;
- browser, Companion and no tracking;
- Map lifecycle and current location;
- FieldGuide in one tap;
- Finish and review;
- offline and weak-network operation;
- older supported Companion recording formats;
- no Companion installed;
- low battery and long-session use.

Binding GO criterion:

> Users complete normal detecting sessions through the workspace without core
> actions becoming harder to find or understand than in 4.12.24.

HOLD if recording actions are hard to locate; session or trail state is
unclear; FieldGuide is materially less reachable; map cost causes battery, heat
or jank concern; reload causes confusion; or any correctness or data-loss defect
occurs.

## 17. Navigation and accessibility

The application destinations Home, Field Guide, Permissions, Discover, Finds
and Settings remain.

The workspace must not trap the user. Open permission and Finish are separate,
clearly labelled actions; application-level destinations remain available
through the established navigation.

Outdoor acceptance includes:

- touch targets suitable for one-handed use and imperfect taps;
- no hover-dependent meaning;
- colour-independent state labels;
- sunlight and dark-mode contrast;
- readable state at 200% text where platform layout permits;
- screen-reader names for every icon-only action;
- no essential action obscured by safe-area insets or the mobile keyboard;
- reduced-motion treatment for pulsing or animated recording states.

## 18. Durability

Reuse the canonical reminder model only:

`BackupReminderLevel = 'none' | 'recommended' | 'important' | 'urgent'`

Reuse `evaluateBackupReminder`, `getBackupReminderState`, existing thresholds,
existing snooze and `hasExternalBackup`. Do not add a fifth state or parallel
policy. `hasExternalBackup === false` changes explanation, not level.

Presentation suppresses a first backup prompt until at least one session has
been completed. This does not change the canonical evaluated level.

The required restore-drill sequence was:

> backup → clean database → restore → integrity audit → task-level inspection

The gate closed on 25 August 2026. A localhost non-destructive drill validated
and staged a format-v5 backup with 20 recoverable records and no skipped,
repaired or damaged records, while leaving live table keys and counts
unchanged. A subsequent import-and-overwrite on a Pixel 10 Pro exercised 32
media blobs and 34 tracks from real V5 data and completed with no reported
issues. Because `applyValidatedBackup` clears every backed-up table inside the
atomic restore transaction, that overwrite was functionally a clean restore of
the backed-up graph. The full evidence record is in
`docs/programmes/v5-handoff-2026-08-15.md` under "Durability drill record".

Excluded derived/cache tables — `fieldGuideCache`,
`landscapeInterpretations`, `geologyContext` and `geocodeCache` — survive an
overwrite on an existing device. They would start empty after genuine device
loss and regenerate from R2 and BGS. That cold-start recovery path remains
unexercised, but is a known residual rather than an open release gate.

The existing backup registry remains canonical. The rule “derived items are
recomputed” applies to new V5 Home, continuity and review presentation objects;
it does not remove established durable evidence such as stable section identity,
sessionCoverage or calibration history from backup.

## 19. Architecture and startup performance

Release-gate baselines from 4.12.24:

- `src/pages/Home.tsx`: 1,033 lines;
- `src/pages/Session.tsx`: 1,746 lines.

Record them mechanically before V5-A. At the V5.0 gate each page must be at or
below its baseline. The review also inspects the new component total and direct
dependencies so moving complexity into a single oversized child component does
not satisfy the ratchet cosmetically.

React-free services at release:

- `services/home/homeContext.ts`;
- `services/continuity/continuityResolver.ts`;
- `services/session/sessionReview.ts`;
- `services/session/activeSessionContext.ts`.

Home becomes interactive from a bounded initial context: current unfinished
session, recent permission metadata and backup reminder state. Continuity loads
progressively after interaction readiness.

Extend startup architecture guards:

- no `db.sessions.toArray()` global ordering pass;
- no FieldGuide scan or FieldGuide engine import on Home;
- no raw GPS track or Turf import in Home enrichment;
- no continuity resolution on the startup-critical path;
- no global hotspot resolution at launch;
- no eager map construction before the workspace Map lifecycle requires it;
- fixed query shape for fifteen-permission return ordering.

No new UI component writes directly to Dexie. Commands remain in existing or
explicit new mutation services.

## 20. Retirement and release rollback

The accepted ruling is recorded in
`docs/adr/0002-retire-classic-active-session.md`: Classic active Session is
retired, and workspace rollback means code rollback to the prior release rather
than a user-facing runtime switch. The temporary escape and preview preference
were removed with the Classic renderer after the parity gate closed. “Show
return reminders” remains an independent optional feature.

Before public launch, release ownership, qualifying support evidence and the
maximum response time for a code rollback must be explicit in the release
record.

With no behavioural telemetry, staged default-on cannot pretend to be a
statistical rollout. Decisions use explicit tester records, support contacts,
user feedback and reproducible local diagnostics.

## 21. New users and launch language

At zero history, Today shows the existing useful first-run or quick-action
surface. It never shows an empty continuation message and the first contextual
card is not a backup warning.

A new user may see little change on Home until they create history. Their first
active session must still reveal the V5 workspace, so the release has a visible
experience without manufacturing fake personalisation.

Launch language:

- “FindSpot helps you pick up where you left off.”
- “When you start detecting, FindSpot changes with you.”

Do not present “Continue where you left off” as new copy. The improvement is
that the existing promise becomes functional.

Avoid claims that FindSpot knows where the user should detect, knows what they
have not searched or remembers everything forever.

## 22. Release discipline

Provide one command, for example:

`npm run release:prepare -- 5.0.0`

It must:

1. validate the requested semantic version;
2. verify clean release prerequisites without discarding unrelated work;
3. update `package.json`, the package-lock root and package entry;
4. verify the built Settings version derives from that single source;
5. prepare release-note and programme metadata;
6. verify tag and programme-ledger state;
7. run existing consistency checks;
8. fail atomically or restore the files it changed.

Backfill the programme ledger through 4.12.24 and reconcile the semantic tag
gap before V5.0. CI fails when version surfaces or prepared release metadata
disagree. Existing architecture, type and release ratchets are not weakened.

## 23. Sequence

### V5-0 — task proof

Prototype the ordinary detectorist tasks from section 2 using concrete
screen compositions and current data. Record current and candidate taps,
hesitation points and action visibility. Do not begin with internal feature
names.

### V5-A — foundation and decision gates

- record shipped-state inventory and page baselines;
- define active-session and timestamp semantics;
- extract headless context/review services;
- run the map-shape performance gate;
- assess and rule on GRID-LITE;
- map backup presentation onto canonical policy;
- extend startup guards;
- define Home density fixture and baseline.

### V5-B — contextual Home

- primary active/return surface;
- deterministic permission selection;
- merged continuity-reason seam, enabled by default with a durable user toggle;
- backup/trust-line treatment;
- inventory relocations;
- progressive loading;
- zero-history behaviour;
- density and query-shape tests.

### V5-C — safe active workspace

- four-tab demand-mounted baseline;
- recording-state treatments;
- all existing record actions;
- one-tap FieldGuide;
- pinned Finish and permission navigation;
- active-state reconstruction and parity fence;
- map-first variation only if V5-A passes.

### V5-D — session review

- close-first durable finish;
- immediate, skippable review;
- completed-session retrieval;
- qualitative, historically honest coverage only;
- shared unresolved-source wording.

### V5-E — independent validation

The workspace and continuity were ruled on independently. Workspace retirement
uses the automated parity gate recorded in ADR 0002. Continuity's public
default is governed by the product ruling in §15; contextual Home and the
workspace do not wait two weekends for continuity evidence.

### V5-F — durability and release automation

- restore drill;
- backed-up V5 preferences;
- retirement and release-rollback decision record;
- release preparation command;
- programme/tag reconciliation.

### V5-G — integration and release gate

The workspace composition, continuity outcome and public defaults were resolved
from evidence or an explicit product ruling. V5.0 was selected without
weakening a gate.

## 24. Release gates

V5.0 ships only when all required gates pass:

- visible-improvement task proof;
- active-workspace GO;
- map composition selected through measured cost — CLOSED 25 Aug 2026 on
  observed field cost, not measurement; see §12 outcome;
- Home density and startup performance;
- FieldGuide one-tap access;
- durable finish before review;
- coverage language and integrity ruling;
- backup/clean-restore drill — CLOSED 25 Aug 2026; see the durability drill
  record in `docs/programmes/v5-handoff-2026-08-15.md`;
- accepted retirement decision and release rollback route;
- automated active-session parity and lifecycle checks;
- production build, full automated suite and release preparation.

All required V5.0 gates are closed. Two were closed after release rather than
before it, on the basis recorded above.

Continuity is accepted default-on by the product ruling recorded on 25 August
2026; its planned cohort is retired as a V5 gate. Coverage continuation is not
part of V5.0.

## 25. Test matrices

### Home

Current session; no current session; zero history; one and fifteen permissions;
identical timestamps; continuity on/off; eligible source on selected and
unselected permission; stale source; backup none/recommended/important/urgent;
statutory obligation; pending record; no external backup; offline; restored
database; query shape; 380px density; 200% text.

### Workspace

Start; resume; multiple unfinished sessions; reopened historic session; reload;
restore; each Record action; Map suspend/resume; Guide in one tap; current
location; permission navigation; Finish; release rollback evidence; browser tracking;
Companion tracking; older Companion recording; no Companion; offline; weak
network; background/foreground; safe-area and keyboard; three-hour soak.

### Review

Normal completion; failed derived work; skip; reopen; no finds; many finds;
pending finds; surface observations; open signals; reliable/unreliable distance;
historic sessionCoverage; later permission-coverage change; offline.

### Continuity

Eligible/ineligible; selected/unselected permission; retired or deleted
permission; 40+ signal backlog; 12-month bound; createdAt and ID tie-break;
correct explanation; authoritative navigation; resolution disappearance;
preview off; restore regeneration; no source mutation from presentation.

### Durability and release

Backup with and without media; clean restore; all canonical records and V5
preferences; integrity audit; version surfaces; atomic release preparation;
programme/tag guard; full test suite; production PWA build.

## 26. Success and failure

Intended reactions:

- Home: “That takes me back to the right place.”
- Workspace: “Everything I normally do while detecting is right here.”
- State: “I can tell whether the session and trail are running.”
- Review: “The session was safely finished before this appeared.”
- Continuity, if enabled: “It reminded me about something I meant to return
  to.”

Treat as product failure:

- Home selection cannot be explained;
- the return card is merely a renamed suggestion;
- Home is slower or Permissions moves lower;
- the workspace hides an existing action;
- users cannot complete ordinary session work in the focused workspace;
- session and trail states are confused;
- FieldGuide is less reachable;
- map-first causes battery, heat, memory or jank concern;
- finish waits for review derivation;
- coverage overclaims or historical meaning changes;
- restore loses canonical records or preferences;
- continuity is read as prediction or produces no return behaviour.

These remain design or correctness failures until evidence says otherwise. They
are not dismissed as onboarding problems.

## 27. Programme rule

When deadline, ambition and risk conflict:

1. protect user data and durable session completion;
2. preserve existing recording, legal and safety workflows;
3. protect startup, battery, heat and map performance;
4. keep FieldGuide one tap away during detecting;
5. make session and trail state unmistakable;
6. make the Home return promise true without adding density;
7. keep historical and coverage language honest;
8. validate continuity rather than assume it;
9. automate and record the release;
10. defer optional depth, cosmetic novelty and unproven intelligence.

V5 should contain fewer ideas than the first proposal, create a more obvious
change in ordinary field use and make no existing capability less trustworthy.
