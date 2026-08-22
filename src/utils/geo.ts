export type GeoPoint = {
  lat: number;
  lon: number;
};

const EARTH_RADIUS_M = 6_371_000;

/** Great-circle distance between two WGS84 latitude/longitude points. */
export function distanceMeters(left: GeoPoint, right: GeoPoint): number {
  const toRadians = Math.PI / 180;
  const leftLat = left.lat * toRadians;
  const rightLat = right.lat * toRadians;
  const deltaLat = (right.lat - left.lat) * toRadians;
  const deltaLon = (right.lon - left.lon) * toRadians;
  const haversine = Math.sin(deltaLat / 2) ** 2
    + Math.cos(leftLat) * Math.cos(rightLat) * Math.sin(deltaLon / 2) ** 2;
  const boundedHaversine = Math.max(0, Math.min(1, haversine));
  return 2 * EARTH_RADIUS_M * Math.atan2(
    Math.sqrt(boundedHaversine),
    Math.sqrt(1 - boundedHaversine),
  );
}

export function distanceKilometers(left: GeoPoint, right: GeoPoint): number {
  return distanceMeters(left, right) / 1000;
}
