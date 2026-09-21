/** Versions describe capture and outcome semantics independently of scoring. */
export const PREDICTION_CAPTURE_VERSION = 1;
export const PREDICTION_EVIDENCE_VERSION = 2;
export const PREDICTION_AGGREGATE_VERSION = 2;

/** Raw contributions precede dimension caps; they are not additive final scores. */
export type HotspotEvidenceCapture = {
  scoring: Record<string, number>;
  suppression: string[];
  context: string[];
  /** Complete explanation keys, before display prioritization. */
  tags: string[];
};

export type PredictionCounts = {
  surfacedCount: number;
  searchedCount: number;
  hitCount: number;
  reportedSearchedCount: number;
  reportedHitCount: number;
  mixedSearchedCount: number;
  mixedHitCount: number;
  trackedVisitCount: number;
  trackedFindCount: number;
  findOnlyHitCount: number;
  explicitNoFindCount: number;
  unresolvedCount: number;
  unscopedCount: number;
};

export function emptyPredictionCounts(): PredictionCounts {
  return {
    surfacedCount: 0, searchedCount: 0, hitCount: 0,
    reportedSearchedCount: 0, reportedHitCount: 0,
    mixedSearchedCount: 0, mixedHitCount: 0,
    trackedVisitCount: 0, trackedFindCount: 0, findOnlyHitCount: 0,
    explicitNoFindCount: 0, unresolvedCount: 0, unscopedCount: 0,
  };
}

type CountablePrediction = {
  outcome: string;
  legacyOutcome?: string;
  permissionId: string | null;
  sessionId: string | null;
  resolutionEvidence?: string;
};

/** Shared by the live reader and frozen rollup. Rates describe associations. */
export function countPrediction(row: CountablePrediction): PredictionCounts {
  const counts = emptyPredictionCounts();
  if (row.legacyOutcome || row.outcome === 'hit' || row.outcome === 'searched_no_find') return counts;
  counts.surfacedCount = 1;
  if (!row.permissionId && !row.sessionId) {
    counts.unscopedCount = 1;
    return counts;
  }
  const hit = row.outcome === 'find_recorded';
  const reported = row.resolutionEvidence === 'reported' || row.resolutionEvidence === 'mixed';
  const searched = reported && (hit || row.outcome === 'search_reported' || row.outcome === 'no_relevant_find_reported');
  if (searched) {
    counts.searchedCount = 1;
    counts.hitCount = Number(hit);
    if (row.resolutionEvidence === 'mixed') {
      counts.mixedSearchedCount = 1;
      counts.mixedHitCount = Number(hit);
    } else {
      counts.reportedSearchedCount = 1;
      counts.reportedHitCount = Number(hit);
    }
  }
  if (row.resolutionEvidence === 'tracked' || row.resolutionEvidence === 'mixed') counts.trackedVisitCount = 1;
  if (hit && row.resolutionEvidence === 'tracked') counts.trackedFindCount = 1;
  if (hit && (!row.resolutionEvidence || row.resolutionEvidence === 'find')) counts.findOnlyHitCount = 1;
  if (row.outcome === 'no_relevant_find_reported') counts.explicitNoFindCount = 1;
  if (!searched && !hit) counts.unresolvedCount = 1;
  return counts;
}

export function addPredictionCounts(target: PredictionCounts, source: PredictionCounts): void {
  for (const key of Object.keys(target) as Array<keyof PredictionCounts>) target[key] += source[key];
}
