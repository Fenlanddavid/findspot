import { v4 as uuid } from 'uuid';
import {
  db,
  type FindSpotDB,
  type PermissionSection,
  type SurfaceAbundance,
  type SurfaceAssessmentSnapshot,
  type SurfaceConfidence,
  type SurfaceExtent,
  type SurfaceGroundCondition,
  type SurfaceMaterial,
  type SurfaceObservation,
  type SurfacePeriod,
  type SurfaceVisibility,
} from '../db';
import { pointIsInsideArea } from '../engines/coverage/sectionCoverageEngine';
import { sectionGeometryAtVersion } from '../shared/coverageRecords';
import { getDistance } from '../utils/fieldGuideAnalysis';
import { SURFACE_PERIOD_VALUES } from '../shared/surfacePeriodVocabulary';

export const SURFACE_MATERIAL_LABELS: Record<SurfaceMaterial, string> = {
  pottery: 'Pottery',
  ceramic_building_material: 'Ceramic building material (CBM)',
  field_drain: 'Ceramic field drain',
  flint: 'Flint',
  glass: 'Glass',
  slag: 'Slag',
  stone: 'Worked or notable stone',
  bone: 'Bone',
  shell: 'Shell',
  modern_material: 'Modern material',
  other: 'Other material',
};

export const SURFACE_ABUNDANCE_LABELS: Record<SurfaceAbundance, string> = {
  single: 'Single',
  few: 'Few',
  frequent: 'Frequent',
  dense: 'Dense',
};

export const SURFACE_EXTENT_LABELS: Record<SurfaceExtent, string> = {
  point: 'Single spot',
  small_patch: 'Small patch',
  approx_10m: 'Around 10 m',
  approx_25m: 'Around 25 m',
  widespread: 'Widespread',
};

export const SURFACE_VISIBILITY_LABELS: Record<SurfaceVisibility, string> = {
  poor: 'Poor',
  moderate: 'Moderate',
  good: 'Good',
  excellent: 'Excellent',
};

export const SURFACE_GROUND_LABELS: Record<SurfaceGroundCondition, string> = {
  ploughed: 'Ploughed',
  cultivated: 'Cultivated',
  stubble: 'Stubble',
  crop: 'Crop',
  pasture: 'Pasture',
  disturbed: 'Disturbed',
  other: 'Other',
};

export const SURFACE_NOTE_MAX_LENGTH = 500;
export const SURFACE_GROUND_OTHER_MAX_LENGTH = 80;
export const SURFACE_CLUSTER_ALGORITHM_VERSION = 1 as const;
export const SURFACE_CLUSTER_DISTANCE_M = 50;

export const SURFACE_PERIOD_LABELS: Record<SurfacePeriod, string> = {
  palaeolithic: 'Palaeolithic',
  mesolithic: 'Mesolithic',
  neolithic: 'Neolithic',
  bronze_age: 'Bronze Age',
  iron_age: 'Iron Age',
  roman: 'Roman',
  early_medieval: 'Early Medieval',
  medieval: 'Medieval',
  post_medieval: 'Post-medieval',
  modern: 'Modern',
  unknown: '',
};

export const SURFACE_CAPTURE_PERIODS = SURFACE_PERIOD_VALUES.filter(
  (period): period is Exclude<SurfacePeriod, 'unknown'> => period !== 'unknown',
);

export type ScatterPoint = { lat: number; lon: number };

export type SurfaceScope = {
  permissionId: string;
  sectionId: string | null;
  point: ScatterPoint;
};

export type EffectiveSurfaceObservation = {
  source: SurfaceObservation;
  sectionId: string | null;
  distanceM: number;
  differentSection: boolean;
};

export type SurfaceCombination = {
  observationIds: [string, string];
  distanceM: number;
  title: 'Nearby material association';
  explanation: string;
};

export type EffectiveScatter = {
  observations: EffectiveSurfaceObservation[];
  count: number;
  combination: SurfaceCombination | null;
};

