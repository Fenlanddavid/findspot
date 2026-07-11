/**
 * build-sm-index.mjs
 *
 * Fetches all Scheduled Monuments from the NHLE ArcGIS FeatureServer/6,
 * Cadw Scheduled Ancient Monument polygons from DataMapWales WFS, and
 * Historic Environment Scotland Scheduled Monuments from HES ArcGIS
 * MapServer/5, buckets them by geohash6 cell, and writes a sparse shard-per-cell index
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
 *
 * Designated Historic Asset GIS Data, The Welsh Historic Environment Service
 * (Cadw), fetch date recorded in _meta.json builtAt, licensed under the Open
 * Government Licence v3.0.
 *
 * HES Scheduled Monuments verified against MapServer/5 on 2026-07-11.
 * Field mapping: listEntry ← DES_REF, name ← DES_TITLE. Sample: SM5755
 * "Windy Mains,enclosures 600m SE of". Portal Terms and Conditions
 * "Spatial Downloads" checked 2026-07-11: spatial downloads except Historic
 * Landuse Assessment are OGL v3. Attribution:
 * Contains Historic Environment Scotland and OS data © Historic Environment
 * Scotland and Crown Copyright and [database right] (year), licensed under the
 * Open Government Licence v3.0. Service fetch uses the same Scheduled
 * Monuments dataset; sam_scotland.zip is the documented spatial-download
 * alternative if a future audit requires download-only ingestion.
 */

