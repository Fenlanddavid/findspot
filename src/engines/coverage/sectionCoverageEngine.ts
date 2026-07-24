import type { Feature, MultiPolygon, Polygon, Position } from 'geojson';
import * as turf from '@turf/turf';
import {
  POLYGON_TO_CELLS_FLAGS,
  cellToBoundary,
  polygonToCellsExperimental,
} from 'h3-js';
import type {
  CoverageEvidence,
  GeoJSONArea,
  GeoJSONPolygon,
  PermissionSection,
  SessionCoverageObservation,
} from '../../shared/coverageTypes';
import {
  sectionGeometryAtVersion,
} from '../../shared/coverageRecords';
import { getDistance } from '../../utils/fieldGuideAnalysis';

export const SECTION_LAYOUT_VERSION = 'h3-adaptive-v2';
export const SECTION_TARGET_COUNT = 3;
export const SECTION_MIN_RESOLUTION = 7;
export const SECTION_MAX_RESOLUTION = 13;
export const SECTION_MIN_COUNT = 2;
export const REPORTED_IMMEDIATE_MAX_AREA_M2 = 10_000;
export const REPORTED_LARGE_SECTION_CONFIRMATIONS = 3;
export const TRACK_SECTION_COVERAGE_THRESHOLD = 0.15;
export const TRACK_SECTION_SWATH_RADIUS_M = 5;
export const TRACK_SECTION_CALCULATION_VERSION = 'sample-grid-12-swath-5m-v1';
export const PREDICTION_TRACK_COVERAGE_THRESHOLD = 0.2;
const TRACK_SAMPLE_GRID_SIZE = 12;

type TrackPath = {
  points: Array<{ lat: number; lon: number; timestamp: number }>;
};

type FindEvidence = {
  id: string;
  permissionId: string;
  lat: number | null;
  lon: number | null;
  createdAt: string;
  foundAt?: string;
};

type PredictionEvidenceTarget = {
  id: string;
  permissionId: string | null;
  surfacedAt: number;
  center: [number, number];
  bounds: [[number, number], [number, number]];
  outcome: 'hit' | 'searched_no_find' | 'unvisited';
};

export type SectionSourceBoundary = {
  fieldId: string | null;
  permissionId: string;
  name: string;
  boundary: GeoJSONPolygon;
};

export type SectionCandidate = {
  id: string;
  permissionId: string;
  fieldId: string | null;
  layoutKey: string;
  label: string;
  boundaryHash: string;
  geometry: GeoJSONArea;
  areaM2: number;
};

export type ResolutionEvidence = 'find' | 'tracked' | 'reported' | 'mixed';

export type PredictionResolutionDecision =
  | {
      predictionId: string;
      outcome: 'hit';
      evidence: ResolutionEvidence;
      matchedFindId: string;
      reportedConfirmationCount: number;
    }
  | {
      predictionId: string;
      outcome: 'searched_no_find';
      evidence: Exclude<ResolutionEvidence, 'find'>;
      searchedCoverage?: number;
      reportedConfirmationCount: number;
    };

function geometryFeature(geometry: GeoJSONArea): Feature<Polygon | MultiPolygon> {
  return {
    type: 'Feature',
    properties: {},
    geometry,
  };
}

