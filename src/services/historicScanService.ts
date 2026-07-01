// ─── External API fetch helpers for the Field Guide terrain/heritage scanner ──
import { USE_R2_DESIGNATIONS, FINDSPOT_STATIC_BASE_URL } from '../utils/featureFlags';
import { bboxToGeohash6Cells } from '../utils/geohashUtils';
import { cachedFetchAny } from '../utils/cachedFetch';

// ─── Typed API response shapes ────────────────────────────────────────────────

export interface OverpassTag {
    [key: string]: string | undefined;
    name?: string;
    historic?: string;
    route?: string;
    origin?: string;
    heritage?: string;
    place?: string;
    natural?: string;
    landuse?: string;
    standing_remains?: string;
    archaeological_site?: string;
    site_type?: string;
    period?: string;
    roman_road?: string;
    holloway?: string;
    highway?: string;
}

export interface OverpassElement {
    id: number;
    type: 'node' | 'way' | 'relation';
    lat?: number;
    lon?: number;
    center?: { lat: number; lon: number };
    tags?: OverpassTag;
    geometry?: { lat: number; lon: number }[];
    members?: { type: string; ref: number; role: string }[];
}

export interface OverpassResponse {
    elements: OverpassElement[];
}

export interface ModernWaysFetchResult {
    ways: import('../pages/fieldGuideTypes').ModernWay[];
    available: boolean;
}

export interface NHLEGeometry {
    type: 'Point' | 'Polygon' | 'MultiPolygon';
    coordinates: number[] | number[][][] | number[][][][];
}

export interface NHLEFeature {
    type: 'Feature';
    geometry: NHLEGeometry;
    properties: {
        Name?: string;
        ListEntry?: string;
    };
}

export interface NHLEResponse {
    features: NHLEFeature[];
    available?: boolean;
    error?: string;
}

export interface AIMFeature {
    type: 'Feature';
    geometry: {
        type: string;
        coordinates: number[] | number[][][] | number[][][][];
    };
    properties: {
        MONUMENT_TYPE?: string;
        PERIOD?: string;
        EVIDENCE_1?: string;
    };
}

export interface AIMResponse {
    features: AIMFeature[];
    available?: boolean;
    error?: string;
}

export interface NominatimAddress {
    hamlet?: string;
    village?: string;
    suburb?: string;
    town?: string;
    parish?: string;
    county?: string;
    state_district?: string;
}

export interface NominatimResponse {
    address?: NominatimAddress;
    display_name?: string;
}

// ─── Service functions ────────────────────────────────────────────────────────

const OVERPASS_URLS = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
    'https://overpass.osm.ch/api/interpreter',
];
const OVERPASS_ENDPOINT_TIMEOUT_MS = 6000;
const OVERPASS_TOTAL_TIMEOUT_MS = 12000;
const OVERPASS_BROAD_ENDPOINT_TIMEOUT_MS = 12000;
const OVERPASS_BROAD_TOTAL_TIMEOUT_MS = 24000;
const GENERAL_FETCH_TIMEOUT_MS = 7000;
const NHLE_RETRY_DELAYS_MS = [350, 900];
// The context query is useful enrichment, but terrain/NHLE/AIM already provide
// the core scan. Keep it bounded so public Overpass slowness cannot dominate.
const LANDSCAPE_CONTEXT_RETRY_DELAYS_MS: number[] = [];
const KNOWN_ROMAN_ROUTE_NAMES = [
    'akeman street',
    'cade\'s road',
    'dere street',
    'devil\'s highway',
    'ermine street',
    'fen causeway',
    'fosse way',
    'icknield street',
    'peddars way',
    'port way',
    'ryknild street',
    'stane street',
    'stanegate',
    'watling street',
];
const KNOWN_ROMAN_ROUTE_NAME_REGEX = KNOWN_ROMAN_ROUTE_NAMES
    .map(name => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');

export type OverpassAttemptTiming = {
    endpoint: string;
    elapsedMs: number;
    status: 'ok' | 'http-error' | 'timeout' | 'error';
    httpStatus?: number;
};

export type OverpassFetchOptions = {
    endpointTimeoutMs?: number;
    totalTimeoutMs?: number;
    onAttempt?: (timing: OverpassAttemptTiming) => void;
};

export type DesignationFetchOptions = {
    cacheOnly?: boolean;
};

function isAbortError(e: unknown): boolean {
    return e instanceof DOMException && e.name === 'AbortError';
}

function withTimeoutSignal(signal: AbortSignal | undefined, timeoutMs: number) {
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), timeoutMs);
    const combined = AbortSignal.any
        ? AbortSignal.any([timeout.signal, ...(signal ? [signal] : [])])
        : timeout.signal;
    return {
        signal: combined,
        clear:  () => clearTimeout(timer),
    };
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, ms);
        if (signal) {
            signal.addEventListener('abort', () => {
                clearTimeout(timer);
                reject(new DOMException('Aborted', 'AbortError'));
            }, { once: true });
        }
    });
}

