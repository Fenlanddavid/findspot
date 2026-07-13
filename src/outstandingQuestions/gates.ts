// ─── Outstanding Questions — hard gates ─────────────────────────────────────
// Evaluated before any question is emitted. A candidate failing any gate is
// silently discarded — no partial questions, no "suppressed" UI.
//
// Gate order: boundary → SM → coverage fence.

import type { GeoJSONPolygon } from '../db';
import type { QuestionCandidate } from './types';
import type { ScanBounds } from '../pages/fieldGuideTypes';
import * as turf from '@turf/turf';

// ─── Gate 1: Boundary inset ────────────────────────────────────────────────
// Anchor must be inside the permission polygon, inset by 25 m.
// The gate enforces a 25 m anchor inset universally.

const BOUNDARY_INSET_M = 25;

export function isAnchorInsideBoundary(
  anchor: QuestionCandidate['anchor'],
  boundary: GeoJSONPolygon | undefined,
): boolean {
  if (!boundary?.coordinates?.[0]?.length) return false;
  try {
    return turf.booleanPointInPolygon(
      turf.point([anchor.lon, anchor.lat]),
      turf.polygon(boundary.coordinates),
    );
  } catch {
    return false;
  }
}

export function passesBoundaryGate(
  candidate: QuestionCandidate,
  boundary: GeoJSONPolygon | undefined,
): boolean {
  if (!boundary?.coordinates?.[0]?.length) return false;

  const poly = turf.polygon(boundary.coordinates);
  let inset: any;
  try {
    inset = turf.buffer(poly, -BOUNDARY_INSET_M / 1000, { units: 'kilometers' });
  } catch {
    return false;
  }
  if (!inset) return false;

  const pt = turf.point([candidate.anchor.lon, candidate.anchor.lat]);
  return turf.booleanPointInPolygon(pt, inset);
}

// ─── Gate 2: Scheduled Monument ─────────────────────────────────────────────
// Anchor must not overlap a scheduled monument. Uses the same pass/fail
// semantics as the FieldGuide SM gate. The caller provides the SM status
// for the anchor's area.

export type SMStatus = 'green' | 'amber' | 'red';

export function passesSMGate(smStatus: SMStatus, anchorProtected = false): boolean {
  return smStatus === 'green' && !anchorProtected;
}

// ─── Gate 3: Coverage fence ─────────────────────────────────────────────────
// If SM coverage data is incomplete for the anchor's jurisdiction cell
// (Scotland, NI, border conditions), discard all spatially-anchored
// candidates in that cell.

export function passesCoverageFence(smCoverageAvailable: boolean): boolean {
  return smCoverageAvailable;
}

export function isAnchorInScanBounds(
  anchor: QuestionCandidate['anchor'],
  bounds: ScanBounds,
): boolean {
  return anchor.lat >= bounds.south && anchor.lat <= bounds.north &&
    anchor.lon >= bounds.west && anchor.lon <= bounds.east;
}

// ─── Combined gate check ────────────────────────────────────────────────────

export interface GateContext {
  boundary: GeoJSONPolygon | undefined;
  smStatus: SMStatus;
  smCoverageAvailable: boolean;
  scanBounds: ScanBounds;
  isAnchorProtected?: (anchor: QuestionCandidate['anchor']) => boolean;
}

export function passesAllGates(
  candidate: QuestionCandidate,
  ctx: GateContext,
): boolean {
  if (!passesBoundaryGate(candidate, ctx.boundary)) return false;
  if (!isAnchorInScanBounds(candidate.anchor, ctx.scanBounds)) return false;
  if (!passesSMGate(ctx.smStatus, ctx.isAnchorProtected?.(candidate.anchor) ?? false)) return false;
  if (!passesCoverageFence(ctx.smCoverageAvailable)) return false;
  return true;
}