function polygonFeature(geometry: GeoJSONPolygon): Feature<Polygon> {
  return {
    type: 'Feature',
    properties: {},
    geometry,
  };
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function boundaryHash(boundary: GeoJSONPolygon): string {
  return `${SECTION_LAYOUT_VERSION}:${stableHash(JSON.stringify(boundary.coordinates))}`;
}

function asArea(feature: Feature<Polygon | MultiPolygon>): GeoJSONArea {
  if (feature.geometry.type === 'Polygon') {
    return { type: 'Polygon', coordinates: feature.geometry.coordinates };
  }
  return { type: 'MultiPolygon', coordinates: feature.geometry.coordinates };
}

/**
 * Creates a small set of stable H3-backed sections at the resolution whose
 * clipped cell count is closest to the interaction target. H3 identity is
 * independent of the field bounding box, and callers retain the initially
 * selected resolution across ordinary boundary edits.
 */
export function deriveSectionCandidates(
  source: SectionSourceBoundary,
  retainedResolution?: number,
): SectionCandidate[] {
  const fieldFeature = polygonFeature(source.boundary);
  const fieldAreaM2 = turf.area(fieldFeature);
  if (!Number.isFinite(fieldAreaM2) || fieldAreaM2 <= 0) return [];

  const ownerKey = source.fieldId ?? `permission-${source.permissionId}`;
  const candidatesAtResolution = (resolution: number): SectionCandidate[] => {
    const cells = polygonToCellsExperimental(
      source.boundary.coordinates,
      resolution,
      POLYGON_TO_CELLS_FLAGS.containmentOverlapping,
      true,
    ).sort();
    const candidates: SectionCandidate[] = [];
    for (const cell of cells) {
      const ring = cellToBoundary(cell, true) as Position[];
      if (ring.length === 0) continue;
      const closedRing = [...ring, ring[0]];
      const hex = turf.polygon([closedRing]);
      const clipped = turf.intersect(
        turf.featureCollection([fieldFeature, hex]),
      ) as Feature<Polygon | MultiPolygon> | null;
      if (!clipped) continue;
      const areaM2 = turf.area(clipped);
      if (!Number.isFinite(areaM2) || areaM2 < 25) continue;
      candidates.push({
        id: `${ownerKey}:h3:${cell}`,
        permissionId: source.permissionId,
        fieldId: source.fieldId,
        layoutKey: `h3:${cell}`,
        label: source.name,
        boundaryHash: boundaryHash(source.boundary),
        geometry: asArea(clipped),
        areaM2,
      });
    }
    return candidates;
  };

  let candidates: SectionCandidate[] = [];
  if (retainedResolution !== undefined) {
    candidates = candidatesAtResolution(retainedResolution);
  } else {
    let bestDistance = Number.POSITIVE_INFINITY;
    for (
      let resolution = SECTION_MIN_RESOLUTION;
      resolution <= SECTION_MAX_RESOLUTION;
      resolution++
    ) {
      const atResolution = candidatesAtResolution(resolution);
      if (atResolution.length < SECTION_MIN_COUNT) {
        if (resolution === SECTION_MAX_RESOLUTION && candidates.length === 0) {
          candidates = atResolution;
        }
        continue;
      }
      const distance = Math.abs(atResolution.length - SECTION_TARGET_COUNT);
      if (
        distance < bestDistance
        || (distance === bestDistance && atResolution.length > candidates.length)
      ) {
        candidates = atResolution;
        bestDistance = distance;
      }
      if (distance === 0) break;
    }
  }

  return candidates.map((candidate, index) => ({
    ...candidate,
    label: `${source.name} · ${index + 1}`,
  }));
}

export function pointIsInsideArea(
  point: { lat: number; lon: number },
  geometry: GeoJSONArea,
): boolean {
  return turf.booleanPointInPolygon(
    turf.point([point.lon, point.lat]),
    geometryFeature(geometry),
  );
}

function areaBounds(geometry: GeoJSONArea): [number, number, number, number] {
  const bounds = turf.bbox(geometryFeature(geometry));
  return [bounds[0], bounds[1], bounds[2], bounds[3]];
}

function interpolateTrack(track: TrackPath): Array<[number, number]> {
  if (track.points.length < 2) return [];
  const sorted = [...track.points].sort((left, right) => left.timestamp - right.timestamp);
  const samples: Array<[number, number]> = [];
  for (let index = 1; index < sorted.length; index++) {
    const previous = sorted[index - 1];
    const current = sorted[index];
    const timestampGap = current.timestamp - previous.timestamp;
    const distanceM = getDistance([previous.lon, previous.lat], [current.lon, current.lat]);
    if (timestampGap > 120_000 || distanceM > 200) continue;
    const steps = Math.max(1, Math.ceil(distanceM / TRACK_SECTION_SWATH_RADIUS_M));
    for (let step = 0; step <= steps; step++) {
      const fraction = step / steps;
      samples.push([
        previous.lon + (current.lon - previous.lon) * fraction,
        previous.lat + (current.lat - previous.lat) * fraction,
      ]);
    }
  }
  return samples;
}

export function trackedSectionCoverageFraction(
  geometry: GeoJSONArea,
  tracks: TrackPath[],
): number {
  const trackSamples = tracks.flatMap(interpolateTrack);
  if (trackSamples.length === 0) return 0;

  const [west, south, east, north] = areaBounds(geometry);
  const sectionSamples: Array<[number, number]> = [];
  for (let row = 0; row < TRACK_SAMPLE_GRID_SIZE; row++) {
    for (let column = 0; column < TRACK_SAMPLE_GRID_SIZE; column++) {
      const sample: [number, number] = [
        west + (east - west) * ((column + 0.5) / TRACK_SAMPLE_GRID_SIZE),
        south + (north - south) * ((row + 0.5) / TRACK_SAMPLE_GRID_SIZE),
      ];
      if (pointIsInsideArea({ lon: sample[0], lat: sample[1] }, geometry)) {
        sectionSamples.push(sample);
      }
    }
  }
  if (sectionSamples.length === 0) return 0;
  const covered = sectionSamples.filter(sample =>
    trackSamples.some(trackPoint =>
      getDistance(trackPoint, sample) <= TRACK_SECTION_SWATH_RADIUS_M
    )
  ).length;
  return covered / sectionSamples.length;
}

export function evidenceObservationId(
  sessionId: string,
  sectionId: string,
  geometryVersion: number,
  evidence: CoverageEvidence,
): string {
  return `${sessionId}:${sectionId}:v${geometryVersion}:${evidence}`;
}

function findMatchesPrediction(
  find: FindEvidence,
  prediction: PredictionEvidenceTarget,
): boolean {
  if (find.lat == null || find.lon == null) return false;
  if (prediction.permissionId && find.permissionId !== prediction.permissionId) return false;
  const createdAt = Date.parse(find.createdAt);
  const foundAt = find.foundAt ? Date.parse(find.foundAt) : Number.NaN;
  if (
    (!Number.isFinite(createdAt) || createdAt < prediction.surfacedAt)
    && (!Number.isFinite(foundAt) || foundAt < prediction.surfacedAt)
  ) return false;
  const [[west, south], [east, north]] = prediction.bounds;
  return (
    find.lon >= west && find.lon <= east && find.lat >= south && find.lat <= north
  ) || getDistance([find.lon, find.lat], prediction.center) <= 150;
}

function observationCoversPrediction(
  observation: SessionCoverageObservation,
  prediction: PredictionEvidenceTarget,
  sectionById: ReadonlyMap<string, PermissionSection>,
): boolean {
  if (observation.permissionId !== prediction.permissionId) return false;
  if (observation.observedAt < prediction.surfacedAt) return false;
  if (
    observation.evidence === 'reported'
    && observation.startedAt < prediction.surfacedAt
  ) return false;
  const section = sectionById.get(observation.sectionId);
  if (!section) return false;
  const geometry = sectionGeometryAtVersion(section, observation.sectionGeometryVersion);
  if (!geometry) return false;
  return pointIsInsideArea(
    { lon: prediction.center[0], lat: prediction.center[1] },
    geometry.geometry,
  );
}

function exposureEvidence(
  hasTracked: boolean,
  hasReported: boolean,
): 'tracked' | 'reported' | 'mixed' | null {
  if (hasTracked && hasReported) return 'mixed';
  if (hasTracked) return 'tracked';
  if (hasReported) return 'reported';
  return null;
}

/**
 * Pure transition model. Find-only observations never create negative
 * evidence. Large reported sections remain unvisited until three independent
 * session confirmations exist.
 */
export function resolvePredictionDecisions(input: {
  predictions: PredictionEvidenceTarget[];
  finds: FindEvidence[];
  sections: PermissionSection[];
  observations: SessionCoverageObservation[];
  trackedCoverageByPrediction: ReadonlyMap<string, number>;
}): PredictionResolutionDecision[] {
  const sectionById = new Map(input.sections.map(section => [section.id, section]));
  const decisions: PredictionResolutionDecision[] = [];

  for (const prediction of input.predictions) {
    if (prediction.outcome !== 'unvisited') continue;
    const relevant = input.observations.filter(observation =>
      observationCoversPrediction(observation, prediction, sectionById)
    );
    const reported = relevant.filter(observation => observation.evidence === 'reported');
    const reportedSessions = new Set(reported.map(observation => observation.sessionId));
    const trackedCoverage = input.trackedCoverageByPrediction.get(prediction.id) ?? 0;
    const hasTracked = trackedCoverage >= PREDICTION_TRACK_COVERAGE_THRESHOLD;
    const hasReported = reportedSessions.size > 0;
    const matchedFind = input.finds.find(find => findMatchesPrediction(find, prediction));

    if (matchedFind) {
      decisions.push({
        predictionId: prediction.id,
        outcome: 'hit',
        evidence: exposureEvidence(hasTracked, hasReported) ?? 'find',
        matchedFindId: matchedFind.id,
        reportedConfirmationCount: reportedSessions.size,
      });
      continue;
    }

    if (hasTracked) {
      decisions.push({
        predictionId: prediction.id,
        outcome: 'searched_no_find',
        evidence: hasReported ? 'mixed' : 'tracked',
        searchedCoverage: trackedCoverage,
        reportedConfirmationCount: reportedSessions.size,
      });
      continue;
    }

    const reportedAreas = reported.flatMap(observation => {
      const section = sectionById.get(observation.sectionId);
      const geometry = section
        ? sectionGeometryAtVersion(section, observation.sectionGeometryVersion)
        : null;
      return geometry ? [geometry.areaM2] : [];
    });
    const requires = reportedAreas.length > 0
      && reportedAreas.every(areaM2 => areaM2 <= REPORTED_IMMEDIATE_MAX_AREA_M2)
      ? 1
      : REPORTED_LARGE_SECTION_CONFIRMATIONS;
    if (reportedSessions.size >= requires) {
      decisions.push({
        predictionId: prediction.id,
        outcome: 'searched_no_find',
        evidence: 'reported',
        reportedConfirmationCount: reportedSessions.size,
      });
    }
  }
  return decisions;
}
