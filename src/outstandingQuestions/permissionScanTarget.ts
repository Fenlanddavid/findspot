import type { Permission } from '../db';
import * as turf from '@turf/turf';
import { reportNonFatal } from '../services/diagLog';

type PermissionScanMap = {
  getZoom: () => number;
  jumpTo: (options: { center: [number, number]; zoom: number }) => unknown;
  stop: () => unknown;
};

export function getPermissionScanTarget(permission: Permission): { lat: number; lon: number } | null {
  const points = permission.boundary?.coordinates?.[0];
  if (points?.length) {
    try {
      const [lon, lat] = turf.pointOnFeature(turf.polygon(permission.boundary!.coordinates)).geometry.coordinates;
      if (Number.isFinite(lat) && Number.isFinite(lon)) return { lat, lon };
    } catch (error) {
      reportNonFatal('outstanding-questions', 'Invalid permission boundary skipped', error);
    }
  }

  if (Number.isFinite(permission.lat) && Number.isFinite(permission.lon)) {
    return { lat: permission.lat!, lon: permission.lon! };
  }
  return null;
}

/**
 * Permission-card scans must not inherit MapLibre's in-flight flyTo position.
 * jumpTo updates getCenter/getBounds synchronously, so the terrain and historic
 * readers start from the requested permission rather than the default UK view.
 */
export function positionMapForPermissionScan(
  map: PermissionScanMap,
  permission: Permission,
): boolean {
  const target = getPermissionScanTarget(permission);
  if (!target) return false;

  map.stop();
  map.jumpTo({
    center: [target.lon, target.lat],
    zoom: Math.max(map.getZoom(), 14),
  });
  return true;
}
