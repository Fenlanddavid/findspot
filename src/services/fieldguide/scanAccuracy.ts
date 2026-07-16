// ─── Scan Accuracy Engine ─────────────────────────────────────────────────────
// Per-permission retrospective: compares session outcomes against what the scan
// predicted. Consumes FindHotspotSignal + UndugSignal + Find data that has been
// accumulating since DB v29/v33.
//
// Pure functions — no DB access. Caller passes pre-fetched arrays.

import type { FindHotspotSignal, UndugSignal } from '../../db';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ScanAccuracyInput {
  /** FindHotspotSignal rows for this permission */
  hotspotSignals: Pick<FindHotspotSignal, 'findCount' | 'lastHotspotScore' | 'periodCounts' | 'geohash6' | 'findIds'>[];
  /** UndugSignal rows for this permission */
  undugSignals: Pick<UndugSignal, 'status' | 'resolvedFindId'>[];
  /** IDs of the current GPS-located finds on this permission */
  gpsFindIds: string[];
}

export interface ScanAccuracyResult {
  /** Fraction of GPS-located finds that landed inside/near a hotspot cell (0–1) */
  spatialHitRate: number | null;
  /** Number of finds that matched a hotspot cell */
  findsInHotspots: number;
  /** Total finds with GPS used as denominator */
  totalFindsWithGps: number;
  /** Number of hotspot cells corroborated by at least one find */
  corroboratedCells: number;

  /** Undug signal outcomes */
  undugTotal: number;
  undugResolved: number;
  undugDugFind: number;
  undugDugNothing: number;
  undugDismissed: number;
  undugOpen: number;
  /** Fraction of resolved undug signals that were actual finds (0–1) */
  undugConversionRate: number | null;

  /** Calibration factor: 1.0 = neutral, >1 = engine under-predicted, <1 = over-predicted */
  calibrationFactor: number;
  /** Whether there's enough data for the calibration to be meaningful */
  calibrationReliable: boolean;
}

// Minimum data thresholds before calibration is considered reliable
const MIN_FINDS_FOR_CALIBRATION = 5;
const MIN_HOTSPOT_CELLS = 2;

// Maximum adjustment range: ±15%
const CALIBRATION_CAP_HIGH = 1.15;
const CALIBRATION_CAP_LOW = 0.85;

// ─── Engine ──────────────────────────────────────────────────────────────────

export function computeScanAccuracy(input: ScanAccuracyInput): ScanAccuracyResult {
  const { hotspotSignals, undugSignals, gpsFindIds } = input;

  // ── Spatial hit rate ───────────────────────────────────────────────────
  const currentFindIds = new Set(gpsFindIds);
  const matchedFindIds = new Set(
    hotspotSignals.flatMap(signal => signal.findIds ?? []).filter(id => currentFindIds.has(id)),
  );
  const findsInHotspots = matchedFindIds.size;
  const corroboratedCells = hotspotSignals.filter(signal =>
    (signal.findIds ?? []).some(id => currentFindIds.has(id)),
  ).length;
  const totalFindsWithGps = currentFindIds.size;
  const hasDeduplicatedSignalData = hotspotSignals.some(signal => Array.isArray(signal.findIds));

  const spatialHitRate = totalFindsWithGps > 0 && hasDeduplicatedSignalData
    ? Math.min(1, findsInHotspots / totalFindsWithGps)
    : null;

  // ── Undug signal resolution ────────────────────────────────────────────
  const undugTotal = undugSignals.length;
  const undugDugFind = undugSignals.filter(s => s.status === 'dug-find').length;
  const undugDugNothing = undugSignals.filter(s => s.status === 'dug-nothing').length;
  const undugDismissed = undugSignals.filter(s => s.status === 'dismissed').length;
  const undugOpen = undugSignals.filter(s => s.status === 'open').length;
  const undugResolved = undugDugFind + undugDugNothing;

  const undugConversionRate = undugResolved > 0
    ? undugDugFind / undugResolved
    : null;

  // ── Calibration factor ─────────────────────────────────────────────────
  // Based on spatial hit rate: if finds cluster in hotspots at a high rate,
  // the engine is well-calibrated or slightly under-scoring (factor > 1).
  // If finds rarely land in hotspots, the engine may be over-scoring (factor < 1).
  //
  // Neutral point: 40% hit rate (baseline for a well-calibrated scan).
  // This is deliberately conservative — a 40% hit rate means the engine
  // correctly predicted 2 in 5 find locations, which is good for an
  // archaeology-blind terrain model.
  const NEUTRAL_HIT_RATE = 0.4;

  let calibrationFactor = 1.0;
  const calibrationReliable =
    totalFindsWithGps >= MIN_FINDS_FOR_CALIBRATION &&
    corroboratedCells >= MIN_HOTSPOT_CELLS;

  if (calibrationReliable && spatialHitRate !== null) {
    // Linear interpolation: hit rate above neutral → boost, below → dampen.
    // Scale: 0% hit rate → 0.85, 40% → 1.0, 80%+ → 1.15
    const deviation = (spatialHitRate - NEUTRAL_HIT_RATE) / NEUTRAL_HIT_RATE;
    calibrationFactor = 1.0 + deviation * 0.15;
    calibrationFactor = Math.max(CALIBRATION_CAP_LOW, Math.min(CALIBRATION_CAP_HIGH, calibrationFactor));
  }

  return {
    spatialHitRate,
    findsInHotspots,
    totalFindsWithGps,
    corroboratedCells,
    undugTotal,
    undugResolved,
    undugDugFind,
    undugDugNothing,
    undugDismissed,
    undugOpen,
    undugConversionRate,
    calibrationFactor,
    calibrationReliable,
  };
}
