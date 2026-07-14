// ─── Outstanding Questions — generator ──────────────────────────────────────
// Pure function: (scanContext, gateContext) => QuestionCandidate[]
// Runs rules, applies gates, returns post-gate candidates (pre-cap/diff).

import type { QuestionCandidate } from './types';
import type { GateContext } from './gates';
import { isAnchorInScanBounds, passesAllGates, passesBoundaryGate, passesCoverageFence } from './gates';
import { runRules, type ScanContext } from './rules';

function distM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function metricsAtAnchor(
  candidate: QuestionCandidate,
  anchor: QuestionCandidate['anchor'],
  scanCtx: ScanContext,
): QuestionCandidate['metrics'] {
  const bufferM = candidate.metrics.bufferM;
  const coverage = scanCtx.localCoverageAtAnchor?.(anchor.lat, anchor.lon, bufferM) ?? null;
  const findsNearCount = scanCtx.finds.filter(find =>
    find.lat != null && find.lon != null &&
    distM(anchor.lat, anchor.lon, find.lat, find.lon) < bufferM
  ).length;
  return {
    bufferM,
    ...(coverage != null && Number.isFinite(coverage) ? { localCoveragePct: coverage } : {}),
    findsNearCount,
  };
}

function safePermissionAnchors(candidate: QuestionCandidate, gateCtx: GateContext): QuestionCandidate['anchor'][] {
  const ring = gateCtx.boundary?.coordinates?.[0];
  if (!ring?.length) return [];
  const lons = ring.map(point => point[0]);
  const lats = ring.map(point => point[1]);
  const west = Math.max(Math.min(...lons), gateCtx.scanBounds.west);
  const east = Math.min(Math.max(...lons), gateCtx.scanBounds.east);
  const south = Math.max(Math.min(...lats), gateCtx.scanBounds.south);
  const north = Math.min(Math.max(...lats), gateCtx.scanBounds.north);
  if (west >= east || south >= north) return [];

  const points: QuestionCandidate['anchor'][] = [];
  for (let y = 1; y <= 7; y += 1) {
    for (let x = 1; x <= 7; x += 1) {
      points.push({
        lat: south + (north - south) * (y / 8),
        lon: west + (east - west) * (x / 8),
      });
    }
  }
  return points.sort((a, b) => {
    const aDistance = (a.lat - candidate.anchor.lat) ** 2 + (a.lon - candidate.anchor.lon) ** 2;
    const bDistance = (b.lat - candidate.anchor.lat) ** 2 + (b.lon - candidate.anchor.lon) ** 2;
    return aDistance - bDistance;
  });
}

/**
 * Generate question candidates from scan output.
 * Pure function — no I/O, no Dexie, no engine imports.
 */
export function generateCandidates(
  scanCtx: ScanContext,
  gateCtx: GateContext,
): QuestionCandidate[] {
  const raw = runRules(scanCtx);
  return raw.flatMap(candidate => {
    const anchors = [candidate.anchor, ...(candidate.alternativeAnchors ?? [])];
    const {
      alternativeAnchors: _alternatives,
      contextOnly: _contextOnly,
      ...persistableCandidate
    } = candidate;

    // Nearby historic evidence is deliberately displayed as non-actionable
    // permission context. Anchor the row to the nearest safe internal point so
    // the normal boundary/protection guarantees remain intact, but do not turn
    // unrelated permission coverage or finds into evidence about the external
    // route.
    if (candidate.contextOnly) {
      if (gateCtx.smStatus !== 'green' || !passesCoverageFence(gateCtx.smCoverageAvailable)) return [];
      const contextAnchor = safePermissionAnchors(candidate, gateCtx)
        .find(anchor => passesAllGates({ ...candidate, anchor }, gateCtx));
      if (!contextAnchor) return [];
      return [{
        ...persistableCandidate,
        anchor: contextAnchor,
        locationActionAllowed: false,
        contextGeometry: undefined,
      }];
    }

    const safeAnchor = anchors.find(anchor => passesAllGates({ ...candidate, anchor }, gateCtx));
    if (safeAnchor) return [{
      ...persistableCandidate,
      anchor: safeAnchor,
      metrics: metricsAtAnchor(candidate, safeAnchor, scanCtx),
    }];

    // A Roman-road insight can still be useful when the alignment is protected,
    // but it must not link the user to the protected evidence location. Only use
    // this fallback when a route anchor passed the spatial/coverage checks and
    // was rejected specifically by monument protection.
    const protectedRomanContext = candidate.ruleId === 'ROMAN_ROUTE_ACTIVITY' &&
      gateCtx.smStatus === 'green' &&
      passesCoverageFence(gateCtx.smCoverageAvailable) &&
      anchors.some(anchor =>
        passesBoundaryGate({ ...candidate, anchor }, gateCtx.boundary) &&
        isAnchorInScanBounds(anchor, gateCtx.scanBounds) &&
        (gateCtx.isAnchorProtected?.(anchor) ?? false)
      );
    if (!protectedRomanContext) return [];

    const fallbackAnchor = safePermissionAnchors(candidate, gateCtx)
      .find(anchor => passesAllGates({ ...candidate, anchor }, gateCtx));
    if (!fallbackAnchor) return [];

    return [{
      ...persistableCandidate,
      anchor: fallbackAnchor,
      metrics: metricsAtAnchor(candidate, fallbackAnchor, scanCtx),
      status: 'NEEDS_EVIDENCE' as const,
      locationActionAllowed: false,
      description: `${candidate.description} Part of this context overlaps protected archaeology; the scheduled monument must remain excluded from detecting.`,
      supportingEvidence: [
        ...candidate.supportingEvidence,
        { label: 'Roman-road context overlaps a scheduled monument', sourceScanId: candidate.scanId },
      ],
    }];
  });
}
