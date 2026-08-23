import type { GeoJSONPolygon, Track } from '../../db';

type Coordinate = [number, number];

type LocatedPoint = { lat: number; lon: number };

function isCoordinate(value: number[]): value is Coordinate {
  return value.length >= 2 && Number.isFinite(value[0]) && Number.isFinite(value[1]);
}

/**
 * Chooses the authoritative first viewport for a session map. A recorded
 * boundary wins over session/GPS content so a late location fix cannot make
 * the initial map open away from the field the visit belongs to.
 */
export function initialSessionMapCoordinates(input: {
  boundary?: GeoJSONPolygon;
  tracks?: Track[];
  center?: LocatedPoint | null;
  liveLocation?: LocatedPoint | null;
  markers?: LocatedPoint[];
}): Coordinate[] {
  const boundaryCoordinates = (input.boundary?.coordinates?.[0] ?? [])
    .filter(isCoordinate)
    .map(point => [point[0], point[1]] as Coordinate);
  if (boundaryCoordinates.length > 0) return boundaryCoordinates;

  const trackCoordinates = (input.tracks ?? []).flatMap(track =>
    (track.points ?? []).map(point => [point.lon, point.lat] as Coordinate),
  );
  const centerCoordinates = input.center ? [[input.center.lon, input.center.lat] as Coordinate] : [];
  const liveCoordinates = input.liveLocation ? [[input.liveLocation.lon, input.liveLocation.lat] as Coordinate] : [];
  const markerCoordinates = (input.markers ?? []).map(marker => [marker.lon, marker.lat] as Coordinate);
  return [...trackCoordinates, ...centerCoordinates, ...liveCoordinates, ...markerCoordinates];
}
