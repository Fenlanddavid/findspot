// ─── Offline Pack service (W3) ────────────────────────────────────────────────
// Durably caches all scan-layer tiles and static designation shards for a
// permission or saved point so a full FieldGuide scan runs with no signal.
//
// Architecture:
//   - Pack data lives in Cache Storage (NOT Dexie). It is regenerable public
//     data — not user data — and stays out of export/import.
//   - Each pack has a unique named cache: findspot-pack:{ownerType}:{ownerId}:...
//   - Pack metadata is stored as a synthetic Response at key `${CACHE_NAME}#meta`
//     within the pack's own cache.
//   - cachedFetch() (src/utils/cachedFetch.ts) is the read path: scan code
//     calls cachedFetch(url, CACHE_NAME) and gets the cached tile if present.

import { db, Permission, SavedPoint } from '../db';
import { resolveWaybackIds, waybackTileUrl, WaybackIds } from '../utils/waybackService';
import { SCAN_CONFIG } from '../utils/scanConfig';
import { FINDSPOT_STATIC_BASE_URL } from '../utils/featureFlags';
import { bboxToGeohash6Cells } from '../utils/geohashUtils';
import { LayerFetchStatus } from '../pages/fieldGuideTypes';
import type { NHLEFeature, NHLEGeometry } from './historicScanService';
import { romanRoadsAssetUrl } from './romanRoadService';

// ─── Constants ────────────────────────────────────────────────────────────────

const ZOOM = SCAN_CONFIG.TERRAIN_ZOOM; // 16
/** Maximum tile count before requiring explicit confirmation (permissions only). */
export const PACK_TILE_CAP = 2000;
/** Approximate bytes per tile (terrain tiles compress well; satellite less so). */
const BYTES_PER_TILE_EST = 25_000;
/** AIM index shards: if total aim-index is within this budget, cache whole set. */
const AIM_PACK_MAX_SHARDS = 500;
/** Tile URLs per cell before optional Wayback imagery. Must match tileUrlsForCell(). */
const BASE_TILE_URLS_PER_CELL = 7;
/** Staleness threshold in ms — 90 days. */
export const PACK_STALE_MS = 90 * 24 * 60 * 60 * 1000;
const DESIGNATION_BBOX_PAD_M = 50;
const PERMISSION_SCAN_TILE_MARGIN = 1;
const NHLE_FEATURE_SERVER =
    'https://services-eu1.arcgis.com/ZOdPfBS3aqqDYPUQ/arcgis/rest/services/' +
    'National_Heritage_List_for_England_NHLE_v02_VIEW/FeatureServer/6/query';

// ─── Types ────────────────────────────────────────────────────────────────────

export type PackOwner =
    | { ownerType: 'permission'; ownerId: string }
    | { ownerType: 'savedPoint'; ownerId: string };

export type PackMeta = {
    ownerType: 'permission' | 'savedPoint';
    ownerId: string;
    projectId: string;
    bbox: [number, number, number, number]; // [west, south, east, north]
    zoom: number;
    createdAt: string;
    sizeBytesApprox: number;
    waybackIds: WaybackIds | null;
    /** Per-layer cache status recorded at build time. */
    layers: Record<string, LayerFetchStatus>;
    cacheName: string;
};

export type PackCoverage = {
    covered: number;
    total: number;
    full: boolean;
};

export type PackMatch = {
    meta: PackMeta;
    coverage: PackCoverage;
};

// ─── Cache key helpers ────────────────────────────────────────────────────────

function bboxKey(bbox: [number, number, number, number]): string {
    return bbox.map(v => v.toFixed(6)).join(',');
}

export function packCacheName(owner: PackOwner, bbox: [number, number, number, number]): string {
    return `findspot-pack:${owner.ownerType}:${owner.ownerId}:${bboxKey(bbox)}:${ZOOM}`;
}

// Cache Storage only accepts http(s) URLs — use a synthetic local URL for meta.
function metaUrl(cacheName: string): string {
    return `https://findspot-local/pack-meta/${encodeURIComponent(cacheName)}`;
}

// ─── Tile coordinate helpers ──────────────────────────────────────────────────

function lon2tileFloat(lon: number, zoom: number): number {
    return (lon + 180) / 360 * Math.pow(2, zoom);
}

