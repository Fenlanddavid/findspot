// ─── Outstanding Questions — scan completion hook ───────────────────────────
// Called after a FieldGuide scan completes. Determines which permission the
// scan falls within, generates candidates, diffs against existing questions,
// and persists the result to Dexie.
//
// The caller runs this non-blocking because questions are supplementary.

import { db, type Permission } from '../db';
import { calculateCoverage } from '../services/coverage';
import { generateCandidates } from './generator';
import { diffQuestions } from './differ';
import type { Hotspot, Cluster, HistoricRoute, ScanBounds } from '../pages/fieldGuideTypes';
import type { GateContext } from './gates';
import type { ScanContext } from './rules';
import type { OutstandingQuestion, QuestionSourceAvailability, RuleId } from './types';
import { hasRequiredSources } from './rules';
import { isPointInPolygon, isPointProtectedByNHLE } from '../utils/fieldGuideAnalysis';
import type { NHLEResponse } from '../services/historicScanService';
import * as turf from '@turf/turf';

export interface ScanCompleteInput {
  permissionId?: string;
  scanCenter: { lat: number; lng: number };
  hotspots: Hotspot[];
  clusters: Cluster[];
  routes: HistoricRoute[];
  scanBounds: ScanBounds;
  sourceAvailability: QuestionSourceAvailability;
  permissions: Permission[];
  scheduledMonuments: NHLEResponse;
  pasRecordCountInScanCell?: number;
  pasTopPeriods?: string[];
  pasTopTypes?: string[];
  /** Rules owned by this scan pass. Out-of-scope questions remain untouched. */
  ruleIds?: readonly RuleId[];
}

/**
 * Update outstanding questions after a scan completes.
 * Pure side-effect — reads finds/tracks from Dexie, writes questions back.
 */
export async function updateQuestionsAfterScan(input: ScanCompleteInput): Promise<void> {
  const { permissionId: requestedPermissionId, scanCenter, hotspots, clusters, routes, scanBounds, sourceAvailability, permissions, scheduledMonuments, pasRecordCountInScanCell, pasTopPeriods, pasTopTypes, ruleIds } = input;
  const ruleScope = ruleIds ? new Set<RuleId>(ruleIds) : null;

  // 1. A permission-page scan carries its permission ID explicitly. Ordinary
  // FieldGuide scans still use spatial matching against the scan centre.
  const matchedPermission = requestedPermissionId
    ? permissions.find(p => p.id === requestedPermissionId)
    : permissions.find(p => {
        if (!p.boundary?.coordinates?.[0]?.length) return false;
        return isPointInPolygon(scanCenter.lat, scanCenter.lng, p.boundary.coordinates);
      });
  if (!matchedPermission) return; // Scan outside any permission — no questions

  const permissionId = matchedPermission.id;
  const boundary = matchedPermission.boundary;

  // 2. Load finds for this permission
  const finds = await db.finds.where('permissionId').equals(permissionId).toArray();

  // 3. Compute coverage from tracks
  const sessions = await db.sessions.where('permissionId').equals(permissionId).toArray();
  const sessionIds = sessions.map(s => s.id);
  const tracks = sessionIds.length > 0
    ? await db.tracks.where('sessionId').anyOf(sessionIds).toArray()
    : [];
  const permissionCoverage = boundary
    ? calculateCoverage(boundary, tracks)
    : null;
  const localCoverageAtAnchor = (lat: number, lon: number, radiusM: number): number | null => {
    if (!boundary) return null;
    try {
      const permissionPolygon = turf.polygon(boundary.coordinates);
      const localArea = turf.circle([lon, lat], radiusM / 1000, { units: 'kilometers', steps: 32 });
      const clipped = turf.intersect(turf.featureCollection([permissionPolygon, localArea]));
      if (!clipped) return null;
      return calculateCoverage(clipped.geometry, tracks)?.percentCovered ?? null;
    } catch {
      return null;
    }
  };

  // 4. Compute permission centroid
  let centroid = { lat: scanCenter.lat, lon: scanCenter.lng };
  if (boundary) {
    try {
      const [lon, lat] = turf.centroid(turf.polygon(boundary.coordinates)).geometry.coordinates;
      centroid = { lat, lon };
    } catch {
      // Invalid legacy boundaries are already rejected by the candidate gate.
    }
  }

  // 5. Generate scan ID
  const scanId = `scan-${permissionId}-${Date.now()}`;

  const protectedAreaPresent = !!boundary && scheduledMonuments.features.some(feature => {
    if (!feature.geometry) return false;
    try {
      return turf.booleanIntersects(
        turf.polygon(boundary.coordinates),
        turf.feature(feature.geometry as GeoJSON.Geometry),
      );
    } catch {
      return false;
    }
  });

  // 6. Build scan context
  const scanCtx: ScanContext = {
    scanId,
    hotspots,
    clusters,
    historicRoutes: routes,
    finds,
    localCoverageAtAnchor,
    permissionCentroid: centroid,
    pasRecordCountInScanCell,
    pasTopPeriods,
    pasTopTypes,
    totalCoveragePct: permissionCoverage?.percentCovered ?? null,
    hasRecordedTracks: tracks.some(track => Array.isArray(track.points) && track.points.length >= 2),
    protectedAreaPresent,
  };

  // 7. Build gate context
  const smCoverageAvailable = sourceAvailability.scheduled_monuments;
  const smStatus = smCoverageAvailable ? 'green' as const : 'amber' as const;

  const gateCtx: GateContext = {
    boundary,
    smStatus,
    smCoverageAvailable,
    scanBounds,
    isAnchorProtected: anchor => isPointProtectedByNHLE(anchor.lat, anchor.lon, scheduledMonuments),
  };

  // 8. Generate and diff
  const candidates = generateCandidates(scanCtx, gateCtx)
    .filter(candidate => !ruleScope || ruleScope.has(candidate.ruleId))
    .filter(candidate => hasRequiredSources(candidate.ruleId, sourceAvailability));

  // Keep the read/diff/write lifecycle atomic. This prevents two detached scan
  // completions from advancing or replacing the same question from stale state.
  await db.transaction('rw', [db.outstandingQuestions, db.permissions], async () => {
    const existing = await db.outstandingQuestions
      .where('permissionId')
      .equals(permissionId)
      .toArray() as OutstandingQuestion[];

    const now = Date.now();
    const result = diffQuestions(existing, candidates, now, {
      contains: question => {
        if (ruleScope && !ruleScope.has(question.ruleId)) return false;
        const spatiallyCovered = question.anchor.lat >= scanBounds.south && question.anchor.lat <= scanBounds.north &&
          question.anchor.lon >= scanBounds.west && question.anchor.lon <= scanBounds.east;
        if (!spatiallyCovered) return false;
        return hasRequiredSources(question.ruleId, sourceAvailability);
      },
    });

    // Stamp permissionId on new questions (differ doesn't know it).
    for (const q of result.upserts) {
      q.permissionId = permissionId;
    }

    const allQuestions = [...result.upserts, ...result.resolved];
    if (allQuestions.length > 0) {
      await db.outstandingQuestions.bulkPut(allQuestions);
    }
    await db.permissions.update(permissionId, {
      questionsEvaluatedAt: new Date(now).toISOString(),
    });
  });
}
