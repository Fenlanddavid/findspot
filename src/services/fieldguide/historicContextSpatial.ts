import { booleanIntersects, booleanPointInPolygon, distance, flatten, point, pointToLineDistance, polygonToLine } from '@turf/turf';
import type { ScanBounds } from '../../pages/fieldGuideTypes';
import { hillfortScanPolygon } from './hillfortSpatial';

export type ContextGeometry = GeoJSON.Point | GeoJSON.LineString | GeoJSON.Polygon | GeoJSON.MultiPolygon;
export type ContextRelationship = 'contains_scan_centre' | 'intersects_scan' | 'point_within_scan' | 'nearby' | 'query_extent';

function boundaryLines(geometry: ContextGeometry): GeoJSON.LineString[] {
    if (geometry.type === 'Point') return [];
    if (geometry.type === 'LineString') return [geometry];
    return flatten(geometry).features.flatMap(feature =>
        flatten(polygonToLine(feature.geometry as GeoJSON.Polygon)).features.map(line => line.geometry as GeoJSON.LineString));
}

/** Distance to the actual geometry, including polygon interiors and holes. */
export function distanceToContextGeometryM(position: [number, number], geometry: ContextGeometry): number {
    const p = point(position);
    if (geometry.type === 'Point') return distance(p, geometry, { units: 'meters' });
    if ((geometry.type === 'Polygon' || geometry.type === 'MultiPolygon') && booleanPointInPolygon(p, geometry)) return 0;
    return Math.min(...boundaryLines(geometry).map(line => pointToLineDistance(p, line, { units: 'meters' })));
}

export function contextRelationship(geometry: ContextGeometry, bounds: ScanBounds, centre: [number, number], nearbyM = 2000): ContextRelationship {
    const footprint = hillfortScanPolygon(bounds);
    if (geometry.type === 'Point' && booleanPointInPolygon(geometry, footprint)) return 'point_within_scan';
    if ((geometry.type === 'Polygon' || geometry.type === 'MultiPolygon') && booleanPointInPolygon(point(centre), geometry)) return 'contains_scan_centre';
    if (booleanIntersects(geometry, footprint)) return 'intersects_scan';
    const footprintVertices = footprint.coordinates[0];
    const vertices = geometry.type === 'Point' ? [geometry.coordinates] : boundaryLines(geometry).flatMap(line => line.coordinates);
    const distanceM = Math.min(
        ...footprintVertices.map(p => distanceToContextGeometryM(p as [number, number], geometry)),
        ...vertices.map(p => distanceToContextGeometryM(p as [number, number], footprint)),
    );
    return distanceM <= nearbyM ? 'nearby' : 'query_extent';
}