function persistedTime(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function activeSectionGeometry(section: PermissionSection) {
  return sectionGeometryAtVersion(section, section.currentGeometryVersion)?.geometry ?? null;
}

function sectionContains(section: PermissionSection, point: ScatterPoint): boolean {
  const geometry = activeSectionGeometry(section);
  return !!geometry && pointIsInsideArea(point, geometry);
}

function derivedSectionId(
  observation: SurfaceObservation,
  sections: readonly PermissionSection[],
): string | null {
  if (observation.sectionId) return observation.sectionId;
  return sections.find(section =>
    section.permissionId === observation.permissionId
    && !section.retiredAt
    && sectionContains(section, { lat: observation.lat, lon: observation.lon })
  )?.id ?? null;
}

function combinationFor(
  observations: readonly EffectiveSurfaceObservation[],
  _sectionId: string | null,
): SurfaceCombination | null {
  const pottery = observations.filter(row => row.source.material === 'pottery');
  const cbm = observations.filter(row => row.source.material === 'ceramic_building_material');
  let nearest: { left: EffectiveSurfaceObservation; right: EffectiveSurfaceObservation; distanceM: number } | null = null;
  for (const left of pottery) {
    for (const right of cbm) {
      const distanceM = getDistance(
        [left.source.lon, left.source.lat],
        [right.source.lon, right.source.lat],
      );
      if (!nearest || distanceM < nearest.distanceM) nearest = { left, right, distanceM };
    }
  }
  if (!nearest || nearest.distanceM > SURFACE_CLUSTER_DISTANCE_M) return null;
  return {
    observationIds: [nearest.left.source.id, nearest.right.source.id],
    distanceM: nearest.distanceM,
    title: 'Nearby material association',
    explanation: `Pottery and ceramic building material have both been recorded in this area. Their recorded positions are approximately ${Math.round(nearest.distanceM)} m apart.`,
  };
}

/**
 * The sole read resolver for permission-scoped Landscape investigations.
 * It returns presentation data only: never a score, rank, confidence change or
 * LandscapeInterpretation contribution.
 */
export function resolveEffectiveScatter(input: {
  observations: readonly SurfaceObservation[];
  sections: readonly PermissionSection[];
  scope: SurfaceScope | null;
}): EffectiveScatter {
  if (!input.scope) return { observations: [], count: 0, combination: null };
  const observations = input.observations
    .filter(row => !row.retiredAt && row.permissionId === input.scope!.permissionId)
    .map(row => {
      const sectionId = derivedSectionId(row, input.sections);
      return {
        source: row,
        sectionId,
        distanceM: getDistance([input.scope!.point.lon, input.scope!.point.lat], [row.lon, row.lat]),
        differentSection: input.scope!.sectionId !== null
          && sectionId !== null
          && sectionId !== input.scope!.sectionId,
      } satisfies EffectiveSurfaceObservation;
    })
    // Early local builds persisted timestamps as epoch numbers. Accept both
    // forms here so opening a permission never depends on record vintage.
    .sort((left, right) => persistedTime(right.source.observedAt) - persistedTime(left.source.observedAt));
  return {
    observations,
    count: observations.length,
    combination: combinationFor(observations, input.scope.sectionId),
  };
}

export type RecordSurfaceObservationInput = {
  projectId: string;
  permissionId: string;
  sessionId: string | null;
  material: SurfaceMaterial;
  abundance: SurfaceAbundance;
  periodImpression?: SurfacePeriod;
  point: ScatterPoint;
  gpsAccuracyM?: number | null;
};

export type SurfaceContextInput = {
  extent?: SurfaceExtent;
  surfaceVisibility?: SurfaceVisibility;
  groundCondition?: SurfaceGroundCondition;
  groundConditionOther?: string;
  note?: string;
};

export type SurfaceCaptureDetailsInput = SurfaceContextInput & {
  materialConfidence?: SurfaceConfidence;
  periodImpression?: Exclude<SurfacePeriod, 'unknown'>;
  datingConfidence?: SurfaceConfidence;
};

const activeCaptureIds = new Set<string>();

function cleanOptionalText(value: string | undefined, maximum: number, field: string): string | undefined {
  const cleaned = value?.trim();
  if (!cleaned) return undefined;
  if ([...cleaned].length > maximum) throw new Error(`${field} must be ${maximum} characters or fewer.`);
  return cleaned;
}

function normalizedContext(input: SurfaceContextInput): SurfaceContextInput {
  const groundConditionOther = cleanOptionalText(
    input.groundConditionOther,
    SURFACE_GROUND_OTHER_MAX_LENGTH,
    'Other ground condition',
  );
  if (groundConditionOther && input.groundCondition !== 'other') {
    throw new Error('Other ground condition requires Ground: Other.');
  }
  return {
    extent: input.extent,
    surfaceVisibility: input.surfaceVisibility,
    groundCondition: input.groundCondition,
    groundConditionOther: input.groundCondition === 'other' ? groundConditionOther : undefined,
    note: cleanOptionalText(input.note, SURFACE_NOTE_MAX_LENGTH, 'Observation note'),
  };
}

export async function recordSurfaceObservation(
  input: RecordSurfaceObservationInput,
  database: FindSpotDB = db,
): Promise<SurfaceObservation> {
  const permission = await database.permissions.get(input.permissionId);
  if (!permission || permission.projectId !== input.projectId) {
    throw new Error('Move into a mapped permission before recording a surface find.');
  }
  const sections = await database.permissionSections.where('permissionId').equals(permission.id).toArray();
  const section = sections.find(row => !row.retiredAt && sectionContains(row, input.point));
  const session = input.sessionId ? await database.sessions.get(input.sessionId) : undefined;
  if (input.sessionId && (!session || session.permissionId !== permission.id)) {
    throw new Error('The active visit no longer belongs to this permission.');
  }
  const now = new Date().toISOString();
  const observation: SurfaceObservation = {
    id: uuid(),
    projectId: input.projectId,
    permissionId: permission.id,
    fieldId: section?.fieldId ?? null,
    sectionId: section?.id ?? null,
    sessionId: input.sessionId,
    material: input.material,
    abundance: input.abundance,
    materialConfidence: 'fairly_sure',
    periodImpression: input.periodImpression ?? 'unknown',
    datingConfidence: input.periodImpression && input.periodImpression !== 'unknown'
      ? CAPTURE_DATING_CONFIDENCE
      : 'unsure',
    lat: input.point.lat,
    lon: input.point.lon,
    gpsAccuracyM: input.gpsAccuracyM ?? null,
    observedAt: now,
    originSessionId: session?.id,
    originSessionDate: session?.date,
    originSessionStartTime: session?.startTime,
    originSessionEndTime: session?.endTime,
    reassessments: [],
    createdAt: now,
    updatedAt: now,
  };
  await database.surfaceObservations.add(observation);
  activeCaptureIds.add(observation.id);
  return observation;
}

/**
 * Completes the active creation flow. Assessment enrichment is deliberately
 * available only while this module still holds the capture capability; a page
 * reload ends the window without invalidating the already-durable base row.
 */
export async function completeSurfaceCapture(
  observationId: string,
  details: SurfaceCaptureDetailsInput = {},
  database: FindSpotDB = db,
): Promise<void> {
  if (!activeCaptureIds.has(observationId)) {
    throw new Error('The original capture is complete. Use Reassess to change assessment fields.');
  }
  const observation = await database.surfaceObservations.get(observationId);
  if (!observation) throw new Error('Surface observation not found.');
  const now = new Date().toISOString();
  const context = normalizedContext(details);
  const periodImpression = details.periodImpression ?? observation.periodImpression;
  const datingConfidence = details.periodImpression
    ? (details.datingConfidence ?? CAPTURE_DATING_CONFIDENCE)
    : observation.datingConfidence;
  await database.surfaceObservations.update(observationId, {
    ...context,
    materialConfidence: details.materialConfidence ?? observation.materialConfidence,
    periodImpression,
    datingConfidence,
    captureCompletedAt: now,
    updatedAt: now,
  });
  activeCaptureIds.delete(observationId);
}

export async function finishSurfaceCapture(
  observationId: string,
  database: FindSpotDB = db,
): Promise<void> {
  if (!activeCaptureIds.has(observationId)) return;
  const now = new Date().toISOString();
  await database.surfaceObservations.update(observationId, { captureCompletedAt: now, updatedAt: now });
  activeCaptureIds.delete(observationId);
}

/** Context-only edit API. Its input type cannot carry assessment fields. */
export async function editSurfaceObservationContext(
  observationId: string,
  contextInput: SurfaceContextInput,
  database: FindSpotDB = db,
): Promise<void> {
  const observation = await database.surfaceObservations.get(observationId);
  if (!observation) throw new Error('Surface observation not found.');
  await database.surfaceObservations.update(observationId, {
    ...normalizedContext(contextInput),
    updatedAt: new Date().toISOString(),
  });
}

export async function reassessSurfaceObservation(
  observationId: string,
  assessment: SurfaceAssessmentSnapshot,
  database: FindSpotDB = db,
): Promise<void> {
  const observation = await database.surfaceObservations.get(observationId);
  if (!observation) throw new Error('Surface observation not found.');
  const previous: SurfaceAssessmentSnapshot = {
    material: observation.material,
    abundance: observation.abundance,
    materialConfidence: observation.materialConfidence,
    periodImpression: observation.periodImpression,
    datingConfidence: observation.datingConfidence,
  };
  const current: SurfaceAssessmentSnapshot = assessment.periodImpression === 'unknown'
    ? { ...assessment, datingConfidence: 'unsure' }
    : assessment;
  if ((Object.keys(previous) as Array<keyof SurfaceAssessmentSnapshot>)
    .every(key => previous[key] === current[key])) return;
  const reassessedAt = new Date().toISOString();
  await database.surfaceObservations.update(observationId, {
    ...current,
    reassessments: [
      ...observation.reassessments,
      { previous, current, reassessedAt },
    ],
    updatedAt: reassessedAt,
  });
}

export const CAPTURE_DATING_CONFIDENCE: SurfaceConfidence = 'fairly_sure';
export const DEFAULT_CAPTURE_PERIODS: readonly Exclude<SurfacePeriod, 'unknown'>[] = [
  'roman', 'medieval', 'post_medieval',
];

export function recentSurfacePeriods(
  observations: readonly SurfaceObservation[],
  permissionId: string,
  limit = 3,
): Array<Exclude<SurfacePeriod, 'unknown'>> {
  const recent = [...observations]
    .filter(row => !row.retiredAt
      && row.permissionId === permissionId
      && row.periodImpression !== 'unknown')
    .sort((left, right) => persistedTime(right.updatedAt) - persistedTime(left.updatedAt));
  const periods = [...new Set(recent.map(
    row => row.periodImpression as Exclude<SurfacePeriod, 'unknown'>,
  ))].slice(0, limit);
  return periods.length > 0 ? periods : [...DEFAULT_CAPTURE_PERIODS].slice(0, limit);
}

/**
 * Enriches an already-saved capture. This is deliberately not a reassessment:
 * the period was volunteered as part of the original field observation.
 */
export async function setSurfaceCapturePeriod(
  observationId: string,
  periodImpression: Exclude<SurfacePeriod, 'unknown'>,
  database: FindSpotDB = db,
): Promise<void> {
  await completeSurfaceCapture(observationId, { periodImpression }, database);
}

export async function retireSurfaceObservation(
  observationId: string,
  database: FindSpotDB = db,
): Promise<void> {
  const now = new Date().toISOString();
  await database.surfaceObservations.update(observationId, { retiredAt: now, updatedAt: now });
}

export async function deleteSurfaceObservationPermanently(
  observationId: string,
  database: FindSpotDB = db,
): Promise<void> {
  await database.transaction('rw', [database.surfaceObservations, database.media], async () => {
    await database.media.where('surfaceObservationId').equals(observationId).delete();
    await database.surfaceObservations.delete(observationId);
  });
  activeCaptureIds.delete(observationId);
}

export type SurfaceObservationSummary = {
  observationCount: number;
  distinctOriginVisitCount: number;
  outsideSavedVisitCount: number;
  materialCounts: Partial<Record<SurfaceMaterial, number>>;
  firstObserved: string | null;
  mostRecentlyObserved: string | null;
};

export type SurfaceCluster = SurfaceObservationSummary & {
  id: string;
  algorithmVersion: typeof SURFACE_CLUSTER_ALGORITHM_VERSION;
  observations: SurfaceObservation[];
  spreadM: number;
  periodCounts: Partial<Record<SurfacePeriod, number>>;
  periodPattern: 'none' | 'consistent' | 'mixed';
  materialAssociations: Array<{
    materials: [SurfaceMaterial, SurfaceMaterial];
    observationIds: [string, string];
    distanceM: number;
  }>;
};

export function summarizeSurfaceObservations(
  observations: readonly SurfaceObservation[],
): SurfaceObservationSummary {
  const active = observations.filter(row => !row.retiredAt);
  const visits = new Set(active.flatMap(row => row.originSessionId ? [row.originSessionId] : []));
  const materialCounts: Partial<Record<SurfaceMaterial, number>> = {};
  for (const row of active) materialCounts[row.material] = (materialCounts[row.material] ?? 0) + 1;
  const times = active.map(row => persistedTime(row.observedAt)).filter(Boolean).sort((a, b) => a - b);
  return {
    observationCount: active.length,
    distinctOriginVisitCount: visits.size,
    outsideSavedVisitCount: active.filter(row => !row.originSessionId).length,
    materialCounts,
    firstObserved: times.length ? new Date(times[0]!).toISOString() : null,
    mostRecentlyObserved: times.length ? new Date(times.at(-1)!).toISOString() : null,
  };
}

function recordedDistance(left: SurfaceObservation, right: SurfaceObservation): number {
  return getDistance([left.lon, left.lat], [right.lon, right.lat]);
}

function clusterSpread(observations: readonly SurfaceObservation[]): number {
  let spreadM = 0;
  for (let leftIndex = 0; leftIndex < observations.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < observations.length; rightIndex += 1) {
      spreadM = Math.max(spreadM, recordedDistance(observations[leftIndex]!, observations[rightIndex]!));
    }
  }
  return spreadM;
}