function lat2tileFloat(lat: number, zoom: number): number {
    const rad = lat * Math.PI / 180;
    return (1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2 * Math.pow(2, zoom);
}

/** Enumerate all [tx, ty] tile coords covering a bbox at the given zoom. */
function bboxTiles(bbox: [number, number, number, number], zoom: number): Array<[number, number]> {
    const [west, south, east, north] = bbox;
    const txMin = Math.floor(lon2tileFloat(west, zoom));
    const txMax = Math.max(txMin, Math.ceil(lon2tileFloat(east, zoom)) - 1);
    const tyMin = Math.floor(lat2tileFloat(north, zoom)); // note: ty increases southward
    const tyMax = Math.max(tyMin, Math.ceil(lat2tileFloat(south, zoom)) - 1);
    const tiles: Array<[number, number]> = [];
    for (let ty = tyMin; ty <= tyMax; ty++) {
        for (let tx = txMin; tx <= txMax; tx++) {
            tiles.push([tx, ty]);
        }
    }
    return tiles;
}

function tileKey(tx: number, ty: number): string {
    return `${tx}:${ty}`;
}

function tile2lon(tx: number, zoom: number) {
    return tx / Math.pow(2, zoom) * 360 - 180;
}

function tile2lat(ty: number, zoom: number) {
    const n2 = Math.PI - 2 * Math.PI * ty / Math.pow(2, zoom);
    return 180 / Math.PI * Math.atan(0.5 * (Math.exp(n2) - Math.exp(-n2)));
}

function expandBboxByTileMargin(
    bbox: [number, number, number, number],
    zoom: number,
    marginTiles: number,
): [number, number, number, number] {
    const tiles = bboxTiles(bbox, zoom);
    if (!tiles.length) return bbox;
    const xs = tiles.map(([tx]) => tx);
    const ys = tiles.map(([, ty]) => ty);
    const txMin = Math.min(...xs) - marginTiles;
    const txMax = Math.max(...xs) + marginTiles;
    const tyMin = Math.min(...ys) - marginTiles;
    const tyMax = Math.max(...ys) + marginTiles;
    return [
        tile2lon(txMin, zoom),
        tile2lat(tyMax + 1, zoom),
        tile2lon(txMax + 1, zoom),
        tile2lat(tyMin, zoom),
    ];
}

function packCoverageForBboxTiles(
    packBbox: [number, number, number, number],
    queryBbox: [number, number, number, number],
    zoom: number,
): PackCoverage {
    const packTiles = new Set(bboxTiles(packBbox, zoom).map(([tx, ty]) => tileKey(tx, ty)));
    const queryTiles = bboxTiles(queryBbox, zoom);
    const covered = queryTiles.filter(([tx, ty]) => packTiles.has(tileKey(tx, ty))).length;
    return { covered, total: queryTiles.length, full: queryTiles.length > 0 && covered === queryTiles.length };
}

function padBboxByMetres(
    bbox: [number, number, number, number],
    metres: number,
): [number, number, number, number] {
    const [west, south, east, north] = bbox;
    const centerLat = (south + north) / 2;
    const latPad = metres / 111_320;
    const cosLat = Math.max(0.2, Math.abs(Math.cos(centerLat * Math.PI / 180)));
    const lonPad = metres / (111_320 * cosLat);
    return [west - lonPad, south - latPad, east + lonPad, north + latPad];
}

/** Tile URLs for a single tile cell. Mirrors useTilePrewarm.ts tile sources. */
function tileUrlsForCell(tx: number, ty: number, zoom: number, waybackIds: WaybackIds | null): string[] {
    const urls = [
        `https://services.arcgis.com/JJT1S6cy9mS999Xy/arcgis/rest/services/LIDAR_Composite_1m_DTM_2025_Hillshade/MapServer/tile/${zoom}/${ty}/${tx}`,
        `https://services.arcgis.com/JJT1S6cy9mS999Xy/arcgis/rest/services/LIDAR_Composite_1m_DTM_2022_Multi_Directional_Hillshade/MapServer/tile/${zoom}/${ty}/${tx}`,
        `https://environment.data.gov.uk/image/rest/services/SURVEY/LIDAR_Composite_DTM_1m_2022_Slope/ImageServer/tile/${zoom}/${ty}/${tx}`,
        `https://services.arcgisonline.com/arcgis/rest/services/Elevation/World_Hillshade/MapServer/tile/${zoom}/${ty}/${tx}`,
        `https://services.arcgisonline.com/arcgis/rest/services/Elevation/World_Hillshade_Dark/MapServer/tile/${zoom}/${ty}/${tx}`,
        `https://services.arcgisonline.com/arcgis/rest/services/World_Shaded_Relief/MapServer/tile/${zoom}/${ty}/${tx}`,
    ];
    if (waybackIds) {
        urls.push(
            waybackTileUrl(waybackIds.spring, zoom, ty, tx),
            waybackTileUrl(waybackIds.summer, zoom, ty, tx),
        );
    }
    urls.push(`https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${zoom}/${ty}/${tx}`);
    return urls;
}

// ─── Scheduled Monument shard helpers ────────────────────────────────────────

type SMShardEntry = {
    listEntry: string;
    name: string;
    bbox: [number, number, number, number];
    geometry: NHLEGeometry;
};

function flatGeometryCoordinates(geometry: NHLEGeometry): Array<[number, number]> {
    if (geometry.type === 'Point') return [geometry.coordinates as [number, number]];
    if (geometry.type === 'Polygon') return (geometry.coordinates as number[][][]).flat() as Array<[number, number]>;
    return (geometry.coordinates as number[][][][]).flat(2) as Array<[number, number]>;
}

function bboxFromNHLEGeometry(geometry: NHLEGeometry): [number, number, number, number] | null {
    const coords = flatGeometryCoordinates(geometry);
    if (!coords.length) return null;
    const lons = coords.map(c => c[0]);
    const lats = coords.map(c => c[1]);
    return [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)];
}

