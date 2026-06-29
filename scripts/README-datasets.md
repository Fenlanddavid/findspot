# FindSpot Static Datasets

Static datasets served from the `findspot-static` R2 bucket via the `findspot-static` Cloudflare Worker.

---

## Datasets

| Key prefix | Description | Cache |
|---|---|---|
| `sm-index/_meta.json` | SM index build metadata (count, date, source) | 1 day |
| `sm-index/{geohash6}.json` | Per-cell SM shard (array of `{ listEntry, name, bbox }`). Missing cell = valid empty response (`[]`). | 1 day |
| `aim-index/{geohash6}.json` | Per-cell AIM shard (array of `{ monumentType, period, evidence, bbox }`). Same sparse pattern as SM. | 1 day |
| `pas-h3/` | PAS H3 density tiles (future W4). | 7 days |

---

## Rebuilding the SM Index

The SM index is a sparse geohash6 shard index of all ~20,000 Scheduled Monuments in England from the NHLE FeatureServer/6.

**Step 1 — Generate shards locally:**
```bash
node scripts/build-sm-index.mjs
# Output: scripts/out/sm-index/_meta.json  +  scripts/out/sm-index/{geohash6}.json
```

**Step 2 — Upload meta:**
```bash
wrangler r2 object put findspot-static/sm-index/_meta.json \
  --file scripts/out/sm-index/_meta.json \
  --content-type application/json
```

**Step 3 — Bulk-upload all shards:**
```bash
find scripts/out/sm-index -name '*.json' | while read f; do
  key="sm-index/$(basename $f)"
  wrangler r2 object put "findspot-static/$key" --file "$f" --content-type application/json
done
```

Total upload time: ~2–5 minutes for ~20,000 features across ~4,000 cells.

---

## Rebuilding the AIM Index

The AIM index uses the same geohash-sharded structure as SM, served from `aim-index/`.

**Step 1 — Generate shards locally:**
```bash
node scripts/build-aim-index.mjs
# Output: scripts/out/aim-index/_meta.json  +  scripts/out/aim-index/{geohash6}.json
```

**Step 2 — Bulk-upload all shards:**
```bash
wrangler r2 object put findspot-static/aim-index/_meta.json \
  --file scripts/out/aim-index/_meta.json \
  --content-type application/json

find scripts/out/aim-index -name '*.json' | while read f; do
  key="aim-index/$(basename $f)"
  wrangler r2 object put "findspot-static/$key" --file "$f" --content-type application/json
done
```

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

- **Scheduled Monuments (SM index, AIM):** National Heritage List for England (NHLE) © Historic England, licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Source: FeatureServer/6 live query.
- **Itiner-e Roman Roads:** © Itiner-e contributors, licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
- **Wales LiDAR hillshade:** © Natural Resources Wales / Welsh Government, Open Government Licence v3.0.