function clusterMaterialAssociations(observations: readonly SurfaceObservation[]): SurfaceCluster['materialAssociations'] {
  const nearestByPair = new Map<string, SurfaceCluster['materialAssociations'][number]>();
  for (let leftIndex = 0; leftIndex < observations.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < observations.length; rightIndex += 1) {
      const left = observations[leftIndex]!;
      const right = observations[rightIndex]!;
      if (left.material === right.material) continue;
      const materials = [left.material, right.material].sort() as [SurfaceMaterial, SurfaceMaterial];
      const key = materials.join(':');
      const candidate = {
        materials,
        observationIds: [left.id, right.id] as [string, string],
        distanceM: recordedDistance(left, right),
      };
      const current = nearestByPair.get(key);
      if (!current || candidate.distanceM < current.distanceM) nearestByPair.set(key, candidate);
    }
  }
  return [...nearestByPair.values()].sort((left, right) => left.materials.join(':').localeCompare(right.materials.join(':')));
}

/**
 * Algorithm v1: deterministic connected components using a 50 m coordinate
 * distance edge. Components with one observation are not called clusters.
 */
export function clusterSurfaceObservations(
  observations: readonly SurfaceObservation[],
): SurfaceCluster[] {
  const active = observations.filter(row => !row.retiredAt).sort((a, b) => a.id.localeCompare(b.id));
  const visited = new Set<string>();
  const clusters: SurfaceCluster[] = [];
  for (const seed of active) {
    if (visited.has(seed.id)) continue;
    const queue = [seed];
    const members: SurfaceObservation[] = [];
    visited.add(seed.id);
    while (queue.length) {
      const current = queue.shift()!;
      members.push(current);
      for (const candidate of active) {
        if (visited.has(candidate.id)) continue;
        if (recordedDistance(current, candidate) <= SURFACE_CLUSTER_DISTANCE_M) {
          visited.add(candidate.id);
          queue.push(candidate);
        }
      }
    }
    if (members.length < 2) continue;
    members.sort((a, b) => a.id.localeCompare(b.id));
    const periodCounts: Partial<Record<SurfacePeriod, number>> = {};
    for (const member of members) {
      periodCounts[member.periodImpression] = (periodCounts[member.periodImpression] ?? 0) + 1;
    }
    const knownPeriods = Object.keys(periodCounts).filter(period => period !== 'unknown');
    clusters.push({
      id: `surface-cluster-v${SURFACE_CLUSTER_ALGORITHM_VERSION}:${members.map(row => row.id).join(':')}`,
      algorithmVersion: SURFACE_CLUSTER_ALGORITHM_VERSION,
      observations: members,
      spreadM: clusterSpread(members),
      periodCounts,
      periodPattern: knownPeriods.length === 0 ? 'none' : knownPeriods.length === 1 ? 'consistent' : 'mixed',
      materialAssociations: clusterMaterialAssociations(members),
      ...summarizeSurfaceObservations(members),
    });
  }
  return clusters.sort((left, right) => left.id.localeCompare(right.id));
}

