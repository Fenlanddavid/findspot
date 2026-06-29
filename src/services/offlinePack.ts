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

// ─── Constants ────────────────────────────────────────────────────────────────

const ZOOM = SCAN_CONFIG.TERRAIN_ZOOM; // 16
/** Maximum tile count before requiring explicit confirmation (permissions only). */
export const PACK_TILE_CAP = 2000;
/** Approximate bytes per tile (terrain tiles compress well; satellite less so). */
const BYTES_PER_TILE_EST = 25_000;
/** AIM index shards: if total aim-index is within this budget, cache whole set. */
const AIM_PACK_MAX_SHARDS = 500;
/** Tile sources per tile cell — must match useTilePrewarm.ts and terrainScanWorker.ts. */
const TILE_SOURCES_PER_CELL = 4; // DTM2025, DTM2022, Slope, WorldHillshade (+ 2 Wayback if available)
/** Staleness threshold in ms — 90 days. */
export const PACK_STALE_MS = 90 * 24 * 60 * 60 * 1000;

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

/** Tile URLs for a single tile cell. Mirrors useTilePrewarm.ts tile sources. */
function tileUrlsForCell(tx: number, ty: number, zoom: number, waybackIds: WaybackIds | null): string[] {
    const urls = [
        `https://services.arcgis.com/JJT1S6cy9mS999Xy/arcgis/rest/services/LIDAR_Composite_1m_DTM_2025_Hillshade/MapServer/tile/${zoom}/${ty}/${tx}`,
        `https://services.arcgis.com/JJT1S6cy9mS999Xy/arcgis/rest/services/LIDAR_Composite_1m_DTM_2022_Multi_Directional_Hillshade/MapServer/tile/${zoom}/${ty}/${tx}`,
        `https://environment.data.gov.uk/image/rest/services/SURVEY/LIDAR_Composite_DTM_1m_2022_Slope/ImageServer/tile/${zoom}/${ty}/${tx}`,
        `https://services.arcgisonline.com/arcgis/rest/services/Elevation/World_Hillshade/MapServer/tile/${zoom}/${ty}/${tx}`,
    ];
    if (waybackIds) {
        urls.push(
            waybackTileUrl(waybackIds.spring, zoom, ty, tx),
            waybackTileUrl(waybackIds.summer, zoom, ty, tx),
        );
    }
    return urls;
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
        return {
            bbox: [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)],
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
        function tile2lon(tx: number, z: number) { return tx / Math.pow(2, z) * 360 - 180; }
        function tile2lat(ty: number, z: number) {
            const n2 = Math.PI - 2 * Math.PI * ty / Math.pow(2, z);
            return 180 / Math.PI * Math.atan(0.5 * (Math.exp(n2) - Math.exp(-n2)));
        }
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
    // Each tile cell has up to TILE_SOURCES_PER_CELL + 2 Wayback sources
    const tileCount = tiles.length * (TILE_SOURCES_PER_CELL + 2);
    return { tileCount, estBytes: tileCount * BYTES_PER_TILE_EST };
}

/** Return metadata for an existing pack, or null if none built. */
export async function getPackMeta(owner: PackOwner): Promise<PackMeta | null> {
    if (typeof caches === 'undefined') return null;
    const { bbox } = await resolveBbox(owner);
    const cacheName = packCacheName(owner, bbox);
    if (!(await caches.has(cacheName))) return null;
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

    // Cache the SM _meta.json sentinel so offline scans can confirm the index
    // was built (fetchSMFromR2 checks for it before trusting shard 200-[] responses)
    try {
        const metaRes = await fetch(`${FINDSPOT_STATIC_BASE_URL}/sm-index/_meta.json`);
        if (metaRes.ok) await cache.put(`${FINDSPOT_STATIC_BASE_URL}/sm-index/_meta.json`, metaRes);
    } catch { /* non-fatal: SM gate will go amber offline if meta missing */ }

    const smCells = bboxToGeohash6Cells(...bbox);
    let smOk = 0;
    for (const cell of smCells) {
        const url = `${FINDSPOT_STATIC_BASE_URL}/sm-index/${cell}.json`;
        try {
            const res = await fetch(url);
            // 404 = empty cell = valid; cache a 200 [] to avoid future fetch
            if (res.status === 404) {
                await cache.put(url, new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } }));
                smOk++;
            } else if (res.ok) {
                await cache.put(url, res);
                smOk++;
            }
        } catch { /* record unavailable below */ }
    }
    layers['sm'] = smOk === smCells.length ? 'cached' : smOk > 0 ? 'partial' : 'unavailable';

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

    // 6 — Roman roads are served from /public (SW precache) — already offline
    layers['romanRoads'] = 'ok';

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