import { mkdir, rm, writeFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR   = join(__dirname, 'out', 'sm-index');

const FEATURE_SERVER =
  'https://services-eu1.arcgis.com/ZOdPfBS3aqqDYPUQ/arcgis/rest/services/' +
  'National_Heritage_List_for_England_NHLE_v02_VIEW/FeatureServer/6/query';

// DataMapWales GeoServer WFS returns GeoJSON in lon/lat order when requested
// with srsName=EPSG:4326. Verified against Cadw_SAM.1 / CN395 on 2026-07-09.
const WALES_SOURCE = 'https://datamap.gov.wales/geoserver/inspire-wg/ows';

const SCOTLAND_SOURCE =
  'https://inspire.hes.scot/arcgis/rest/services/HES/' +
  'HES_Designations/MapServer/5/query';

const PAGE_SIZE = 1000;
const SCOTLAND_PAGE_SIZE = 100;
const SCOTLAND_EXPECTED_MIN = 7500;

function hesAttribution(year = new Date().getUTCFullYear()) {
  return `Contains Historic Environment Scotland and OS data © Historic Environment Scotland and Crown Copyright and [database right] ${year}, licensed under the Open Government Licence v3.0`;
}

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

// ── Source fetchers ───────────────────────────────────────────────────────────

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
async function fetchAllEnglandFeatures() {
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

/**
 * Fetch a single Cadw WFS page. Field mapping:
 *   listEntry ← SAMNumber
 *   name      ← Name
 *
 * @param {number} startIndex
 * @returns {Promise<{features: object[], totalFeatures: number|null}>}
 */
async function fetchWalesPage(startIndex) {
  const params = new URLSearchParams({
    service:      'WFS',
    version:      '2.0.0',
    request:      'GetFeature',
    typeNames:    'inspire-wg:Cadw_SAM',
    outputFormat: 'application/json',
    srsName:      'EPSG:4326',
    count:        String(PAGE_SIZE),
    startIndex:   String(startIndex),
  });

  const url = `${WALES_SOURCE}?${params}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'FindSpot-SM-Index-Builder/1.0' },
  });

  if (!res.ok) {
    throw new Error(`Cadw WFS returned ${res.status} at startIndex ${startIndex}`);
  }

  const data = await res.json();
  if (data.exceptions || data.ExceptionReport) {
    throw new Error(`Cadw WFS error: ${JSON.stringify(data.exceptions ?? data.ExceptionReport)}`);
  }

  return {
    features: Array.isArray(data.features) ? data.features : [],
    totalFeatures: Number.isFinite(data.totalFeatures) ? data.totalFeatures : null,
  };
}

/**
 * Fetch ALL Cadw SAM features from DataMapWales WFS using pagination.
 * @returns {Promise<object[]>}
 */
async function fetchAllWalesFeatures() {
  const all = [];
  let startIndex = 0;
  let totalFeatures = null;

  console.log('Fetching Cadw Scheduled Ancient Monuments from DataMapWales WFS…');

  while (true) {
    const page = await fetchWalesPage(startIndex);
    if (totalFeatures === null && page.totalFeatures !== null) {
      totalFeatures = page.totalFeatures;
    }
    if (page.features.length === 0) break;

    all.push(...page.features);
    console.log(`  …fetched ${all.length} Cadw features so far`);

    if (page.features.length < PAGE_SIZE) break;
    if (totalFeatures !== null && all.length >= totalFeatures) break;
    startIndex += PAGE_SIZE;
  }

  console.log(`Total Cadw features fetched: ${all.length}`);
  return all;
}

async function fetchScotlandCount() {
  const params = new URLSearchParams({
    where: '1=1',
    returnCountOnly: 'true',
    f: 'json',
  });

  const res = await fetch(`${SCOTLAND_SOURCE}?${params}`, {
    headers: { 'User-Agent': 'FindSpot-SM-Index-Builder/1.0' },
  });
  if (!res.ok) throw new Error(`HES count query returned ${res.status}`);

  const data = await res.json();
  if (data.error) throw new Error(`HES count query error: ${JSON.stringify(data.error)}`);
  if (!Number.isFinite(data.count)) throw new Error('HES count query did not return a numeric count');
  return data.count;
}

async function fetchScotlandObjectIds() {
  const params = new URLSearchParams({
    where: '1=1',
    returnIdsOnly: 'true',
    f: 'json',
  });

  const res = await fetch(`${SCOTLAND_SOURCE}?${params}`, {
    headers: { 'User-Agent': 'FindSpot-SM-Index-Builder/1.0' },
  });
  if (!res.ok) throw new Error(`HES objectIds query returned ${res.status}`);

  const data = await res.json();
  if (data.error) throw new Error(`HES objectIds query error: ${JSON.stringify(data.error)}`);
  if (data.objectIdFieldName !== 'FID') {
    throw new Error(`Unexpected HES objectIdFieldName: ${data.objectIdFieldName}`);
  }
  if (!Array.isArray(data.objectIds)) throw new Error('HES objectIds query did not return objectIds');
  return data.objectIds.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
}

async function fetchScotlandObjectIdChunk(objectIds) {
  const params = new URLSearchParams({
    objectIds: objectIds.join(','),
    outFields: 'DES_REF,DES_TITLE,FID',
    returnGeometry: 'true',
    f: 'geojson',
    outSR: '4326',
  });

  const res = await fetch(`${SCOTLAND_SOURCE}?${params}`, {
    headers: { 'User-Agent': 'FindSpot-SM-Index-Builder/1.0' },
  });
  if (!res.ok) throw new Error(`HES feature query returned ${res.status}`);

  const data = await res.json();
  if (data.error) throw new Error(`HES feature query error: ${JSON.stringify(data.error)}`);
  return Array.isArray(data.features) ? data.features : [];
}

/**
 * Fetch ALL HES Scheduled Monument features from ArcGIS MapServer/5.
 * The layer does not support resultOffset pagination, so this uses
 * returnIdsOnly followed by objectIds chunks and verifies exact completeness.
 * @returns {Promise<object[]>}
 */
async function fetchAllScotlandFeatures() {
  console.log('Fetching HES Scheduled Monuments from MapServer/5…');

  const expectedCount = await fetchScotlandCount();
  if (expectedCount < SCOTLAND_EXPECTED_MIN) {
    throw new Error(`HES count ${expectedCount} is below sanity floor ${SCOTLAND_EXPECTED_MIN}`);
  }

  const objectIds = await fetchScotlandObjectIds();
  if (objectIds.length !== expectedCount) {
    throw new Error(`HES objectIds count ${objectIds.length} did not match count query ${expectedCount}`);
  }

  const all = [];
  for (let i = 0; i < objectIds.length; i += SCOTLAND_PAGE_SIZE) {
    const chunkIds = objectIds.slice(i, i + SCOTLAND_PAGE_SIZE);
    const features = await fetchScotlandObjectIdChunk(chunkIds);
    all.push(...features);
    console.log(`  …fetched ${all.length} HES features so far`);
  }

  if (all.length !== expectedCount) {
    throw new Error(`HES fetched feature count ${all.length} did not match count query ${expectedCount}`);
  }

  console.log(`Total HES features fetched: ${all.length}`);
  return all;
}

// ── Index builder ─────────────────────────────────────────────────────────────

/**
 * Build the sharded index from source-grouped GeoJSON features.
 *
 * @param {Array<{source:'NHLE'|'Cadw'|'HES', features: object[]}>} sourceGroups
 * @returns {{index: Map<string, Array<{listEntry:string, name:string, bbox:[number,number,number,number], geometry:object}>>, allListEntries: string[], skipped: number, cadwDigitIds: number, hesDigitIds: number}}
 */
function buildIndex(sourceGroups) {
  // cell → Map<source:listEntry, entry>  (deduplicate within source only)
  const cellMap = new Map();
  const allListEntries = [];
  let   skipped = 0;
  let   cadwDigitIds = 0;
  let   hesDigitIds = 0;

  for (const { source, features } of sourceGroups) {
    for (const feature of features) {
      const props = feature.properties ?? {};
      const listEntry = String(source === 'Cadw'
        ? props.SAMNumber ?? ''
        : source === 'HES'
          ? props.DES_REF ?? ''
          : props.ListEntry ?? '').trim();
      const name = String(source === 'HES' ? props.DES_TITLE ?? '' : props.Name ?? '').trim();

      if (!listEntry || !name) { skipped++; continue; }
      if (source === 'Cadw' && /^\d/.test(listEntry)) cadwDigitIds++;
      if (source === 'HES' && /^\d+$/.test(listEntry)) hesDigitIds++;

      const bbox = bboxFromGeometry(feature.geometry);
      if (!bbox) { skipped++; continue; }

      allListEntries.push(listEntry);
      const cells = geohash6CellsForBbox(bbox);

      for (const cell of cells) {
        if (!cellMap.has(cell)) cellMap.set(cell, new Map());
        const cellEntries = cellMap.get(cell);
        const dedupeKey = `${source}:${listEntry}`;
        if (!cellEntries.has(dedupeKey)) {
          cellEntries.set(dedupeKey, { listEntry, name, bbox, geometry: feature.geometry });
        }
      }
    }
  }

  if (skipped > 0) {
    console.log(`  Skipped ${skipped} features (missing identifier, name, or geometry)`);
  }
  if (cadwDigitIds > 0) {
    console.log(`  Warning: ${cadwDigitIds} Cadw identifiers start with a digit`);
  }
  if (hesDigitIds > 0) {
    console.log(`  Warning: ${hesDigitIds} HES identifiers are bare digits and may collide with NHLE ListEntry values`);
  }

  // Convert inner Maps to arrays
  const index = new Map();
  for (const [cell, entries] of cellMap) {
    index.set(cell, Array.from(entries.values()));
  }

  return {
    index,
    allListEntries: [...new Set(allListEntries)],
    skipped,
    cadwDigitIds,
    hesDigitIds,
  };
}

// ── Writer ────────────────────────────────────────────────────────────────────

async function writeIndex(index, allListEntries, counts) {
  await rm(OUT_DIR, { recursive: true, force: true });
  await mkdir(OUT_DIR, { recursive: true });

  let maxShardSize = 0;
  let written = 0;

  for (const [cell, entries] of index) {
    const filePath = join(OUT_DIR, `${cell}.json`);
    await writeFile(filePath, JSON.stringify(entries), 'utf8');
    if (entries.length > maxShardSize) maxShardSize = entries.length;
    written++;
  }

  const builtAt = new Date();
  const featureCount = counts.englandFeatureCount + counts.walesFeatureCount + counts.scotlandFeatureCount;

  const meta = {
    builtAt:      builtAt.toISOString(),
    schemaVersion: 2,
    geometryMode: 'full-geojson',
    featureCount,
    englandFeatureCount: counts.englandFeatureCount,
    walesFeatureCount:   counts.walesFeatureCount,
    scotlandFeatureCount: counts.scotlandFeatureCount,
    coverage:     ['england', 'wales', 'scotland'],
    cellCount:    index.size,
    source:       'NHLE FeatureServer/6 live + Cadw DataMapWales WFS live + HES MapServer/5 live',
    sources: [
      { name: 'NHLE', licence: 'CC BY 4.0' },
      { name: 'Cadw', licence: 'OGL v3' },
      { name: 'HES', licence: 'OGL v3', attribution: hesAttribution(builtAt.getUTCFullYear()) },
    ],
  };

  await writeFile(join(OUT_DIR, '_meta.json'),    JSON.stringify(meta, null, 2), 'utf8');
  // _entries.json used by diff-sm-index.mjs for per-entry diff
  await writeFile(join(OUT_DIR, '_entries.json'), JSON.stringify(allListEntries), 'utf8');

  return { written, maxShardSize, featureCount };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const englandFeatures = await fetchAllEnglandFeatures();
  const walesFeatures = await fetchAllWalesFeatures();
  const scotlandFeatures = await fetchAllScotlandFeatures();

  console.log('Building geohash6 index…');
  const { index, allListEntries } = buildIndex([
    { source: 'NHLE', features: englandFeatures },
    { source: 'Cadw', features: walesFeatures },
    { source: 'HES', features: scotlandFeatures },
  ]);

  console.log(`Writing ${index.size} shard files to ${OUT_DIR}…`);
  const { written, maxShardSize } = await writeIndex(index, allListEntries, {
    englandFeatureCount: englandFeatures.length,
    walesFeatureCount: walesFeatures.length,
    scotlandFeatureCount: scotlandFeatures.length,
  });

  console.log('');
  console.log('Done.');
  console.log(`  England features : ${englandFeatures.length}`);
  console.log(`  Wales features   : ${walesFeatures.length}`);
  console.log(`  Scotland features: ${scotlandFeatures.length}`);
  console.log(`  Total features   : ${englandFeatures.length + walesFeatures.length + scotlandFeatures.length}`);
  console.log(`  Cells with SMs : ${written}`);
  console.log(`  Max shard size : ${maxShardSize} entries`);
  console.log(`  Output dir     : ${OUT_DIR}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => {
    console.error('FATAL:', err);
    process.exit(1);
  });
}

export {
  bboxFromGeometry,
  buildIndex,
  fetchAllScotlandFeatures,
  geohash6CellsForBbox,
  hesAttribution,
  writeIndex,
};
