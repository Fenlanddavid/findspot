// Deterministic v1 question rules. Each rule emits at most one candidate.

import type { Cluster, Hotspot, HistoricRoute } from '../pages/fieldGuideTypes';
import type { Find } from '../db';
import type {
  QuestionCandidate,
  EvidenceSnapshot,
  QuestionEvidenceSource,
  QuestionSourceAvailability,
  RuleId,
} from './types';
import { anchorOctant } from './types';

export interface ScanContext {
  scanId: string;
  hotspots: Hotspot[];
  clusters: Cluster[];
  historicRoutes: HistoricRoute[];
  finds: Find[];
  localCoverageAtAnchor?: (lat: number, lon: number, radiusM: number) => number | null;
  permissionCentroid: { lat: number; lon: number };
  /** Public PAS record count for the H3 cell containing this scan. */
  pasRecordCountInScanCell?: number;
  /** Most frequent public PAS periods/types in the surrounding H3 cell. */
  pasTopPeriods?: string[];
  pasTopTypes?: string[];
  /** Permission-wide coverage derived from the user's recorded tracks. */
  totalCoveragePct?: number | null;
  hasRecordedTracks?: boolean;
  /** A returned scheduled-monument geometry intersects this permission. */
  protectedAreaPresent?: boolean;
}

type RuleFn = (ctx: ScanContext) => QuestionCandidate | null;

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
  PUBLIC_RECORD_CONTEXT: ['scheduled_monuments', 'pas_density'],
  COVERAGE_GAP: [],
  PROTECTED_AREA_EXCLUSION: ['scheduled_monuments'],
};

export function hasRequiredSources(
  ruleId: RuleId,
  availability: QuestionSourceAvailability,
): boolean {
  return RULE_REQUIRED_SOURCES[ruleId].every(source => availability[source] === true);
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
  const bufferM = 200;
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
    anchor,
    title: 'Why is movement strongly indicated here without supporting finds?',
    description: `Strong movement corridor signal in the ${loc(anchor, ctx.permissionCentroid)}, but no finds recorded nearby. This may indicate incomplete coverage, or that the corridor signal derives from landscape features rather than human activity.`,
    category: 'MOVEMENT',
    status,
    confidence: clamp01(best.score / 100 * 0.8 + 0.2),
    scanId: ctx.scanId,
    supportingEvidence: evidence,
    contradictingEvidence: [],
  };
};