function isValidSMShardEntry(entry: unknown): entry is SMShardEntry {
    const candidate = entry as Partial<SMShardEntry>;
    return typeof candidate?.listEntry === 'string' &&
        typeof candidate.name === 'string' &&
        Array.isArray(candidate.bbox) &&
        candidate.bbox.length === 4 &&
        !!candidate.geometry &&
        (candidate.geometry.type === 'Point' || candidate.geometry.type === 'Polygon' || candidate.geometry.type === 'MultiPolygon');
}

async function cacheSMIndexFromR2(cache: Cache, cells: string[]): Promise<boolean> {
    const metaUrl = `${FINDSPOT_STATIC_BASE_URL}/sm-index/_meta.json`;
    const metaRes = await fetch(metaUrl);
    if (!metaRes.ok) return false;
    const meta = await metaRes.clone().json().catch(() => null);
    if (!meta || meta.schemaVersion !== 2 || meta.geometryMode !== 'full-geojson') return false;
    await cache.put(metaUrl, metaRes);

    let ok = 0;
    for (const cell of cells) {
        const url = `${FINDSPOT_STATIC_BASE_URL}/sm-index/${cell}.json`;
        try {
            const res = await fetch(url);
            if (!res.ok) continue;
            const entries = await res.json();
            if (!Array.isArray(entries) || !entries.every(isValidSMShardEntry)) continue;
            await cache.put(url, new Response(JSON.stringify(entries), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            }));
            ok++;
        } catch { /* try live fallback below */ }
    }
    return ok === cells.length;
}

async function fetchLiveScheduledMonumentsForBbox(
    bbox: [number, number, number, number],
): Promise<NHLEFeature[]> {
    const [west, south, east, north] = bbox;
    const url = `${NHLE_FEATURE_SERVER}?where=1%3D1&geometry=${west},${south},${east},${north}&geometryType=esriGeometryEnvelope&spatialRel=esriSpatialRelIntersects&inSR=4326&outSR=4326&f=geojson&outFields=Name,ListEntry`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`NHLE live HTTP ${res.status}`);
    const data = await res.json();
    return Array.isArray(data.features) ? data.features as NHLEFeature[] : [];
}

async function cacheSMIndexFromLive(
    cache: Cache,
    packBbox: [number, number, number, number],
    cells: string[],
): Promise<boolean> {
    try {
        const cellSet = new Set(cells);
        const shards = new Map<string, SMShardEntry[]>(cells.map(cell => [cell, []]));
        const features = await fetchLiveScheduledMonumentsForBbox(packBbox);

        for (const feature of features) {
            const listEntry = String(feature.properties?.ListEntry ?? '').trim();
            if (!listEntry || !feature.geometry) continue;
            const bbox = bboxFromNHLEGeometry(feature.geometry);
            if (!bbox) continue;

            const entry: SMShardEntry = {
                listEntry,
                name: String(feature.properties?.Name ?? '').trim(),
                bbox,
                geometry: feature.geometry,
            };

            for (const cell of bboxToGeohash6Cells(...bbox)) {
                if (!cellSet.has(cell)) continue;
                const entries = shards.get(cell);
                if (!entries || entries.some(existing => existing.listEntry === listEntry)) continue;
                entries.push(entry);
            }
        }

        await cache.put(`${FINDSPOT_STATIC_BASE_URL}/sm-index/_meta.json`, new Response(JSON.stringify({
            builtAt: new Date().toISOString(),
            schemaVersion: 2,
            geometryMode: 'full-geojson',
            featureCount: features.length,
            cellCount: cells.length,
            source: 'FeatureServer/6 live offline-pack fallback',
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        }));

        for (const [cell, entries] of shards) {
            await cache.put(`${FINDSPOT_STATIC_BASE_URL}/sm-index/${cell}.json`, new Response(JSON.stringify(entries), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            }));
        }

        return true;
    } catch {
        return false;
    }
}


