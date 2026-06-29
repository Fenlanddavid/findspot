// ─── Itiner-e Roman Road Service ─────────────────────────────────────────────
// Loads Roman road alignments from the Itiner-e dataset (de Soto et al. 2025,
// CC-BY-4.0). The GeoJSON is bundled in /public and served as a static asset.
// A session-level cache avoids re-fetching on every scan.

import { HistoricRoute } from '../pages/fieldGuideTypes';
import { cachedFetchAny } from '../utils/cachedFetch';

interface ItinereFeature {
    type: 'Feature';
    properties: {
        Segment_s: string;
        Name: string | null;
        Type: string;
        confidenceClass: 'A' | 'B' | 'C';
    };
    geometry: {
        type: 'LineString' | 'MultiLineString';
        coordinates: number[][] | number[][][];
    };
}

let _cache: Promise<ItinereFeature[]> | null = null;

export function romanRoadsAssetUrl(): string {
    return new URL(`${import.meta.env.BASE_URL}roman-roads-gb.geojson`, window.location.origin).toString();
}

function getFeatures(): Promise<ItinereFeature[]> {
    if (!_cache) {
        _cache = cachedFetchAny(romanRoadsAssetUrl())
            .then(r => {
                if (!r.ok) throw new Error(`roman-roads-gb.geojson: ${r.status}`);
                return r.json();
            })
            .then(data => data.features as ItinereFeature[])
            .catch(e => {
                _cache = null; // allow retry
                throw e;
            });
    }
    return _cache;
}

/**
 * Prime the module-level GeoJSON cache without blocking the call site.
 * Call this at scan start so the 150 KB asset is in-flight while other
 * requests (NHLE, AIM, Overpass) are also running — avoids a sequential
 * wait later when fetchRomanRoads() is actually awaited.
 */
export function prefetchRomanRoads(): void {
    getFeatures().catch(() => { /* silently ignore — fetchRomanRoads handles retry */ });
}

/**
 * Return Itiner-e Roman road alignments within the given bounding box.
 * Adds 2km padding so roads just outside the visible viewport are included.
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
    // 2km padding so roads near the edge of the viewport are included
    const latPad = 2 / 111.32;
    const centerLat = (south + north) / 2;
    const lonPad = 2 / (111.32 * Math.max(0.1, Math.cos(centerLat * Math.PI / 180)));
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
        const inBbox = allCoords.some(
            ([lon, latC]) => lon >= minLon && lon <= maxLon && latC >= minLat && latC <= maxLat,
        );
        if (!inBbox) continue;

        const p = feat.properties;
        const cls: 'A' | 'B' | 'C' = p.confidenceClass ?? 'C';

        for (const ring of rings) {
            if (ring.length < 2) continue;
            const geomCoords: [number, number][] = ring.map(c => [c[0], c[1]]);
            const lons = geomCoords.map(c => c[0]);
            const lats = geomCoords.map(c => c[1]);
            routes.push({
                id:              `itinere-${routes.length}`,
                type:            'roman_road',
                source:          'itinere',
                name:            p.Name ?? undefined,
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
