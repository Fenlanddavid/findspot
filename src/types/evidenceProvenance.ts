export type DeliveredDataType =
  | 'rendered_hillshade'
  | 'rendered_relief'
  | 'rendered_slope'
  | 'rgb_imagery'
  | 'elevation_dem'
  | 'historic_record';

export type FallbackStatus = 'requested' | 'fallback' | 'offline_cache';

/** Immutable identity for one delivered tile/observation. */
export interface EvidenceProvenance {
  observationId: string;
  requestedSource: string;
  deliveredSource: string;
  datasetIdentity: string;
  parentSourceIdentity: string;
  /**
   * Stable identity for the underlying dataset/acquisition lineage. This may
   * deliberately be broader than a publication version. It is only used to
   * award independence when `lineageConfidence` is verified.
   */
  sourceLineageIdentity?: string;
  lineageConfidence?: 'verified' | 'unknown';
  /** SHA-256 of delivered bytes; required for imagery independence checks. */
  contentIdentity?: string;
  /** SHA-256 of decoded RGBA pixels; detects equivalent imagery re-encoded differently. */
  decodedContentIdentity?: string;
  deliveredDataType: DeliveredDataType;
  resolutionM?: number;
  /** Native/effective source resolution, only when the provider establishes it. */
  sourceResolutionM?: number;
  horizontalCrs?: string;
  verticalUnits?: 'metres';
  verticalDatum?: string;
  acquisitionDate?: string;
  retrievalDate: string;
  fallbackStatus: FallbackStatus;
  coverageStatus?: 'complete' | 'partial' | 'unknown';
  limitations?: string[];
  tile?: { z: number; x: number; y: number };
}

export type ImageryIndependenceState =
  | 'identical_content'
  | 'changed_content_unknown_acquisition'
  | 'verified_distinct_acquisitions'
  | 'insufficient_overlap'
  | 'unknown';

export interface EvidenceIndependenceAssessment {
  imageryState: ImageryIndependenceState;
  imageryFootprints: ImageryFootprintAssessment[];
  independentObservationCount: number;
  deduplicatedProvenance: EvidenceProvenance[];
  reasons: string[];
}

export interface ImageryFootprintAssessment {
  footprint: string;
  leftParentSourceIdentity: string;
  rightParentSourceIdentity: string;
  state: ImageryIndependenceState;
  leftAcquisitionDate?: string;
  rightAcquisitionDate?: string;
}

export interface EvidenceQualityAssessment {
  /** Analytical suitability heuristic, not a probability or delivery metric. */
  score: number;
  /** Successful footprint delivery, represented separately from suitability. */
  deliveryCompleteness: number | null;
  reasons: string[];
}

export type ObservationKind =
  | 'image_anomaly'
  | 'elevation_measurement'
  | 'historic_record';

export function distinctObservationParents(
  provenance: readonly EvidenceProvenance[] | undefined,
): Set<string> {
  const unique = mergeEvidenceProvenance(provenance);
  const parents = new Set(unique
    .filter(item => item.deliveredDataType !== 'rgb_imagery'
      && item.lineageConfidence === 'verified'
      && item.sourceLineageIdentity)
    .map(item => `lineage:${item.sourceLineageIdentity}`));
  if (parents.size === 0 && unique.some(item => item.deliveredDataType !== 'rgb_imagery')) {
    parents.add('lineage:unknown');
  }
  if (unique.some(item => item.deliveredDataType === 'rgb_imagery')) {
    parents.add('imagery:observation-1');
    if (assessImageryIndependence(unique) === 'verified_distinct_acquisitions') {
      parents.add('imagery:observation-2');
    }
  }
  return parents;
}

export function observationsAreIndependent(
  left: readonly EvidenceProvenance[] | undefined,
  right: readonly EvidenceProvenance[] | undefined,
): boolean {
  const separate = Math.max(
    assessEvidenceIndependence(left).independentObservationCount,
    assessEvidenceIndependence(right).independentObservationCount,
  );
  return assessEvidenceIndependence([...(left ?? []), ...(right ?? [])])
    .independentObservationCount > separate;
}

function tileFootprint(item: EvidenceProvenance): string | null {
  return item.tile ? `${item.tile.z}/${item.tile.x}/${item.tile.y}` : null;
}

