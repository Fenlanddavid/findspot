// Deterministic v1 question rules. Each rule emits at most one candidate.

import type { Cluster, Hotspot, HistoricRoute } from '../pages/fieldGuideTypes';
import type { Find, GeoJSONPolygon } from '../db';
import * as turf from '@turf/turf';
import type {
  QuestionCandidate,
  EvidenceSnapshot,
  QuestionEvidenceSource,
  QuestionSourceAvailability,
  RuleId,
  InvestigationMetrics,
} from './types';
import { anchorOctant, HYPOTHESIS_BY_RULE } from './types';

export interface ScanContext {
  scanId: string;
  hotspots: Hotspot[];
  clusters: Cluster[];
  historicRoutes: HistoricRoute[];
  finds: Find[];
  localCoverageAtAnchor?: (lat: number, lon: number, radiusM: number) => number | null;
  permissionCentroid: { lat: number; lon: number };
  permissionBoundary?: GeoJSONPolygon;
  /** Public PAS record count for the H3 cell containing this scan. */
  pasRecordCountInScanCell?: number;
  /** Most frequent public PAS periods/types in the surrounding H3 cell. */
  pasTopPeriods?: string[];
  pasTopTypes?: string[];
}

type RuleFn = (ctx: ScanContext) => QuestionCandidate | null;

export const MOVEMENT_INVESTIGATION_BUFFER_M = 200;
export const SETTLEMENT_INVESTIGATION_BUFFER_M = 300;
export const ROUTE_INVESTIGATION_BUFFER_M = 250;
export const MAX_CONTEXT_GEOMETRY_POINTS = 50;
export const CONTEXT_GEOMETRY_SIMPLIFY_TOLERANCE = 0.00001;

const LANDSCAPE_SOURCES: readonly QuestionEvidenceSource[] = [
  'terrain',
  'terrain_global',
  'slope',
  'hydrology',
  'satellite_spring',
  'satellite_summer',
  'scheduled_monuments',
  'aim',
  'historic_context',
  'historic_routes',
  'pas_density',
];

export const RULE_REQUIRED_SOURCES: Record<RuleId, readonly QuestionEvidenceSource[]> = {
  MOVEMENT_NO_FINDS: LANDSCAPE_SOURCES,
  SETTLEMENT_QUIET: LANDSCAPE_SOURCES,
  UNRECORDED_ROUTE: ['scheduled_monuments', 'historic_routes', 'pas_density'],
  // The rule itself requires a returned Roman route. Do not also require every
  // configured route provider to have completed successfully: that would hide
  // valid presence-based questions when (for example) OSM is unavailable but
  // the Itiner-e alignment was returned.
  ROMAN_ROUTE_ACTIVITY: ['scheduled_monuments', 'historic_routes'],
};

export function hasRequiredSources(
  ruleId: RuleId,
  availability: QuestionSourceAvailability,
): boolean {
  // Persisted rows and in-flight work can outlive a deployed rule definition.
  // Treat an unknown runtime ID as unavailable so it can neither enter nor
  // advance the lifecycle, even though normal TypeScript callers use RuleId.
  const requiredSources = RULE_REQUIRED_SOURCES[ruleId] as readonly QuestionEvidenceSource[] | undefined;
  return requiredSources !== undefined &&
    requiredSources.every(source => availability[source] === true);
}

function distM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function snap(label: string, scanId: string): EvidenceSnapshot {
  return { label, sourceScanId: scanId };
}

