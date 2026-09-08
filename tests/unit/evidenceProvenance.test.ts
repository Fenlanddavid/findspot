import { describe, expect, it } from 'vitest';
import {
  assessEvidenceIndependence,
  assessEvidenceQuality,
  assessImageryFootprints,
  assessImageryIndependence,
  evidenceProvenanceLabels,
  hasDistinctImageryObservations,
  type EvidenceProvenance,
} from '../../src/types/evidenceProvenance';
import { findConsensus } from '../../src/utils/fieldGuideAnalysis';
import { buildTerrainHotspots } from '../../src/engines/hotspot/hotspotEngine';
import { computeTraceTargets } from '../../src/engines/hotspot/traceTargetEngine';
import type { Cluster } from '../../src/pages/fieldGuideTypes';

function observation(overrides: Partial<EvidenceProvenance> = {}): EvidenceProvenance {
  return {
    observationId: 'a',
    requestedSource: 'satellite_spring',
    deliveredSource: 'world-imagery',
    datasetIdentity: 'World Imagery',
    parentSourceIdentity: 'world-imagery:tile-1',
    contentIdentity: 'a'.repeat(64),
    decodedContentIdentity: '1'.repeat(64),
    deliveredDataType: 'rgb_imagery',
    retrievalDate: '2026-09-08T00:00:00.000Z',
    fallbackStatus: 'fallback',
    tile: { z: 16, x: 1, y: 1 },
    ...overrides,
  };
}

