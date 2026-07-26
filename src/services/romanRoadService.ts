// ─── RRRA Roman Road Service ─────────────────────────────────────────────────
// Loads the bundled Digital Britannia engineered-road layer. Legacy Itiner-e
// property/source handling remains only for v4.x cached-record compatibility.
// A session-level cache avoids re-fetching the static asset on every scan.

import { HistoricRoute } from '../pages/fieldGuideTypes';
import { ROMAN_ROADS_DATASET } from '../shared/staticDatasetContract';
import { cachedFetchAny } from '../utils/cachedFetch';
import { HISTORIC_CONTEXT_RADIUS_KM } from '../outstandingQuestions/contextRadius';
import { reportNonFatal } from './diagLog';

interface RomanRoadFeature {
    id?: string;
    type: 'Feature';
    properties: {
        source?: 'itinere' | 'rrra';
        name?: string | null;
        reference?: string | null;
        Name?: string | null;
        confidenceClass: 'A' | 'B' | 'C';
    };
    geometry: {
        type: 'LineString' | 'MultiLineString';
        coordinates: number[][] | number[][][];
    };
}

let _cache: Promise<RomanRoadFeature[]> | null = null;

function hash32(value: string, seed: number): string {
    let hash = seed;
    for (let index = 0; index < value.length; index++) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(36).padStart(7, '0');
}

function contentRouteId(
    source: 'itinere' | 'rrra',
    name: string | null,
    coordinates: number[][],
): string {
    const normalized = coordinates.map(([lon, lat]) => `${lon.toFixed(5)},${lat.toFixed(5)}`);
    const forwards = normalized.join(';');
    const backwards = [...normalized].reverse().join(';');
    const canonicalGeometry = forwards < backwards ? forwards : backwards;
    const content = `${name?.trim() ?? ''}|${canonicalGeometry}`;
    return `${source}-${hash32(content, 0x811c9dc5)}${hash32(content, 0x9e3779b9)}`;
}

function routeId(
    feat: RomanRoadFeature,
    source: 'itinere' | 'rrra',
    name: string | null,
    ring: number[][],
    ringCount: number,
): string {
    if (feat.id && ringCount === 1) return feat.id;
    return contentRouteId(source, name, ring);
}

export function romanRoadsAssetUrl(): string {
    return new URL(
        `${import.meta.env.BASE_URL}${ROMAN_ROADS_DATASET.assetPath}`,
        window.location.origin,
    ).toString();
}

function getFeatures(): Promise<RomanRoadFeature[]> {
    if (!_cache) {
        _cache = cachedFetchAny(romanRoadsAssetUrl())
            .then(r => {
                if (!r.ok) throw new Error(`${ROMAN_ROADS_DATASET.assetPath}: ${r.status}`);
                return r.json();
            })
            .then(data => data.features as RomanRoadFeature[])
            .catch(e => {
                _cache = null; // allow retry
                throw e;
            });
    }
    return _cache;
}

/**
 * Prime the module-level GeoJSON cache without blocking the call site.
 * Call this at scan start so the bundled asset is in-flight while other
 * requests (NHLE, AIM, Overpass) are also running — avoids a sequential
 * wait later when fetchRomanRoads() is actually awaited.
 */
export function prefetchRomanRoads(): void {
    getFeatures().catch(error => {
        reportNonFatal('roman-roads', 'Dataset prefetch failed', error);
    });
}

/**
 * Return bundled Roman road alignments within the given bounding box.
 * Adds the shared historic-context padding so nearby roads are included.
 * Multi-ring segments are split into individual HistoricRoute entries.
 */
/**
 * W2 wrapper: returns routes with an explicit available flag so callers can
 * surface an honest layer status when the GeoJSON asset fails to load.
 * Existing callers can continue using fetchRomanRoads (thin wrapper below).
 */
export async function fetchRomanRoadsResult(
    west: number,
    south: number,
    east: number,
    north: number,
): Promise<{ routes: HistoricRoute[]; available: boolean }> {
    try {
        const routes = await fetchRomanRoads(west, south, east, north);
        return { routes, available: true };
    } catch {
        return { routes: [], available: false };
    }
}

export async function fetchRomanRoads(
    west: number,
    south: number,
    east: number,
    north: number,
): Promise<HistoricRoute[]> {
    const latPad = HISTORIC_CONTEXT_RADIUS_KM / 111.32;
    const centerLat = (south + north) / 2;
    const lonPad = HISTORIC_CONTEXT_RADIUS_KM / (111.32 * Math.max(0.1, Math.cos(centerLat * Math.PI / 180)));
    const minLon = west  - lonPad, maxLon = east  + lonPad;
    const minLat = south - latPad, maxLat = north + latPad;

    const features = await getFeatures();
    const routes: HistoricRoute[] = [];

    for (const feat of features) {
        const geom = feat.geometry;
        const rings: number[][][] =
            geom.type === 'LineString'
                ? [geom.coordinates as number[][]]
                : (geom.coordinates as number[][][]);

        const allCoords = rings.flat();
        const routeLons = allCoords.map(([lon]) => lon);
        const routeLats = allCoords.map(([, lat]) => lat);
        // Bounding-box overlap also catches a long segment that crosses the
        // context area without having a stored vertex inside it. The exact
        // 2km route-to-permission distance is enforced later by the rule.
        const inBbox = routeLons.length > 0 && routeLats.length > 0 &&
            Math.min(...routeLons) <= maxLon && Math.max(...routeLons) >= minLon &&
            Math.min(...routeLats) <= maxLat && Math.max(...routeLats) >= minLat;
        if (!inBbox) continue;

        const p = feat.properties;
        const cls: 'A' | 'B' | 'C' = p.confidenceClass ?? 'C';
        const source: 'itinere' | 'rrra' = p.source === 'rrra' ? 'rrra' : 'itinere';
        const name = p.name ?? p.Name ?? null;

        for (const ring of rings) {
            if (ring.length < 2) continue;
            const geomCoords: [number, number][] = ring.map(c => [c[0], c[1]]);
            const lons = geomCoords.map(c => c[0]);
            const lats = geomCoords.map(c => c[1]);
            routes.push({
                id:              routeId(feat, source, name, ring, rings.length),
                type:            'roman_road',
                source,
                name:            name ?? undefined,
                reference:       p.reference ?? undefined,
                confidenceClass: cls,
                certaintyScore:  cls === 'A' ? 90 : cls === 'B' ? 65 : 40,
                geometry:        geomCoords,
                bbox:            [
                    [Math.min(...lons), Math.min(...lats)],
                    [Math.max(...lons), Math.max(...lats)],
                ] as [[number, number], [number, number]],
                period: 'roman',
            });
        }
    }

    return routes;
}
