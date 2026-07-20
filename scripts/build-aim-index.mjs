/**
 * build-aim-index.mjs
 *
 * Fetches all HE AIM (Aerial Investigation and Mapping) features from the
 * ArcGIS FeatureServer/1, buckets them by geohash6 cell, and writes a sparse
 * shard-per-cell index to scripts/out/aim-index/ — the same structure as the
 * SM index so the findspot-static worker can serve them identically.
 *
 * Requirements: Node 18+ (global fetch, fs/promises)
 *
 * Usage:
 *   node scripts/build-aim-index.mjs
 *
 * Output:
 *   scripts/out/aim-index/_meta.json
 *   scripts/out/aim-index/{geohash6}.json   (one per occupied cell)
 *
 * Attribution: © Historic England
 */

import { mkdir, writeFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR   = join(__dirname, 'out', 'aim-index');

const FEATURE_SERVER =
    'https://services-eu1.arcgis.com/ZOdPfBS3aqqDYPUQ/arcgis/rest/services/' +
    'HE_AIM_data/FeatureServer/1/query';

const PAGE_SIZE = 1000;

// ─── Geohash encoder (precision 6) ───────────────────────────────────────────

const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';

function geohashEncode(lat, lon, precision = 6) {
    let hash = '', minLat = -90, maxLat = 90, minLon = -180, maxLon = 180;
    let isEven = true, bits = 0, hashValue = 0;
    while (hash.length < precision) {
        if (isEven) {
            const mid = (minLon + maxLon) / 2;
            if (lon >= mid) { hashValue = (hashValue << 1) | 1; minLon = mid; }
            else            { hashValue = hashValue << 1;        maxLon = mid; }
        } else {
            const mid = (minLat + maxLat) / 2;
            if (lat >= mid) { hashValue = (hashValue << 1) | 1; minLat = mid; }
            else            { hashValue = hashValue << 1;        maxLat = mid; }
        }
        isEven = !isEven; bits++;
        if (bits === 5) { hash += BASE32[hashValue]; bits = 0; hashValue = 0; }
    }
    return hash;
}

// ─── Geometry bbox ────────────────────────────────────────────────────────────

function geomBbox(geometry) {
    if (!geometry) return null;
    const coords = flatCoords(geometry);
    if (!coords.length) return null;
    let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
    for (const [lon, lat] of coords) {
        if (lon < minLon) minLon = lon;
        if (lon > maxLon) maxLon = lon;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
    }
    return [minLon, minLat, maxLon, maxLat];
}

function flatCoords(geometry) {
    const { type, coordinates } = geometry;
    if (type === 'Point')           return [coordinates];
    if (type === 'MultiPoint' || type === 'LineString') return coordinates;
    if (type === 'MultiLineString') return coordinates.flat();
    if (type === 'Polygon')         return coordinates.flat();
    if (type === 'MultiPolygon')    return coordinates.flat(2);
    return [];
}

// ─── Cells covering a bbox ────────────────────────────────────────────────────

function bboxCells(west, south, east, north) {
    const STEP = 0.004;
    const cells = new Set();
    for (let lat = south; lat <= north + STEP; lat += STEP) {
        for (let lon = west; lon <= east + STEP; lon += STEP) {
            cells.add(geohashEncode(Math.min(lat, north), Math.min(lon, east)));
        }
    }
    return Array.from(cells);
}

// ─── Fetch all features ───────────────────────────────────────────────────────

async function fetchAllFeatures() {
    const features = [];
    let offset = 0;

    while (true) {
        const url = new URL(FEATURE_SERVER);
        url.searchParams.set('where', '1=1');
        url.searchParams.set('geometryType', 'esriGeometryEnvelope');
        url.searchParams.set('outSR', '4326');
        url.searchParams.set('f', 'geojson');
        url.searchParams.set('outFields', 'MONUMENT_TYPE,PERIOD,EVIDENCE_1');
        url.searchParams.set('resultOffset', String(offset));
        url.searchParams.set('resultRecordCount', String(PAGE_SIZE));

        const res = await fetch(url.toString());
        if (!res.ok) throw new Error(`FeatureServer/1 HTTP ${res.status} at offset ${offset}`);
        const data = await res.json();

        const page = data.features ?? [];
        features.push(...page);

        if (offset % 5000 === 0 && offset > 0) {
            console.log(`  … fetched ${features.length} AIM features so far`);
        }

        if (page.length < PAGE_SIZE) break;
        offset += PAGE_SIZE;
    }

    return features;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
    console.log('Building AIM index from live FeatureServer/1…');
    await mkdir(OUT_DIR, { recursive: true });

    const features = await fetchAllFeatures();
    console.log(`Fetched ${features.length} AIM features`);

    // Build shard map: cell → array of entries
    const shards = new Map(); // cell → SMShardEntry[]

    for (const feature of features) {
        const bbox = geomBbox(feature.geometry);
        if (!bbox) continue;

        const [west, south, east, north] = bbox;
        const cells = bboxCells(west, south, east, north);

        const entry = {
            monumentType: feature.properties?.MONUMENT_TYPE ?? '',
            period:       feature.properties?.PERIOD ?? '',
            evidence:     feature.properties?.EVIDENCE_1 ?? '',
            bbox:         [west, south, east, north],
        };

        for (const cell of cells) {
            if (!shards.has(cell)) shards.set(cell, []);
            shards.get(cell).push(entry);
        }
    }

    // Write shards
    let written = 0;
    let maxShardSize = 0;
    for (const [cell, entries] of shards) {
        const path = join(OUT_DIR, `${cell}.json`);
        await writeFile(path, JSON.stringify(entries));
        written++;
        if (entries.length > maxShardSize) maxShardSize = entries.length;
    }

    // Write meta
    const meta = {
        schemaVersion: 1,
        builtAt:      new Date().toISOString(),
        featureCount: features.length,
        cellCount:    shards.size,
        maxShardSize,
        source:       'FeatureServer/1 live',
    };
    await writeFile(join(OUT_DIR, '_meta.json'), JSON.stringify(meta, null, 2));

    console.log(`Done. ${features.length} features → ${written} cells`);
    console.log(`Max shard size: ${maxShardSize} entries`);
    console.log(`Output: ${OUT_DIR}`);
}

main().catch(e => { console.error(e); process.exit(1); });
