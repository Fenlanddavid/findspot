# Hillforts Atlas integration

## Resume here

Updated: 2026-10-13. Status: implemented locally and reviewed after user refinements;
release and physical-device gates remain. Baseline: v5.0.22, `3ce77a91670ebf7c2b6de9e8b34def56cb1b016b`.
Equivalence to the supplied `findspot-v5(20261013-201844).txt` is not established.
Preserve pre-existing edits in `docs/permission-decompose-stage0-checklist.md`
and `scripts/README-datasets.md`.

The user authorizes the full map, automatic scan, ALIE and offline integration.
This specifically supersedes the earlier FieldGuide programme's hold on adding
datasets for this source only. Its context-only scoring decision still applies.
No delegation requested. Physical mobile verification must remain distinct from
desktop/emulated checks.

## Source decisions

- Original archive: [DOI 10.5284/1118744](https://doi.org/10.5284/1118744),
  ADS collection 1006508, *Spreadsheets and a Document on the Atlas of Hillforts
  of Britain and Ireland*, Ralston, I., Lock, G. (2024).
- Collection first release: **3 May 2024**. Main CSV file metadata says last
  modified **16 April 2024**. Neither is a claim of current archaeological data.
- `Data-information.pdf` calls the edition **Atlas data 1.1 2017**, a snapshot
  between 2012 and October 2016. The separate spreadsheet metadata lists creation
  September 2012–October 2017; preserve this discrepancy rather than silently
  treating the archive publication year as the source observation date.
- [Main table file metadata](https://archaeologydataservice.ac.uk/archives/collections/view/object.cfm?object_id=2620866)
  explicitly licenses that file under **CC BY 4.0**. The collection page agrees.
  This differs from the viewer's CC BY-SA 4.0 reported in the brief. Use the
  original archive's verified terms; do not copy viewer imagery or linked media.
- Documented downloads: `Hillfort-atlas-main-table.csv`, `Dating-evidence.csv`,
  `Entrances.csv`, `Investigations.csv`, `References.csv`, `Data-information.pdf`.
  The main table already includes dating comments, summary description,
  references, identifiers and record URLs. Use that table without scraping.
- Primer [DOI 10.5284/1119340](https://doi.org/10.5284/1119340), ADS 1006761,
  Middleton (2024), first released 12 June 2024, also labelled CC BY 4.0 by its
  catalogue. Its spreadsheet was retrieved for comparison, but is not the chosen
  source and its transformations must not be attributed to the original archive.
- Acquisition date: 13 October 2026, separately from every source date above.
- Original CSV downloaded: 15,275,370 bytes, 4,147 rows and unique Atlas numbers
  and record URLs. Actual SHA-256:
  `3445e46e48f579f79a59582920529e12b8b159374bcc2929816d97aa118dae8f`.
  The file page lists checksum `912340b6f0cd379155d7c71597d6c07a`;
  downloaded bytes have MD5 `a514b7c861b50b5011e8e64a05ae436c`.
  This discrepancy is unresolved; never label the download catalogue-checksum
  verified. Pin the observed SHA-256 for reproducibility and record both values.

## Verified source semantics

- Country counts: England 1,225; Scotland 1,695; Wales 690; Republic of Ireland
  475; Northern Ireland 32; Isle of Man 30. Includes offshore islands to Shetland,
  Scilly and Isle of Wight; excludes Channel Islands. This is a selective Atlas,
  not a complete inventory of archaeology or protections. Its criteria exclude
  many small enclosures, brochs and Irish raths/cashels/ringforts.
- Atlas number is the project's unique identifier; country-prefixed IDs and
  record URLs are supplied. Preserve the source record URL, never invent one.
- Reliability of **data** and **interpretation** are separate fields. The latter
  has Confirmed (3,354), Unconfirmed (722), Irreconciled issues (71). The last means
  uncertainty the authors considered impossible to resolve, not a synonym for
  rejected. Oppida are included with unconfirmed interpretation. No dedicated
  rejected category exists in these structured fields; preserve comments and
  avoid asserting every row is a confirmed hillfort.
- Date bands describe construction/enclosure use, not all activity at the site.
  Preserve the source bands, reliability and comments; do not translate all rows
  into Iron Age. 3,546 rows explicitly mark dating Unknown. Reliability is
  A - High, B - Medium, C - Low, D - None, or blank (not recorded).
- Points only. Source grid labels OSGB36 (3,640) and IRENET95 (507); geographic
  longitude/latitude and EPSG:3857 coordinates are also supplied. All 4,147
  geographic positions agree with inverse EPSG:3857 within 2 m. Use the supplied
  geographic points, with no new British/Irish grid transformation. Decimal
  precision is not survey accuracy; source positional accuracy is undocumented.
  Never derive monument/protection geometry from these points or area fields.
- Empty optional cells mean not recorded. Yes/No and Unknown remain distinct.
  The CSV is not valid UTF-8 and contains undefined Windows-1252 bytes; encoding
  handling and any replacement count must be reported by the converter.
- Source designation numbers are archival cross-references, not current legal
  status. Missing identifiers never establish lack of protection.

## Implementation decisions

1. One typed lookup result belongs to a scan and feeds map, cards and ALIE.
   Visibility cannot affect interpretation. No live Atlas queries or Home work.
2. Current terrain scans expose the actual rectangular `analysisBounds`, while
   permission boundaries are separate. Spatial code also accepts Polygon /
   MultiPolygon for irregular scans. Points on the boundary count as within.
3. Existing historic lookup extents depend on viewport/zoom and do not express a
   fixed surrounding distance. Introduce `HILLFORT_CONTEXT_PADDING_M = 2000`:
   retrieve points inside the actual scan or within 2 km of its boundary. This
   modest landscape context limit is not a territory, catchment or detecting
   recommendation. Display distances from the **scan centre**, rounded to 100 m;
   source accuracy is unknown. The retrieval boundary distance is separate.
4. No whole-map browsing in this release. Panning cannot rewrite scan evidence.
5. A separate contextual channel in existing ALIE evidence/narrative retains
   provenance and source wording, without weighted evidence, period aggregates,
   defence signals, density, confidence or hotspot changes. Shared authoritative
   identifiers establish matches; location + name + type can only flag unresolved
   candidates. Do not borrow scan-centre terrain for a site's setting.
6. Signatures must include full interpretation-relevant records, geometry,
   generation, availability and matching results. ALIE version changes when this
   contract lands; hotspot version stays unchanged. Worker envelope v1 already
   carries typed payloads and correlated requests; additive payload validation
   does not require changing its transport version.
7. Public data stays in Cache Storage, excluded from backups. Old packs and
   interpretations have unassessed/missing context, never implicit zero records.
8. Measure compact payload before deciding storage granularity. Attribution and
   metadata must travel with the data and remain readable offline.

## Delivery gates

- [x] Current checkout, AGENTS and related programme decisions inspected.
- [x] Documented original download and file licence located; real data retrieved.
- [x] Reproducible conversion, manifest, source notices, coordinate validation.
- [x] Static loader, bounded spatial queries, cancellation and cache lifecycle.
- [x] Scan integration, layer controls, selection and source cards.
- [x] Context-only ALIE, signatures, validation and legacy restore.
- [ ] Offline pack refresh, eviction, interruption and shared removal.
- [x] Focused regressions, required repository checks and production build.
- [ ] Mobile performance and accessibility evidence (label emulation explicitly).
- [x] Release notes and version surfaces prepared; deployment not performed.

## Validation and remaining limitations

Initial read-only audit and source checks above completed. No feature completion
or device-performance claim is made. Source website timed out during discovery;
ADS metadata and downloads were reachable. The source checksum and creation-date
discrepancies remain recorded limitations requiring careful publication review.

### 2026-10-13 — review after user refinements

The user requested checks of their compact hillfort presentation and single
LiDAR button in both FieldGuide and the active session map. Preserve their
hidden empty-state sections and shorter narrative. No deployment or version
release was requested.

Review fixes:

- Removed the geographic shortcuts used for LiDAR source selection: Cornwall
  and parts of northern England could select the wrong provider. One button now
  toggles the existing regional providers together, with shared opacity. Each
  provider retains its coverage and attribution; this does not establish complete
  LiDAR coverage. The button exposes its pressed state to assistive technology.
- Restored hillfort details **only on selection**. Removing the entire records
  section had left name/marker actions with no rendered detail view. The default
  landscape reading stays compact; an explicit “View all” action opens the list.
- Re-align selected details after the mobile sheet expands, keeping the site
  heading below the scan controls. Screenshot review exposed the initial timing
  issue; the browser regression checks the heading against the scroll viewport.
- Corrected offline classification to require `navigator.onLine === false`.
  An absent connectivity value is not evidence that the browser is offline.
- Fixed added React dependency warnings and stale ALIE effect cleanup. Registered
  DOI/licence strings as metadata, without allowing automatic source requests.
- Updated the affected architecture inventory and session smoke expectations.
  Python conversion scripts are included in portable architecture dumps.

Verified evidence:

- Full `npm test`: 163 files, **1,348 passed**, one existing skip. TypeScript,
  type floor, casing, explicit-any, hooks, dump coverage, DOM/download/date and
  network-origin checks passed. Initial failures and their fixes were dependency
  warnings, metadata-origin registration, and one stale architecture line count.
- `npm run build` passed; production service worker precaches 120 application
  assets. The Atlas JSON is demand-loaded and is not a Home precache download.
- Dedicated Atlas suite: 14 tests pass, covering real data/IDs/jurisdictions,
  checksum and coordinate rejection, irregular polygons/holes/boundaries,
  context extent/signature changes, explicit NHLE matching, ALIE numerical
  invariance, legacy saves, cancellation, deduplication, failed refresh and
  interrupted/offline downloads.
- Existing mobile landscape-details and protection/overlapping-target browser
  regressions: 2 passed.
- New FieldGuide LiDAR/Atlas browser checks and affected session/basemap smoke
  checks: 4 passed. Verify one LiDAR control, regional visibility/shared opacity,
  real EN0001 scan result, selected details, full list, hidden-layer preference
  after rescan, retained interpretation, one dataset download across scans, no
  Atlas/Experience requests, and card text accessible after going offline.
- Production builds also pass both new UI checks. An additional production
  check passes a fresh **offline document navigation**, scan from Cache Storage,
  and source card with dating/attribution. Tests reopen the selected route
  coordinates because the app deliberately consumes one-shot coordinates;
  ordinary reload is not a guarantee of restoring the same map position.
- Rebuilding the dataset into a separate directory reproduced byte-identical
  output SHA-256 `0328ad53fd1e3e8413cca6dd0a4d606fad9a04c2cda72a4648276cc608cb449b`.
  Output: 11,546,253 bytes, gzip 2,261,417 bytes; 4,147 records, zero rejections,
  395 recorded encoding replacement glyphs. Single payload chosen; no sharding.

Browser evidence uses NixOS Chromium 155 on desktop, with a **390×844 emulated
viewport** and mocked external terrain/heritage services. Real packaged Atlas
data was used. This is not physical-phone or live-provider verification. The
downloaded Playwright Chromium was incompatible with NixOS; the Nix browser
completed the checks. Artifacts/logs are under `/tmp/findspot-hillfort-review-*`.

Remaining limits: physical-device performance/accessibility, live LiDAR provider
coverage and full pack refresh/removal/concurrent-build lifecycle verification
remain unverified. Source checksum/date/encoding limitations
above remain disclosed. The pre-existing trailing-blank-line warning in
`docs/permission-decompose-stage0-checklist.md` was left untouched.

### 2026-10-13 — release preparation requested

The user requested release notes and a version bump. Prepare **5.0.23** using the
repository's atomic release-preparation script; retain 5.0.22's historical
metadata. Banner wording: “See recorded hillforts in FieldGuide and use one LiDAR
layer control.”

Release behaviour: automatic Atlas lookup supplies scan and surrounding context;
the compact existing landscape reading links to selectable records and source
details. Downloaded records remain usable offline. Atlas context is separate
from weighted ALIE evidence and cannot change hotspot scores or confidence.
FieldGuide and the active session map each offer one LiDAR control with shared
regional opacity.

The user accepts deferring additional offline-pack lifecycle verification and
will perform live LiDAR and physical-phone checks after deployment. These checks
remain unverified, not failed or completed. This request prepares release files;
no commit, push or deployment was performed in this step. Source limitations
remain recorded above.

Preparation completed: `package.json`, both lockfile version fields and
`docs/releases/5.0.23.json` agree on 5.0.23. The 69-character update banner names
both shipped changes. `release:prepare`, release guard, TypeScript, all three
release-automation tests and the production/PWA build passed. The built Settings
bundle contains 5.0.23. Logs: `/tmp/findspot-hillfort-release-{prepare,tests,build}.log`.

### 2026-10-13 — push authorized

The user explicitly requested pushing this release to `main`, which triggers
the GitHub Pages deployment workflow. Live LiDAR and physical-phone checks remain
the user's post-deployment checks; additional pack lifecycle checks are deferred
as agreed. Commit only this feature and release work, preserving the two unrelated
documentation edits identified in the baseline. CI/deployment confirmation is
pending at commit time.
