/**
 * build-sm-verification.mjs
 *
 * Queries the live NHLE FeatureServer/6 for a hardcoded set of test points
 * and writes tests/fixtures/smVerification.json with expected SM flag/clear
 * results for each point.
 *
 * Run this after a major SM designation batch to refresh the fixture, or
 * whenever the test suite starts failing against the live data.
 *
 * Usage:
 *   node scripts/build-sm-verification.mjs
 *
 * Output:
 *   tests/fixtures/smVerification.json
 *
 * Requirements: Node 18+ (global fetch, fs/promises)
 * Attribution: NHLE © Historic England, CC BY 4.0
 */

import { writeFile, mkdir } from 'fs/promises';
import { join, dirname }    from 'path';
import { fileURLToPath }    from 'url';

const __dirname  = dirname(fileURLToPath(import.meta.url));
const OUT_FILE   = join(__dirname, '..', 'tests', 'fixtures', 'smVerification.json');

const FEATURE_SERVER =
  'https://services-eu1.arcgis.com/ZOdPfBS3aqqDYPUQ/arcgis/rest/services/' +
  'National_Heritage_List_for_England_NHLE_v02_VIEW/FeatureServer/6/query';

// Bbox half-width in degrees — matches what the app scan uses
const BBOX_HALF = 0.005;

// ── Test points ───────────────────────────────────────────────────────────────
// Each point has a `label`, `lat`, `lon`, and an optional `note`.
// `expected` and `listEntry` are derived at runtime from the live service.

/** @type {Array<{ lat: number, lon: number, label: string, note?: string, _edgeCase?: boolean }>} */
const TEST_POINTS = [
  // ── Known SM points ───────────────────────────────────────────────────────
  {
    label: 'Stonehenge',
    lat:   51.1789,
    lon:   -1.8262,
    note:  'stone circle complex',
  },
  {
    label: 'Avebury',
    lat:   51.4285,
    lon:   -1.8544,
    note:  'henge and stone circles complex',
  },
  {
    label: "Hadrian's Wall near Housesteads",
    lat:   55.0147,
    lon:   -2.3268,
    note:  'linear earthwork — multi-cell SM',
  },
  {
    label: 'Maiden Castle, Dorset',
    lat:   50.6965,
    lon:   -2.4700,
    note:  'Iron Age hillfort',
  },
  {
    label: 'Carn Euny',
    lat:   50.1093,
    lon:   -5.6132,
    note:  'Iron Age courtyard house settlement',
  },
  {
    label: "Wayland's Smithy",
    lat:   51.5675,
    lon:   -1.5948,
    note:  'Neolithic long barrow',
  },
  {
    label: 'Silbury Hill',
    lat:   51.4155,
    lon:   -1.8574,
    note:  'Neolithic chalk mound',
  },
  {
    label: 'Sutton Hoo',
    lat:   52.0922,
    lon:   1.3485,
    note:  'Anglo-Saxon royal burial ground',
  },
  {
    label: "Offa's Dyke near Knighton",
    lat:   52.3556,
    lon:   -3.0447,
    note:  'linear earthwork — multi-cell SM',
  },
  {
    label: 'Grimes Graves',
    lat:   52.4793,
    lon:   0.6767,
    note:  'Neolithic flint mine complex',
  },
  {
    label: 'Thornborough Henges',
    lat:   54.1857,
    lon:   -1.5693,
    note:  'triple henge complex',
  },
  {
    label: 'Cerne Abbas Giant',
    lat:   50.8134,
    lon:   -2.5076,
    note:  'hill figure (chalk)',
  },
  {
    label: 'Flag Fen',
    lat:   52.5728,
    lon:   -0.1893,
    note:  'Bronze Age wetland platform and causeway',
  },
  {
    label: 'Old Sarum',
    lat:   51.0936,
    lon:   -1.7997,
    note:  'Iron Age hillfort and Norman castle',
  },
  {
    label: 'Belas Knap',
    lat:   51.9393,
    lon:   -1.9296,
    note:  'Neolithic long barrow',
  },
  // ── Edge cases (near SM polygon boundaries) ───────────────────────────────
  {
    label: 'Stonehenge outer buffer edge',
    lat:   51.1797,
    lon:   -1.8230,
    note:  'edge case: near outer scheduled area boundary — result may vary with designation changes',
    _edgeCase: true,
  },
  {
    label: 'Avebury henge eastern edge',
    lat:   51.4279,
    lon:   -1.8484,
    note:  'edge case: near eastern boundary of Avebury scheduled area',
    _edgeCase: true,
  },
  // ── Known clear points ────────────────────────────────────────────────────
  {
    label: 'Leicestershire arable',
    lat:   52.5678,
    lon:   -1.2345,
    note:  'rural arable — no known SMs',
  },
  {
    label: 'South Yorkshire arable',
    lat:   53.4567,
    lon:   -1.5678,
    note:  'rural arable — no known SMs',
  },
  {
    label: 'Kent arable',
    lat:   51.2345,
    lon:   0.5678,
    note:  'rural arable — no known SMs',
  },
  {
    label: 'Worcestershire',
    lat:   52.1234,
    lon:   -2.3456,
    note:  'rural arable — no known SMs',
  },
  {
    label: 'Devon arable',
    lat:   50.9876,
    lon:   -3.4567,
    note:  'rural arable — no known SMs',
  },
  {
    label: 'North Yorkshire (east)',
    lat:   54.3210,
    lon:   -0.9876,
    note:  'rural arable — no known SMs',
  },
  {
    label: 'Hertfordshire',
    lat:   51.8765,
    lon:   -0.4321,
    note:  'rural arable — no known SMs',
  },
  {
    label: 'Cheshire',
    lat:   53.1234,
    lon:   -2.7654,
    note:  'rural arable — no known SMs',
  },
  {
    label: 'North Yorkshire (west)',
    lat:   53.9876,
    lon:   -1.7654,
    note:  'rural arable, well clear of Thornborough Henges',
  },
  {
    label: 'Hampshire coastal plain',
    lat:   50.5678,
    lon:   -1.3456,
    note:  'rural arable — no known SMs',
  },
];

