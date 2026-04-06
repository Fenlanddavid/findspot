// ─── External API fetch helpers for the Field Guide terrain/heritage scanner ──

// ─── Typed API response shapes ────────────────────────────────────────────────

export interface OverpassTag {
    name?: string;
    historic?: string;
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
}

export interface OverpassResponse {
    elements: OverpassElement[];
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

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

function isAbortError(e: unknown): boolean {
    return e instanceof DOMException && e.name === 'AbortError';
}

// POST is the recommended approach for Overpass — avoids URL length limits
// and is more reliably accepted across all Overpass instances.
async function overpassFetch(query: string, signal?: AbortSignal): Promise<OverpassResponse | null> {
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), 15000);
    try {
        const combined = AbortSignal.any
            ? AbortSignal.any([timeout.signal, ...(signal ? [signal] : [])])
            : timeout.signal;
        const res = await fetch(OVERPASS_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: 'data=' + encodeURIComponent(query),
            signal: combined,
        });
        if (!res.ok) return null;
        return await res.json() as OverpassResponse;
    } catch (e) {
        if (signal && isAbortError(e) && signal.aborted) throw e;
        return null;
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Nominatim reverse geocode — returns the parsed address block or null.
 */
export async function fetchLocationLabel(
    lat: number,
    lng: number,
    signal?: AbortSignal
): Promise<NominatimResponse | null> {
    try {
        const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`;
        const res = await fetch(url, { signal });
        return await res.json() as NominatimResponse;
    } catch (e) {
        if (isAbortError(e)) throw e;
        return null;
    }
}

/**
 * Overpass query for place-name / etymology signals in a bounding box.
 */
export async function fetchEtymologySignals(
    south: number,
    west: number,
    north: number,
    east: number,
    signal?: AbortSignal
): Promise<OverpassResponse | null> {
    const query = `[out:json][timeout:25];(node["place"](${south},${west},${north},${east});way["place"](${south},${west},${north},${east});rel["place"](${south},${west},${north},${east});node["natural"](${south},${west},${north},${east});way["natural"](${south},${west},${north},${east});node["historic"](${south},${west},${north},${east});way["historic"](${south},${west},${north},${east});node["landuse"="farmyard"](${south},${west},${north},${east});way["landuse"="farmyard"](${south},${west},${north},${east}););out center;`;
    return overpassFetch(query, signal);
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
    return overpassFetch(query, signal);
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
    try {
        const url = `https://services-eu1.arcgis.com/ZOdPfBS3aqqDYPUQ/arcgis/rest/services/National_Heritage_List_for_England_NHLE_v02_VIEW/FeatureServer/6/query?where=1%3D1&geometry=${west},${south},${east},${north}&geometryType=esriGeometryEnvelope&spatialRel=esriSpatialRelIntersects&inSR=4326&outSR=4326&f=geojson&outFields=Name,ListEntry`;
        const res = await fetch(url, { signal });
        return await res.json() as NHLEResponse;
    } catch (e) {
        if (isAbortError(e)) throw e;
        return { features: [] };
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
    try {
        const url = `https://services-eu1.arcgis.com/ZOdPfBS3aqqDYPUQ/arcgis/rest/services/HE_AIM_data/FeatureServer/1/query?where=1%3D1&geometry=${west},${south},${east},${north}&geometryType=esriGeometryEnvelope&spatialRel=esriSpatialRelIntersects&inSR=4326&outSR=4326&f=geojson&outFields=MONUMENT_TYPE,PERIOD,EVIDENCE_1`;
        const res = await fetch(url, { signal });
        return await res.json() as AIMResponse;
    } catch (e) {
        if (isAbortError(e)) throw e;
        return { features: [] };
    }
}

/**
 * Overpass query for historic routes (roman roads, trackways, holloways) within 2km.
 */
export async function fetchHistoricRoutes(
    lat: number,
    lng: number,
    signal?: AbortSignal
): Promise<OverpassResponse | null> {
    const query = `[out:json][timeout:25];(way["historic"="roman_road"](around:2000,${lat},${lng});way["roman_road"="yes"](around:2000,${lat},${lng});way["historic"="trackway"](around:2000,${lat},${lng});way["holloway"="yes"](around:2000,${lat},${lng}););out geom;`;
    return overpassFetch(query, signal);
}

/**
 * Parse raw Overpass way elements into typed HistoricRoute objects.
 * Used by both terrain and historic scan to avoid duplicated parsing logic.
 */
export function parseOverpassRoutes(elements: OverpassElement[]): import('../pages/fieldGuideTypes').HistoricRoute[] {
    return elements
        .filter(el => el.geometry && el.geometry.length >= 2)
        .map(el => {
            const geom: [number, number][] = (el.geometry || []).map(g => [g.lon, g.lat]);
            const lons = geom.map(g => g[0]);
            const lats = geom.map(g => g[1]);
            const isRoman = el.tags?.historic === 'roman_road' || el.tags?.roman_road === 'yes' ||
                !!(el.tags?.name && el.tags.name.toLowerCase().includes('roman road'));
            return {
                id:              `route-${el.id}`,
                type:            isRoman ? 'roman_road' as const : el.tags?.holloway === 'yes' ? 'holloway' as const : 'historic_trackway' as const,
                source:          'osm' as const,
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
    const query = `[out:json][timeout:25];(way["historic"="roman_road"](around:1000,${lat},${lng});way["roman_road"="yes"](around:1000,${lat},${lng});way["name"~"Roman Road",i](around:1000,${lat},${lng});way["historic"="trackway"](around:1000,${lat},${lng});way["holloway"="yes"](around:1000,${lat},${lng});way["highway"="track"]["historic"="yes"](around:1000,${lat},${lng}););out geom;`;
    return overpassFetch(query, signal);
}
