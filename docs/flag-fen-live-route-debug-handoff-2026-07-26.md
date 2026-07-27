# Flag Fen live Roman-road debug handoff

Date paused: 2026-07-26  
Resolved: 2026-07-27  
Status: root cause confirmed and corrected for v4.12.6.

## User-grounded truth

David works at Flag Fen and has extensive knowledge of the Fen Causeway. Treat
his first screenshot as the correct alignment:

- Correct localhost/validation reference:
  `/home/david/Pictures/Screenshots/Screenshot From 2026-07-26 21-22-57.png`
- Incorrect live result reported before v4.12.5:
  `/home/david/Downloads/Screenshot_20260726-214800.png`
- Live Settings screenshot showing v4.12.4:
  `/home/david/Downloads/Screenshot_20260726-214817.png`

After v4.12.5 deployed successfully and its live bundles were verified, David
reported that live was still not working. No post-v4.12.5 screenshot or Settings
version was captured before pausing.

## Releases already made

- v4.12.4, commit `838baed`: RRRA Digital Britannia engineered roads replaced
  the Itiner-e asset.
- v4.12.5, commit `b761dc3`: attempted production correction making RRRA the
  sole Roman-road source.
- `origin/main` and local `HEAD` both pointed to full commit
  `b761dc3c95c2f456366bb8391172bab6bd45901b` after the push.
- GitHub Pages run `30220555443` (run 417) completed successfully for that exact
  commit.

The deployed HTML referenced the same hashes as the validated local build:

- `assets/index-BYxQGsgW.js`
- `assets/FieldGuide-B29XMWCv.js`
- `assets/Settings-ByaJ83ne.js`

Live and local SHA-256 values matched:

- index: `e9e29cd721b902f4f907f608e6c0ba699fec2992dbfbd5fcdd2e74d8d2c4dec4`
- FieldGuide:
  `798bc90ad42374cb6244a9b8fddbcc00af3f18d0fd1cd7e14132a4a9d007056f`
- Settings:
  `1a3fa08e83353d451469e86f7e4357fc59258ce2a805ea40895fc9df7529a6e3`

The Settings bundle contains `4.12.5`, and the index bundle contains:
`Roman-road maps now show only verified RRRA alignments.`

## First live diagnosis and v4.12.5 correction

The v4.12.4 app combined the bundled RRRA roads with Roman-road results from
Overpass/OSM. Around Flag Fen, Overpass returned:

- relation `7612846`, `historic=roman_road`, `conjectural=yes`, named
  `ROMAN ROAD - Fen Causeway`
- member way `497933068`, with
  `fixme=Approximate location - needs to be mapped.` and a note describing it
  as an estimated segment

That explained why localhost, when Overpass did not contribute the relation,
matched David's reference while live showed additional blue alignments.

v4.12.5 changed:

- `src/services/historicScanService.ts`
  - Overpass route queries now request only historic trackways and holloways.
  - `parseOverpassContextRoutes()` filters every OSM route classified as
    `roman_road` as a defence-in-depth policy.
- `src/services/fieldguide/historicScanCoordinator.ts`
- `src/services/fieldguide/terrainScanCoordinator.ts`
  - Both production paths use `parseOverpassContextRoutes()`.
- `tests/unit/historicRouteSourcePolicy.test.ts`
  - Contains the exact Flag Fen relation/member-way fixture.
  - Proves the legacy parser identifies it as an OSM Roman road.
  - Proves the production parser removes it while retaining trackways and
    holloways.
- `tests/regression.spec.ts`
  - The historic-sheet browser fixture now supplies its Roman road through the
    RRRA asset and supplies only a trackway through OSM.

The sign-off record is:
`docs/rrra-roads-slice-2-sign-off.md`.

## Validation completed for v4.12.5

- `npm test`: 94 files; 919 passed; 1 intentional skip
- `npm run test:worker:nix`: 10 passed
- `npm run test:e2e:nix`: 52 passed
- `npm run build`: passed; PWA 53 entries / 5,036.41 KiB
- `npm run check:release`: passed
- `git diff --check`: passed
- Type floor: 883 <= 891
- Explicit `any`: unchanged at 137

One browser test initially failed because its old fixture sourced a Roman road
from OSM. It was corrected to source that road from RRRA, then the focused test
and all 52 browser tests passed.

## Final root cause and v4.12.6 correction

The incorrect live screenshot contains the old schematic Itiner-e geometries,
including the Durobrivae-Denver east-west alignment and the
Peterborough-Stilton diagonal. It is not only the conjectural OSM relation.

`romanRoadService.ts` loaded the fixed
`/findspot/roman-roads-gb.geojson` URL through `cachedFetchAny()`. That helper
calls `caches.match()` across every Cache Storage cache. An older Workbox
precache or prepared offline cache could therefore return the obsolete
Itiner-e file to newer v4.12.4/v4.12.5 JavaScript. This reconciles the Settings
version screenshot with the old route geometry, and explains why **Clear Scan**
did not help: it resets page state, not Cache Storage.

v4.12.6 scopes both the app request and Workbox precache entry to the dataset
generation:

`roman-roads-gb.geojson?generation=rrra-digital-britannia-v1.0-2026-07-26`

The old stable URL cannot match that request. Existing offline-pack code also
uses the generation-scoped URL, so a stale prepared pack cannot shadow the
current asset.

Permanent regression coverage seeds an old unversioned Itiner-e response into
Cache Storage, runs the full Field Guide historic scan, and proves the
generation-scoped RRRA route is used while the stale route is absent. The test
passes against both the Vite development app and the built production preview.
The built service worker contains exactly one Roman-road precache entry at the
generation-scoped URL.

## Other bookkeeping

- The courtesy RRRA licensing/schema email remains unsent.
- No Dexie schema or backup-format change was made.
- The repository was clean immediately after commit/push; this handoff file is
  the only expected new working-tree file.
