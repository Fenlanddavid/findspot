# Collections and Detector Reference delivery tracker

## Resume here

Updated: 2026-09-16. Primary physical-device target: Samsung Galaxy S25 (user checks via localhost). Status: M1–M7 implemented and verified locally; v5.0.19 was pushed, but GitHub Actions failed before deployment. CI fixes are prepared locally (see the 2026-09-16 checkpoint below). Physical-device verification remains unrecorded. Neither feature is released.

User authorized implementation of both supplied development briefs, with the review amendments below, across sessions. Continue without asking to reconfirm scope. Do not deploy or claim completion without the checks and device evidence below. No delegation was requested.

**Next step:** obtain physical Samsung Galaxy S25 verification using the running production preview at `http://localhost:4175/findspot/`, then prepare the version/release notes and release checks. The S25 feedback question was sent; no physical-device result has been received. Production offline route loading and PDF/ZIP export now pass. PDF JPEG pages, long-caption continuation, the public detector label and mobile light/dark screenshots have been inspected. The 5,000-record browser test passes; its earlier timeout was an exact-label test-selector mismatch, not established evidence of a slow query. Project-scoped 500-record native batches are independently covered by unit tests. Current local browser config: `/tmp/findspot-collections-playwright.config.ts` (its webServer now explicitly uses the repository cwd).

Read this file first after interruption, inspect `git status --short` and the current diff, then resume the first incomplete milestone. Preserve unrelated changes. Record checks and remaining failures before ending each work session. A checkbox means verified implementation, not merely a plan or written code.

## Agreed product and architecture decisions

- Both features live within FindsBox through focused views; no permanent navigation tab and no extra active-session controls.
- Collections: existing finds, ordered membership, title/introduction, captions, optional interpretation status, explicit facts/photos, private exhibition, carousel and PDF. No duplicate find/photo library, accounts, telemetry, payment, hosted galleries, AI claims or social network.
- Collection limits: 50 finds; title 100; introduction 2,000; item title 120; caption 1,000 characters. Validate without truncation. At most two existing photos per item; preserve originals and save presentation crop only. Stable ID ordering tie-breaker; unique find membership; same project and photo ownership; transactions for graph changes.
- Source facts stay live; authored text stays independent. Review fingerprints cover selected factual fields and media, not unrelated private changes. Review never certifies accuracy. Unknown/tentative records stay visible; selected finds are not automatically an archaeological assemblage.
- Collection CRUD includes duplicate, reorder with keyboard/touch controls, cover, missing references, source-record navigation, explicit removal/relinking, labelled isolated example, search/filter and multi-selection. New multi-selection is shared work, not an assumed existing builder.
- Export through a dedicated allowlist; never give full Find/Permission/Session records to templates. Explicit facts may include object title, recorded period, material, measurements and opted-in target ID/context. Never automatically export coordinates/grid/W3W, permission/landowner, maps/routes, IDs, storage, private notes, recorder/contact details, exact recovery dates, source filenames/metadata or private detector nickname. No public location option.
- Preview every final page, warn: “Check your photographs and wording for details you do not want to share.” Capture a consistent state before rendering, re-encode photographs, bounded sequential rendering, cancellation/cleanup, preserve edits on failure. Long text wraps and continues legibly; no silent clipping. Carousel 1080×1350, ordered anonymous filenames, ZIP fallback and smaller subset; PDF booklet with no private properties/attachments/links or remote assets. Accurate “Export prepared” status; share-sheet cancellation is neutral.
- Detector Reference is retrospective: one group, strict exact/inclusive integer range, photographed source results, material/category/recovery-date/permission filters with explicit unknowns; optional coil/programme/ground filters. No prediction, desirable-material ranking, percentages, un-dug signals, cross-model conversion or invented readings/context. Counts and chart share result scope; one linked actual find counts once. Required explanation: “These are finds you chose to recover and record. They do not represent every signal or predict what remains underground.”
- Detector strings remain authoritative historical text. Explicit aliases trim/case-normalize and map uniquely per project. Add per-find reference-group assignment to split identically named records with differing scales; aliases supply the default. Unknown names remain separately browsable. Deleting organisation never deletes finds. Default equipment changes never rewrite history.
- Optional detectorContext: coilLabel, programmeLabel, frequencyLabel, groundCondition (dry/damp/wet/mixed/unknown), groundNotes. Optional collapsed editing; bulk assignment requires selected-record preview/confirmation showing replacements. No bulk target-ID invention.
- Strict new-input target IDs: zero/negative valid; absent distinct; finite safe integers; reject decimals, partial parses, ranged text, nonfinite values. Preserve malformed historical backup values for review, exclude from queries without rewriting. New external record input must be strict.
- Audit depth semantics: current depthMm is under object Measurements, depthCm under Detector & Signal. Do not assume they measure the same quantity or compare them as conflicting recovery depths. Remove lastDepthCm prefill/persistence. Never infer recovery depth from target ID.
- Reference uses foundAt only for recovery dates, never createdAt fallback. Derived queries/charts are recomputed offline and load no photo blobs for calculations; paginate results and load thumbnails on demand. Collection integration is a fixed reviewed selection with editable title and no automatic private detector name.
- Add durable tables to schema history, backup registry/export/validation/atomic restore/integrity/project deletion/clear-all. Old backups restore; full backups include referenced media; records-only preserve structure/text with explicit missing photos. Handle all single/bulk find/media/project deletion paths transactionally; collection removal never deletes finds. Missing export photos require explicit acknowledgement, never silent substitution.

