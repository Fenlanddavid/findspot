import type { GeoJSONPolygon } from '../../db';

export type FieldLocation = {
  lat: number;
  lon: number;
  accuracyM?: number | null;
  headingDegrees?: number | null;
};

export type BoundaryPositionStatus = {
  kind: 'inside' | 'near' | 'outside' | 'uncertain';
  distanceM: number;
  label: string;
};

export type BoundaryBounds = {
  west: number;
  south: number;
  east: number;
  north: number;
};

const EARTH_RADIUS_M = 6_371_000;

export function getBoundaryBounds(boundary: GeoJSONPolygon | undefined): BoundaryBounds | null {
  if (!boundary?.coordinates?.length) return null;
  let west = Number.POSITIVE_INFINITY;
  let south = Number.POSITIVE_INFINITY;
  let east = Number.NEGATIVE_INFINITY;
  let north = Number.NEGATIVE_INFINITY;
  for (const ring of boundary.coordinates) {
    for (const point of ring) {
      const [lon, lat] = point;
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
      west = Math.min(west, lon);
      south = Math.min(south, lat);
      east = Math.max(east, lon);
      north = Math.max(north, lat);
    }
  }
  return Number.isFinite(west) && Number.isFinite(south) && east > west && north > south
    ? { west, south, east, north }
    : null;
}

export function distanceMetres(left: Pick<FieldLocation, 'lat' | 'lon'>, right: Pick<FieldLocation, 'lat' | 'lon'>): number {
  const lat1 = left.lat * Math.PI / 180;
  const lat2 = right.lat * Math.PI / 180;
  const dLat = lat2 - lat1;
  const dLon = (right.lon - left.lon) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function pointInRing(point: FieldLocation, ring: number[][]): boolean {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const currentPoint = ring[index];
    const previousPoint = ring[previous];
    if (!currentPoint || !previousPoint) continue;
    const [currentLon, currentLat] = currentPoint;
    const [previousLon, previousLat] = previousPoint;
    const crosses = (currentLat > point.lat) !== (previousLat > point.lat)
      && point.lon < (previousLon - currentLon) * (point.lat - currentLat) / ((previousLat - currentLat) || Number.EPSILON) + currentLon;
    if (crosses) inside = !inside;
  }
  return inside;
}

function segmentDistanceMetres(point: FieldLocation, start: number[], end: number[]): number {
  const latitudeRadians = point.lat * Math.PI / 180;
  const metresPerLonDegree = 111_320 * Math.cos(latitudeRadians);
  const metresPerLatDegree = 110_540;
  const startX = (start[0] - point.lon) * metresPerLonDegree;
  const startY = (start[1] - point.lat) * metresPerLatDegree;
  const endX = (end[0] - point.lon) * metresPerLonDegree;
  const endY = (end[1] - point.lat) * metresPerLatDegree;
  const dx = endX - startX;
  const dy = endY - startY;
  const lengthSquared = dx * dx + dy * dy;
  const fraction = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, -(startX * dx + startY * dy) / lengthSquared));
  return Math.hypot(startX + fraction * dx, startY + fraction * dy);
}

function boundaryDistanceMetres(boundary: GeoJSONPolygon, point: FieldLocation): number {
  let nearest = Number.POSITIVE_INFINITY;
  for (const ring of boundary.coordinates) {
    for (let index = 1; index < ring.length; index++) {
      nearest = Math.min(nearest, segmentDistanceMetres(point, ring[index - 1], ring[index]));
    }
  }
  return nearest;
}

export function evaluateBoundaryPosition(boundary: GeoJSONPolygon | undefined, point: FieldLocation | null): BoundaryPositionStatus | null {
  const outerRing = boundary?.coordinates[0];
  if (!boundary || !outerRing?.length || !point) return null;
  const distanceM = boundaryDistanceMetres(boundary, point);
  const accuracyM = point.accuracyM ?? null;
  const insideOuter = pointInRing(point, outerRing);
  const insideHole = boundary.coordinates.slice(1).some(ring => pointInRing(point, ring));
  const inside = insideOuter && !insideHole;
  const accuracyText = accuracyM != null ? ` · GPS ±${Math.round(accuracyM)}m` : '';
  const uncertainty = Math.max(12, accuracyM ?? 0);

  if (!inside && distanceM <= uncertainty) {
    return { kind: 'uncertain', distanceM, label: `Recorded boundary nearby${accuracyText}` };
  }
  if (!inside) {
    return { kind: 'outside', distanceM, label: `Position appears outside recorded boundary${accuracyText}` };
  }
  if (distanceM <= Math.max(20, uncertainty * 1.5)) {
    return { kind: 'near', distanceM, label: `Near recorded boundary${accuracyText}` };
  }
  return { kind: 'inside', distanceM, label: `Inside recorded boundary${accuracyText}` };
}

export function locationAccuracyCircle(point: FieldLocation | null): GeoJSON.FeatureCollection {
  if (!point || !point.accuracyM || point.accuracyM <= 0) return { type: 'FeatureCollection', features: [] };
  const coordinates: number[][] = [];
  const latitudeRadians = point.lat * Math.PI / 180;
  const latDegrees = point.accuracyM / 110_540;
  const lonDegrees = point.accuracyM / (111_320 * Math.max(0.1, Math.cos(latitudeRadians)));
  for (let index = 0; index <= 32; index++) {
    const angle = index / 32 * Math.PI * 2;
    coordinates.push([point.lon + Math.cos(angle) * lonDegrees, point.lat + Math.sin(angle) * latDegrees]);
  }
  return {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: {},
      geometry: { type: 'Polygon', coordinates: [coordinates] },
    }],
  };
}

export function locationHeadingLine(point: FieldLocation | null): GeoJSON.FeatureCollection {
  if (!point || point.headingDegrees == null || !Number.isFinite(point.headingDegrees)) return { type: 'FeatureCollection', features: [] };
  const bearing = point.headingDegrees * Math.PI / 180;
  const distanceM = 16;
  const lat = point.lat + Math.cos(bearing) * distanceM / 110_540;
  const lon = point.lon + Math.sin(bearing) * distanceM / (111_320 * Math.max(0.1, Math.cos(point.lat * Math.PI / 180)));
  return { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[point.lon, point.lat], [lon, lat]] } }] };
}