// ─── Bbox resolution ──────────────────────────────────────────────────────────

/**
 * Resolve the pack bbox for an owner.
 *  - permission: bounding box of the boundary polygon
 *  - savedPoint: 3×3 tile footprint centred on the point at TERRAIN_ZOOM
 *    (same as the live scan viewport — NOT SavedPoint.zoom which is camera zoom)
 */
export async function resolveBbox(
    owner: PackOwner,
): Promise<{ bbox: [number, number, number, number]; projectId: string }> {
    if (owner.ownerType === 'permission') {
        const permission = await db.permissions.get(owner.ownerId);
        if (!permission) throw new Error(`Permission ${owner.ownerId} not found`);
        if (!permission.boundary) throw new Error(`Permission ${owner.ownerId} has no boundary`);
        const coords = permission.boundary.coordinates[0];
        const lons = coords.map(c => c[0]);
        const lats = coords.map(c => c[1]);
        const boundaryBbox: [number, number, number, number] = [
            Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats),
        ];
        return {
            bbox: expandBboxByTileMargin(boundaryBbox, ZOOM, PERMISSION_SCAN_TILE_MARGIN),
            projectId: permission.projectId,
        };
    } else {
        const sp = await db.savedPoints.get(owner.ownerId);
        if (!sp) throw new Error(`Saved point ${owner.ownerId} not found`);
        // 3×3 tile footprint centred on the point (same as live scan viewport)
        const n = Math.pow(2, ZOOM);
        const cX = (sp.lon + 180) / 360 * n;
        const cY = (1 - Math.log(Math.tan(sp.lat * Math.PI / 180) + 1 / Math.cos(sp.lat * Math.PI / 180)) / Math.PI) / 2 * n;
        const tX = Math.floor(cX) - 1;
        const tY = Math.floor(cY) - 1;
        // Convert the 3×3 tile grid back to a geographic bbox
        const west  = tile2lon(tX,     ZOOM);
        const east  = tile2lon(tX + 3, ZOOM);
        const north = tile2lat(tY,     ZOOM);
        const south = tile2lat(tY + 3, ZOOM);
        return { bbox: [west, south, east, north], projectId: sp.projectId };
    }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface PackEstimate {
    tileCount: number;
    estBytes: number;
}

/**
 * Estimate tile count and download size for a pack.
 * For saved points the footprint is always exactly 9 tiles.
 */
export async function estimatePack(owner: PackOwner): Promise<PackEstimate> {
    const { bbox } = await resolveBbox(owner);
    const tiles = bboxTiles(bbox, ZOOM);
    // Each tile cell has base terrain/fallback URLs plus up to 2 Wayback sources.
    const tileCount = tiles.length * (BASE_TILE_URLS_PER_CELL + 2);
    return { tileCount, estBytes: tileCount * BYTES_PER_TILE_EST };
}

/** Return metadata for an existing pack, or null if none built. */
export async function getPackMeta(owner: PackOwner): Promise<PackMeta | null> {
    if (typeof caches === 'undefined') return null;
    const { bbox } = await resolveBbox(owner);
    const cacheName = packCacheName(owner, bbox);
    if (!(await caches.has(cacheName))) {
        const metas = await listPacks();
        return metas
            .filter(meta => meta.ownerType === owner.ownerType && meta.ownerId === owner.ownerId)
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0] ?? null;
    }
    const cache = await caches.open(cacheName);
    const metaRes = await cache.match(metaUrl(cacheName));
    if (!metaRes) return null;
    try {
        return await metaRes.json() as PackMeta;
    } catch {
        return null;
    }
}