## Milestones

- [x] Inspect current checkout and record durable scope/checkpoint.
- [x] M1: strict target-ID UI/mutation/import boundaries, legacy preservation, zero display, recovery-depth prefill removed; meaningful numeric tests.
- [x] M2: collection models/services, validation, schema migration, backups, integrity and deletion lifecycle; persistence/restore tests.
- [x] M3: collection selection/editor/private exhibition, example, accessible ordering, photo/crop selection, source review and missing content.
- [x] M4: restricted export snapshot, preview, sequential carousel/ZIP, cancellation and metadata/privacy tests.
- [x] M5: PDF booklet, long-text pagination and real export visual checks.
- [x] M6: detector query and identity services, per-find override, aliases, optional context and backup/lifecycle coverage.
- [x] M7: detector reference filters/results/chart, missing-information review, confirmed bulk edits, find/settings entry points and Collections integration.
- [ ] M8: full required repository checks, regression/visual checks, representative physical mobile device evidence, release notes/architecture artefacts as required.

## Validation evidence

Baseline working tree was clean. Target-ID suite: 13 passed. TypeScript passed after collection/export implementation. Backup architecture/roundtrip/integrity suites passed (33 tests across the initial five-file run excluding one schema snapshot failure); the expected schema table snapshot was updated and its test passed. Full checks and browser/device testing remain outstanding.

Physical-device testing remains required; desktop/emulated browser evidence must be labelled as such. Do not mark that gate complete without real device evidence.

## Session log

### 2026-09-15 — session 1

- Inspected database (schema 49), backup format 11 and explicit registry/restore pipelines, Find/FindModal editing, sharing and FindsBox.
- Confirmed parseInt target-ID paths, zero truthiness display, lastDepthCm carry-forward, full Find prop on existing ShareCard, and single-selection FindsBox.
- Established this durable tracker before implementation.

- Progress checkpoint: schema 50 / backup format 12; five durable organisation tables; explicit deletion integration in find/permission/session/significant-find services. New collection and detector screens and export pipeline are written; do not infer completion from code presence.

### User steering — UI/UX review

- User requested resumption and an explicit aesthetic/UX fit review; primary device Samsung Galaxy S25.
- Simplified exhibition actions, added photograph-led collection cards, collapsed item presentation controls, improved contrast and detector result hierarchy. Verifying light/dark layouts and compact Android touch widths; physical S25 verification is still pending.
- Current focused browser suite passed all 3 original flows before the latest design pass. Expanded tests now include light/dark screenshots and 5,000-record offline filtering.

### Latest verification checkpoint

- Full `npm test`: 157 files passed, 1,304 tests passed, one existing skip (before the latest batch-query and presentation refinements).
- Focused canonical deletion/migration/collection checks: 24 passed. Single find, permission and session deletion remove memberships and assignments; deleted cover photographs are not replaced silently.
- Browser: collection save/reload/source-review/ZIP/PDF, strict zero/negative editing, long-caption/cancellation and compact Android touch layouts passed. The 5,000-record check now passes after correcting its dropdown selector. A compound project/id index and 500-record native batches are implemented and tested; the original timeout diagnosis of slow cursor reading was not supported.
- Build passed with 116 PWA precache entries. Latest changes require final rebuild.
- Physical target confirmed by user: Samsung Galaxy S25. Desktop screenshots inspected in light/dark modes; touch emulation covers widths 360, 384 and 412 CSS pixels, with 44px primary/secondary controls. These are viewport checks, not measured S25 hardware performance.
- New root `AGENTS.md` points future sessions to this tracker automatically.
- Existing application has no dedicated project-deletion or clear-all UI/service; whole-database deletion and atomic backup replacement include all new tables. Do not add unrelated destructive UI merely for this programme.

### 2026-09-15 — resumed verification and remaining fixes

