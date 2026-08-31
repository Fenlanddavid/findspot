import { describe, expect, it } from 'vitest';
import type { PermissionSection, SessionCoverageObservation } from '../../src/db';
import { recordedCoverageEstimate } from '../../src/shared/coveragePresentation';

function section(id: string, areaM2: number): PermissionSection {
  return {
    id,
    permissionId: 'permission',
    fieldId: 'field',
    label: id,
    currentGeometryVersion: 1,
    geometryVersions: [{ version: 1, geometry: { type: 'Polygon', coordinates: [] }, areaM2, createdAt: '2026-01-01' }],
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
  } as PermissionSection;
}

function observation(sectionId: string, evidence: SessionCoverageObservation['evidence'], coverageFraction?: number): SessionCoverageObservation {
  return {
    id: `${sectionId}-${evidence}`,
    sessionId: 'session',
    permissionId: 'permission',
    fieldId: 'field',
    sectionId,
    sectionGeometryVersion: 1,
    evidence,
    coverageFraction,
    observedAt: '2026-01-01',
  } as SessionCoverageObservation;
}

describe('recorded coverage percentage', () => {
  it('area-weights reported and tracked evidence', () => {
    const result = recordedCoverageEstimate(
      [section('small', 100), section('large', 300)],
      [observation('small', 'reported'), observation('large', 'tracked', 0.5)],
    );
    expect(result).toMatchObject({ percent: 63, coveredAreaM2: 250, totalAreaM2: 400 });
  });

  it('ignores find-only evidence and stale section geometry', () => {
    expect(recordedCoverageEstimate(
      [section('one', 100)],
      [observation('one', 'find-visited')],
    )).toBeNull();
    const stale = { ...observation('one', 'tracked', 1), sectionGeometryVersion: 0 };
    expect(recordedCoverageEstimate([section('one', 100)], [stale])).toBeNull();
  });
});
