import { describe, expect, it } from 'vitest';
import type { TerrainMeasurement } from '../../src/engines/terrain/elevationAnalysis';
import type { EvidenceProvenance } from '../../src/types/evidenceProvenance';
import {
  attachRepresentativeTerrainMeasurements,
  interpolateTerrainMeasurementAt,
} from '../../src/services/fieldguide/terrainScanSupport';
import type { Cluster } from '../../src/pages/fieldGuideTypes';
import { assessEvidenceIndependence } from '../../src/types/evidenceProvenance';
import { safeParseFieldGuideScanCache } from '../../src/services/persistenceValidation';

function measurement(
  lon: number,
  lat: number,
  elevationM: number,
  measurementOverrides: Partial<TerrainMeasurement> = {},
  provenanceOverrides: Partial<EvidenceProvenance> = {},
): TerrainMeasurement {
  const provenance: EvidenceProvenance = {
    observationId: `dem:${lon}:${lat}`, requestedSource: 'elevation_dem', deliveredSource: 'dem',
    datasetIdentity: 'DEM', parentSourceIdentity: 'dem',
    sourceLineageIdentity: 'dem-lineage', lineageConfidence: 'verified',
    deliveredDataType: 'elevation_dem', horizontalCrs: 'EPSG:3857', verticalUnits: 'metres',
    retrievalDate: '2026-09-08T00:00:00.000Z', fallbackStatus: 'requested',
    ...provenanceOverrides,
  };
  return {
    lon, lat, elevationM, slopePercent: elevationM / 10, aspectDegrees: 180,
    relativeReliefM: 1, relativeReliefNorm: 0.02,
    role: 'landscape_context', method: 'grid_sample',
    analysisWindowRadiusM: 51, outputPixelSpacingM: 2.5, sourceResolutionM: null,
    supportCoordinates: [[lon, lat]],
    supportSamples: [{ coordinate: [lon, lat], weight: 1, provenance: [provenance] }],
    limitations: ['Native source resolution unknown.'],
    provenance: [provenance],
    ...measurementOverrides,
  };
}

function cluster(center: [number, number]): Cluster {
  return {
    id: 'cluster', points: [], minX: 0, maxX: 1, minY: 0, maxY: 1,
    type: 'Image anomaly', score: 10, number: 1, isProtected: false,
    confidence: 'Subtle', findPotential: 20, center,
    source: 'terrain', sources: ['terrain'],
  };
}