// ── FeatureServer query ───────────────────────────────────────────────────────

/**
 * Query the live FeatureServer/6 for features within a bbox.
 * Returns an array of { listEntry, name } objects.
 *
 * @param {number} lat
 * @param {number} lon
 * @returns {Promise<Array<{ listEntry: string, name: string }>>}
 */
async function queryBbox(lat, lon) {
  const west  = lon - BBOX_HALF;
  const east  = lon + BBOX_HALF;
  const south = lat - BBOX_HALF;
  const north = lat + BBOX_HALF;

  const params = new URLSearchParams({
    where:          '1=1',
    geometry:       `${west},${south},${east},${north}`,
    geometryType:   'esriGeometryEnvelope',
    inSR:           '4326',
    spatialRel:     'esriSpatialRelIntersects',
    outFields:      'ListEntry,Name',
    returnGeometry: 'false',
    f:              'json',
  });

  const url = `${FEATURE_SERVER}?${params}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'FindSpot-SM-Verification-Builder/1.0' },
  });

  if (!res.ok) {
    throw new Error(`FeatureServer returned ${res.status} for ${lat},${lon}`);
  }

  const data = await res.json();

  if (data.error) {
    throw new Error(`FeatureServer error at ${lat},${lon}: ${JSON.stringify(data.error)}`);
  }

  const features = Array.isArray(data.features) ? data.features : [];
  return features.map((f) => ({
    listEntry: String(f.attributes?.ListEntry ?? '').trim(),
    name:      String(f.attributes?.Name      ?? '').trim(),
  })).filter((x) => x.listEntry);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`Querying live FeatureServer/6 for ${TEST_POINTS.length} test points…`);
  console.log(`Bbox half-width: ±${BBOX_HALF}°\n`);

  const results = [];
  let flagCount  = 0;
  let clearCount = 0;

  for (const point of TEST_POINTS) {
    const { lat, lon, label, note, _edgeCase } = point;

    process.stdout.write(`  ${label.padEnd(45)}`);

    let hits;
    try {
      hits = await queryBbox(lat, lon);
    } catch (err) {
      console.error(`\nERROR querying ${label}: ${err.message}`);
      process.exit(1);
    }

    const expected  = hits.length > 0 ? 'flag' : 'clear';
    const listEntry = hits.length > 0 ? hits[0].listEntry : null;

    if (expected === 'flag') { flagCount++;  process.stdout.write(`FLAG  (SM${listEntry})\n`); }
    else                     { clearCount++; process.stdout.write(`clear\n`); }

    const entry = { lat, lon, label, expected };
    if (listEntry) entry.listEntry = listEntry;
    if (note)      entry.note      = note;
    if (_edgeCase) entry.edgeCase  = true;

    results.push(entry);
  }

  const fixture = {
    capturedAt: new Date().toISOString(),
    source:     'FeatureServer/6 live',
    bboxHalfDeg: BBOX_HALF,
    points:     results,
  };

  await mkdir(dirname(OUT_FILE), { recursive: true });
  await writeFile(OUT_FILE, JSON.stringify(fixture, null, 2), 'utf8');

  console.log('');
  console.log('Summary:');
  console.log(`  Total points : ${results.length}`);
  console.log(`  Flagged (SM) : ${flagCount}`);
  console.log(`  Clear        : ${clearCount}`);
  console.log(`  Written to   : ${OUT_FILE}`);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