/** List all findspot packs across all owners. */
export async function listPacks(): Promise<PackMeta[]> {
    if (typeof caches === 'undefined') return [];
    const keys = await caches.keys();
    const packKeys = keys.filter(k => k.startsWith('findspot-pack:'));
    const metas: PackMeta[] = [];
    for (const key of packKeys) {
        const cache = await caches.open(key);
        const metaRes = await cache.match(metaUrl(key));
        if (metaRes) {
            try {
                metas.push(await metaRes.json() as PackMeta);
            } catch { /* corrupt meta — skip */ }
        }
    }
    return metas;
}

/**
 * Return the best prepared pack for a scan bbox, including partial overlaps.
 * Use this for designation reads where a partial cached shard can still draw a
 * monument. For terrain scans, use findPackCoveringBbox() so the full 3x3 tile
 * grid is known to be present before skipping live paths.
 */
export async function findPackMatchForBbox(
    bbox: [number, number, number, number],
    zoom = ZOOM,
): Promise<PackMatch | null> {
    const metas = await listPacks();
    return metas
        .map(meta => ({
            meta,
            coverage: meta.zoom === zoom &&
                (meta.layers.terrain === 'cached' || meta.layers.terrain === 'partial')
                ? packCoverageForBboxTiles(meta.bbox, bbox, zoom)
                : { covered: 0, total: 0, full: false },
        }))
        .filter(({ coverage }) => coverage.covered > 0)
        .sort((a, b) =>
            Number(b.coverage.full) - Number(a.coverage.full) ||
            b.coverage.covered - a.coverage.covered ||
            new Date(b.meta.createdAt).getTime() - new Date(a.meta.createdAt).getTime()
        )[0] ?? null;
}

/**
 * Return a prepared pack only when its downloaded tile cells cover the full scan
 * bbox. This is the safe signal for fast offline terrain scans.
 */
export async function findPackCoveringBbox(
    bbox: [number, number, number, number],
    zoom = ZOOM,
): Promise<PackMeta | null> {
    const match = await findPackMatchForBbox(bbox, zoom);
    return match?.coverage.full ? match.meta : null;
}

/** Delete a pack and all its cached tiles. */
export async function deletePack(owner: PackOwner): Promise<void> {
    if (typeof caches === 'undefined') return;
    const metas = await listPacks();
    await Promise.all(
        metas
            .filter(meta => meta.ownerType === owner.ownerType && meta.ownerId === owner.ownerId)
            .map(meta => caches.delete(meta.cacheName)),
    );
}

export type BuildProgress = {
    phase: 'tiles' | 'shards' | 'meta';
    done: number;
    total: number;
};

/**
 * Build an offline pack for the given owner.
 * Fetches and caches all terrain tiles + SM/AIM index shards for the bbox.
 * Records honest per-layer status — a mid-build failure is noted in meta,
 * not thrown as an uncaught error.
 *
 * @param owner      The pack owner (permission or savedPoint).
 * @param onProgress Optional progress callback.
 * @param force      If true, rebuild even if a pack already exists.
 */
