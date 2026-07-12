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

export const RULES: { id: RuleId; fn: RuleFn }[] = [
  { id: 'MOVEMENT_NO_FINDS', fn: ruleMovementNoFinds },
  { id: 'SETTLEMENT_QUIET', fn: ruleSettlementQuiet },
  { id: 'UNRECORDED_ROUTE', fn: ruleUnrecordedRoute },
];

export function runRules(ctx: ScanContext): QuestionCandidate[] {
  return RULES.flatMap(rule => {
    const candidate = rule.fn(ctx);
    return candidate ? [candidate] : [];
  });
}
