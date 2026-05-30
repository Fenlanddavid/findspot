// ─── External API fetch helpers for the Field Guide terrain/heritage scanner ──

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
}

export interface NominatimAddress {
    parish?: string;
    village?: string;
    town?: string;
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

export type OverpassFetchOptions = {
    endpointTimeoutMs?: number;
    totalTimeoutMs?: number;
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
        const timed = withTimeoutSignal(signal, Math.min(endpointTimeoutMs, remainingMs));
        try {
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: 'data=' + encodeURIComponent(query),
                signal: timed.signal,
            });
            if (!res.ok) continue;
            return await res.json() as OverpassResponse;
        } catch (e) {
            if (signal && isAbortError(e) && signal.aborted) throw e;
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
    const query = `[out:json][timeout:18];(node["place"](around:${placeRadius},${lat},${lng});way["place"](around:${placeRadius},${lat},${lng});rel["place"](around:${placeRadius},${lat},${lng});node["natural"](around:${placeRadius},${lat},${lng});way["natural"](around:${placeRadius},${lat},${lng});node["historic"](around:${placeRadius},${lat},${lng});way["historic"](around:${placeRadius},${lat},${lng});node["landuse"="farmyard"](around:${placeRadius},${lat},${lng});way["landuse"="farmyard"](around:${placeRadius},${lat},${lng});node["heritage"](around:${heritageRadius},${lat},${lng});way["heritage"](around:${heritageRadius},${lat},${lng});rel["heritage"](around:${heritageRadius},${lat},${lng}););out center;`;
    return overpassFetch(query, signal, {
        endpointTimeoutMs: options.endpointTimeoutMs ?? 6000,
        totalTimeoutMs:    options.totalTimeoutMs    ?? 8000,
    });
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

/**
 * NHLE scheduled monuments query via ArcGIS FeatureServer.
 */
export async function fetchScheduledMonuments(
    west: number,
    south: number,
    east: number,
    north: number,
    signal?: AbortSignal
): Promise<NHLEResponse> {
    const timed = withTimeoutSignal(signal, GENERAL_FETCH_TIMEOUT_MS);
    try {
        const url = `https://services-eu1.arcgis.com/ZOdPfBS3aqqDYPUQ/arcgis/rest/services/National_Heritage_List_for_England_NHLE_v02_VIEW/FeatureServer/6/query?where=1%3D1&geometry=${west},${south},${east},${north}&geometryType=esriGeometryEnvelope&spatialRel=esriSpatialRelIntersects&inSR=4326&outSR=4326&f=geojson&outFields=Name,ListEntry`;
        const res = await fetch(url, { signal: timed.signal });
        if (!res.ok) return { features: [] };
        return await res.json() as NHLEResponse;
    } catch (e) {
        if (signal && isAbortError(e) && signal.aborted) throw e;
        return { features: [] };
    } finally {
        timed.clear();
    }
}

/**
 * HE AIM aerial archaeology polygons via ArcGIS FeatureServer.
 */
export async function fetchAIMData(
    west: number,
    south: number,
    east: number,
    north: number,
    signal?: AbortSignal
): Promise<AIMResponse> {
    const timed = withTimeoutSignal(signal, GENERAL_FETCH_TIMEOUT_MS);
    try {
        const url = `https://services-eu1.arcgis.com/ZOdPfBS3aqqDYPUQ/arcgis/rest/services/HE_AIM_data/FeatureServer/1/query?where=1%3D1&geometry=${west},${south},${east},${north}&geometryType=esriGeometryEnvelope&spatialRel=esriSpatialRelIntersects&inSR=4326&outSR=4326&f=geojson&outFields=MONUMENT_TYPE,PERIOD,EVIDENCE_1`;
        const res = await fetch(url, { signal: timed.signal });
        if (!res.ok) return { features: [] };
        return await res.json() as AIMResponse;
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
