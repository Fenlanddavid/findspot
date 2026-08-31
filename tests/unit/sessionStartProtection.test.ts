import { describe, expect, it } from 'vitest';
import type { GeoJSONPolygon } from '../../src/db';
import {
  daylightSummary,
  resolveSessionStartProtection,
} from '../../src/services/session/sessionStartProtection';

const boundary: GeoJSONPolygon = {
  type: 'Polygon',
  coordinates: [[[-1.1, 51], [-1, 51], [-1, 51.1], [-1.1, 51.1], [-1.1, 51]]],
};

describe('session-start protection evidence', () => {
  it('only returns none-recorded for a complete cached dataset response', () => {
    expect(resolveSessionStartProtection(boundary, {
      features: [],
      available: true,
      cacheComplete: true,
      dataset: { coverage: ['england', 'wales'], sources: ['NHLE', 'Cadw'] },
    }).state).toBe('none_recorded');

    expect(resolveSessionStartProtection(boundary, {
      features: [],
      available: false,
      cacheComplete: false,
    })).toMatchObject({ state: 'not_checked', reason: 'not_cached' });
  });

  it('records an intersecting monument even if broader coverage is unavailable', () => {
    const result = resolveSessionStartProtection(boundary, {
      available: false,
      features: [{
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [-1.05, 51.05] },
        properties: { Name: 'Recorded site', ListEntry: '1' },
      }],
    });
    expect(result).toMatchObject({ state: 'recorded_monument', monumentCount: 1 });
  });
});

describe('local daylight calculation', () => {
  it('reports daylight at midday and after-sunset at night for southern England in summer', () => {
    const point = { lat: 51.5074, lon: -0.1278 };
    expect(daylightSummary(new Date('2026-06-21T12:00:00Z'), point).state).toBe('daylight');
    expect(daylightSummary(new Date('2026-06-21T22:00:00Z'), point).state).toBe('after_sunset');
  });

  it('does not invent a daylight result without a location', () => {
    expect(daylightSummary(new Date('2026-06-21T12:00:00Z'), null).state).toBe('unavailable');
  });
});