export async function buildPack(
    owner: PackOwner,
    onProgress?: (p: BuildProgress) => void,
    force = false,
): Promise<PackMeta> {
    if (typeof caches === 'undefined') {
        throw new Error('Cache Storage is not available in this browser');
    }

    const { bbox, projectId } = await resolveBbox(owner);
    const cacheName = packCacheName(owner, bbox);

    if (force) {
        await deletePack(owner);
    } else {
        const existing = await getPackMeta(owner);
        if (existing) return existing;
    }

    const cache = await caches.open(cacheName);
    const layers: Record<string, LayerFetchStatus> = {};

    // Request persistent storage before writing
    if (navigator.storage?.persist) {
        await navigator.storage.persist().catch(() => {});
    }

    // 1 — Resolve Wayback IDs (stored in meta so staleness is detectable)
    const waybackIds = await resolveWaybackIds().catch(() => null);

    // 2 — Enumerate tiles
    const tiles = bboxTiles(bbox, ZOOM);

    // 3 — Fetch + cache terrain tiles
    let tilesDone = 0;
    let tilesOk = 0;
    let tilesFailed = 0;
    const allTileUrls: string[] = [];
    for (const [tx, ty] of tiles) {
        for (const url of tileUrlsForCell(tx, ty, ZOOM, waybackIds)) {
            allTileUrls.push(url);
        }
    }
    const totalTiles = allTileUrls.length;

    for (const url of allTileUrls) {
        onProgress?.({ phase: 'tiles', done: tilesDone, total: totalTiles });
        try {
            const res = await fetch(url);
            if (res.ok) {
                await cache.put(url, res);
                tilesOk++;
            } else {
                tilesFailed++;
            }
        } catch (e) {
            if (e instanceof DOMException && e.name === 'QuotaExceededError') {
                // Stop gracefully — record partial, don't crash
                layers['terrain'] = 'partial';
                layers['satellite'] = 'partial';
                await _writeMeta(cache, cacheName, owner, projectId, bbox, waybackIds, layers, tilesOk * BYTES_PER_TILE_EST);
                throw Object.assign(new Error('Storage quota exceeded — partial pack saved'), { isQuotaError: true });
            }
            tilesFailed++;
        }
        tilesDone++;
    }

    if (tilesFailed === 0) {
        layers['terrain'] = 'cached';
        layers['satellite'] = 'cached';
    } else if (tilesOk > 0) {
        layers['terrain'] = 'partial';
        layers['satellite'] = 'partial';
    } else {
        layers['terrain'] = 'unavailable';
        layers['satellite'] = 'unavailable';
    }

    // 4 — Cache SM index shards for the bbox
    onProgress?.({ phase: 'shards', done: 0, total: 1 });

    const designationBbox = padBboxByMetres(bbox, DESIGNATION_BBOX_PAD_M);
    const smCells = bboxToGeohash6Cells(...designationBbox);
    const smCachedFromR2 = await cacheSMIndexFromR2(cache, smCells).catch(() => false);
    const smCachedFromLive = smCachedFromR2 ? false : await cacheSMIndexFromLive(cache, designationBbox, smCells);
    layers['sm'] = smCachedFromR2 || smCachedFromLive ? 'cached' : 'unavailable';

    // 5 — Cache AIM index shards for the bbox (same geohash cells as SM)
    const aimCells = smCells;
    let aimOk = 0;
    if (aimCells.length <= AIM_PACK_MAX_SHARDS) {
        for (const cell of aimCells) {
            const url = `${FINDSPOT_STATIC_BASE_URL}/aim-index/${cell}.json`;
            try {
                const res = await fetch(url);
                if (res.status === 404) {
                    await cache.put(url, new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } }));
                    aimOk++;
                } else if (res.ok) {
                    await cache.put(url, res);
                    aimOk++;
                }
            } catch { /* unavailable */ }
        }
        layers['aim'] = aimOk === aimCells.length ? 'cached' : aimOk > 0 ? 'partial' : 'unavailable';
    } else {
        // Too many shards to cache inline — will fetch live on scan
        layers['aim'] = 'unavailable';
    }

    // 6 — Cache Roman roads in the pack as well as relying on SW precache.
    try {
        const url = romanRoadsAssetUrl();
        const res = await fetch(url);
        if (res.ok) {
            await cache.put(url, res);
            layers['romanRoads'] = 'cached';
        } else {
            layers['romanRoads'] = 'unavailable';
        }
    } catch {
        layers['romanRoads'] = 'unavailable';
    }

    onProgress?.({ phase: 'meta', done: 0, total: 1 });
    const sizeBytesApprox = tilesOk * BYTES_PER_TILE_EST;
    const meta = await _writeMeta(cache, cacheName, owner, projectId, bbox, waybackIds, layers, sizeBytesApprox);

    onProgress?.({ phase: 'meta', done: 1, total: 1 });
    return meta;
}

async function _writeMeta(
    cache: Cache,
    cacheName: string,
    owner: PackOwner,
    projectId: string,
    bbox: [number, number, number, number],
    waybackIds: WaybackIds | null,
    layers: Record<string, LayerFetchStatus>,
    sizeBytesApprox: number,
): Promise<PackMeta> {
    const meta: PackMeta = {
        ownerType: owner.ownerType,
        ownerId: owner.ownerId,
        projectId,
        bbox,
        zoom: ZOOM,
        createdAt: new Date().toISOString(),
        sizeBytesApprox,
        waybackIds,
        layers,
        cacheName,
    };
    await cache.put(
        metaUrl(cacheName),
        new Response(JSON.stringify(meta), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        }),
    );
    return meta;
}

/** Is this pack older than PACK_STALE_MS? */
export function isPackStale(meta: PackMeta): boolean {
    return Date.now() - new Date(meta.createdAt).getTime() > PACK_STALE_MS;
}
