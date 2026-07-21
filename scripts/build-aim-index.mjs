/**
 * build-aim-index.mjs
 *
 * Fetches all HE AIM (Aerial Investigation and Mapping) features from the
 * ArcGIS FeatureServer/0, buckets them by geohash6 cell, and writes a sparse
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

import { mkdir, rm, writeFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR   = join(__dirname, 'out', 'aim-index');

const FEATURE_SERVER =
    'https://services-eu1.arcgis.com/ZOdPfBS3aqqDYPUQ/arcgis/rest/services/' +
    'HE_AIM_data/FeatureServer/0/query';

const PAGE_SIZE = 2000;
const FETCH_CONCURRENCY = 4;
const MAX_FETCH_ATTEMPTS = 3;
const FETCH_TIMEOUT_MS = 60_000;

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

async function fetchJson(params, label) {
    for (let attempt = 1; attempt <= MAX_FETCH_ATTEMPTS; attempt++) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
        try {
            const res = await fetch(FEATURE_SERVER, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: params,
                signal: controller.signal,
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            if (data?.error) {
                const detail = data.error.details?.filter(Boolean).join('; ')
                    || data.error.message
                    || 'Unknown ArcGIS error';
                throw new Error(detail);
            }
            return data;
        } catch (error) {
            if (attempt === MAX_FETCH_ATTEMPTS) {
                throw new Error(`FeatureServer/0 ${label} failed: ${error.message}`);
            }
            await new Promise(resolve => setTimeout(resolve, attempt * 1000));
        } finally {
            clearTimeout(timeout);
        }
    }
}

async function fetchAllFeatures(onPage) {
    const idParams = new URLSearchParams({
        where: '1=1',
        returnIdsOnly: 'true',
        f: 'json',
    });
    const idData = await fetchJson(idParams, 'object ID query');
    const objectIds = [...(idData.objectIds ?? [])].sort((a, b) => a - b);
    if (objectIds.length === 0) {
        throw new Error('FeatureServer/0 returned no object IDs');
    }

    console.log(`Source contains ${objectIds.length} AIM features`);
    const chunks = [];
    for (let i = 0; i < objectIds.length; i += PAGE_SIZE) {
        chunks.push(objectIds.slice(i, i + PAGE_SIZE));
    }

    let nextPage = 0;
    let fetched = 0;

    async function fetchFeatureChunk(ids, label) {
        const params = new URLSearchParams({
            objectIds: ids.join(','),
            outSR: '4326',
            f: 'geojson',
            outFields: 'OBJECTID,MONUMENT_TYPE,PERIOD,EVIDENCE_1',
            orderByFields: 'OBJECTID',
            returnGeometry: 'true',
        });
        try {
            const data = await fetchJson(params, label);
            const page = data.features;
            if (!Array.isArray(page) || page.length !== ids.length) {
                throw new Error(
                    `${label} returned ${page?.length ?? 'invalid'} features; expected ${ids.length}`,
                );
            }
            onPage(page);
            return page.length;
        } catch (error) {
            if (ids.length <= 100) throw error;
            const midpoint = Math.ceil(ids.length / 2);
            console.warn(`  … ${label} was too large; retrying as smaller verified chunks`);
            const first = await fetchFeatureChunk(ids.slice(0, midpoint), `${label}a`);
            const second = await fetchFeatureChunk(ids.slice(midpoint), `${label}b`);
            return first + second;
        }
    }

    async function worker() {
        while (true) {
            const pageIndex = nextPage++;
            if (pageIndex >= chunks.length) return;
            const ids = chunks[pageIndex];
            const pageCount = await fetchFeatureChunk(ids, `page ${pageIndex + 1}/${chunks.length}`);
            fetched += pageCount;
            if (fetched % 10000 < PAGE_SIZE) {
                console.log(`  … fetched ${fetched} AIM features so far`);
            }
        }
    }

    await Promise.all(Array.from({ length: FETCH_CONCURRENCY }, () => worker()));
    return objectIds.length;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
    console.log('Building AIM index from live FeatureServer/0…');

    // Build shard map: cell → array of entries
    const shards = new Map(); // cell → SMShardEntry[]
    const featureCount = await fetchAllFeatures((features) => {
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
    });
    console.log(`Fetched ${featureCount} AIM features`);

    // Publish a clean local generation only after the complete live source has
    // been fetched. This preserves the previous artifacts on fetch failure and
    // prevents removed cells from leaking into the next bundle generation.
    await rm(OUT_DIR, { recursive: true, force: true });
    await mkdir(OUT_DIR, { recursive: true });

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
        generationVersion: 'v2',
        schemaVersion: 1,
        builtAt:      new Date().toISOString(),
        featureCount,
        cellCount:    shards.size,
        maxShardSize,
        source:       'FeatureServer/0 live',
    };
    await writeFile(join(OUT_DIR, '_meta.json'), JSON.stringify(meta, null, 2));

    console.log(`Done. ${featureCount} features → ${written} cells`);
    console.log(`Max shard size: ${maxShardSize} entries`);
    console.log(`Output: ${OUT_DIR}`);
}

main().catch(e => { console.error(e); process.exit(1); });