function provenanceFingerprint(item: EvidenceProvenance): string {
  return [
    item.parentSourceIdentity,
    item.deliveredDataType,
    tileFootprint(item) ?? item.observationId,
    item.decodedContentIdentity ?? '',
    item.contentIdentity ?? '',
    item.acquisitionDate ?? '',
  ].join('|');
}

export function mergeEvidenceProvenance(
  ...groups: Array<readonly EvidenceProvenance[] | undefined>
): EvidenceProvenance[] {
  const unique = new Map<string, EvidenceProvenance>();
  for (const item of groups.flatMap(group => group ?? [])) {
    unique.set(provenanceFingerprint(item), item);
  }
  return [...unique.values()];
}

function validAcquisitionDate(value: string | undefined): { value: string; time: number } | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value)) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? { value, time } : null;
}

function compareMatchingImageryObservations(
  footprint: string,
  left: EvidenceProvenance,
  right: EvidenceProvenance,
): ImageryFootprintAssessment {
  let state: ImageryIndependenceState = 'unknown';
  if (left.decodedContentIdentity && right.decodedContentIdentity) {
    if (left.decodedContentIdentity === right.decodedContentIdentity) {
      state = 'identical_content';
    } else {
      const leftDate = validAcquisitionDate(left.acquisitionDate);
      const rightDate = validAcquisitionDate(right.acquisitionDate);
      state = leftDate && rightDate && leftDate.time !== rightDate.time
        ? 'verified_distinct_acquisitions'
        : 'changed_content_unknown_acquisition';
    }
  } else if (left.contentIdentity && right.contentIdentity
    && left.contentIdentity === right.contentIdentity) {
    state = 'identical_content';
  }
  return {
    footprint,
    leftParentSourceIdentity: left.parentSourceIdentity,
    rightParentSourceIdentity: right.parentSourceIdentity,
    state,
    ...(validAcquisitionDate(left.acquisitionDate) ? { leftAcquisitionDate: left.acquisitionDate } : {}),
    ...(validAcquisitionDate(right.acquisitionDate) ? { rightAcquisitionDate: right.acquisitionDate } : {}),
  };
}

function combineFootprintStates(states: ImageryIndependenceState[]): ImageryIndependenceState {
  if (states.length === 0 || states.every(state => state === 'insufficient_overlap')) return 'insufficient_overlap';
  const compared = states.filter(state => state !== 'insufficient_overlap');
  if (compared.length !== states.length) return 'changed_content_unknown_acquisition';
  if (compared.every(state => state === 'verified_distinct_acquisitions')) return 'verified_distinct_acquisitions';
  if (compared.every(state => state === 'identical_content')) return 'identical_content';
  if (compared.every(state => state === 'unknown')) return 'unknown';
  if (compared.some(state => state === 'changed_content_unknown_acquisition'
    || state === 'verified_distinct_acquisitions')) return 'changed_content_unknown_acquisition';
  return 'unknown';
}

function compareImageryPair(
  left: EvidenceProvenance[],
  right: EvidenceProvenance[],
): { state: ImageryIndependenceState; footprints: ImageryFootprintAssessment[] } {
  const rightByFootprint = new Map<string, EvidenceProvenance[]>();
  for (const item of right) {
    const footprint = tileFootprint(item);
    if (!footprint) continue;
    rightByFootprint.set(footprint, [...(rightByFootprint.get(footprint) ?? []), item]);
  }
  const leftByFootprint = new Map<string, EvidenceProvenance[]>();
  for (const item of left) {
    const footprint = tileFootprint(item);
    if (!footprint) continue;
    leftByFootprint.set(footprint, [...(leftByFootprint.get(footprint) ?? []), item]);
  }
  const footprints: ImageryFootprintAssessment[] = [];
  for (const [footprint, leftItems] of leftByFootprint) {
    const rightItems = rightByFootprint.get(footprint);
    if (!rightItems) continue;
    const comparisons = leftItems.flatMap(a => rightItems.map(b =>
      compareMatchingImageryObservations(footprint, a, b)));
    const state = combineFootprintStates(comparisons.map(item => item.state));
    const representative = comparisons.find(item => item.state === state) ?? comparisons[0];
    footprints.push({ ...representative, state });
  }
  return {
    state: footprints.length === 0
      ? 'insufficient_overlap'
      : combineFootprintStates(footprints.map(item => item.state)),
    footprints,
  };
}