// POST is the recommended approach for Overpass — avoids URL length limits
// and is more reliably accepted across all Overpass instances.
async function overpassFetch(
    query: string,
    signal?: AbortSignal,
    options: OverpassFetchOptions = {},
): Promise<OverpassResponse | null> {
    const endpointTimeoutMs = options.endpointTimeoutMs ?? OVERPASS_ENDPOINT_TIMEOUT_MS;
    const totalTimeoutMs = options.totalTimeoutMs ?? OVERPASS_TOTAL_TIMEOUT_MS;
    const started = Date.now();
    for (const url of OVERPASS_URLS) {
        const remainingMs = totalTimeoutMs - (Date.now() - started);
        if (remainingMs <= 0) break;
        const attemptStarted = Date.now();
        const endpoint = new URL(url).host;
        const timed = withTimeoutSignal(signal, Math.min(endpointTimeoutMs, remainingMs));
        try {
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: 'data=' + encodeURIComponent(query),
                signal: timed.signal,
            });
            if (!res.ok) {
                options.onAttempt?.({
                    endpoint,
                    elapsedMs: Date.now() - attemptStarted,
                    status:    'http-error',
                    httpStatus: res.status,
                });
                continue;
            }
            const data = await res.json() as OverpassResponse;
            options.onAttempt?.({
                endpoint,
                elapsedMs: Date.now() - attemptStarted,
                status:    'ok',
            });
            return data;
        } catch (e) {
            if (signal && isAbortError(e) && signal.aborted) throw e;
            options.onAttempt?.({
                endpoint,
                elapsedMs: Date.now() - attemptStarted,
                status:    timed.signal.aborted ? 'timeout' : 'error',
            });
        } finally {
            timed.clear();
        }
    }
    return null;
}

/**
 * Nominatim reverse geocode — returns the parsed address block or null.
 */
