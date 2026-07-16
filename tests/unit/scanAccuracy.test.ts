import { describe, it, expect } from 'vitest';
import { computeScanAccuracy, type ScanAccuracyInput } from '../../src/services/fieldguide/scanAccuracy';

function makeInput(overrides: Partial<ScanAccuracyInput> = {}): ScanAccuracyInput {
  return {
    hotspotSignals: [],
    undugSignals: [],
    gpsFindIds: [],
    ...overrides,
  };
}

function findIds(start: number, count: number) {
  return Array.from({ length: count }, (_, index) => `find-${start + index}`);
}

function makeHotspotSignal(ids: string[], geohash6 = 'gcpuuz', score = 60) {
  return { findCount: ids.length, findIds: ids, lastHotspotScore: score, periodCounts: { Roman: ids.length }, geohash6 };
}

describe('computeScanAccuracy', () => {
  // ── Empty / no data ────────────────────────────────────────────────────

  it('returns null hit rate when no finds', () => {
    const result = computeScanAccuracy(makeInput());
    expect(result.spatialHitRate).toBeNull();
    expect(result.undugConversionRate).toBeNull();
    expect(result.calibrationFactor).toBe(1.0);
    expect(result.calibrationReliable).toBe(false);
  });

  // ── Spatial hit rate ──────────────────────────────────────────────────

  it('computes hit rate: all finds in hotspots', () => {
    const result = computeScanAccuracy(makeInput({
      hotspotSignals: [makeHotspotSignal(findIds(1, 10))],
      gpsFindIds: findIds(1, 10),
    }));
    expect(result.spatialHitRate).toBe(1);
    expect(result.findsInHotspots).toBe(10);
    expect(result.corroboratedCells).toBe(1);
  });

  it('computes hit rate: half of finds in hotspots', () => {
    const result = computeScanAccuracy(makeInput({
      hotspotSignals: [makeHotspotSignal(findIds(1, 5)), makeHotspotSignal([], 'gcpuuy')],
      gpsFindIds: findIds(1, 10),
    }));
    expect(result.spatialHitRate).toBe(0.5);
    expect(result.corroboratedCells).toBe(1); // only cells with findCount > 0
  });

  it('deduplicates finds matched by overlapping hotspot cells', () => {
    const result = computeScanAccuracy(makeInput({
      hotspotSignals: [
        makeHotspotSignal(findIds(1, 8)),
        makeHotspotSignal(findIds(1, 5), 'gcpuuy'),
      ],
      gpsFindIds: findIds(1, 10),
    }));
    expect(result.findsInHotspots).toBe(8);
    expect(result.spatialHitRate).toBe(0.8);
  });

  it('does not guess from legacy signal rows that lack matched find IDs', () => {
    const { findIds: _findIds, ...legacySignal } = makeHotspotSignal(findIds(1, 5));
    const result = computeScanAccuracy(makeInput({
      hotspotSignals: [legacySignal],
      gpsFindIds: findIds(1, 10),
    }));
    expect(result.findsInHotspots).toBe(0);
    expect(result.spatialHitRate).toBeNull();
    expect(result.calibrationReliable).toBe(false);
  });

  it('counts corroborated cells correctly', () => {
    const result = computeScanAccuracy(makeInput({
      hotspotSignals: [
        makeHotspotSignal(findIds(1, 3)),
        makeHotspotSignal([], 'gcpuuy'),
        makeHotspotSignal(findIds(4, 1), 'gcpuux'),
      ],
      gpsFindIds: findIds(1, 10),
    }));
    expect(result.corroboratedCells).toBe(2);
  });

  // ── Undug signal resolution ────────────────────────────────────────────

  it('counts undug signal statuses', () => {
    const result = computeScanAccuracy(makeInput({
      undugSignals: [
        { status: 'open' as const, resolvedFindId: undefined },
        { status: 'dug-find' as const, resolvedFindId: 'find-1' },
        { status: 'dug-find' as const, resolvedFindId: 'find-2' },
        { status: 'dug-nothing' as const, resolvedFindId: undefined },
        { status: 'dismissed' as const, resolvedFindId: undefined },
      ],
    }));
    expect(result.undugTotal).toBe(5);
    expect(result.undugOpen).toBe(1);
    expect(result.undugDugFind).toBe(2);
    expect(result.undugDugNothing).toBe(1);
    expect(result.undugDismissed).toBe(1);
    expect(result.undugResolved).toBe(3); // dug-find + dug-nothing
  });

  it('computes conversion rate from resolved signals', () => {
    const result = computeScanAccuracy(makeInput({
      undugSignals: [
        { status: 'dug-find' as const, resolvedFindId: 'f1' },
        { status: 'dug-find' as const, resolvedFindId: 'f2' },
        { status: 'dug-nothing' as const, resolvedFindId: undefined },
        { status: 'dug-nothing' as const, resolvedFindId: undefined },
      ],
    }));
    expect(result.undugConversionRate).toBe(0.5);
  });

  it('returns null conversion rate when no resolved signals', () => {
    const result = computeScanAccuracy(makeInput({
      undugSignals: [
        { status: 'open' as const, resolvedFindId: undefined },
      ],
    }));
    expect(result.undugConversionRate).toBeNull();
  });

  // ── Calibration factor ─────────────────────────────────────────────────

  it('returns neutral calibration when below data threshold', () => {
    const result = computeScanAccuracy(makeInput({
      hotspotSignals: [makeHotspotSignal(findIds(1, 3))],
      gpsFindIds: findIds(1, 4), // below MIN_FINDS_FOR_CALIBRATION (5)
    }));
    expect(result.calibrationFactor).toBe(1.0);
    expect(result.calibrationReliable).toBe(false);
  });

  it('returns neutral calibration with 1 cell (below MIN_HOTSPOT_CELLS)', () => {
    const result = computeScanAccuracy(makeInput({
      hotspotSignals: [makeHotspotSignal(findIds(1, 5))],
      gpsFindIds: findIds(1, 10),
    }));
    expect(result.calibrationReliable).toBe(false);
  });

  it('computes reliable calibration with enough data', () => {
    const result = computeScanAccuracy(makeInput({
      hotspotSignals: [
        makeHotspotSignal(findIds(1, 4)),
        makeHotspotSignal(findIds(5, 3), 'gcpuuy'),
      ],
      gpsFindIds: findIds(1, 10),
    }));
    expect(result.calibrationReliable).toBe(true);
    // 7/10 = 70% hit rate, well above 40% neutral → should boost
    expect(result.calibrationFactor).toBeGreaterThan(1.0);
  });

  it('caps calibration factor at 1.15', () => {
    const result = computeScanAccuracy(makeInput({
      hotspotSignals: [
        makeHotspotSignal(findIds(1, 10)),
        makeHotspotSignal(findIds(1, 10), 'gcpuuy'),
      ],
      gpsFindIds: findIds(1, 10),
    }));
    expect(result.calibrationReliable).toBe(true);
    expect(result.calibrationFactor).toBe(1.15);
  });

  it('caps calibration factor at 0.85 for zero hit rate', () => {
    const result = computeScanAccuracy(makeInput({
      hotspotSignals: [makeHotspotSignal([]), makeHotspotSignal([], 'gcpuuy')],
      gpsFindIds: findIds(1, 10),
    }));
    // 0 finds in hotspots but 2 corroborated = 0 (they have findCount 0), not reliable
    expect(result.calibrationReliable).toBe(false);
  });

  it('produces well-calibrated (neutral) at 40% hit rate', () => {
    const result = computeScanAccuracy(makeInput({
      hotspotSignals: [
        makeHotspotSignal(findIds(1, 2)),
        makeHotspotSignal(findIds(3, 2), 'gcpuuy'),
      ],
      gpsFindIds: findIds(1, 10),
    }));
    expect(result.calibrationReliable).toBe(true);
    expect(result.calibrationFactor).toBe(1.0);
  });

  it('dampens calibration below 40% hit rate', () => {
    const result = computeScanAccuracy(makeInput({
      hotspotSignals: [
        makeHotspotSignal(findIds(1, 1)),
        makeHotspotSignal(findIds(2, 1), 'gcpuuy'),
      ],
      gpsFindIds: findIds(1, 10),
    }));
    expect(result.calibrationReliable).toBe(true);
    expect(result.calibrationFactor).toBeLessThan(1.0);
    expect(result.calibrationFactor).toBeGreaterThanOrEqual(0.85);
  });
});