describe('evidence provenance identity', () => {
  it('does not count two requested seasons backed by the same image as independent', () => {
    expect(hasDistinctImageryObservations([
      observation(),
      observation({ observationId: 'b', requestedSource: 'satellite_summer' }),
    ])).toBe(false);
  });

  it('keeps changed pixels unknown when acquisition relationships are unavailable', () => {
    const provenance = [
      observation({ fallbackStatus: 'requested', parentSourceIdentity: 'wayback:version-a' }),
      observation({ observationId: 'b', fallbackStatus: 'requested', parentSourceIdentity: 'wayback:version-b', contentIdentity: 'b'.repeat(64), decodedContentIdentity: '2'.repeat(64) }),
    ];
    expect(assessImageryIndependence(provenance)).toBe('changed_content_unknown_acquisition');
    expect(hasDistinctImageryObservations(provenance)).toBe(false);
  });

  it('only verifies distinct acquisitions on a matching footprint with dates and changed pixels', () => {
    expect(hasDistinctImageryObservations([
      observation({ parentSourceIdentity: 'acquisition-a', acquisitionDate: '2024-04-01' }),
      observation({ observationId: 'b', parentSourceIdentity: 'acquisition-b', acquisitionDate: '2025-06-01', decodedContentIdentity: '2'.repeat(64) }),
    ])).toBe(true);
  });

  it('does not borrow acquisition dates from non-overlapping tiles', () => {
    const provenance = [
      observation({ parentSourceIdentity: 'version-a', acquisitionDate: undefined }),
      observation({ observationId: 'a-dated', parentSourceIdentity: 'version-a', tile: { z: 16, x: 2, y: 1 }, acquisitionDate: '2020-01-01' }),
      observation({ observationId: 'b', parentSourceIdentity: 'version-b', decodedContentIdentity: '2'.repeat(64), acquisitionDate: undefined }),
      observation({ observationId: 'b-dated', parentSourceIdentity: 'version-b', tile: { z: 16, x: 3, y: 1 }, acquisitionDate: '2021-01-01' }),
    ];
    expect(assessImageryIndependence(provenance)).toBe('changed_content_unknown_acquisition');
    expect(assessImageryFootprints(provenance)).toEqual([
      expect.objectContaining({ footprint: '16/1/1', state: 'changed_content_unknown_acquisition' }),
    ]);
  });

  it('requires two valid dates on the matching observations', () => {
    const cases = [
      [undefined, '2025-01-01'],
      ['not-a-date', '2025-01-01'],
      ['2024-01-01', undefined],
    ] as const;
    for (const [leftDate, rightDate] of cases) {
      expect(assessImageryIndependence([
        observation({ parentSourceIdentity: 'version-a', acquisitionDate: leftDate }),
        observation({ observationId: 'b', parentSourceIdentity: 'version-b', decodedContentIdentity: '2'.repeat(64), acquisitionDate: rightDate }),
      ])).toBe('changed_content_unknown_acquisition');
    }
  });

  it('keeps mixed footprint corroboration local and the combined assessment conservative', () => {
    const provenance = [
      observation({ parentSourceIdentity: 'version-a', acquisitionDate: '2024-01-01' }),
      observation({ observationId: 'a-2', parentSourceIdentity: 'version-a', tile: { z: 16, x: 2, y: 1 }, acquisitionDate: undefined, decodedContentIdentity: '3'.repeat(64) }),
      observation({ observationId: 'b', parentSourceIdentity: 'version-b', acquisitionDate: '2025-01-01', decodedContentIdentity: '2'.repeat(64) }),
      observation({ observationId: 'b-2', parentSourceIdentity: 'version-b', tile: { z: 16, x: 2, y: 1 }, acquisitionDate: undefined, decodedContentIdentity: '4'.repeat(64) }),
    ];
    expect(assessImageryFootprints(provenance).map(item => item.state)).toEqual([
      'verified_distinct_acquisitions', 'changed_content_unknown_acquisition',
    ]);
    expect(assessImageryIndependence(provenance)).toBe('changed_content_unknown_acquisition');
    expect(assessEvidenceIndependence(provenance).independentObservationCount).toBe(1);
  });

  it('does not corroborate different release IDs delivering identical bytes', () => {
    expect(hasDistinctImageryObservations([
      observation({ fallbackStatus: 'requested', parentSourceIdentity: 'wayback:version-a' }),
      observation({ observationId: 'b', fallbackStatus: 'requested', parentSourceIdentity: 'wayback:version-b' }),
    ])).toBe(false);
  });

  it('ignores missing coverage when the shared tile is identical', () => {
    expect(assessImageryIndependence([
      observation({ parentSourceIdentity: 'version-a' }),
      observation({ observationId: 'a-2', parentSourceIdentity: 'version-a', tile: { z: 16, x: 2, y: 1 }, decodedContentIdentity: '3'.repeat(64) }),
      observation({ observationId: 'b', parentSourceIdentity: 'version-b' }),
    ])).toBe('identical_content');
  });

  it('does not infer a repeat observation from disjoint footprints', () => {
    expect(assessImageryIndependence([
      observation({ parentSourceIdentity: 'version-a' }),
      observation({ observationId: 'b', parentSourceIdentity: 'version-b', tile: { z: 16, x: 2, y: 1 }, decodedContentIdentity: '2'.repeat(64), acquisitionDate: '2025-01-01' }),
    ])).toBe('insufficient_overlap');
  });

  it('deduplicates repeated provenance before counting observations', () => {
    const repeated = observation({ parentSourceIdentity: 'version-a' });
    expect(assessEvidenceIndependence([repeated, { ...repeated, observationId: 'duplicate' }]))
      .toMatchObject({ independentObservationCount: 1 });
  });

  it('groups terrain derivatives by their verified underlying source lineage', () => {
    const hillshade = observation({
      observationId: 'hillshade', deliveredDataType: 'rendered_hillshade',
      parentSourceIdentity: 'ea-lidar-composite-2022', sourceLineageIdentity: 'ea-lidar-composite',
      lineageConfidence: 'verified', decodedContentIdentity: undefined, contentIdentity: undefined,
    });
    const slope = observation({
      observationId: 'slope', deliveredDataType: 'rendered_slope',
      parentSourceIdentity: 'ea-lidar-composite-2022', sourceLineageIdentity: 'ea-lidar-composite',
      lineageConfidence: 'verified', decodedContentIdentity: undefined, contentIdentity: undefined,
    });
    const relief = observation({
      observationId: 'relief', deliveredDataType: 'rendered_relief',
      parentSourceIdentity: 'ea-lidar-composite-2022', sourceLineageIdentity: 'ea-lidar-composite',
      lineageConfidence: 'verified', decodedContentIdentity: undefined, contentIdentity: undefined,
    });
    const assessment = assessEvidenceIndependence([hillshade, slope, relief, { ...slope }]);
    expect(assessment.independentObservationCount).toBe(1);
    expect(assessment.deduplicatedProvenance).toHaveLength(3);
  });

  it('counts only explicitly verified independent terrain lineages', () => {
    const terrain = (parent: string, lineage?: string, verified = false) => observation({
      observationId: parent, deliveredDataType: 'rendered_hillshade', parentSourceIdentity: parent,
      sourceLineageIdentity: lineage, lineageConfidence: verified ? 'verified' : 'unknown',
      decodedContentIdentity: undefined, contentIdentity: undefined,
    });
    expect(assessEvidenceIndependence([
      terrain('release-2022'), terrain('release-2025'),
    ]).independentObservationCount).toBe(1);
    expect(assessEvidenceIndependence([
      terrain('source-a', 'lineage-a', true), terrain('source-b', 'lineage-b', true),
    ]).independentObservationCount).toBe(2);
  });

  it('uses decoded identity to reject differently encoded equivalent imagery', () => {
    expect(assessImageryIndependence([
      observation({ parentSourceIdentity: 'version-a', contentIdentity: 'a'.repeat(64), acquisitionDate: '2024-01-01' }),
      observation({ observationId: 'b', parentSourceIdentity: 'version-b', contentIdentity: 'b'.repeat(64), acquisitionDate: '2025-01-01' }),
    ])).toBe('identical_content');
  });

  it('does not award perfect quality for delivered imagery with unknown coverage, resolution and date', () => {
    const assessment = assessEvidenceQuality([observation({ fallbackStatus: 'requested' })]);
    expect(assessment.score).toBeLessThan(100);
    expect(assessment.deliveryCompleteness).toBeNull();
    expect(assessment.reasons).toContain('Source resolution is unknown for some evidence.');
  });

  it('does not improve a co-located signal when another publication label delivers the same image', () => {
    const base = {
      id: 'spring', points: [], minX: 100, maxX: 120, minY: 100, maxY: 120,
      type: 'Vegetation Stress Signal', score: 50, number: 1, isProtected: false,
      confidence: 'High', findPotential: 50, center: [0, 52] as [number, number],
      source: 'satellite_spring', sources: ['satellite_spring'],
      metrics: { circularity: 0.2, density: 0.3, ratio: 2, area: 200 },
      provenance: [observation({ parentSourceIdentity: 'version-a' })],
    } satisfies Cluster;
    const duplicate = {
      ...base, id: 'summer', source: 'satellite_summer' as const,
      sources: ['satellite_summer'] as Cluster['sources'],
      provenance: [observation({ observationId: 'summer', parentSourceIdentity: 'version-b' })],
    };
    const single = findConsensus([base])[0];
    const repeated = findConsensus([base, duplicate])[0];
    expect(repeated.findPotential).toBe(single.findPotential);
    expect(repeated.persistenceScore).toBe(single.persistenceScore);
    expect(repeated.withinScanMergeCount).toBe(1);
  });

  it('does not change hotspot scoring when duplicate RGB gains another requested-season label', () => {
    const lidar = observation({
      observationId: 'lidar', requestedSource: 'terrain', deliveredSource: 'ea-lidar',
      datasetIdentity: 'EA LiDAR', parentSourceIdentity: 'ea-lidar-composite-2025',
      deliveredDataType: 'rendered_hillshade', decodedContentIdentity: undefined,
      contentIdentity: undefined, fallbackStatus: 'requested',
    });
    const spring = observation({ parentSourceIdentity: 'version-a' });
    const base = {
      id: 'lidar-signal', points: [], minX: 100, maxX: 120, minY: 100, maxY: 120,
      type: 'Roundhouse', score: 50, number: 1, isProtected: false,
      confidence: 'Medium', findPotential: 50, center: [0, 52] as [number, number],
      source: 'terrain' as const, sources: ['terrain', 'hydrology', 'satellite_spring'] as Cluster['sources'],
      observationKind: 'elevation_measurement' as const,
      metrics: { circularity: 0.8, density: 0.3, ratio: 2, area: 200 },
      provenance: [lidar, spring],
    } satisfies Cluster;
    const duplicate = {
      ...base,
      sources: [...base.sources, 'satellite_summer'] as Cluster['sources'],
      provenance: [...base.provenance, observation({
        observationId: 'summer', requestedSource: 'satellite_summer',
        parentSourceIdentity: 'version-b',
      })],
    };
    const original = buildTerrainHotspots([base])[0];
    const repeated = buildTerrainHotspots([duplicate])[0];
    expect(original).toBeDefined();
    expect(repeated).toBeDefined();
    expect(repeated.score).toBe(original.score);
    expect(repeated.metrics.signalCount).toBe(original.metrics.signalCount);
    expect(repeated.metrics.observationAgreement).toBe(original.metrics.observationAgreement);
  });

  it('prevents derivative renderings of one terrain source bypassing hotspot and trace scoring', () => {
    const hillshade = observation({
      observationId: 'hillshade', requestedSource: 'terrain', deliveredSource: 'ea-hillshade',
      datasetIdentity: 'EA LiDAR hillshade', parentSourceIdentity: 'ea-lidar-composite-2022',
      sourceLineageIdentity: 'ea-lidar-composite', lineageConfidence: 'verified',
      deliveredDataType: 'rendered_hillshade', decodedContentIdentity: undefined,
      contentIdentity: undefined, fallbackStatus: 'requested',
    });
    const slope = observation({
      ...hillshade, observationId: 'slope', requestedSource: 'slope', deliveredSource: 'ea-slope',
      datasetIdentity: 'EA LiDAR slope', deliveredDataType: 'rendered_slope',
    });
    const base = {
      id: 'terrain-signal', points: [], minX: 100, maxX: 120, minY: 100, maxY: 120,
      type: 'Enclosure', score: 50, number: 1, isProtected: false,
      confidence: 'Medium', findPotential: 50, center: [0, 52] as [number, number],
      source: 'terrain' as const, sources: ['terrain'] as Cluster['sources'],
      observationKind: 'elevation_measurement' as const,
      metrics: { circularity: 0.4, density: 0.3, ratio: 2, area: 200 },
      provenance: [hillshade],
    } satisfies Cluster;
    const withDerivative = { ...base, provenance: [hillshade, slope] };

    const spring = observation({ observationId: 'spring', parentSourceIdentity: 'imagery-a' });
    const hotspotBase = {
      ...base,
      type: 'Roundhouse',
      sources: ['terrain', 'hydrology', 'satellite_spring'] as Cluster['sources'],
      provenance: [hillshade, spring],
    };
    const originalHotspot = buildTerrainHotspots([hotspotBase])[0];
    const derivativeHotspot = buildTerrainHotspots([{ ...hotspotBase, provenance: [hillshade, slope, spring] }])[0];
    expect(originalHotspot).toBeDefined();
    expect(derivativeHotspot).toBeDefined();
    expect(derivativeHotspot.metrics.signalCount).toBe(originalHotspot.metrics.signalCount);
    expect(derivativeHotspot.metrics.observationAgreement).toBe(originalHotspot.metrics.observationAgreement);

    const originalTrace = computeTraceTargets([base], [])[0];
    const derivativeTrace = computeTraceTargets([withDerivative], [])[0];
    expect(derivativeTrace.traceScore).toBe(originalTrace.traceScore);
    expect(derivativeTrace.traceType).toBe(originalTrace.traceType);
  });

  it('does not claim changed imagery from differing encoded bytes without decoded pixels', () => {
    expect(assessImageryIndependence([
      observation({ parentSourceIdentity: 'version-a', decodedContentIdentity: undefined }),
      observation({ observationId: 'b', parentSourceIdentity: 'version-b', contentIdentity: 'b'.repeat(64), decodedContentIdentity: undefined }),
    ])).toBe('unknown');
  });

  it('does not improve quality when weaker evidence is removed', () => {
    const suitable = observation({
      parentSourceIdentity: 'dated-source', acquisitionDate: '2025-01-01',
      coverageStatus: 'complete', sourceResolutionM: 1,
    });
    const weak = observation({ parentSourceIdentity: 'unknown-source', coverageStatus: 'partial' });
    const combined = assessEvidenceQuality([suitable, weak]);
    const alone = assessEvidenceQuality([suitable]);
    expect(combined.score).toBe(alone.score);
    expect(combined.deliveryCompleteness).toBe(alone.deliveryCompleteness);
  });

  it('discloses actual fallback identity and unknown acquisition date', () => {
    expect(evidenceProvenanceLabels([observation()])[0]).toContain('World Imagery');
    expect(evidenceProvenanceLabels([observation()])[0]).toContain('acquisition date unknown');
    expect(evidenceProvenanceLabels([observation()])[0]).toContain('fallback for satellite_spring');
  });
});