/** Local measurement-only readout. It has no engine adapter or scoring output. */
export type SurfaceCalibrationReadout = {
  observationCount: number;
  reassessedObservationCount: number;
  materialChangeCount: number;
  periodChangeCount: number;
  distinctOriginVisitCount: number;
  outsideSavedVisitCount: number;
  visibilityCounts: Partial<Record<SurfaceVisibility, number>>;
  groundConditionCounts: Partial<Record<SurfaceGroundCondition, number>>;
};

export function readSurfaceCalibration(
  observations: readonly SurfaceObservation[],
): SurfaceCalibrationReadout {
  const active = observations.filter(row => !row.retiredAt);
  const summary = summarizeSurfaceObservations(active);
  const visibilityCounts: Partial<Record<SurfaceVisibility, number>> = {};
  const groundConditionCounts: Partial<Record<SurfaceGroundCondition, number>> = {};
  let reassessedObservationCount = 0;
  let materialChangeCount = 0;
  let periodChangeCount = 0;
  for (const row of active) {
    if (row.surfaceVisibility) visibilityCounts[row.surfaceVisibility] = (visibilityCounts[row.surfaceVisibility] ?? 0) + 1;
    if (row.groundCondition) groundConditionCounts[row.groundCondition] = (groundConditionCounts[row.groundCondition] ?? 0) + 1;
    if (row.reassessments.length) reassessedObservationCount += 1;
    for (const reassessment of row.reassessments) {
      if (reassessment.previous.material !== reassessment.current.material) materialChangeCount += 1;
      if (reassessment.previous.periodImpression !== reassessment.current.periodImpression) periodChangeCount += 1;
    }
  }
  return {
    observationCount: active.length,
    reassessedObservationCount,
    materialChangeCount,
    periodChangeCount,
    distinctOriginVisitCount: summary.distinctOriginVisitCount,
    outsideSavedVisitCount: summary.outsideSavedVisitCount,
    visibilityCounts,
    groundConditionCounts,
  };
}

export const SURFACE_CONFIDENCE_VALUES: readonly SurfaceConfidence[] = [
  'unsure', 'fairly_sure', 'confident',
];