describe('representative terrain measurement support', () => {
  it('interpolates at the feature coordinate only from four enclosing local samples', () => {
    const d = 0.0001;
    const result = interpolateTerrainMeasurementAt([0, 52], [
      measurement(-d, 52 - d, 10), measurement(d, 52 - d, 20),
      measurement(-d, 52 + d, 30), measurement(d, 52 + d, 40),
    ]);
    expect(result).toMatchObject({
      lon: 0, lat: 52, elevationM: 25, role: 'feature_location',
      method: 'bilinear_interpolation', distanceFromFeatureM: 0,
      sourceResolutionM: null, outputPixelSpacingM: 2.5,
    });
    expect(result?.supportCoordinates).toHaveLength(4);
    expect(result?.supportSamples).toHaveLength(4);
    expect(result?.supportSamples.reduce((sum, item) => sum + item.weight, 0)).toBeCloseTo(1);
    expect(result?.maxSupportDistanceM).toBeLessThan(20);
  });

  it('does not substitute a distant nearest sample for a feature measurement', () => {
    expect(interpolateTerrainMeasurementAt([0, 52], [measurement(0.001, 52, 99)]))
      .toBeNull();
    const target = cluster([0, 52]);
    attachRepresentativeTerrainMeasurements([target], [measurement(0.001, 52, 99)]);
    expect(target.terrainMeasured).not.toBe(true);
    expect(target.elevationM).toBeUndefined();
  });

  it('keeps broad context separate when a local enclosing neighbourhood is incomplete', () => {
    const d = 0.0001;
    const context = [
      measurement(-d, 52 - d, 10), measurement(d, 52 - d, 20),
      measurement(-d, 52 + d, 30),
    ];
    expect(context.every(item => item.role === 'landscape_context')).toBe(true);
    expect(interpolateTerrainMeasurementAt([0, 52], context)).toBeNull();
  });

  it('retains provenance from every contributing tile without inflating one parent lineage', () => {
    const d = 0.0001;
    const samples = [
      measurement(-d, 52 - d, 10, {}, { tile: { z: 15, x: 1, y: 1 } }),
      measurement(d, 52 - d, 20, {}, { tile: { z: 15, x: 2, y: 1 } }),
      measurement(-d, 52 + d, 30, {}, { tile: { z: 15, x: 1, y: 1 } }),
      measurement(d, 52 + d, 40, {}, { tile: { z: 15, x: 2, y: 1 } }),
    ];
    const result = interpolateTerrainMeasurementAt([0, 52], samples);
    expect(new Set(result?.provenance.map(item => item.tile?.x))).toEqual(new Set([1, 2]));
    expect(result?.supportSamples).toHaveLength(4);
    expect(assessEvidenceIndependence(result?.provenance).independentObservationCount).toBe(1);

    const target = cluster([0, 52]);
    attachRepresentativeTerrainMeasurements([target], samples);
    attachRepresentativeTerrainMeasurements([target], samples);
    expect(target.provenance).toHaveLength(2);
  });

  it('rejects incompatible units, datums, lineage, windows, methods and resolution states', () => {
    const d = 0.0001;
    const base = [
      measurement(-d, 52 - d, 10), measurement(d, 52 - d, 20),
      measurement(-d, 52 + d, 30), measurement(d, 52 + d, 40),
    ];
    const incompatibleCases: TerrainMeasurement[][] = [
      base.map((item, index) => index === 3
        ? { ...item, provenance: [{ ...item.provenance[0], verticalUnits: 'feet' }] } as unknown as TerrainMeasurement
        : item),
      base.map((item, index) => index === 3
        ? { ...item, provenance: [{ ...item.provenance[0], verticalDatum: 'ODN' }] }
        : { ...item, provenance: [{ ...item.provenance[0], verticalDatum: 'EGM96' }] }),
      base.map((item, index) => index === 3
        ? { ...item, provenance: [{ ...item.provenance[0], sourceLineageIdentity: 'other-dem' }] }
        : item),
      base.map((item, index) => index === 3 ? { ...item, analysisWindowRadiusM: 100 } : item),
      base.map((item, index) => index === 3 ? { ...item, method: 'footprint_summary' } : item),
      base.map((item, index) => index === 3 ? { ...item, sourceResolutionM: 1 } : item),
    ];
    for (const samples of incompatibleCases) {
      expect(interpolateTerrainMeasurementAt([0, 52], samples)).toBeNull();
    }
  });

  it('preserves weighted support provenance through cached validation', () => {
    const d = 0.0001;
    const samples = [
      measurement(-d, 52 - d, 10, {}, { tile: { z: 15, x: 1, y: 1 } }),
      measurement(d, 52 - d, 20, {}, { tile: { z: 15, x: 2, y: 1 } }),
      measurement(-d, 52 + d, 30, {}, { tile: { z: 15, x: 1, y: 1 } }),
      measurement(d, 52 + d, 40, {}, { tile: { z: 15, x: 2, y: 1 } }),
    ];
    const target = cluster([0, 52]);
    attachRepresentativeTerrainMeasurements([target], samples);
    const parsed = safeParseFieldGuideScanCache({
      id: 'scan', createdAt: 1, rawClusters: [target], sourceAvailability: {},
    });
    expect(parsed?.rawClusters[0].terrainMeasurementSupport?.supportSamples).toHaveLength(4);
    expect(parsed?.rawClusters[0].terrainMeasurementSupport?.supportSamples?.[0].provenance).toHaveLength(1);
    expect(parsed?.rawClusters[0].terrainMeasurementSupport?.sourceResolutionM).toBeNull();
  });
});
