/**
 * build-sm-index.mjs
 *
 * Fetches all Scheduled Monuments from the NHLE ArcGIS FeatureServer/6,
 * buckets them by geohash6 cell, and writes a sparse shard-per-cell index
 * to scripts/out/sm-index/.
 *
 * Requirements: Node 18+ (global fetch, fs/promises)
 *
 * Usage:
 *   node scripts/build-sm-index.mjs
 *
 * Output:
 *   scripts/out/sm-index/_meta.json
 *   scripts/out/sm-index/{geohash6}.json   (one per occupied cell)
 *
 * Attribution: NHLE © Historic England, CC BY 4.0
 */

import { mkdir, writeFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR   = join(__dirname, 'out', 'sm-index');

const FEATURE_SERVER =
  'https://services-eu1.arcgis.com/ZOdPfBS3aqqDYPUQ/arcgis/rest/services/' +
  'National_Heritage_List_for_England_NHLE_v02_VIEW/FeatureServer/6/query';

const PAGE_SIZE = 1000;

// ── Geohash6 encoder ─────────────────────────────────────────────────────────
// Standard geohash using Base32 alphabet (Gustavo Niemeyer encoding).
// Precision 6 = ~1.2 km × 0.6 km cells — appropriate granularity for SM lookup.

const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';

/**
 * Encode a lon/lat coordinate to a geohash string of the given precision.
 * @param {number} lon  WGS84 longitude
 * @param {number} lat  WGS84 latitude
 * @param {number} [precision=6]
 * @returns {string}
 */
function encodeGeohash(lon, lat, precision = 6) {
  let minLon = -180, maxLon = 180;
  let minLat =  -90, maxLat =  90;
  let hash   = '';
  let bits   = 0;
  let bitsTotal = 0;
  let hashValue = 0;
  let isEven = true; // start with longitude bit

  while (hash.length < precision) {
    if (isEven) {
      // bisect longitude
      const mid = (minLon + maxLon) / 2;
      if (lon >= mid) { hashValue = (hashValue << 1) | 1; minLon = mid; }
      else            { hashValue = (hashValue << 1);     maxLon = mid; }
    } else {
      // bisect latitude
      const mid = (minLat + maxLat) / 2;
      if (lat >= mid) { hashValue = (hashValue << 1) | 1; minLat = mid; }
      else            { hashValue = (hashValue << 1);     maxLat = mid; }
    }
    isEven = !isEven;
    bits++;
    bitsTotal++;

    if (bits === 5) {
      hash      += BASE32[hashValue];
      bits       = 0;
      hashValue  = 0;
    }
  }

  return hash;
}

/**
 * Return all geohash6 cells touched by the given bbox [west, south, east, north].
 * Steps across the bbox below the smaller precision-6 cell dimension so that
 * large linear features are indexed in every cell their bbox touches.
 *
 * Geohash6 cell dimensions are about 0.011° lon × 0.0055° lat.
 *
 * @param {[number,number,number,number]} bbox  [west, south, east, north]
 * @returns {Set<string>}
 */
function geohash6CellsForBbox([west, south, east, north]) {
  const STEP = 0.004;
  const cells    = new Set();

  for (let lon = west; lon <= east + STEP; lon += STEP) {
    for (let lat = south; lat <= north + STEP; lat += STEP) {
      cells.add(encodeGeohash(Math.min(lon, east), Math.min(lat, north)));
    }
  }
  // Always include corners to handle tiny bboxes smaller than step size
  cells.add(encodeGeohash(west,  south));
  cells.add(encodeGeohash(east,  south));
  cells.add(encodeGeohash(west,  north));
  cells.add(encodeGeohash(east,  north));

  return cells;
}

// ── Geometry bbox extractor ───────────────────────────────────────────────────

/**
 * Extract [west, south, east, north] from a GeoJSON geometry.
 * Handles Point, Polygon, MultiPolygon.
 * Returns null if geometry is missing or unsupported.
 *
 * @param {object|null} geometry  GeoJSON geometry object
 * @returns {[number,number,number,number]|null}
 */
function bboxFromGeometry(geometry) {
  if (!geometry) return null;

  let minLon =  Infinity, maxLon = -Infinity;
  let minLat =  Infinity, maxLat = -Infinity;

  function expandRing(ring) {
    for (const [lon, lat] of ring) {
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
  }

  switch (geometry.type) {
    case 'Point': {
      const [lon, lat] = geometry.coordinates;
      return [lon, lat, lon, lat];
    }
    case 'Polygon':
      for (const ring of geometry.coordinates) expandRing(ring);
      break;
    case 'MultiPolygon':
      for (const polygon of geometry.coordinates)
        for (const ring of polygon) expandRing(ring);
      break;
    default:
      // LineString / MultiLineString etc. — treat as unsupported
      return null;
  }

  if (!isFinite(minLon)) return null;
  return [minLon, minLat, maxLon, maxLat];
}

// ── NHLE fetcher ──────────────────────────────────────────────────────────────

/**
 * Fetch a single page of features from FeatureServer/6.
 * @param {number} offset
 * @returns {Promise<object[]>}  GeoJSON features array (may be empty)
 */
async function fetchPage(offset) {
  const params = new URLSearchParams({
    where:        '1=1',
    outFields:    'Name,ListEntry,Shape__Area',
    f:            'geojson',
    resultOffset: String(offset),
    resultRecordCount: String(PAGE_SIZE),
  });

  const url = `${FEATURE_SERVER}?${params}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'FindSpot-SM-Index-Builder/1.0' },
  });

  if (!res.ok) {
    throw new Error(`FeatureServer returned ${res.status} at offset ${offset}`);
  }

  const data = await res.json();

  if (data.error) {
    throw new Error(`FeatureServer error: ${JSON.stringify(data.error)}`);
  }

  return Array.isArray(data.features) ? data.features : [];
}

/**
 * Fetch ALL features from FeatureServer/6 using pagination.
 * @returns {Promise<object[]>}
 */
async function fetchAllFeatures() {
  const all = [];
  let   offset = 0;

  console.log('Fetching NHLE Scheduled Monuments from FeatureServer/6…');

  while (true) {
    const page = await fetchPage(offset);
    if (page.length === 0) break;

    all.push(...page);

    if (all.length % 1000 < page.length) {
      // crossed a 1000-feature boundary
      console.log(`  …fetched ${all.length} features so far`);
    }

    if (page.length < PAGE_SIZE) break; // last page
    offset += PAGE_SIZE;
  }

  console.log(`Total features fetched: ${all.length}`);
  return all;
}

// ── Index builder ─────────────────────────────────────────────────────────────

/**
 * Build the sharded index from an array of GeoJSON features.
 *
 * @param {object[]} features
 * @returns {Map<string, Array<{listEntry:string, name:string, bbox:[number,number,number,number], geometry:object}>>}
 */
function buildIndex(features) {
  // cell → Map<listEntry, entry>  (deduplicate by listEntry within each cell)
  const cellMap = new Map();
  let   skipped = 0;

  for (const feature of features) {
    const props     = feature.properties ?? {};
    const listEntry = String(props.ListEntry ?? '').trim();
    const name      = String(props.Name      ?? '').trim();

    if (!listEntry) { skipped++; continue; }

    const bbox = bboxFromGeometry(feature.geometry);
    if (!bbox) { skipped++; continue; }

    const cells = geohash6CellsForBbox(bbox);

    for (const cell of cells) {
      if (!cellMap.has(cell)) cellMap.set(cell, new Map());
      const cellEntries = cellMap.get(cell);
      if (!cellEntries.has(listEntry)) {
        cellEntries.set(listEntry, { listEntry, name, bbox, geometry: feature.geometry });
      }
    }
  }

  if (skipped > 0) {
    console.log(`  Skipped ${skipped} features (missing ListEntry or geometry)`);
  }

  // Convert inner Maps to arrays
  const index = new Map();
  for (const [cell, entries] of cellMap) {
    index.set(cell, Array.from(entries.values()));
  }

  return index;
}

// ── Writer ────────────────────────────────────────────────────────────────────

async function writeIndex(index, features) {
  await mkdir(OUT_DIR, { recursive: true });

  let maxShardSize = 0;
  let written = 0;

  for (const [cell, entries] of index) {
    const filePath = join(OUT_DIR, `${cell}.json`);
    await writeFile(filePath, JSON.stringify(entries), 'utf8');
    if (entries.length > maxShardSize) maxShardSize = entries.length;
    written++;
  }

  // Collect all unique ListEntry values for diff-sm-index.mjs
  const allListEntries = [
    ...new Set(
      features
        .map((f) => String(f.properties?.ListEntry ?? '').trim())
        .filter(Boolean),
    ),
  ];

  const featureCount = features.length;

  const meta = {
    builtAt:      new Date().toISOString(),
    schemaVersion: 2,
    geometryMode: 'full-geojson',
    featureCount,
    cellCount:    index.size,
    source:       'FeatureServer/6 live',
  };

  await writeFile(join(OUT_DIR, '_meta.json'),    JSON.stringify(meta, null, 2), 'utf8');
  // _entries.json used by diff-sm-index.mjs for per-entry diff
  await writeFile(join(OUT_DIR, '_entries.json'), JSON.stringify(allListEntries), 'utf8');

  return { written, maxShardSize, featureCount };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const features = await fetchAllFeatures();

  console.log('Building geohash6 index…');
  const index = buildIndex(features);

  console.log(`Writing ${index.size} shard files to ${OUT_DIR}…`);
  const { written, maxShardSize, featureCount } = await writeIndex(index, features);

  console.log('');
  console.log('Done.');
  console.log(`  Total features : ${features.length}`);
  console.log(`  Cells with SMs : ${written}`);
  console.log(`  Max shard size : ${maxShardSize} entries`);
  console.log(`  Output dir     : ${OUT_DIR}`);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
