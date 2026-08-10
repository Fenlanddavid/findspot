import { v4 as uuid } from 'uuid';
import {
  db,
  type FindSpotDB,
  type PermissionSection,
  type SurfaceAbundance,
  type SurfaceAssessmentSnapshot,
  type SurfaceConfidence,
  type SurfaceMaterial,
  type SurfaceObservation,
  type SurfacePeriod,
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
  materialClaimAllowed: boolean;
  periodClaim: SurfacePeriod | null;
};

export type SurfaceCombination = {
  observationIds: [string, string];
  distanceM: number;
  title: 'Strong structural activity signal';
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

function periodsCompatible(left: SurfaceObservation, right: SurfaceObservation): boolean {
  return left.periodImpression === 'unknown'
    || right.periodImpression === 'unknown'
    || left.periodImpression === right.periodImpression;
}

function combinationFor(
  observations: readonly EffectiveSurfaceObservation[],
  sectionId: string | null,
): SurfaceCombination | null {
  const inCombinationScope = sectionId === null
    ? observations
    : observations.filter(row => row.sectionId === sectionId);
  const substantial = inCombinationScope.filter(row => row.materialClaimAllowed);
  const pottery = substantial.filter(row => row.source.material === 'pottery');
  const cbm = substantial.filter(row => row.source.material === 'ceramic_building_material');
  let nearest: { left: EffectiveSurfaceObservation; right: EffectiveSurfaceObservation; distanceM: number } | null = null;
  for (const left of pottery) {
    for (const right of cbm) {
      // On the permission-level card, two observations assigned to different
      // known sections are not treated as co-located. If either record predates
      // section assignment, same-permission is the conservative fallback.
      if (sectionId === null
          && left.sectionId !== null
          && right.sectionId !== null
          && left.sectionId !== right.sectionId) continue;
      if (!periodsCompatible(left.source, right.source)) continue;
      const distanceM = getDistance(
        [left.source.lon, left.source.lat],
        [right.source.lon, right.source.lat],
      );
      if (!nearest || distanceM < nearest.distanceM) nearest = { left, right, distanceM };
    }
  }
  if (!nearest) return null;
  return {
    observationIds: [nearest.left.source.id, nearest.right.source.id],
    distanceM: nearest.distanceM,
    title: 'Strong structural activity signal',
    explanation: `You have recorded substantial pottery and ceramic building material in the same area. Together they may indicate significant former occupation or building activity. The observations were recorded about ${Math.round(nearest.distanceM)} m apart. This is suggestive, not diagnostic.`,
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
      const materialClaimAllowed = row.materialConfidence === 'confident'
        && (row.abundance === 'frequent' || row.abundance === 'dense');
      return {
        source: row,
        sectionId,
        distanceM: getDistance([input.scope!.point.lon, input.scope!.point.lat], [row.lon, row.lat]),
        differentSection: input.scope!.sectionId !== null
          && sectionId !== null
          && sectionId !== input.scope!.sectionId,
        materialClaimAllowed,
        periodClaim: row.materialConfidence === 'confident'
          && row.datingConfidence === 'confident'
          && row.periodImpression !== 'unknown'
          ? row.periodImpression
          : null,
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
  point: ScatterPoint;
  gpsAccuracyM?: number | null;
};

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
    materialConfidence: 'confident',
    periodImpression: 'unknown',
    datingConfidence: 'unsure',
    lat: input.point.lat,
    lon: input.point.lon,
    gpsAccuracyM: input.gpsAccuracyM ?? null,
    observedAt: now,
    reassessments: [],
    createdAt: now,
    updatedAt: now,
  };
  await database.surfaceObservations.add(observation);
  return observation;
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
  const reassessedAt = new Date().toISOString();
  await database.surfaceObservations.update(observationId, {
    ...assessment,
    reassessments: [
      ...observation.reassessments,
      { previous, current: assessment, reassessedAt },
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
  const observation = await database.surfaceObservations.get(observationId);
  if (!observation) throw new Error('Surface observation not found.');
  await database.surfaceObservations.update(observationId, {
    periodImpression,
    datingConfidence: CAPTURE_DATING_CONFIDENCE,
    updatedAt: new Date().toISOString(),
  });
}

export async function retireSurfaceObservation(
  observationId: string,
  database: FindSpotDB = db,
): Promise<void> {
  const now = new Date().toISOString();
  await database.surfaceObservations.update(observationId, { retiredAt: now, updatedAt: now });
}

export const SURFACE_CONFIDENCE_VALUES: readonly SurfaceConfidence[] = [
  'unsure', 'fairly_sure', 'confident',
];
