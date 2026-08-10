import type { SurfaceMaterial } from '../../db';
import {
  SURFACE_ABUNDANCE_LABELS,
  SURFACE_MATERIAL_LABELS,
  SURFACE_PERIOD_LABELS,
  type EffectiveSurfaceObservation,
} from '../../services/surfaceScatter';

const SURFACE_LIST_MATERIAL_LABELS: Record<SurfaceMaterial, string> = {
  pottery: 'Pottery',
  ceramic_building_material: 'CBM',
  field_drain: 'Field drain',
  flint: 'Flint',
  glass: 'Glass',
  slag: 'Slag',
  stone: 'Stone',
  bone: 'Bone',
  shell: 'Shell',
  modern_material: 'Modern material',
  other: 'Other material',
};

function latestReassessmentText(observation: EffectiveSurfaceObservation): string | null {
  const history = Array.isArray(observation.source.reassessments)
    ? observation.source.reassessments
    : [];
  const latest = history.at(-1);
  if (!latest || latest.previous.material === observation.source.material) return null;
  return `Reassessed from ${SURFACE_MATERIAL_LABELS[latest.previous.material]}`;
}

export function surfaceObservationText(observation: EffectiveSurfaceObservation): string {
  return `${SURFACE_LIST_MATERIAL_LABELS[observation.source.material]} · ${SURFACE_ABUNDANCE_LABELS[observation.source.abundance].toLowerCase()}`;
}

export function surfaceObservationDetailText(
  observation: EffectiveSurfaceObservation,
): string | null {
  const details: string[] = [];
  if (observation.source.periodImpression !== 'unknown'
      && observation.source.datingConfidence !== 'unsure') {
    const period = SURFACE_PERIOD_LABELS[observation.source.periodImpression];
    details.push(observation.source.datingConfidence === 'confident'
      ? `${period} — your impression`
      : `Possible ${period} — your impression`);
  }
  const reassessment = latestReassessmentText(observation);
  if (reassessment) details.push(reassessment);
  return details.length > 0 ? details.join(' · ') : null;
}

export function surfaceObservationDistanceText(
  observation: EffectiveSurfaceObservation,
): string | null {
  return observation.differentSection
    ? `Recorded about ${Math.round(observation.distanceM)} m away`
    : null;
}