function loc(anchor: { lat: number; lon: number }, centroid: { lat: number; lon: number }): string {
  return anchorOctant(anchor.lat, anchor.lon, centroid.lat, centroid.lon);
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function investigationMetrics(
  bufferM: number,
  coveragePct: number | null,
  findsNearCount: number,
): InvestigationMetrics {
  return {
    bufferM,
    ...(coveragePct != null && Number.isFinite(coveragePct) ? { localCoveragePct: coveragePct } : {}),
    findsNearCount,
  };
}

function capGeometry(coordinates: [number, number][]): [number, number][] {
  if (coordinates.length <= MAX_CONTEXT_GEOMETRY_POINTS) return coordinates;
  return Array.from({ length: MAX_CONTEXT_GEOMETRY_POINTS }, (_, index) =>
    coordinates[Math.round(index * (coordinates.length - 1) / (MAX_CONTEXT_GEOMETRY_POINTS - 1))]
  );
}

/** Clip a corridor to the permission and keep a compact, deterministic line. */
export function corridorContextGeometry(
  coordinates: [number, number][],
  boundary?: GeoJSONPolygon,
): [number, number][] | undefined {
  if (!boundary || coordinates.length < 2) return undefined;
  try {
    const polygon = turf.polygon(boundary.coordinates);
    const line = turf.lineString(coordinates);
    const boundaryLine = turf.polygonToLine(polygon) as GeoJSON.Feature<GeoJSON.LineString | GeoJSON.MultiLineString>;
    const split = turf.lineSplit(line, boundaryLine);
    const segments = split.features.length > 0 ? split.features : [line];
    const insideSegments = segments.filter(segment => {
      if (segment.geometry.coordinates.length < 2) return false;
      const midpoint = turf.along(segment, turf.length(segment) / 2, { units: 'kilometers' });
      return turf.booleanPointInPolygon(midpoint, polygon);
    });
    const chosen = insideSegments.sort((a, b) => turf.length(b) - turf.length(a))[0];
    if (!chosen) return undefined;
    const simplified = turf.simplify(chosen, {
      tolerance: CONTEXT_GEOMETRY_SIMPLIFY_TOLERANCE,
      highQuality: true,
    });
    const compact = capGeometry(simplified.geometry.coordinates as [number, number][]);
    return compact.length >= 2 ? compact : undefined;
  } catch {
    return undefined;
  }
}

function hotspotCorridorGeometry(hotspot: Hotspot): [number, number][] {
  const [[west, south], [east, north]] = hotspot.bounds;
  const [lon, lat] = hotspot.center;
  const horizontalM = distM(lat, west, lat, east);
  const verticalM = distM(south, lon, north, lon);
  return horizontalM >= verticalM
    ? [[west, lat], [east, lat]]
    : [[lon, south], [lon, north]];
}

function sampledRouteAnchors(
  geometry: [number, number][],
  centroid: { lat: number; lon: number },
): { lat: number; lon: number }[] {
  const sampled: { lat: number; lon: number }[] = [];
  for (let i = 0; i < geometry.length; i += 1) {
    const current = geometry[i];
    if (i === 0) sampled.push({ lat: current[1], lon: current[0] });
    const next = geometry[i + 1];
    if (!next) continue;
    const segmentLength = distM(current[1], current[0], next[1], next[0]);
    const steps = Math.max(1, Math.min(20, Math.ceil(segmentLength / 30)));
    for (let step = 1; step <= steps; step += 1) {
      const fraction = step / steps;
      sampled.push({
        lat: current[1] + (next[1] - current[1]) * fraction,
        lon: current[0] + (next[0] - current[0]) * fraction,
      });
    }
  }
  return sampled.sort((a, b) =>
    distM(centroid.lat, centroid.lon, a.lat, a.lon) -
    distM(centroid.lat, centroid.lon, b.lat, b.lon)
  );
}

const ruleMovementNoFinds: RuleFn = (ctx) => {
  const corridors = ctx.hotspots.filter(h =>
    h.type === 'Movement Corridor (Likely)' && h.score >= 60
  );
  if (corridors.length === 0) return null;

  const best = corridors.reduce((a, b) => a.score > b.score ? a : b);
  const [lon, lat] = best.center;
  const bufferM = MOVEMENT_INVESTIGATION_BUFFER_M;
  const findsNear = ctx.finds.filter(f =>
    f.lat != null && f.lon != null && distM(lat, lon, f.lat, f.lon) < bufferM
  );
  if (findsNear.length > 0) return null;

  const coveragePct = ctx.localCoverageAtAnchor?.(lat, lon, bufferM) ?? null;
  const status = coveragePct != null && coveragePct >= 30 ? 'UNRESOLVED' : 'NEEDS_EVIDENCE';
  const evidence: EvidenceSnapshot[] = [
    snap(`Movement corridor score: ${best.score}`, ctx.scanId),
    snap(`No finds recorded within ${bufferM}m of corridor centre`, ctx.scanId),
  ];
  if (coveragePct != null) {
    evidence.push(snap(`Recorded coverage within ${bufferM}m: ${Math.round(coveragePct)}%`, ctx.scanId));
  }
  if (best.classification) {
    evidence.push(snap(`Classification: ${best.classification}`, ctx.scanId));
  }

  const anchor = { lat, lon };
  return {
    ruleId: 'MOVEMENT_NO_FINDS',
    hypothesisId: HYPOTHESIS_BY_RULE.MOVEMENT_NO_FINDS,
    anchor,
    title: 'Why is movement strongly indicated here without supporting finds?',
    description: `Strong movement corridor signal in the ${loc(anchor, ctx.permissionCentroid)}, but no finds recorded nearby. This may indicate incomplete coverage, or that the corridor signal derives from landscape features rather than human activity.`,
    category: 'MOVEMENT',
    status,
    confidence: clamp01(best.score / 100 * 0.8 + 0.2),
    scanId: ctx.scanId,
    supportingEvidence: evidence,
    contradictingEvidence: [],
    metrics: investigationMetrics(bufferM, coveragePct, findsNear.length),
    contextGeometry: corridorContextGeometry(hotspotCorridorGeometry(best), ctx.permissionBoundary),
  };
};

const ruleSettlementQuiet: RuleFn = (ctx) => {
  const settlements = ctx.hotspots.filter(h =>
    h.type === 'Likely Settlement Edge' && h.score >= 60
  );
  if (settlements.length === 0) return null;

  const best = settlements.reduce((a, b) => a.score > b.score ? a : b);
  const [lon, lat] = best.center;
  const bufferM = SETTLEMENT_INVESTIGATION_BUFFER_M;
  const coveragePct = ctx.localCoverageAtAnchor?.(lat, lon, bufferM) ?? null;
  if (coveragePct == null || coveragePct < 30) return null;

  const findsNear = ctx.finds.filter(f =>
    f.lat != null && f.lon != null && distM(lat, lon, f.lat, f.lon) < bufferM
  );
  if (findsNear.length >= 3) return null;

  const anchor = { lat, lon };
  return {
    ruleId: 'SETTLEMENT_QUIET',
    hypothesisId: HYPOTHESIS_BY_RULE.SETTLEMENT_QUIET,
    anchor,
    title: 'Has this area been interpreted correctly, or is evidence still missing?',
    description: `Settlement-type signal in the ${loc(anchor, ctx.permissionCentroid)} with meaningful recorded coverage nearby (${Math.round(coveragePct)}%), but very few finds. The interpretation may need revisiting as more data accumulates.`,
    category: 'CONTRADICTION',
    status: 'UNRESOLVED',
    confidence: clamp01(best.score / 100 * 0.6 + coveragePct / 100 * 0.4),
    scanId: ctx.scanId,
    supportingEvidence: [
      snap(`Settlement score: ${best.score}`, ctx.scanId),
      snap(`Recorded coverage within ${bufferM}m: ${Math.round(coveragePct)}%`, ctx.scanId),
      snap(`Finds within ${bufferM}m: ${findsNear.length}`, ctx.scanId),
    ],
    contradictingEvidence: [
      snap('Low find count despite nearby recorded coverage may weaken the settlement interpretation', ctx.scanId),
    ],
    metrics: investigationMetrics(bufferM, coveragePct, findsNear.length),
  };
};

const ruleUnrecordedRoute: RuleFn = (ctx) => {
  const routes = ctx.historicRoutes.filter(r =>
    (r.type === 'holloway' || r.type === 'suspected_route' || r.type === 'historic_trackway') &&
    r.source !== 'osm'
  );
  if (routes.length === 0) return null;

  const best = routes.reduce((a, b) => a.certaintyScore > b.certaintyScore ? a : b);
  const midpoint = best.geometry[Math.floor(best.geometry.length / 2)];
  if (!midpoint) return null;
  const [lon, lat] = midpoint;

  const pasRecordCount = ctx.pasRecordCountInScanCell;
  if (pasRecordCount == null || !Number.isFinite(pasRecordCount) || pasRecordCount > 5) return null;

  const scheduledMonumentsNear = ctx.clusters.some(c =>
    c.isProtected && distM(lat, lon, c.center[1], c.center[0]) < 500
  );
  if (scheduledMonumentsNear) return null;

  const bufferM = ROUTE_INVESTIGATION_BUFFER_M;
  const coveragePct = ctx.localCoverageAtAnchor?.(lat, lon, bufferM) ?? null;
  const findsNear = ctx.finds.filter(f =>
    f.lat != null && f.lon != null && distM(lat, lon, f.lat, f.lon) < bufferM
  );

  const anchor = { lat, lon };
  return {
    ruleId: 'UNRECORDED_ROUTE',
    hypothesisId: HYPOTHESIS_BY_RULE.UNRECORDED_ROUTE,
    anchor,
    title: 'Why does this route-like signal have little supporting context?',
    description: `A ${best.type.replace(/_/g, ' ')} signal in the ${loc(anchor, ctx.permissionCentroid)} has little support in public PAS records for the scan area. This may reflect an unrecorded feature, a natural landscape formation, or incomplete public data.`,
    category: 'HISTORIC_CONTEXT',
    status: 'UNRESOLVED',
    confidence: clamp01(best.certaintyScore * 0.7 + (1 - Math.min(pasRecordCount, 10) / 10) * 0.3),
    scanId: ctx.scanId,
    supportingEvidence: [
      snap(`Route type: ${best.type.replace(/_/g, ' ')}`, ctx.scanId),
      snap(`Source: ${best.source}`, ctx.scanId),
      snap(`Certainty: ${best.confidenceClass}`, ctx.scanId),
      snap(`PAS records in scan cell: ${pasRecordCount}`, ctx.scanId),
    ],
    contradictingEvidence: [],
    metrics: investigationMetrics(bufferM, coveragePct, findsNear.length),
  };
};

const ruleRomanRouteActivity: RuleFn = (ctx) => {
  const romanRoutes = ctx.historicRoutes.filter(route => route.type === 'roman_road');
  const pasRecordCount = ctx.pasRecordCountInScanCell;
  if (romanRoutes.length === 0) return null;

  const best = romanRoutes.reduce((a, b) => a.certaintyScore > b.certaintyScore ? a : b);
  // Route geometries can extend beyond the permission or pass through a
  // scheduled monument. Supply sampled alternatives so the generator can pick
  // the nearest point that passes every boundary and protection gate.
  const routeAnchors = sampledRouteAnchors(best.geometry, ctx.permissionCentroid);
  const closest = routeAnchors[0];
  if (!closest) return null;

  const { lat, lon } = closest;
  const bufferM = ROUTE_INVESTIGATION_BUFFER_M;
  const coveragePct = ctx.localCoverageAtAnchor?.(lat, lon, bufferM) ?? null;
  const findsNear = ctx.finds.filter(f =>
    f.lat != null && f.lon != null && distM(lat, lon, f.lat, f.lon) < bufferM
  );
  const evidence: EvidenceSnapshot[] = [
    snap(`Roman road alignment${best.name ? `: ${best.name}` : ''}`, ctx.scanId),
    snap(`Route confidence: ${best.confidenceClass}`, ctx.scanId),
  ];
  if (pasRecordCount != null && Number.isFinite(pasRecordCount)) {
    evidence.splice(1, 0, snap(`Public PAS records in the surrounding density cell: ${pasRecordCount}`, ctx.scanId));
  }
  if (coveragePct != null) {
    evidence.push(snap(`Recorded coverage within 250m: ${Math.round(coveragePct)}%`, ctx.scanId));
  }

  const anchor = { lat, lon };
  return {
    ruleId: 'ROMAN_ROUTE_ACTIVITY',
    hypothesisId: HYPOTHESIS_BY_RULE.ROMAN_ROUTE_ACTIVITY,
    anchor,
    alternativeAnchors: routeAnchors.slice(1),
    title: 'How does the recorded activity relate to the Roman road corridor?',
    description: pasRecordCount != null && Number.isFinite(pasRecordCount)
      ? `A Roman road alignment passes through this permission, within a wider area containing ${pasRecordCount} public PAS records. The density is contextual only: it does not show that individual records came from this permission or are associated with the road. Comparing your own finds and coverage may help distinguish activity focused on the corridor from broader landscape use.`
      : 'A Roman road alignment passes through this permission. Comparing your own finds and recorded coverage may help test whether activity is focused on the corridor or reflects broader landscape use.',
    category: 'HISTORIC_CONTEXT',
    status: coveragePct != null && coveragePct >= 20 ? 'UNRESOLVED' : 'NEEDS_EVIDENCE',
    confidence: clamp01(best.certaintyScore * 0.75 + (pasRecordCount != null && Number.isFinite(pasRecordCount) ? Math.min(pasRecordCount / 25, 1) * 0.25 : 0.1)),
    scanId: ctx.scanId,
    supportingEvidence: evidence,
    contradictingEvidence: [],
    metrics: investigationMetrics(bufferM, coveragePct, findsNear.length),
    contextGeometry: corridorContextGeometry(best.geometry, ctx.permissionBoundary),
  };
};


export const RULES: { id: RuleId; fn: RuleFn }[] = [
  { id: 'MOVEMENT_NO_FINDS', fn: ruleMovementNoFinds },
  { id: 'SETTLEMENT_QUIET', fn: ruleSettlementQuiet },
  { id: 'UNRECORDED_ROUTE', fn: ruleUnrecordedRoute },
  { id: 'ROMAN_ROUTE_ACTIVITY', fn: ruleRomanRouteActivity },
];

export const PERMISSION_WIDE_RULE_IDS = [
  'ROMAN_ROUTE_ACTIVITY',
] as const satisfies readonly RuleId[];

export const TERRAIN_HISTORIC_RULE_IDS = [
  'MOVEMENT_NO_FINDS',
  'SETTLEMENT_QUIET',
  'UNRECORDED_ROUTE',
] as const satisfies readonly RuleId[];

export function historicQuestionRuleScope(
  permissionScanRequested: boolean,
  permissionWideUpdated: boolean,
): readonly RuleId[] | undefined {
  return permissionScanRequested && permissionWideUpdated
    ? TERRAIN_HISTORIC_RULE_IDS
    : undefined;
}

export function runRules(ctx: ScanContext): QuestionCandidate[] {
  return RULES.flatMap(rule => {
    const candidate = rule.fn(ctx);
    return candidate ? [candidate] : [];
  });
}
