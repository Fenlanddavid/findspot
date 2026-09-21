import { db } from '../db';
import type { HotspotPrediction, HotspotPredictionAggregate } from '../db';
import {
  addPredictionCounts, countPrediction, emptyPredictionCounts,
  PREDICTION_AGGREGATE_VERSION, PREDICTION_EVIDENCE_VERSION,
  type PredictionCounts,
} from '../shared/predictionEvidence';

export type PredictionEvidenceCohort = {
  key: string;
  engineVersion: string;
  captureVersion?: number;
  evidenceVersion?: number;
  confidence: string;
  counts: PredictionCounts;
  firstSurfacedAt: number;
  lastSurfacedAt: number;
  uniqueFindCount: number;
  sharedFindCount: number;
  permissionCount: number;
  scanCount: number;
  limited: boolean;
  firstFrozenAt?: number;
  lastFrozenAt?: number;
  reportedAssociationRate: number | null;
  mixedAssociationRate: number | null;
};

type Exposure = Pick<HotspotPrediction, 'engineVersion' | 'captureVersion' | 'evidenceVersion' | 'confidence'
  | 'permissionId' | 'scanId' | 'surfacedAt' | 'associatedFindIds' | 'matchedFindId'> & { counts: PredictionCounts; frozenAt?: number };

function summarizeExposures(exposures: Exposure[]): PredictionEvidenceCohort[] {
  const groups = new Map<string, Exposure[]>();
  for (const exposure of exposures) {
    const key = JSON.stringify([exposure.engineVersion, exposure.captureVersion ?? null,
      exposure.evidenceVersion ?? null, exposure.confidence]);
    const group = groups.get(key);
    if (group) group.push(exposure);
    else groups.set(key, [exposure]);
  }
  return [...groups.entries()].map(([key, rows]) => {
    const counts = emptyPredictionCounts();
    const finds = new Map<string, number>();
    for (const row of rows) {
      addPredictionCounts(counts, row.counts);
      for (const id of new Set(row.associatedFindIds ?? (row.matchedFindId ? [row.matchedFindId] : []))) {
        finds.set(id, (finds.get(id) ?? 0) + 1);
      }
    }
    const frozenTimes = rows.flatMap(row => row.frozenAt === undefined ? [] : [row.frozenAt]);
    const limited = rows[0].evidenceVersion !== PREDICTION_EVIDENCE_VERSION;
    return {
      key, engineVersion: rows[0].engineVersion, captureVersion: rows[0].captureVersion,
      evidenceVersion: rows[0].evidenceVersion, confidence: rows[0].confidence, counts,
      firstSurfacedAt: rows.reduce((value, row) => Math.min(value, row.surfacedAt), Infinity),
      lastSurfacedAt: rows.reduce((value, row) => Math.max(value, row.surfacedAt), -Infinity),
      uniqueFindCount: finds.size,
      sharedFindCount: [...finds.values()].filter(count => count > 1).length,
      permissionCount: new Set(rows.flatMap(row => row.permissionId ? [row.permissionId] : [])).size,
      scanCount: new Set(rows.flatMap(row => row.scanId ? [row.scanId] : [])).size,
      limited,
      firstFrozenAt: frozenTimes.length ? frozenTimes.reduce((a, b) => Math.min(a, b)) : undefined,
      lastFrozenAt: frozenTimes.length ? frozenTimes.reduce((a, b) => Math.max(a, b)) : undefined,
      reportedAssociationRate: !limited && counts.reportedSearchedCount > 0 ? counts.reportedHitCount / counts.reportedSearchedCount : null,
      mixedAssociationRate: !limited && counts.mixedSearchedCount > 0 ? counts.mixedHitCount / counts.mixedSearchedCount : null,
    };
  }).sort((a, b) => a.key.localeCompare(b.key));
}

export function summarizePredictionEvidence(predictions: HotspotPrediction[]) {
  const eligible = predictions.filter(row => countPrediction(row).surfacedCount > 0);
  return {
    cohorts: summarizeExposures(eligible.map(row => ({ ...row, counts: countPrediction(row) }))),
    legacyExcludedCount: predictions.length - eligible.length,
  };
}

export async function loadPredictionEvidenceCalibration(permissionId: string) {
  return summarizePredictionEvidence(await db.hotspotPredictions.where('permissionId').equals(permissionId).toArray());
}

export function summarizeFrozenPredictionEvidence(aggregates: HotspotPredictionAggregate[]) {
  const exposures: Exposure[] = [];
  const legacy: HotspotPredictionAggregate[] = [];
  for (const row of aggregates) {
    if (row.formatVersion !== PREDICTION_AGGREGATE_VERSION || !row.snapshot || !row.counts) {
      legacy.push(row);
      continue;
    }
    exposures.push({
      ...row.snapshot, engineVersion: row.engineVersion, confidence: row.confidence,
      captureVersion: row.captureVersion, evidenceVersion: row.evidenceVersion, counts: row.counts, frozenAt: row.updatedAt,
    });
  }
  return {
    cohorts: summarizeExposures(exposures),
    // No invented zero counters or recasting of frozen legacy denominators.
    legacy: legacy.map(row => ({
      engineVersion: row.engineVersion, confidence: row.confidence,
      surfacedCount: row.surfacedCount, searchedCount: row.searchedCount, hitCount: row.hitCount,
      limitation: 'Historical counting rules; missing evidence dimensions cannot be reconstructed.',
    })),
  };
}

/** Existing diagnostics download is the sole aggregate read surface. No location data exported here. */
export async function loadPredictionEvidenceDiagnostics() {
  const [raw, frozen] = await db.transaction('r', [db.hotspotPredictions, db.hotspotPredictionAggregates], () =>
    Promise.all([db.hotspotPredictions.toArray(), db.hotspotPredictionAggregates.toArray()]));
  return {
    meaning: 'Prediction exposures and spatial find associations, not independent trials or calibrated probabilities.',
    spatialRule: 'Inside target bounds or within 150 metres of its centre; permission and post-surface time must match.',
    sufficiency: 'No sufficiency claim. Inspect compatible versions, permissions, repeated scans and shared finds before comparison.',
    retention: 'Live and frozen exposures are separate. Frozen rows retain their last reconciled outcome; follow-up varies with age.',
    live: summarizePredictionEvidence(raw),
    frozen: summarizeFrozenPredictionEvidence(frozen),
  };
}
