import type {
  PermissionSection,
  SessionCoverageObservation,
} from './coverageTypes';
import { currentSectionGeometry } from './coverageRecords';

export const COVERAGE_PRESENTATION = {
  limited: 'This section has limited recorded coverage.',
  noneRecorded: 'No searched areas have been recorded for this field yet.',
  gapsShown: 'Recorded coverage gaps are shown on the map.',
  gapsUnavailable: 'Recorded coverage gaps are unavailable for this field.',
  reportedIncluded: 'Marked searched areas are included.',
  percentageCaveat: 'Recorded coverage is an estimate from saved reports and accepted GPS trail samples. It does not establish everything searched or that a field is complete.',
} as const;

export type RecordedCoverageEstimate = {
  percent: number;
  coveredAreaM2: number;
  totalAreaM2: number;
};

function clampFraction(value: number | undefined): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value!));
}

/**
 * Area-weights the current stable field sections. A user report covers its
 * section; tracked evidence contributes only its persisted sampled fraction.
 * Find locations never contribute. Observations tied to an older geometry
 * version are omitted rather than silently projected onto a changed field.
 */
export function recordedCoverageEstimate(
  sections: readonly PermissionSection[],
  observations: readonly SessionCoverageObservation[],
): RecordedCoverageEstimate | null {
  let totalAreaM2 = 0;
  let coveredAreaM2 = 0;
  let hasRecordedEvidence = false;

  for (const section of sections) {
    const geometry = currentSectionGeometry(section);
    if (!geometry || !Number.isFinite(geometry.areaM2) || geometry.areaM2 <= 0) continue;
    totalAreaM2 += geometry.areaM2;
    const matching = observations.filter(observation =>
      observation.sectionId === section.id
      && observation.sectionGeometryVersion === section.currentGeometryVersion
    );
    if (matching.some(observation => observation.evidence === 'reported')) {
      coveredAreaM2 += geometry.areaM2;
      hasRecordedEvidence = true;
      continue;
    }
    const trackedFraction = Math.max(0, ...matching
      .filter(observation => observation.evidence === 'tracked')
      .map(observation => clampFraction(observation.coverageFraction)));
    if (trackedFraction > 0) {
      coveredAreaM2 += geometry.areaM2 * trackedFraction;
      hasRecordedEvidence = true;
    }
  }

  if (!hasRecordedEvidence || totalAreaM2 <= 0) return null;
  return {
    percent: Math.max(0, Math.min(100, Math.round(coveredAreaM2 / totalAreaM2 * 100))),
    coveredAreaM2,
    totalAreaM2,
  };
}