export async function fetchLocationLabel(
    lat: number,
    lng: number,
    signal?: AbortSignal
): Promise<NominatimResponse | null> {
    const timed = withTimeoutSignal(signal, GENERAL_FETCH_TIMEOUT_MS);
    try {
        const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`;
        const res = await fetch(url, { signal: timed.signal });
        if (!res.ok) return null;
        return await res.json() as NominatimResponse;
    } catch (e) {
        if (signal && isAbortError(e) && signal.aborted) throw e;
        return null;
    } finally {
        timed.clear();
    }
}

/**
 * Overpass query for place-name / etymology signals within 4km of a point.
 * Uses a radius rather than the map viewport bbox so results are consistent
 * regardless of zoom level — named places relevant to a location can be
 * several km away and would be missed by a tight bbox at high zoom.
 */
export async function fetchEtymologySignals(
    lat: number,
    lng: number,
    signal?: AbortSignal
): Promise<OverpassResponse | null> {
    const r = 4000;
    const query = `[out:json][timeout:25];(node["place"](around:${r},${lat},${lng});way["place"](around:${r},${lat},${lng});rel["place"](around:${r},${lat},${lng});node["natural"](around:${r},${lat},${lng});way["natural"](around:${r},${lat},${lng});node["historic"](around:${r},${lat},${lng});way["historic"](around:${r},${lat},${lng});node["landuse"="farmyard"](around:${r},${lat},${lng});way["landuse"="farmyard"](around:${r},${lat},${lng}););out center;`;
    return overpassFetch(query, signal, {
        endpointTimeoutMs: OVERPASS_BROAD_ENDPOINT_TIMEOUT_MS,
        totalTimeoutMs:    OVERPASS_BROAD_TOTAL_TIMEOUT_MS,
    });
}

/**
 * Combined OSM context query for the standalone Historic button.
 * This replaces separate place-name and heritage Overpass requests in the UI
 * path, cutting one public API round-trip while preserving the same parsers.
 */
export async function fetchHistoricContextFeatures(
    lat: number,
    lng: number,
    signal?: AbortSignal,
    options: OverpassFetchOptions = {},
): Promise<OverpassResponse | null> {
    const placeRadius = 4000;
    const heritageRadius = 2000;
    const query = `[out:json][timeout:8];(node["place"](around:${placeRadius},${lat},${lng});way["place"](around:${placeRadius},${lat},${lng});rel["place"](around:${placeRadius},${lat},${lng});node["natural"](around:${placeRadius},${lat},${lng});way["natural"](around:${placeRadius},${lat},${lng});node["historic"](around:${placeRadius},${lat},${lng});way["historic"](around:${placeRadius},${lat},${lng});node["landuse"="farmyard"](around:${placeRadius},${lat},${lng});way["landuse"="farmyard"](around:${placeRadius},${lat},${lng});node["heritage"](around:${heritageRadius},${lat},${lng});way["heritage"](around:${heritageRadius},${lat},${lng});rel["heritage"](around:${heritageRadius},${lat},${lng}););out center;`;
    const fetchOptions = {
        endpointTimeoutMs: options.endpointTimeoutMs ?? 3000,
        totalTimeoutMs:    options.totalTimeoutMs    ?? 6000,
        onAttempt:         options.onAttempt,
    };

    for (let attempt = 0; attempt <= LANDSCAPE_CONTEXT_RETRY_DELAYS_MS.length; attempt++) {
        const result = await overpassFetch(query, signal, fetchOptions);
        if (result) return result;

        const retryDelay = LANDSCAPE_CONTEXT_RETRY_DELAYS_MS[attempt];
        if (retryDelay !== undefined) await delay(retryDelay, signal);
    }

    return null;
}

/**
 * Overpass query for heritage / archaeological features within 2km of a point.
 */
export async function fetchHeritageFeatures(
    lat: number,
    lng: number,
    signal?: AbortSignal
): Promise<OverpassResponse | null> {
    const query = `[out:json][timeout:25];(node["historic"](around:2000,${lat},${lng});way["historic"](around:2000,${lat},${lng});node["heritage"](around:2000,${lat},${lng});way["heritage"](around:2000,${lat},${lng}););out center;`;
    return overpassFetch(query, signal, {
        endpointTimeoutMs: OVERPASS_BROAD_ENDPOINT_TIMEOUT_MS,
        totalTimeoutMs:    OVERPASS_BROAD_TOTAL_TIMEOUT_MS,
    });
}

// ─── R2 static designation helpers (W1) ──────────────────────────────────────

type SMShardEntry = {
    listEntry: string;
    name: string;
    bbox: [number, number, number, number];
    geometry?: NHLEGeometry;
};

function _smBboxIntersects(
    sm: [number, number, number, number],
    q:  [number, number, number, number],
): boolean {
    return sm[0] <= q[2] && sm[2] >= q[0] && sm[1] <= q[3] && sm[3] >= q[1];
}

function _pointInBbox(point: [number, number], bbox: [number, number, number, number]): boolean {
    return point[0] >= bbox[0] && point[0] <= bbox[2] && point[1] >= bbox[1] && point[1] <= bbox[3];
}

function _pointInRing(point: [number, number], ring: number[][]): boolean {
    const [lon, lat] = point;
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const xi = ring[i][0], yi = ring[i][1];
        const xj = ring[j][0], yj = ring[j][1];
        if (((yi > lat) !== (yj > lat)) && (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
}

function _orientation(a: [number, number], b: [number, number], c: [number, number]): number {
    return (b[1] - a[1]) * (c[0] - b[0]) - (b[0] - a[0]) * (c[1] - b[1]);
}

function _onSegment(a: [number, number], b: [number, number], c: [number, number]): boolean {
    return b[0] <= Math.max(a[0], c[0]) && b[0] >= Math.min(a[0], c[0]) &&
        b[1] <= Math.max(a[1], c[1]) && b[1] >= Math.min(a[1], c[1]);
}

function _segmentsIntersect(p1: [number, number], q1: [number, number], p2: [number, number], q2: [number, number]): boolean {
    const o1 = _orientation(p1, q1, p2);
    const o2 = _orientation(p1, q1, q2);
    const o3 = _orientation(p2, q2, p1);
    const o4 = _orientation(p2, q2, q1);
    if ((o1 > 0) !== (o2 > 0) && (o3 > 0) !== (o4 > 0)) return true;
    if (o1 === 0 && _onSegment(p1, p2, q1)) return true;
    if (o2 === 0 && _onSegment(p1, q2, q1)) return true;
    if (o3 === 0 && _onSegment(p2, p1, q2)) return true;
    if (o4 === 0 && _onSegment(p2, q1, q2)) return true;
    return false;
}

function _ringIntersectsBbox(ring: number[][], bbox: [number, number, number, number]): boolean {
    if (ring.some(p => _pointInBbox(p as [number, number], bbox))) return true;
    const [w, s, e, n] = bbox;
    const corners: [number, number][] = [[w, s], [e, s], [e, n], [w, n]];
    if (corners.some(corner => _pointInRing(corner, ring))) return true;
    const edges: Array<[[number, number], [number, number]]> = [
        [[w, s], [e, s]], [[e, s], [e, n]], [[e, n], [w, n]], [[w, n], [w, s]],
    ];
    for (let i = 1; i < ring.length; i++) {
        const a = ring[i - 1] as [number, number];
        const b = ring[i] as [number, number];
        if (edges.some(([c, d]) => _segmentsIntersect(a, b, c, d))) return true;
    }
    return false;
}

function _smGeometryIntersectsBbox(geometry: NHLEGeometry, bbox: [number, number, number, number]): boolean {
    if (geometry.type === 'Point') return _pointInBbox(geometry.coordinates as [number, number], bbox);
    if (geometry.type === 'Polygon') {
        return (geometry.coordinates as number[][][]).some(ring => _ringIntersectsBbox(ring, bbox));
    }
    if (geometry.type === 'MultiPolygon') {
        return (geometry.coordinates as number[][][][]).some(poly => poly.some(ring => _ringIntersectsBbox(ring, bbox)));
    }
    return false;
}

/**
 * Fetch SM data from R2 static index.
 * Returns NHLEResponse identical to the live path.
 * On ANY failure: available:false (gate goes amber — never false-clear).
 *
 * Coverage sentinel: _meta.json is fetched first. A missing _meta.json means
 * the index has never been built/deployed — we cannot distinguish "no SM in
 * cell" from "shard never uploaded", so we must return available:false rather
 * than risk a false-clear on the legal gate. Only once _meta.json is confirmed
 * present can a shard 200-[] be trusted as "genuinely empty cell."
 */
async function _fetchSMFromR2(
    west: number,
    south: number,
    east: number,
    north: number,
    signal?: AbortSignal,
    options: DesignationFetchOptions = {},
): Promise<NHLEResponse> {
    // ── 1. Coverage sentinel ──────────────────────────────────────────────────
    const metaUrl = `${FINDSPOT_STATIC_BASE_URL}/sm-index/_meta.json`;
    try {
        const metaTimed = withTimeoutSignal(signal, GENERAL_FETCH_TIMEOUT_MS);
        try {
            const metaRes = await cachedFetchAny(metaUrl, { signal: metaTimed.signal }, { cacheOnly: options.cacheOnly });
            if (!metaRes.ok) {
                return { features: [], available: false, error: `SM index not built (${metaRes.status})` };
            }
            const meta = await metaRes.json().catch(() => null);
            if (!meta || meta.schemaVersion !== 2 || meta.geometryMode !== 'full-geojson') {
                return { features: [], available: false, error: 'SM index requires full-geometry schema v2' };
            }
        } finally {
            metaTimed.clear();
        }
    } catch (e) {
        if (signal && isAbortError(e) && signal.aborted) throw e;
        return { features: [], available: false, error: 'SM index unreachable' };
    }

    // ── 2. Shard reads ────────────────────────────────────────────────────────
    const cells = bboxToGeohash6Cells(west, south, east, north);
    const query: [number, number, number, number] = [west, south, east, north];
    const seen = new Set<string>();
    const features: NHLEFeature[] = [];
    let missingCacheShards = 0;

    try {
        await Promise.all(cells.map(async (cell) => {
            const url = `${FINDSPOT_STATIC_BASE_URL}/sm-index/${cell}.json`;
            const timed = withTimeoutSignal(signal, GENERAL_FETCH_TIMEOUT_MS);
            try {
                // cachedFetchAny serves from any open offline pack before network
                const res = await cachedFetchAny(url, { signal: timed.signal }, { cacheOnly: options.cacheOnly });
                if (!res.ok) {
                    missingCacheShards++;
                    return;
                }
                const entries: SMShardEntry[] = await res.json();
                for (const entry of entries) {
                    if (seen.has(entry.listEntry)) continue;
                    if (!_smBboxIntersects(entry.bbox, query)) continue;
                    if (!entry.geometry) {
                        throw new Error('SM shard is old format; rebuild index with full geometry');
                    }
                    if (!_smGeometryIntersectsBbox(entry.geometry, query)) continue;
                    seen.add(entry.listEntry);
                    features.push({
                        type: 'Feature',
                        geometry: entry.geometry,
                        properties: { Name: entry.name, ListEntry: entry.listEntry },
                    });
                }
            } catch (e) {
                if (!(signal && isAbortError(e) && signal.aborted)) {
                    missingCacheShards++;
                    return;
                }
                throw e;
            } finally {
                timed.clear();
            }
        }));
        if (missingCacheShards > 0) {
            return {
                features,
                available: false,
                error: `SM offline pack missing ${missingCacheShards}/${cells.length} shard${missingCacheShards !== 1 ? 's' : ''}`,
            };
        }
        return { features, available: true };
    } catch (e) {
        if (signal && isAbortError(e) && signal.aborted) throw e;
        const msg = e instanceof Error ? e.message : 'SM R2 fetch failed';
        return { features: [], available: false, error: msg };
    }
}

type AIMShardEntry = { monumentType: string; period: string; evidence: string; bbox: [number, number, number, number] };

/**
 * Fetch AIM data from R2 static index (geohash-sharded JSON, same pattern as SM).
 * Requires aim-index/_meta.json to be present before shard results are trusted —
 * prevents a missing/un-deployed index from returning an empty false-clear.
 * AIM is not a legal gate (unlike SM) so failures are amber-state only: the
 * caller receives available:false and silently omits AIM from confidence scoring.
 */
async function _fetchAIMFromR2(
    west: number,
    south: number,
    east: number,
    north: number,
    signal?: AbortSignal,
    options: DesignationFetchOptions = {},
): Promise<AIMResponse> {
    // ── 1. Coverage sentinel ──────────────────────────────────────────────────
    // aim-index/_meta.json must exist before shard arrays are trusted.
    // A missing meta means the index has not been built/deployed yet.
    const metaUrl = `${FINDSPOT_STATIC_BASE_URL}/aim-index/_meta.json`;
    try {
        const metaTimed = withTimeoutSignal(signal, GENERAL_FETCH_TIMEOUT_MS);
        try {
            const metaRes = await cachedFetchAny(metaUrl, { signal: metaTimed.signal }, { cacheOnly: options.cacheOnly });
            if (!metaRes.ok) {
                return { features: [], available: false, error: `AIM index not built (${metaRes.status})` };
            }
            const meta = await metaRes.json().catch(() => null);
            if (!meta || typeof meta.schemaVersion !== 'number') {
                return { features: [], available: false, error: 'AIM index meta invalid' };
            }
        } finally {
            metaTimed.clear();
        }
    } catch (e) {
        if (signal && isAbortError(e) && signal.aborted) throw e;
        return { features: [], available: false, error: 'AIM index unreachable' };
    }

    // ── 2. Shard reads ────────────────────────────────────────────────────────
    const cells = bboxToGeohash6Cells(west, south, east, north);
    const query: [number, number, number, number] = [west, south, east, north];
    const features: AIMFeature[] = [];
    let missingCacheShards = 0;

    try {
        await Promise.all(cells.map(async (cell) => {
            const url = `${FINDSPOT_STATIC_BASE_URL}/aim-index/${cell}.json`;
            const timed = withTimeoutSignal(signal, GENERAL_FETCH_TIMEOUT_MS);
            try {
                const res = await cachedFetchAny(url, { signal: timed.signal }, { cacheOnly: options.cacheOnly });
                if (!res.ok) {
                    missingCacheShards++;
                    return;
                }
                const entries: AIMShardEntry[] = await res.json();
                for (const entry of entries) {
                    if (!_smBboxIntersects(entry.bbox, query)) continue;
                    const [w, s, e, n] = entry.bbox;
                    features.push({
                        type: 'Feature',
                        geometry: {
                            type: 'Polygon',
                            coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]],
                        },
                        properties: {
                            MONUMENT_TYPE: entry.monumentType,
                            PERIOD: entry.period,
                            EVIDENCE_1: entry.evidence,
                        },
                    });
                }
            } catch (e) {
                if (!(signal && isAbortError(e) && signal.aborted)) {
                    missingCacheShards++;
                    return;
                }
                throw e;
            } finally {
                timed.clear();
            }
        }));
        if (missingCacheShards > 0) {
            return {
                features,
                available: false,
                error: `AIM offline pack missing ${missingCacheShards}/${cells.length} shard${missingCacheShards !== 1 ? 's' : ''}`,
            };
        }
        return { features, available: true };
    } catch (e) {
        if (signal && isAbortError(e) && signal.aborted) throw e;
        const msg = e instanceof Error ? e.message : 'AIM R2 fetch failed';
        return { features, available: false, error: msg };
    }
}

async function _fetchScheduledMonumentsLive(
    west: number,
    south: number,
    east: number,
    north: number,
    signal?: AbortSignal
): Promise<NHLEResponse> {
    // Legacy live ArcGIS path — REMOVE_AFTER_RELEASE: v4.3.0
    const url = `https://services-eu1.arcgis.com/ZOdPfBS3aqqDYPUQ/arcgis/rest/services/National_Heritage_List_for_England_NHLE_v02_VIEW/FeatureServer/6/query?where=1%3D1&geometry=${west},${south},${east},${north}&geometryType=esriGeometryEnvelope&spatialRel=esriSpatialRelIntersects&inSR=4326&outSR=4326&f=geojson&outFields=Name,ListEntry`;
    let lastError = 'Scheduled monument service unavailable';

    for (let attempt = 0; attempt <= NHLE_RETRY_DELAYS_MS.length; attempt++) {
        const timed = withTimeoutSignal(signal, GENERAL_FETCH_TIMEOUT_MS);
        try {
            const res = await fetch(url, { signal: timed.signal });
            if (res.ok) {
                const data = await res.json() as NHLEResponse;
                return { ...data, features: data.features ?? [], available: true };
            }
            lastError = `HTTP ${res.status}`;
        } catch (e) {
            if (signal && isAbortError(e) && signal.aborted) throw e;
            lastError = e instanceof Error ? e.message : 'Scheduled monument service unavailable';
        } finally {
            timed.clear();
        }

        const retryDelay = NHLE_RETRY_DELAYS_MS[attempt];
        if (retryDelay !== undefined) await delay(retryDelay, signal);
    }

    return { features: [], available: false, error: lastError };
}

/**
 * NHLE scheduled monuments — R2 static index or live ArcGIS FeatureServer.
 * When USE_R2_DESIGNATIONS is true, R2 is preferred so offline packs can satisfy
 * the read path. If R2 is unavailable while online, fall back to live ArcGIS so
 * scans still draw current NHLE geometry instead of silently losing the layer.
 */
export async function fetchScheduledMonuments(
    west: number,
    south: number,
    east: number,
    north: number,
    signal?: AbortSignal,
    options: DesignationFetchOptions = {},
): Promise<NHLEResponse> {
    if (USE_R2_DESIGNATIONS) {
        const r2Result = await _fetchSMFromR2(west, south, east, north, signal, options);
        if (r2Result.available !== false) return r2Result;
        if (options.cacheOnly) return r2Result;

        const liveResult = await _fetchScheduledMonumentsLive(west, south, east, north, signal);
        if (liveResult.available !== false) return liveResult;
        return r2Result;
    }

    return _fetchScheduledMonumentsLive(west, south, east, north, signal);
}

/**
 * HE AIM aerial archaeology polygons — R2 static index or live ArcGIS FeatureServer.
 * When USE_R2_DESIGNATIONS is true, reads geohash-sharded JSON from R2.
 */
export async function fetchAIMData(
    west: number,
    south: number,
    east: number,
    north: number,
    signal?: AbortSignal,
    options: DesignationFetchOptions = {},
): Promise<AIMResponse> {
    if (USE_R2_DESIGNATIONS) {
        return _fetchAIMFromR2(west, south, east, north, signal, options);
    }

    // Legacy live ArcGIS path — REMOVE_AFTER_RELEASE: v4.3.0
    const timed = withTimeoutSignal(signal, GENERAL_FETCH_TIMEOUT_MS);
    try {
        const url = `https://services-eu1.arcgis.com/ZOdPfBS3aqqDYPUQ/arcgis/rest/services/HE_AIM_data/FeatureServer/1/query?where=1%3D1&geometry=${west},${south},${east},${north}&geometryType=esriGeometryEnvelope&spatialRel=esriSpatialRelIntersects&inSR=4326&outSR=4326&f=geojson&outFields=MONUMENT_TYPE,PERIOD,EVIDENCE_1`;
        const res = await fetch(url, { signal: timed.signal });
        if (!res.ok) return { features: [] };
        const data = await res.json() as Partial<AIMResponse>;
        return { ...data, features: Array.isArray(data.features) ? data.features : [] };
    } catch (e) {
        if (signal && isAbortError(e) && signal.aborted) throw e;
        return { features: [] };
    } finally {
        timed.clear();
    }
}

/**
 * Overpass query for historic routes (roman roads, trackways, holloways) within 2km.
 */
export async function fetchHistoricRoutes(
    lat: number,
    lng: number,
    signal?: AbortSignal,
    options: OverpassFetchOptions = {},
): Promise<OverpassResponse | null> {
    // Include relation queries so Roman roads stored as OSM route relations
    // (e.g. Fen Causeway, Stane Street) are captured alongside tagged ways.
    // (._;>;) recurses the relation set down to its member ways with geometry.
    const query = `[out:json][timeout:15];(way["historic"="roman_road"](around:2000,${lat},${lng});way["roman_road"="yes"](around:2000,${lat},${lng});way["name"~"${KNOWN_ROMAN_ROUTE_NAME_REGEX}",i](around:2000,${lat},${lng});way["historic"="trackway"](around:2000,${lat},${lng});way["holloway"="yes"](around:2000,${lat},${lng});relation["historic"="roman_road"](around:2000,${lat},${lng});relation["route"="historic"](around:2000,${lat},${lng});relation["name"~"${KNOWN_ROMAN_ROUTE_NAME_REGEX}",i](around:2000,${lat},${lng}););(._;>;);out geom;`;
    return overpassFetch(query, signal, options);
}

/**
 * Parse raw Overpass way elements into typed HistoricRoute objects.
 * Used by both terrain and historic scan to avoid duplicated parsing logic.
 */
export function parseOverpassRoutes(elements: OverpassElement[]): import('../pages/fieldGuideTypes').HistoricRoute[] {
    const hasRomanRouteTags = (tags?: OverpassTag) =>
        tags?.historic === 'roman_road' ||
        tags?.roman_road === 'yes' ||
        tags?.origin?.toLowerCase() === 'roman' ||
        tags?.period?.toLowerCase() === 'roman' ||
        tags?.['historic:civilization']?.toLowerCase() === 'ancient_roman' ||
        !!(tags?.name && (
            tags.name.toLowerCase().includes('roman road') ||
            KNOWN_ROMAN_ROUTE_NAMES.some(name => tags.name?.toLowerCase().includes(name))
        ));

    // Build a map of way IDs that are members of Roman route relations.
    // This catches roads like the Fen Causeway that are stored as OSM route
    // relations rather than individually tagged ways.
    const romanRelationWayNames = new Map<number, string | undefined>();
    elements
        .filter(el => el.type === 'relation' && hasRomanRouteTags(el.tags))
        .forEach(rel => {
            rel.members
                ?.filter(m => m.type === 'way')
                .forEach(m => romanRelationWayNames.set(m.ref, rel.tags?.name?.trim() || undefined));
        });

    return elements
        .filter(el => el.type === 'way' && el.geometry && el.geometry.length >= 2)
        .map(el => {
            const geom: [number, number][] = (el.geometry || []).map(g => [g.lon, g.lat]);
            const lons = geom.map(g => g[0]);
            const lats = geom.map(g => g[1]);
            const hasRomanRelation = romanRelationWayNames.has(el.id);
            const relationName = romanRelationWayNames.get(el.id);
            const routeName = hasRomanRelation ? relationName || el.tags?.name?.trim() : el.tags?.name?.trim();
            const isRoman = hasRomanRouteTags(el.tags) || hasRomanRelation;
            return {
                id:              `route-${el.id}`,
                type:            isRoman ? 'roman_road' as const : el.tags?.holloway === 'yes' ? 'holloway' as const : 'historic_trackway' as const,
                source:          'osm' as const,
                name:            routeName,
                confidenceClass: 'B' as const,
                certaintyScore:  70,
                geometry:        geom,
                bbox:            [[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]] as [[number,number],[number,number]],
                period:          isRoman ? 'roman' as const : 'unknown' as const,
            };
        });
}

/**
 * Overpass query for historic routes used during executeScan (wider search, 1km radius).
 */
export async function fetchScanRoutes(
    lat: number,
    lng: number,
    signal?: AbortSignal
): Promise<OverpassResponse | null> {
    const query = `[out:json][timeout:15];(way["historic"="roman_road"](around:1000,${lat},${lng});way["roman_road"="yes"](around:1000,${lat},${lng});way["name"~"Roman Road|${KNOWN_ROMAN_ROUTE_NAME_REGEX}",i](around:1000,${lat},${lng});way["historic"="trackway"](around:1000,${lat},${lng});way["holloway"="yes"](around:1000,${lat},${lng});way["highway"="track"]["historic"="yes"](around:1000,${lat},${lng});relation["historic"="roman_road"](around:1000,${lat},${lng});relation["route"="historic"](around:1000,${lat},${lng});relation["name"~"${KNOWN_ROMAN_ROUTE_NAME_REGEX}",i](around:1000,${lat},${lng}););(._;>;);out geom;`;
    return overpassFetch(query, signal);
}

/**
 * Overpass query for modern roads, tracks, and paths within 300m of a point.
 * Used exclusively for route-artefact target suppression — never scored
 * archaeologically. Fetches highway types that could generate false-positive
 * linear or proximity signals in the terrain scanner.
 */
export async function fetchModernWays(
    lat: number,
    lng: number,
    signal?: AbortSignal
): Promise<import('../pages/fieldGuideTypes').ModernWay[]> {
    const r = 300;
    const types = ['motorway','trunk','primary','secondary','tertiary','unclassified','residential','service','track','path','footway','bridleway'];
    const query = `[out:json][timeout:12];(${types.map(t => `way["highway"="${t}"](around:${r},${lat},${lng})`).join(';')};);out geom;`;
    const result = await overpassFetch(query, signal);
    return parseModernWays(result);
}

/**
 * Overpass query for modern roads, tracks, and paths across the active scan
 * footprint, with a small buffer so edge-of-scan route artefacts are still
 * assessed. Used by the terrain scanner for route-noise suppression.
 */
export async function fetchModernWaysForBounds(
    west: number,
    south: number,
    east: number,
    north: number,
    signal?: AbortSignal
): Promise<import('../pages/fieldGuideTypes').ModernWay[]> {
    const result = await fetchModernWaysForBoundsResult(west, south, east, north, signal);
    return result.ways;
}

export async function fetchModernWaysForBoundsResult(
    west: number,
    south: number,
    east: number,
    north: number,
    signal?: AbortSignal
): Promise<ModernWaysFetchResult> {
    const pad = 0.003;
    const w = Number((west  - pad).toFixed(6));
    const s = Number((south - pad).toFixed(6));
    const e = Number((east  + pad).toFixed(6));
    const n = Number((north + pad).toFixed(6));
    const types = ['motorway','trunk','primary','secondary','tertiary','unclassified','residential','service','track','path','footway','bridleway'];
    const query = `[out:json][timeout:12];(${types.map(t => `way["highway"="${t}"](${s},${w},${n},${e})`).join(';')};);out geom;`;
    const result = await overpassFetch(query, signal);
    return {
        ways:      parseModernWays(result),
        available: result !== null,
    };
}

function parseModernWays(result: OverpassResponse | null): import('../pages/fieldGuideTypes').ModernWay[] {
    if (!result?.elements) return [];
    return result.elements
        .filter(el => el.geometry && el.geometry.length >= 2)
        .map(el => {
            const geom: [number, number][] = (el.geometry || []).map(g => [g.lon, g.lat]);
            const lons = geom.map(g => g[0]);
            const lats = geom.map(g => g[1]);
            return {
                geometry: geom,
                bbox:     [[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]] as [[number, number], [number, number]],
                highwayTag: el.tags?.highway || 'unknown',
            };
        });
}