- Added explicit source relinking to collection items. It retains authored title/caption, item order and cover identity; clears photographs, crop settings and previous source review; and excludes finds already in the collection. A browser test simulates a missing restored source and verifies the saved/reloaded result and preservation of the original photograph.
- Missing-source items now show their authored wording. Collection text fields keep overlong pasted text intact and return field-specific validation errors; the user can shorten it without losing their draft.
- Full repository run passed all static checks and 158 unit-test files: 1,310 passed, one existing skip. An initial concurrent run timed out in the repository-wide download scanner; its isolated rerun and subsequent full suite passed. A later concurrent run again exceeded the scanner’s five-second timeout; the final unit run with two workers passed all 1,310 tests without changing assertions or timeouts (106.28 seconds). The sandbox blocked the date-check subprocess, so the successful checks used normal approved execution outside the sandbox.
- Six existing feature browser tests and the new relinking test passed. The new overlong-text browser check also passed. The browser suite contains 110 development checks; final failed-save verification is in progress. The initial full runner terminated with exit 143 after 99 passes and one earlier failed-save messaging failure; two further checks passed before its old server stopped, causing connection-refused failures. Restarting the server and rerunning the remaining seven passed (1.6 minutes). The additional overlong-text test passed separately. The earlier failed-save message regression was found in the final log tally: FindModal exposed the raw persistence error instead of reassuring the user their edits remain. Target-ID parsing now has its own validation path, while persistence failures restore the existing recovery message. The affected browser checks are being rerun. The long-text test uses the textarea’s accessible textbox role after editing.
- Final production suite: all four checks passed (33.9 seconds), including routes/PDF code first opened offline, collection save/reload, PDF/ZIP download and both Companion production handoff checks. The final build has 116 precache entries (6,217.06 KiB). Corrected a test race by waiting for the save navigation and saved-view controls before reloading; the first attempt reloaded the collection list before navigation completed.
- Independently rendered all four exported A4 PDF pages using Poppler and inspected them. Photographs render, the caption continues through its final marker, and the public detector label appears on the cover. PDF properties show the generic FindSpot title/creator, no custom metadata, no metadata stream, no user properties, no JavaScript or forms; `pdfdetach -list` confirms zero embedded files. Export browser tests cover exclusion of seeded private metadata; public snapshot unit tests cover private source fields.
- Visual artifacts: `/tmp/findspot-collections-review/` (PDF, ZIP, PDF page PNGs, light/dark mobile/desktop captures). Final run logs: `/tmp/findspot-collections-final-tests.log`, `/tmp/findspot-collections-final-build.log`, `/tmp/findspot-collections-final-unit.log`, `/tmp/findspot-collections-regression.log`, `/tmp/findspot-collections-final-production.log`, `/tmp/findspot-collections-final-smoke.log`, `/tmp/findspot-collections-restarted-smoke.log`. Production artifacts are ignored at `test-results-production/`.
- Physical Galaxy S25 evidence and release remain pending. No deployment performed.

## Physical-device check still required

On the Samsung Galaxy S25, use the local production preview and record the browser/PWA mode tested:

1. Open Finds → Collections. Create a small collection using existing photographs; edit a caption, crop and order, save, then reload.
2. Preview every export page, save PDF and ZIP, and open the downloaded files. Try opening and cancelling the carousel share sheet.
3. Open My detector, my finds. Check a known reading, an inclusive range and a filter; select results and create a collection.
4. After the production preview has loaded and its service worker is ready, disconnect connectivity and reload the features, then prepare an export.
5. Report clipped text, unreachable controls, awkward scrolling, failed downloads or noticeable delays. Desktop touch emulation does not satisfy this gate.

## Draft release wording

Short update: “Collections and detector reference, with private PDF and image exports.”

- Build personal collections from existing finds, with your own captions, selected facts and photographs.
- Preview and export a collection as carousel images or a PDF booklet. Location and other private record details are excluded from the export data.
- Explore your recorded target IDs by detector, with exact/range filters and optional detector context.
- Keep zero and negative target IDs, and validate new readings as whole numbers. Historical records retain their existing detector details.

Architecture snapshot refreshed at `/tmp/findspot-collections-architecture.txt` after this checkpoint. Version bump, release guard and deployment remain pending the device gate.

Final checkpoint: build and static checks passed; 1,310 unit tests passed (one existing skip); the final failed-save browser check is being completed; four production checks have passing evidence before that message-only fix. The production preview is running on port 4175 (session 71935). Resume with the physical S25 check and release preparation; do not repeat completed automated checks unless code changes or a reported issue warrants it.

### 2026-09-16 — GitHub Actions failure repair

- Inspected run `35028782487` for commit `d148db5`. Browser and production Companion handoff jobs passed; the unit job failed because package-lock.json still recorded 5.0.18 while package.json recorded 5.0.19. Android setup failed before Gradle because its default SDK package list included the unavailable `tools` package. Site build and deployment were skipped.
- Synced both root lockfile version fields to 5.0.19 and explicitly requested `platform-tools` in the Android setup action.
- Fetched the missing v5.0.16–v5.0.18 tags and uncovered the next release-check blocker: UPDATE_NOTES was unchanged since v5.0.18. Updated the banner text to the agreed Collections/Detector Reference release wording.
- Verification: full `npm test` passed all static checks and all 158 unit-test files (1,310 tests passed, one existing skip). After the banner update, `npm run check:release` passed against v5.0.18, and `git diff --check` passed. The initial sandbox run stopped at the date-check subprocess; the successful run used approved execution outside the sandbox. Log: `/tmp/findspot-ci-fix-tests.log`.
- The user explicitly requested committing and pushing these fixes to main, which triggers the deployment workflow. GitHub verification and deployment remain pending at this checkpoint. Android setup still needs verification on a fresh GitHub runner; no local Java/Android SDK is available. No new physical-device evidence was received.
