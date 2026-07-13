// ─── Outstanding Questions — generator ──────────────────────────────────────
// Pure function: (scanContext, gateContext) => QuestionCandidate[]
// Runs rules, applies gates, returns post-gate candidates (pre-cap/diff).

import type { QuestionCandidate } from './types';
import type { GateContext } from './gates';
import { isAnchorInScanBounds, isAnchorInsideBoundary, passesAllGates, passesBoundaryGate, passesCoverageFence, passesSMGate } from './gates';
import { runRules, type ScanContext } from './rules';

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
    const safeAnchor = anchors.find(anchor => passesAllGates({ ...candidate, anchor }, gateCtx));
    const { alternativeAnchors: _alternatives, ...persistableCandidate } = candidate;
    if (safeAnchor) return [{ ...persistableCandidate, anchor: safeAnchor }];

    // These questions describe permission-wide records rather than a target at
    // one coordinate. If the representative centre is protected, retain the
    // insight at a safe point inside the permission and keep location actions off.
    const permissionWideContext = (
      candidate.ruleId === 'PUBLIC_RECORD_CONTEXT' || candidate.ruleId === 'COVERAGE_GAP'
    ) && candidate.locationActionAllowed === false;
    if (permissionWideContext) {
      const fallbackAnchor = [candidate.anchor, ...safePermissionAnchors(candidate, gateCtx)]
        .find(anchor =>
          isAnchorInsideBoundary(anchor, gateCtx.boundary) &&
          isAnchorInScanBounds(anchor, gateCtx.scanBounds) &&
          passesSMGate(gateCtx.smStatus, gateCtx.isAnchorProtected?.(anchor) ?? false) &&
          passesCoverageFence(gateCtx.smCoverageAvailable)
        );
      if (fallbackAnchor) return [{ ...persistableCandidate, anchor: fallbackAnchor }];
    }

    // This is a non-location safety question, not a detecting target. It may be
    // retained when its representative anchor is protected, provided the anchor
    // is still inside the permission and current scan and SM coverage succeeded.
    const protectedAreaExclusion = candidate.ruleId === 'PROTECTED_AREA_EXCLUSION' &&
      candidate.locationActionAllowed === false &&
      gateCtx.smStatus === 'green' &&
      passesCoverageFence(gateCtx.smCoverageAvailable);
    if (protectedAreaExclusion) {
      const contextualAnchor = [candidate.anchor, ...safePermissionAnchors(candidate, gateCtx)]
        .find(anchor =>
          isAnchorInsideBoundary(anchor, gateCtx.boundary) &&
          isAnchorInScanBounds(anchor, gateCtx.scanBounds)
        );
      if (contextualAnchor) return [{ ...persistableCandidate, anchor: contextualAnchor }];
    }

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