export function assessImageryFootprints(
  provenance: readonly EvidenceProvenance[] | undefined,
): ImageryFootprintAssessment[] {
  const imagery = mergeEvidenceProvenance(provenance)
    .filter(item => item.deliveredDataType === 'rgb_imagery');
  const byParent = new Map<string, EvidenceProvenance[]>();
  for (const item of imagery) {
    const group = byParent.get(item.parentSourceIdentity) ?? [];
    group.push(item);
    byParent.set(item.parentSourceIdentity, group);
  }
  const groups = [...byParent.values()];
  const results: ImageryFootprintAssessment[] = [];
  for (let left = 0; left < groups.length; left++) {
    for (let right = left + 1; right < groups.length; right++) {
      results.push(...compareImageryPair(groups[left], groups[right]).footprints);
    }
  }
  return results;
}

export function assessImageryIndependence(
  provenance: readonly EvidenceProvenance[] | undefined,
): ImageryIndependenceState {
  const imagery = mergeEvidenceProvenance(provenance)
    .filter(item => item.deliveredDataType === 'rgb_imagery');
  const byParent = new Map<string, EvidenceProvenance[]>();
  for (const item of imagery) {
    const group = byParent.get(item.parentSourceIdentity) ?? [];
    group.push(item);
    byParent.set(item.parentSourceIdentity, group);
  }
  const groups = [...byParent.values()];
  if (groups.length < 2) return 'unknown';
  const states: ImageryIndependenceState[] = [];
  for (let left = 0; left < groups.length; left++) {
    for (let right = left + 1; right < groups.length; right++) {
      states.push(compareImageryPair(groups[left], groups[right]).state);
    }
  }
  return combineFootprintStates(states);
}

export function assessEvidenceIndependence(
  provenance: readonly EvidenceProvenance[] | undefined,
): EvidenceIndependenceAssessment {
  const deduplicatedProvenance = mergeEvidenceProvenance(provenance);
  const imageryState = assessImageryIndependence(deduplicatedProvenance);
  const imageryFootprints = assessImageryFootprints(deduplicatedProvenance);
  const nonImagery = deduplicatedProvenance
    .filter(item => item.deliveredDataType !== 'rgb_imagery');
  const verifiedLineages = new Set(nonImagery
    .filter(item => item.lineageConfidence === 'verified' && item.sourceLineageIdentity)
    .map(item => item.sourceLineageIdentity as string));
  const unknownLineagePresent = nonImagery.some(item =>
    item.lineageConfidence !== 'verified' || !item.sourceLineageIdentity);
  // Unknown lineages cannot be presumed independent of one another or of a
  // verified source. They can establish that evidence exists, but not add an
  // unsupported source-count bonus.
  const nonImageryCount = Math.max(verifiedLineages.size, unknownLineagePresent ? 1 : 0);
  const hasImagery = deduplicatedProvenance.some(item => item.deliveredDataType === 'rgb_imagery');
  const imageryCount = !hasImagery ? 0 : imageryState === 'verified_distinct_acquisitions' ? 2 : 1;
  const reasons = [
    imageryState === 'verified_distinct_acquisitions'
      ? 'Matching footprints have changed pixels and distinct known acquisition dates.'
      : imageryState === 'identical_content'
        ? 'Matching imagery footprints deliver identical content.'
        : imageryState === 'changed_content_unknown_acquisition'
          ? 'Delivered imagery differs, but acquisition independence is unknown.'
          : imageryState === 'insufficient_overlap'
            ? 'Imagery footprints do not overlap, so repeat observation is not established.'
            : 'Imagery identity or acquisition metadata is incomplete.',
  ];
  return {
    imageryState,
    imageryFootprints,
    independentObservationCount: nonImageryCount + imageryCount,
    deduplicatedProvenance,
    reasons,
  };
}

