# FindSpot Static Datasets

Static datasets served from the `findspot-static` R2 bucket via the `findspot-static` Cloudflare Worker.

---

## Datasets

| Key prefix | Description | Cache |
|---|---|---|
| `v2/sm-index/_meta.json` | SM index build metadata (count, date, source) | 1 day |
| `v2/sm-index/{geohash6}.json` | Per-cell SM shard (array of `{ listEntry, name, bbox }`). Missing cell = valid empty response (`[]`). | 1 day |
| `v2/aim-index/{geohash6}.json` | Per-cell AIM shard (array of `{ monumentType, period, evidence, bbox }`). Same sparse pattern as SM. | 1 day |
| `v2/pas-h3/` | PAS H3 density tiles (future W4). | 7 days |

---

## Rebuilding the bundled Roman-road asset

The checked-in `public/roman-roads-gb.geojson` file is the browser-ready RRRA
Digital Britannia v1.0 engineered-roads layer. The raw download is deliberately
kept outside the repository.

Pinned input vintage:

- Downloaded: 2026-07-26
- Source: `downloads/V1.0/GeoJSON/engineered_roman_roads.geojson`
- Raw bytes: 3,941,276
- SHA-256: `ff4caff0b4446554660b117304554b51e7e9b1420c262f3dbdf60c0f1454b9d2`
- Observed features: 3,572 (the published figure is 3,577; the source file was
  not altered to reconcile that discrepancy)

The `.geojson` download declares and uses EPSG:27700 British National Grid,
contrary to RFC 7946. Reproject with GDAL before running the existing builder:

```bash
ogr2ogr -f GeoJSON -s_srs EPSG:27700 -t_srs EPSG:4326 \
  -lco COORDINATE_PRECISION=5 /tmp/rrra-roads-wgs84.geojson \
  /path/to/engineered_roman_roads.geojson

node scripts/build-roman-roads.mjs \
  /tmp/rrra-roads-wgs84.geojson public/roman-roads-gb.geojson
```

The builder pins the observed v1.0 property schema and `Segment Confidence`
domain (`0`, `1`, `2`, `3`, `null`) but deliberately does not interpret that
undocumented field. Every accepted engineered-road segment is emitted as class
A. Coordinates are quantized to five decimal places; MultiLineStrings are
split; short/degenerate geometry is removed; properties are reduced to source,
name, road reference and confidence class; and IDs use the `rrra-` prefix.
Passing unreprojected BNG coordinates fails WGS84 validation.

Build result: 3,505 features and 1,417,865 bytes. The 67 removed features have
empty, zero-length geometry, so `droppedDegenerateSegments` is the entire
`droppedShortSegments` total rather than an additional removal count. At 1.35
MiB the result is below the 3 MiB Workbox limit and remains one explicitly
versioned precached asset; no sharding is used. The checked-in output SHA-256 is
`d7577aaba43e11f63afa6c3e00bdf2a83e135be49a1330361479c7a2b2cbda37`.

---

## Rebuilding the SM Index

The SM index is a sparse geohash6 shard index of Scheduled Monuments in England from the NHLE FeatureServer/6, Welsh Scheduled Ancient Monuments from Cadw WFS, and Scottish Scheduled Monuments from HES MapServer/5.

**Step 1 — Generate shards locally:**
```bash
node scripts/build-sm-index.mjs
# Output: scripts/out/sm-index/_meta.json  +  scripts/out/sm-index/{geohash6}.json
```

**Step 2 — Bundle the cell shards, then upload the bundle data and indexes:**
```bash
node scripts/bundle-sm-index.mjs

find scripts/out/sm-index/bundles -type f | while read f; do
  key="v2/sm-index/bundles/$(basename $f)"
  wrangler r2 object put "findspot-static/$key" --file "$f"
done
```

Use the `v2/sm-index/bundles/` prefix for the destination key. The Worker reads
the small `.index.json` object and requests only the byte range for the public
cell URL, so it never parses a complete data bundle in memory.

**Step 3 — Verify Scottish shard URLs directly, then upload `_meta.json` last:**
```bash
wrangler r2 object put findspot-static/v2/sm-index/_meta.json \
  --file scripts/out/sm-index/_meta.json \
  --content-type application/json
```

The current v2 generation contains 43,359 occupied cells in 1,380 bundle
objects. The metadata file is deliberately excluded until verification passes.

---

## Rebuilding the AIM Index

The AIM index uses the same geohash-sharded structure as SM, served from `v2/aim-index/`.

**Step 1 — Generate shards locally:**
```bash
node scripts/build-aim-index.mjs
# Output: scripts/out/aim-index/_meta.json  +  scripts/out/aim-index/{geohash6}.json
```

**Step 2 — Bundle the cell shards, then upload the bundles:**
```bash
node scripts/bundle-aim-index.mjs

find scripts/out/aim-index/bundles -name '*.json' | while read f; do
  key="v2/aim-index/bundles/$(basename $f)"
  wrangler r2 object put "findspot-static/$key" --file "$f" --content-type application/json
done
```

The Worker keeps the public per-cell URL contract and reads each cell from its
four-character prefix bundle. This makes a generation practical to upload and
switch atomically.

**Step 3 — Verify a few cell URLs, then upload `_meta.json` last:**
```bash
wrangler r2 object put findspot-static/v2/aim-index/_meta.json \
  --file scripts/out/aim-index/_meta.json \
  --content-type application/json
```

Keep the `v1/` objects and the old unversioned objects in R2 for the documented
grace window; the Worker continues to serve both while installed clients update.

---

## Checking for Changes (Diff)

Run before deciding whether a rebuild is needed:

```bash
node scripts/diff-sm-index.mjs
# Exit 0: no changes. Exit 1: changes detected — rebuild recommended.
```

The diff compares `scripts/out/sm-index/_entries.json` (written alongside the index) against the live FeatureServer/6.

---

## Recommended Cadence

- **Quarterly minimum** — Historic England designates SMs in batches (typically a few dozen per quarter).
- **After any major designation announcement** — run the diff checker first; rebuild only if changes are detected.
- CI can run `diff-sm-index.mjs` on a schedule and alert on exit code 1.

---

## Verification Fixture

`tests/fixtures/smVerification.json` contains ~27 test points (SM and clear) with expected results derived from the live service. Refresh it after a major designation batch:

```bash
node scripts/build-sm-verification.mjs
# Queries live FeatureServer/6 for each point and writes updated fixture
```

Run the regression suite after refreshing to confirm the app's SM lookup logic matches the fixture.

---

## Attribution

- **Scheduled Monuments (SM index, AIM):** National Heritage List for England (NHLE) © Historic England, licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Welsh Scheduled Ancient Monument data is Designated Historic Asset GIS Data from The Welsh Historic Environment Service (Cadw), licensed under the Open Government Licence v3.0. Scottish Scheduled Monument attribution: Contains Historic Environment Scotland and OS data © Historic Environment Scotland and Crown Copyright and [database right] 2026, licensed under the Open Government Licence v3.0. Sources: NHLE FeatureServer/6, Cadw DataMapWales WFS, HES MapServer/5 live queries.
- **RRRA Digital Britannia engineered Roman roads:** Digital Britannia © Mike Haken 2026, Roman Roads Research Association (RRRA), licensed under [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/). Not for use in fee-charging applications without prior written consent.
- **Historical Itiner-e route caches:** © Itiner-e contributors, licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). No Itiner-e-derived Roman-road bytes remain in the shipped asset.
- **Wales LiDAR hillshade:** © Natural Resources Wales / Welsh Government, Open Government Licence v3.0.
