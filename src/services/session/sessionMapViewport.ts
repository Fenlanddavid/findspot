import type { GeoJSONPolygon, Track } from '../../db';

type Coordinate = [number, number];

type LocatedPoint = { lat: number; lon: number };

type SessionMapViewportInput = {
  boundary?: GeoJSONPolygon;
  tracks?: Track[];
  center?: LocatedPoint | null;
  liveLocation?: LocatedPoint | null;
  markers?: LocatedPoint[];
};

function isCoordinate(value: number[]): value is Coordinate {
  return value.length >= 2 && Number.isFinite(value[0]) && Number.isFinite(value[1]);
}

/**
 * Chooses the authoritative first viewport for a session map. A recorded
 * boundary wins over session/GPS content so a late location fix cannot make
 * the initial map open away from the field the visit belongs to.
 */
export function initialSessionMapCoordinates(input: SessionMapViewportInput): Coordinate[] {
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

/** Keeps the map constructor off the UK fallback while its style is loading. */
export function initialSessionMapCenter(input: SessionMapViewportInput): Coordinate | null {
  const coordinates = initialSessionMapCoordinates(input);
  if (coordinates.length === 0) return null;
  let west = coordinates[0][0];
  let east = coordinates[0][0];
  let south = coordinates[0][1];
  let north = coordinates[0][1];
  for (const [lon, lat] of coordinates.slice(1)) {
    west = Math.min(west, lon);
    east = Math.max(east, lon);
    south = Math.min(south, lat);
    north = Math.max(north, lat);
  }
  return [(west + east) / 2, (south + north) / 2];
}