export function assessEvidenceQuality(
  provenance: readonly EvidenceProvenance[] | undefined,
  options: { spatiallyRepresentativeMeasurement?: boolean } = {},
): EvidenceQualityAssessment {
  const unique = mergeEvidenceProvenance(provenance);
  if (unique.length === 0) return { score: 0, deliveryCompleteness: null, reasons: ['No delivered provenance is available.'] };
  const sourceGroups = new Map<string, EvidenceProvenance[]>();
  for (const item of unique) {
    const group = sourceGroups.get(item.parentSourceIdentity) ?? [];
    group.push(item);
    sourceGroups.set(item.parentSourceIdentity, group);
  }
  const coverageValues = [...sourceGroups.values()].flatMap(group => {
    const state = group.find(item => item.coverageStatus)?.coverageStatus;
    return state === 'complete' ? [100] : state === 'partial' ? [50] : [];
  });
  // Completeness describes the best delivered observation of the target
  // footprint. Averaging sources would let deleting a partial delivery improve
  // the number, while duplicate downloads would change the denominator.
  const deliveryCompleteness = coverageValues.length
    ? Math.max(...coverageValues)
    : null;

  const perSource = [...sourceGroups.values()].map(group => {
    const item = group[0];
    let quality = 15; // delivery is useful, but does not itself establish suitability.
    if (item.coverageStatus === 'complete') quality += 20;
    else if (item.coverageStatus === 'partial') quality += 8;
    if (item.sourceResolutionM != null || item.resolutionM != null) quality += 20;
    if (item.acquisitionDate) quality += 15;
    if (item.horizontalCrs) quality += 5;
    if (item.deliveredDataType === 'elevation_dem') {
      quality += options.spatiallyRepresentativeMeasurement ? 25 : 5;
    } else if (item.deliveredDataType === 'historic_record') quality += 20;
    else if (item.deliveredDataType.startsWith('rendered_')) quality += 10;
    else quality += 8;
    // Provider limitations are explicit analytical constraints. This small,
    // capped deduction is provisional and is exposed in the explanation; it is
    // not a claim of calibrated archaeological accuracy.
    quality -= Math.min(20, new Set(group.flatMap(entry => entry.limitations ?? [])).size * 5);
    return Math.min(100, quality);
  });
  // Additional weak deliveries must not lower quality and their removal must
  // not manufacture an improvement. The best suitable observation sets the
  // ceiling; coverage and agreement remain separate components.
  const score = Math.max(...perSource);
  const reasons: string[] = [];
  if (deliveryCompleteness === null) reasons.push('Coverage completeness is unknown.');
  else if (unique.some(item => item.coverageStatus === 'partial')) reasons.push('Some delivered coverage is incomplete.');
  if (unique.some(item => item.sourceResolutionM == null && item.resolutionM == null)) reasons.push('Source resolution is unknown for some evidence.');
  if (unique.some(item => item.acquisitionDate == null)) reasons.push('Acquisition metadata is incomplete.');
  if (unique.some(item => item.deliveredDataType.startsWith('rendered_'))) reasons.push('Rendered terrain imagery is observational, not a height measurement.');
  if (unique.some(item => item.deliveredDataType === 'elevation_dem') && !options.spatiallyRepresentativeMeasurement) reasons.push('DEM delivery lacks representative feature-location support.');
  for (const limitation of new Set(unique.flatMap(item => item.limitations ?? []))) {
    reasons.push(`Known source limitation: ${limitation}`);
  }
  return { score, deliveryCompleteness, reasons };
}

export function hasDistinctImageryObservations(
  provenance: readonly EvidenceProvenance[] | undefined,
): boolean {
  return assessImageryIndependence(provenance) === 'verified_distinct_acquisitions';
}

export function hasDeliveredDataType(
  provenance: readonly EvidenceProvenance[] | undefined,
  type: DeliveredDataType,
): boolean {
  return (provenance ?? []).some(item => item.deliveredDataType === type);
}

/** Compact, factual labels suitable for an evidence-source disclosure panel. */
export function evidenceProvenanceLabels(
  provenance: readonly EvidenceProvenance[] | undefined,
): string[] {
  const labels = new Map<string, string>();
  for (const item of provenance ?? []) {
    const resolution = item.resolutionM == null ? '' : ` · ${item.resolutionM.toFixed(item.resolutionM < 10 ? 1 : 0)} m`;
    const acquired = item.acquisitionDate ? ` · acquired ${item.acquisitionDate}` : ' · acquisition date unknown';
    const retrieved = ` · retrieved ${item.retrievalDate.slice(0, 10)}`;
    const fallback = item.fallbackStatus === 'fallback' ? ` · fallback for ${item.requestedSource}` : '';
    labels.set(
      `${item.parentSourceIdentity}:${item.deliveredDataType}:${item.fallbackStatus}`,
      `${item.datasetIdentity} · ${item.deliveredDataType.replaceAll('_', ' ')}${resolution}${acquired}${retrieved}${fallback}`,
    );
  }
  return [...labels.values()];
}
