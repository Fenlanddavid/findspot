import {
  resolveSMCoverage,
  type NHLEResponse,
  type SMDatasetMetadata,
  type SMUnavailableReason,
} from '../historicScanService';

export type ScheduledMonumentMapCoverage = {
  status: 'loading' | 'ready' | 'not_cached' | 'error';
  classification: 'covered' | 'partial' | 'uncovered';
  unavailableReason: SMUnavailableReason | null;
  coveredNations: string[];
  missingNations: string[];
  renderedFeatureCount: number;
  dataset?: SMDatasetMetadata;
};

export const INITIAL_SCHEDULED_MONUMENT_MAP_COVERAGE: ScheduledMonumentMapCoverage = {
  status: 'loading',
  classification: 'uncovered',
  unavailableReason: null,
  coveredNations: [],
  missingNations: [],
  renderedFeatureCount: 0,
};

export function scheduledMonumentPopupText(
  properties: Record<string, unknown> | null | undefined,
): string {
  const name = typeof properties?.Name === 'string' ? properties.Name.trim() : '';
  return name ? `Scheduled monument · ${name}` : 'Scheduled monument';
}

export function resolveScheduledMonumentMapCoverage(
  bbox: [number, number, number, number],
  response: NHLEResponse,
): ScheduledMonumentMapCoverage {
  const resolution = response.dataset
    ? resolveSMCoverage(bbox, response.dataset.coverage)
    : null;
  const unavailableReason = response.unavailableReason
    ?? resolution?.unavailableReason
    ?? null;

  if (response.cacheComplete === false) {
    return {
      status: 'not_cached',
      classification: resolution?.classification ?? 'uncovered',
      unavailableReason,
      coveredNations: resolution?.coveredNations ?? [],
      missingNations: resolution?.missingNations ?? [],
      renderedFeatureCount: response.features.length,
      dataset: response.dataset,
    };
  }

  if (!resolution || (response.available === false && response.cacheComplete !== true)) {
    return {
      status: 'error',
      classification: 'uncovered',
      unavailableReason,
      coveredNations: [],
      missingNations: [],
      renderedFeatureCount: 0,
      dataset: response.dataset,
    };
  }

  return {
    status: 'ready',
    classification: resolution.classification,
    unavailableReason,
    coveredNations: resolution.coveredNations,
    missingNations: resolution.missingNations,
    renderedFeatureCount: response.features.length,
    dataset: response.dataset,
  };
}