const ruleSettlementQuiet: RuleFn = (ctx) => {
  const settlements = ctx.hotspots.filter(h =>
    h.type === 'Likely Settlement Edge' && h.score >= 60
  );
  if (settlements.length === 0) return null;

  const best = settlements.reduce((a, b) => a.score > b.score ? a : b);
  const [lon, lat] = best.center;
  const bufferM = 300;
  const coveragePct = ctx.localCoverageAtAnchor?.(lat, lon, bufferM) ?? null;
  if (coveragePct == null || coveragePct < 30) return null;

  const findsNear = ctx.finds.filter(f =>
    f.lat != null && f.lon != null && distM(lat, lon, f.lat, f.lon) < bufferM
  );
  if (findsNear.length >= 3) return null;

  const anchor = { lat, lon };
  return {
    ruleId: 'SETTLEMENT_QUIET',
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

  const anchor = { lat, lon };
  return {
    ruleId: 'UNRECORDED_ROUTE',
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
  const coveragePct = ctx.localCoverageAtAnchor?.(lat, lon, 250) ?? null;
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
  };
};

const rulePublicRecordContext: RuleFn = (ctx) => {
  const count = ctx.pasRecordCountInScanCell;
  if (count == null || !Number.isFinite(count) || count < 3) return null;

  const periods = (ctx.pasTopPeriods ?? []).filter(Boolean).slice(0, 3);
  const types = (ctx.pasTopTypes ?? []).filter(Boolean).slice(0, 3);
  const localFindCount = ctx.finds.filter(find => !find.isPending).length;
  const contextParts = [
    periods.length ? `Leading public periods: ${periods.join(', ')}` : '',
    types.length ? `Common public object groups: ${types.join(', ')}` : '',
  ].filter(Boolean);

  return {
    ruleId: 'PUBLIC_RECORD_CONTEXT',
    anchor: ctx.permissionCentroid,
    title: 'Does this permission reflect the wider public finds pattern?',
    description: `The surrounding PAS density cell contains ${count} public records${periods.length ? `, led by ${periods.join(', ')}` : ''}. This is broad landscape context, not evidence that those finds came from this permission. Compare it with your ${localFindCount} recorded find${localFindCount === 1 ? '' : 's'} here as coverage develops.`,
    category: 'HISTORIC_CONTEXT',
    status: localFindCount > 0 ? 'UNRESOLVED' : 'NEEDS_EVIDENCE',
    confidence: clamp01(0.45 + Math.min(count / 100, 1) * 0.3),
    scanId: ctx.scanId,
    supportingEvidence: [
      snap(`Public PAS records in the surrounding density cell: ${count}`, ctx.scanId),
      ...contextParts.map(label => snap(label, ctx.scanId)),
      snap(`Your recorded finds on this permission: ${localFindCount}`, ctx.scanId),
    ],
    contradictingEvidence: [],
    locationActionAllowed: false,
  };
};

const ruleCoverageGap: RuleFn = (ctx) => {
  const coverage = ctx.totalCoveragePct;
  if (coverage == null || !Number.isFinite(coverage) || coverage >= 80) return null;

  const rounded = Math.max(0, Math.round(coverage));
  const localFindCount = ctx.finds.filter(find => !find.isPending).length;
  const hasTracks = ctx.hasRecordedTracks === true;
  return {
    ruleId: 'COVERAGE_GAP',
    anchor: ctx.permissionCentroid,
    title: hasTracks
      ? 'Which parts of this permission still lack recorded coverage?'
      : 'Where should the first recorded coverage baseline begin?',
    description: hasTracks
      ? `Recorded tracks currently cover approximately ${rounded}% of the permission. Comparing the remaining gaps with the ${localFindCount} find${localFindCount === 1 ? '' : 's'} logged here can help separate genuinely quiet areas from places that have not yet been systematically searched.`
      : 'No usable detecting track coverage is recorded for this permission yet. A tracked visit will make later comparisons between finds, routes and quiet areas substantially more reliable.',
    category: 'COVERAGE',
    status: 'NEEDS_EVIDENCE',
    confidence: clamp01(0.5 + (1 - rounded / 100) * 0.25),
    scanId: ctx.scanId,
    supportingEvidence: [
      snap(`Recorded permission coverage: ${rounded}%`, ctx.scanId),
      snap(`Your recorded finds on this permission: ${localFindCount}`, ctx.scanId),
    ],
    contradictingEvidence: [],
    locationActionAllowed: false,
  };
};

const ruleProtectedAreaExclusion: RuleFn = (ctx) => {
  if (!ctx.protectedAreaPresent) return null;
  return {
    ruleId: 'PROTECTED_AREA_EXCLUSION',
    anchor: ctx.permissionCentroid,
    title: 'Is the scheduled monument clearly excluded from the detecting plan?',
    description: 'A scheduled monument intersects this permission boundary. Landowner permission does not authorise detecting on protected archaeology. Confirm that the monument and its protective buffer are clearly excluded from every visit, shared map and detecting plan.',
    category: 'HISTORIC_CONTEXT',
    status: 'UNRESOLVED',
    confidence: 1,
    scanId: ctx.scanId,
    supportingEvidence: [
      snap('Scheduled-monument geometry intersects the permission boundary', ctx.scanId),
    ],
    contradictingEvidence: [],
    locationActionAllowed: false,
  };
};

export const RULES: { id: RuleId; fn: RuleFn }[] = [
  { id: 'MOVEMENT_NO_FINDS', fn: ruleMovementNoFinds },
  { id: 'SETTLEMENT_QUIET', fn: ruleSettlementQuiet },
  { id: 'UNRECORDED_ROUTE', fn: ruleUnrecordedRoute },
  { id: 'ROMAN_ROUTE_ACTIVITY', fn: ruleRomanRouteActivity },
  { id: 'PUBLIC_RECORD_CONTEXT', fn: rulePublicRecordContext },
  { id: 'COVERAGE_GAP', fn: ruleCoverageGap },
  { id: 'PROTECTED_AREA_EXCLUSION', fn: ruleProtectedAreaExclusion },
];

export const PERMISSION_WIDE_RULE_IDS = [
  'ROMAN_ROUTE_ACTIVITY',
  'PUBLIC_RECORD_CONTEXT',
  'COVERAGE_GAP',
  'PROTECTED_AREA_EXCLUSION',
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
