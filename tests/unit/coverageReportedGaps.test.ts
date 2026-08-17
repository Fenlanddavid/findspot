import { describe, expect, it } from 'vitest';
import type { GeoJSONArea } from '../../src/shared/coverageTypes';
import {
  applyReportedCoverageToGaps,
  calculateCoverage,
} from '../../src/services/coverage';

const FIELD: GeoJSONArea = {
  type: 'Polygon',
  coordinates: [[
    [0, 52],
    [0.002, 52],
    [0.002, 52.001],
    [0, 52.001],
    [0, 52],
  ]],
};

const WEST_HALF: GeoJSONArea = {
  type: 'Polygon',
  coordinates: [[
    [0, 52],
    [0.001, 52],
    [0.001, 52.001],
    [0, 52.001],
    [0, 52],
  ]],
};

describe('reported coverage in Show Gaps', () => {
  it('does not draw apparent searched coverage across an explicit GPS gap', () => {
    const points = [
      { lat: 52.0005, lon: 0.0002, timestamp: 1_000 },
      { lat: 52.0005, lon: 0.0018, timestamp: 61_000 },
    ];
    const connected = calculateCoverage(FIELD, [{ points }]);
    const interrupted = calculateCoverage(FIELD, [{ points, gaps: [{ start: 1_000, end: 30_000 }] }]);

    expect(connected?.percentCovered).toBeGreaterThan(0);
    expect(interrupted?.percentCovered).toBe(0);
  });

  it('removes reported sections from track-derived gaps without claiming GPS precision', () => {
    const trackOnly = calculateCoverage(FIELD, []);
    const combined = applyReportedCoverageToGaps(trackOnly, [WEST_HALF]);

    expect(trackOnly?.percentCovered).toBe(0);
    expect(combined?.percentCovered).toBeGreaterThan(45);
    expect(combined?.percentCovered).toBeLessThan(55);
    expect(combined?.reportedAreaM2).toBeGreaterThan(0);
    expect(combined?.undetectionsGeoJSON.features).toHaveLength(1);
  });

  it('does not double-count a section reported in more than one session', () => {
    const trackOnly = calculateCoverage(FIELD, []);
    const once = applyReportedCoverageToGaps(trackOnly, [WEST_HALF]);
    const repeated = applyReportedCoverageToGaps(trackOnly, [WEST_HALF, WEST_HALF]);

    expect(repeated?.percentCovered).toBeCloseTo(once?.percentCovered ?? 0, 6);
    expect(repeated?.reportedAreaM2).toBeCloseTo(once?.reportedAreaM2 ?? 0, 6);
  });
});
