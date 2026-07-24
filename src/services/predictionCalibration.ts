import { db } from '../db';

export type EvidenceCalibrationRow = {
  evidence: 'tracked' | 'reported' | 'mixed';
  searched: number;
  hits: number;
  hitRate: number | null;
};

export type PredictionEvidenceCalibration = {
  rows: EvidenceCalibrationRow[];
  findOnlyHits: number;
};

export async function loadPredictionEvidenceCalibration(
  permissionId: string,
): Promise<PredictionEvidenceCalibration> {
  const predictions = await db.hotspotPredictions
    .where('permissionId')
    .equals(permissionId)
    .toArray();
  const rows = (['tracked', 'reported', 'mixed'] as const).map(evidence => {
    const resolved = predictions.filter(prediction =>
      prediction.outcome !== 'unvisited' && prediction.resolutionEvidence === evidence
    );
    const hits = resolved.filter(prediction => prediction.outcome === 'hit').length;
    return {
      evidence,
      searched: resolved.length,
      hits,
      hitRate: resolved.length > 0 ? hits / resolved.length : null,
    };
  });
  return {
    rows,
    findOnlyHits: predictions.filter(prediction =>
      prediction.outcome === 'hit' && (
        prediction.resolutionEvidence === 'find'
        || prediction.resolutionEvidence === undefined
      )
    ).length,
  };
}
