import * as turf from '@turf/turf';
import type { Find, GeoJSONPolygon, Track } from '../db';
import { calculateCoverage } from '../services/coverage';
import { anchorOctant } from './types';

export const MIN_SECTIONAL_LENGTH_M = 100;
export const SECTION_COUNT = 3;

export interface InvestigationSectionStat {
  index: number;
  label: string;
  coveragePct?: number;
  findsCount?: number;
  outsidePermission: boolean;
}

export function calculateInvestigationSections(input: {
  contextGeometry?: [number, number][];
  boundary?: GeoJSONPolygon;
  bufferM: number;
  tracks: readonly Track[];
  finds: readonly Find[];
}): InvestigationSectionStat[] {
  const { contextGeometry, boundary, bufferM, tracks, finds } = input;
  if (!contextGeometry || contextGeometry.length < 2 || !boundary) return [];

  try {
    const line = turf.lineString(contextGeometry);
    const totalKm = turf.length(line, { units: 'kilometers' });
    if (totalKm * 1000 < MIN_SECTIONAL_LENGTH_M) return [];
    const polygon = turf.polygon(boundary.coordinates);
    const [centroidLon, centroidLat] = turf.centroid(polygon).geometry.coordinates;

    return Array.from({ length: SECTION_COUNT }, (_, index) => {
      const startKm = totalKm * index / SECTION_COUNT;
      const endKm = totalKm * (index + 1) / SECTION_COUNT;
      const midpoint = turf.along(line, (startKm + endKm) / 2, { units: 'kilometers' });
      const [lon, lat] = midpoint.geometry.coordinates;
      const label = anchorOctant(lat, lon, centroidLat, centroidLon);
      if (!turf.booleanPointInPolygon(midpoint, polygon)) {
        return { index, label, outsidePermission: true };
      }

      const localArea = turf.circle([lon, lat], bufferM / 1000, {
        units: 'kilometers', steps: 32,
      });
      const clipped = turf.intersect(turf.featureCollection([polygon, localArea]));
      const coveragePct = clipped
        ? calculateCoverage(clipped.geometry, [...tracks])?.percentCovered
        : undefined;
      const segment = turf.lineSliceAlong(line, startKm, endKm, { units: 'kilometers' });
      const findsCount = finds.filter(find => {
        if (find.lat == null || find.lon == null) return false;
        return turf.pointToLineDistance(
          turf.point([find.lon, find.lat]),
          segment,
          { units: 'meters' },
        ) <= bufferM;
      }).length;

      return {
        index,
        label,
        ...(coveragePct != null && Number.isFinite(coveragePct) ? { coveragePct } : {}),
        findsCount,
        outsidePermission: false,
      };
    });
  } catch {
    return [];
  }
}
