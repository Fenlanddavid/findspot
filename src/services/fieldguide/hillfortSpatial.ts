import { bbox, booleanPointInPolygon, distance, flatten, point, pointToLineDistance, polygonToLine } from '@turf/turf';
import type { HillfortContext, HillfortDataset, HillfortResult, HillfortScanGeometry } from '../../types/hillforts';
import type { NHLEFeature } from '../historicScanService';

/** Retrieval distance from scan boundary; never an archaeological influence area. */
export const HILLFORT_CONTEXT_PADDING_M = 2000;

export function hillfortScanPolygon(bounds: { west: number; south: number; east: number; north: number }): GeoJSON.Polygon {
    return { type: 'Polygon', coordinates: [[[bounds.west, bounds.south], [bounds.east, bounds.south], [bounds.east, bounds.north], [bounds.west, bounds.north], [bounds.west, bounds.south]]] };
}

export function hillfortGeometryFingerprint(geometry: HillfortScanGeometry, centre: [number, number]): string {
    return JSON.stringify([geometry, centre, HILLFORT_CONTEXT_PADDING_M]);
}

function nameKey(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export function matchHillfortSources(result: HillfortResult, features: NHLEFeature[]): HillfortResult['matches'] {
    const ids: string[] = result.record.identifiers['Scheduled Monument Number']?.match(/\b\d{7}\b/g) ?? [];
    const matches: HillfortResult['matches'] = [];
    for (const feature of features) {
        const attrs = feature.properties as Record<string, unknown>;
        const id = String(attrs.ListEntry ?? attrs.LIST_ENTRY ?? attrs.list_entry ?? '');
        if (!id) continue;
        if (result.record.country === 'England' && ids.includes(id)) {
            matches.push({ source: 'NHLE', sourceId: id, relationship: 'shared_identifier', reason: 'Atlas Scheduled Monument Number equals authoritative NHLE ListEntry; current geometry and legal status remain with NHLE.' });
            continue;
        }
        const name = String(attrs.Name ?? attrs.NAME ?? '');
        const g = feature.geometry;
        if (nameKey(name) === nameKey(result.record.name) && /hill\s?fort/i.test(name) && g?.type === 'Point' && g.coordinates.length >= 2
            && distance(result.record.position, g.coordinates, { units: 'meters' }) <= 200) {
            matches.push({ source: 'NHLE', sourceId: id, relationship: 'unresolved_candidate', reason: 'Same normalized name, hillfort wording and point within 200 m. Not a confirmed merge or independent corroboration.' });
        }
    }
    return matches.sort((a, b) => a.sourceId.localeCompare(b.sourceId));
}

export function queryHillforts(dataset: HillfortDataset, geometry: HillfortScanGeometry, centre: [number, number], features: NHLEFeature[] = []): HillfortContext {
    const extent = bbox(geometry);
    if (extent.some(v => !Number.isFinite(v)) || extent[2] - extent[0] > 2 || extent[3] - extent[1] > 2) throw new Error('Invalid or unbounded hillfort scan extent');
    const context: HillfortContext = {
        status: 'empty', generation: dataset.metadata.generation, centre,
        geometryFingerprint: hillfortGeometryFingerprint(geometry, centre),
        contextPaddingM: HILLFORT_CONTEXT_PADDING_M, metadata: dataset.metadata, results: [],
    };
    // Only assert outside when certainly beyond the documented region; gaps in
    // Atlas records are never a geographic coverage polygon.
    if (extent[2] < -11 || extent[0] > 2 || extent[3] < 49.8 || extent[1] > 61.1) {
        context.status = 'outside_coverage';
        return context;
    }
    const lines = flatten(geometry).features.flatMap(p => {
        const l = polygonToLine(p.geometry as GeoJSON.Polygon);
        return flatten(l).features.map(f => f.geometry as GeoJSON.LineString);
    });
    const padLat = HILLFORT_CONTEXT_PADDING_M / 110_000;
    const padLon = padLat / Math.cos(Math.max(Math.abs(extent[1]), Math.abs(extent[3])) * Math.PI / 180);
    for (const record of dataset.records) {
        const [lon, lat] = record.position;
        if (lon < extent[0] - padLon || lon > extent[2] + padLon || lat < extent[1] - padLat || lat > extent[3] + padLat) continue;
        const p = point(record.position);
        const inside = booleanPointInPolygon(p, geometry, { ignoreBoundary: false });
        const boundaryDistance = inside ? 0 : Math.min(...lines.map(line => pointToLineDistance(p, line, { units: 'meters' })));
        if (!inside && boundaryDistance > HILLFORT_CONTEXT_PADDING_M) continue;
        const result: HillfortResult = { record, relationship: inside ? 'within_scan' : 'surrounding_context', distanceFromCentreM: distance(centre, record.position, { units: 'meters' }), distanceFromBoundaryM: boundaryDistance, matches: [] };
        result.matches = matchHillfortSources(result, features);
        context.results.push(result);
    }
    context.results.sort((a, b) => a.distanceFromCentreM - b.distanceFromCentreM || a.record.id.localeCompare(b.record.id));
    context.status = dataset.metadata.rejectedRecordCount ? 'partial' : context.results.length ? 'loaded' : 'empty';
    return context;
}

export function hillfortContextSignature(context?: HillfortContext | null): string {
    return context ? JSON.stringify(context) : 'hillforts:not_assessed';
}

export function hillfortDistanceLabel(metres: number): string {
    return metres < 100 ? 'Within 100 m of scan centre' : `${(Math.round(metres / 100) / 10).toFixed(1)} km from scan centre`;
}

export function hillfortStatusLabel(context?: HillfortContext | null): string {
    if (!context) return 'Hillfort context not assessed';
    return {
        loaded: `${context.results.length} ${context.results.length === 1 ? 'record' : 'records'} in the scan and surrounding 2 km`,
        empty: 'No records returned within the scan and surrounding 2 km. This does not establish an absence of archaeology.',
        partial: 'Hillfort context partly available; some source records could not be mapped.',
        unavailable_offline: 'Hillfort data not downloaded or evicted; unavailable offline.',
        load_failure: 'Hillfort context could not be loaded. Other scan results remain available.',
        outside_coverage: 'Scan outside documented hillfort coverage.',
    }[context.status];
}
