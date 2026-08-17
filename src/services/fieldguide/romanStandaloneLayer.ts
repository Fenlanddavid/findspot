import type maplibregl from 'maplibre-gl';
import type { HistoricRoute } from '../../pages/fieldGuideTypes';
import type { RomanStandaloneLayerStatus } from '../../hooks/useFieldGuidePageState';
import { fetchRomanRoads } from '../romanRoadService';
import { reportNonFatal } from '../diagLog';
import { ROMAN_STANDALONE_MIN_ZOOM } from './romanRoadLayerConfig';

export type RomanStandaloneBounds = {
    west: number;
    south: number;
    east: number;
    north: number;
};

type RomanRoadFetcher = (
    west: number,
    south: number,
    east: number,
    north: number,
) => Promise<HistoricRoute[]>;

export function romanBoundsContain(
    fetched: RomanStandaloneBounds,
    viewport: RomanStandaloneBounds,
): boolean {
    return fetched.west <= viewport.west
        && fetched.south <= viewport.south
        && fetched.east >= viewport.east
        && fetched.north >= viewport.north;
}

export async function populateRomanStandaloneRoads(
    map: maplibregl.Map,
    bounds: RomanStandaloneBounds,
    fetchRoads: RomanRoadFetcher = fetchRomanRoads,
): Promise<RomanStandaloneLayerStatus> {
    if (map.getZoom() < ROMAN_STANDALONE_MIN_ZOOM) return 'zoom-in';
    const source = map.getSource('roman-roads-standalone') as maplibregl.GeoJSONSource | undefined;
    try {
        const routes = await fetchRoads(bounds.west, bounds.south, bounds.east, bounds.north);
        source?.setData({
            type: 'FeatureCollection',
            features: routes.map(route => ({
                type: 'Feature' as const,
                geometry: { type: 'LineString' as const, coordinates: route.geometry },
                properties: {
                    id: route.id,
                    source: route.source,
                    name: route.name,
                    reference: route.reference,
                    confidenceClass: route.confidenceClass,
                },
            })),
        });
        return 'available';
    } catch (error) {
        source?.setData({ type: 'FeatureCollection', features: [] });
        reportNonFatal('field-guide-map', 'Roman roads layer unavailable', error);
        return 'unavailable';
    }
}
