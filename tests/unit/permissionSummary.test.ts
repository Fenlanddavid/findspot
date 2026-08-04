import { describe, expect, it } from 'vitest';
import type { PermissionSection, SessionCoverageObservation } from '../../src/db';
import { geometryAreaM2, persistedCoveragePercent } from '../../src/services/permissionSummary';

const ISO = '2026-08-04T08:00:00.000Z';

function section(id: string, areaM2: number): PermissionSection {
  return {
    id,
    permissionId: 'permission-1',
    fieldId: 'field-1',
    layoutKey: id,
    label: id,
    currentGeometryVersion: 1,
    geometryVersions: [{
      version: 1,
      boundaryHash: id,
      geometry: {
        type: 'Polygon',
        coordinates: [[[0, 52], [0.001, 52], [0.001, 52.001], [0, 52],]],
      },
      areaM2,
      effectiveFrom: ISO,
    }],
    createdAt: ISO,
    updatedAt: ISO,
  };
}

function observation(
  id: string,
  sectionId: string,
  evidence: SessionCoverageObservation['evidence'],
  coverageFraction?: number,
): SessionCoverageObservation {
  return {
    id,
    sessionId: `session-${id}`,
    permissionId: 'permission-1',
    sectionId,
    sectionGeometryVersion: 1,
    evidence,
    coverageFraction,
    startedAt: 1,
    observedAt: 2,
    createdAt: ISO,
    updatedAt: ISO,
  };
}

describe('lightweight permission summary', () => {
  it('calculates a plausible geodesic area without loading Turf', () => {
    const area = geometryAreaM2({
      type: 'Polygon',
      coordinates: [[[0, 52], [0.001, 52], [0.001, 52.001], [0, 52.001], [0, 52]]],
    });
    expect(area).toBeGreaterThan(7_000);
    expect(area).toBeLessThan(8_000);
  });

  it('uses the strongest saved evidence per current section', () => {
    const result = persistedCoveragePercent(
      [section('small', 100), section('large', 300)],
      [
        observation('a', 'small', 'tracked', 0.5),
        observation('b', 'small', 'tracked', 0.8),
        observation('c', 'large', 'reported'),
        observation('d', 'large', 'find-visited'),
      ],
    );
    expect(result).toBe(95);
  });

  it('does not present find visits or stale geometry as searched coverage', () => {
    const stale = observation('stale', 'one', 'reported');
    stale.sectionGeometryVersion = 0;
    expect(persistedCoveragePercent(
      [section('one', 100)],
      [stale, observation('visit', 'one', 'find-visited')],
    )).toBeNull();
  });
});
