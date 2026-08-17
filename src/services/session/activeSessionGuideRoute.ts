import type { GeoJSONPolygon } from '../../db';
import { getBoundaryBounds } from './sessionFieldPosition';

export function buildActiveSessionGuideHref(input: {
  sessionId: string;
  permissionId?: string;
  fieldId?: string;
  boundary?: GeoJSONPolygon;
  target: { lat: number; lon: number } | null;
}): string {
  const params = new URLSearchParams({ scan: 'active-session', sessionId: input.sessionId });
  if (input.permissionId) params.set('permissionId', input.permissionId);
  if (input.fieldId) params.set('fieldId', input.fieldId);
  if (input.target) {
    params.set('lat', String(input.target.lat));
    params.set('lng', String(input.target.lon));
  }
  const bounds = getBoundaryBounds(input.boundary);
  if (bounds) {
    params.set('west', String(bounds.west));
    params.set('south', String(bounds.south));
    params.set('east', String(bounds.east));
    params.set('north', String(bounds.north));
  }
  return `/fieldguide?${params.toString()}`;
}
