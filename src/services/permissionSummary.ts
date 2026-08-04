import type {
  GeoJSONArea,
  PermissionSection,
  SessionCoverageObservation,
} from '../shared/coverageTypes';
import { currentSectionGeometry } from '../shared/coverageRecords';

const EARTH_RADIUS_M = 6_371_008.8;

function toRadians(value: number): number {
  return value * Math.PI / 180;
}

function ringAreaM2(ring: number[][]): number {
  if (ring.length < 3) return 0;
  let total = 0;
  for (let index = 0; index < ring.length; index += 1) {
    const lower = ring[(index + ring.length - 1) % ring.length];
    const middle = ring[index];
    const upper = ring[(index + 1) % ring.length];
    total += (toRadians(upper[0]) - toRadians(lower[0])) * Math.sin(toRadians(middle[1]));
  }
  return total * EARTH_RADIUS_M * EARTH_RADIUS_M / 2;
}

function polygonAreaM2(rings: number[][][]): number {
  if (rings.length === 0) return 0;
  const outer = Math.abs(ringAreaM2(rings[0]));
  const holes = rings.slice(1).reduce((sum, ring) => sum + Math.abs(ringAreaM2(ring)), 0);
  return Math.max(0, outer - holes);
}

/** Lightweight geodesic area calculation, kept out of the Home page's Turf bundle. */
export function geometryAreaM2(geometry: GeoJSONArea): number {
  if (geometry.type === 'Polygon') return polygonAreaM2(geometry.coordinates);
  return geometry.coordinates.reduce((sum, polygon) => sum + polygonAreaM2(polygon), 0);
}

/**
 * Summarises already-derived coverage without loading raw GPS tracks.
 * Repeated sessions use the strongest saved evidence for each current section.
 */
export function persistedCoveragePercent(
  sections: PermissionSection[],
  observations: SessionCoverageObservation[],
): number | null {
  const activeSections = sections.filter(section => !section.retiredAt);
  if (activeSections.length === 0) return null;

  const sectionById = new Map(activeSections.map(section => [section.id, section]));
  const strongestFraction = new Map<string, number>();
  for (const observation of observations) {
    if (observation.evidence === 'find-visited') continue;
    const section = sectionById.get(observation.sectionId);
    if (!section || observation.sectionGeometryVersion !== section.currentGeometryVersion) continue;
    const fraction = observation.evidence === 'reported'
      ? 1
      : Math.max(0, Math.min(1, observation.coverageFraction ?? 0));
    strongestFraction.set(
      section.id,
      Math.max(strongestFraction.get(section.id) ?? 0, fraction),
    );
  }
  if (strongestFraction.size === 0) return null;

  let totalAreaM2 = 0;
  let coveredAreaM2 = 0;
  for (const section of activeSections) {
    const areaM2 = currentSectionGeometry(section)?.areaM2 ?? 0;
    if (areaM2 <= 0) continue;
    totalAreaM2 += areaM2;
    coveredAreaM2 += areaM2 * (strongestFraction.get(section.id) ?? 0);
  }
  return totalAreaM2 > 0 ? coveredAreaM2 / totalAreaM2 * 100 : null;
}
