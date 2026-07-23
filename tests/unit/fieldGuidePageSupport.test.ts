import { describe, expect, it } from 'vitest';
import {
  buildMonumentBufferGeoJSON,
  clampOpacity,
  hasLocalPhysicalEvidence,
  hasTargetEvidence,
} from '../../src/services/fieldguide/fieldGuidePageSupport';
import type { Cluster } from '../../src/pages/fieldGuideTypes';

function cluster(overrides: Partial<Cluster> = {}): Cluster {
  return {
    id: 'target-1',
    center: [0.1, 52],
    bounds: [[0.099, 51.999], [0.101, 52.001]],
    sources: [],
    findPotential: 50,
    ...overrides,
  } as Cluster;
}

describe('FieldGuide page support', () => {
  it('clamps persisted overlay opacity and uses the fallback for invalid values', () => {
    expect(clampOpacity(1.4, 0.5)).toBe(1);
    expect(clampOpacity(-0.2, 0.5)).toBe(0);
    expect(clampOpacity(Number.NaN, 0.5)).toBe(0.5);
  });

  it('preserves broad target evidence gates', () => {
    expect(hasTargetEvidence(cluster({ sources: ['terrain'] }))).toBe(true);
    expect(hasTargetEvidence(cluster({ sources: [], aimInfo: {
      type: 'Cropmark',
      period: 'Roman',
      distance: 10,
    } }))).toBe(true);
    expect(hasTargetEvidence(cluster({ sources: ['hydrology'] }))).toBe(false);
  });

  it('requires local physical evidence independently of historic context', () => {
    expect(hasLocalPhysicalEvidence(cluster({
      sources: ['satellite_spring', 'satellite_summer'],
    }))).toBe(true);
    expect(hasLocalPhysicalEvidence(cluster({
      sources: [],
      aimInfo: { type: 'Cropmark', period: 'Roman', distance: 10 },
    }))).toBe(false);
  });

  it('builds protected-site buffers without interpolating feature labels', () => {
    const result = buildMonumentBufferGeoJSON({
      features: [{
        type: 'Feature',
        geometry: {
          type: 'Polygon',
          coordinates: [[
            [0.1, 52],
            [0.101, 52],
            [0.101, 52.001],
            [0.1, 52.001],
            [0.1, 52],
          ]],
        },
        properties: { Name: '<b>Scheduled site</b>' },
      }],
    });

    expect(result.features).toHaveLength(1);
    expect(result.features[0].properties).toMatchObject({
      Name: '<b>Scheduled site</b>',
      bufferMetres: 20,
    });
  });
});
