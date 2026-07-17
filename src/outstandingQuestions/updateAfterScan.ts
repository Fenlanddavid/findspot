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
import type { QuestionNote } from './types';
import { hasRequiredSources } from './rules';
import { isControlledObservation, metricsChanged, resolvedOutcomeFor } from './investigationState';
import { isPointInPolygon, isPointProtectedByNHLE } from '../utils/fieldGuideAnalysis';
import type { NHLEResponse } from '../services/historicScanService';
import * as turf from '@turf/turf';
import { v4 as uuid } from 'uuid';
import {
  mergedFromText,
  statusTransitionText,
  terminalSupersedingQuestionId,
} from './transitionHistory';

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
    permissionBoundary: boundary,
    pasRecordCountInScanCell,
    pasTopPeriods,
    pasTopTypes,
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

  // ── Write protectionStatus and pasContext to the permission BEFORE the
  // question pipeline so the UI can render the banner even if candidate
  // generation or differ/persistence fails downstream.
  await db.transaction('rw', [db.permissions], async () => {
    const perm = await db.permissions.get(permissionId);
    if (!perm) return;

    // Protection banner state machine (fail-safe, order matters):
    const prevProtection = perm.protectionStatus;
    const now_iso = new Date().toISOString();
    let protectionState: 'present' | 'clear' | 'unknown' = prevProtection?.state ?? 'unknown';
    let monumentCount = prevProtection?.monumentCount;

    if (!smCoverageAvailable) {
      // B1: SM source unavailable — preserve previous state, never write clear.
      // evaluatedAt still updates to record "we checked, source was unavailable".
    } else if (protectedAreaPresent) {
      // B2: Intersection found on a green scan — present until a fully-contained green scan shows otherwise.
      protectionState = 'present';
      monumentCount = scheduledMonuments.features.filter(f => {
        if (!f.geometry || !boundary) return false;
        try {
          return turf.booleanIntersects(
            turf.polygon(boundary.coordinates),
            turf.feature(f.geometry as GeoJSON.Geometry),
          );
        } catch { return false; }
      }).length;
    } else {
      // B3: clear requires full polygon containment inside scanBounds.
      let fullyContained = false;
      if (boundary) {
        try {
          const permPoly = turf.polygon(boundary.coordinates);
          const boundsPolygon = turf.bboxPolygon([scanBounds.west, scanBounds.south, scanBounds.east, scanBounds.north]);
          fullyContained = turf.booleanContains(boundsPolygon, permPoly);
        } catch {
          fullyContained = false;
        }
      }
      if (fullyContained) {
        protectionState = 'clear';
        monumentCount = undefined;
      }
      // B4: else preserve previous state (already set above).
    }

    const protectionUpdate: Permission['protectionStatus'] = {
      state: protectionState,
      evaluatedAt: now_iso,
      ...(monumentCount !== undefined ? { monumentCount } : {}),
    };

    const permUpdates: Partial<Permission> = {
      protectionStatus: protectionUpdate,
    };

    // Write pasContext if PAS data is available.
    if (pasRecordCountInScanCell != null && Number.isFinite(pasRecordCountInScanCell)) {
      permUpdates.pasContext = {
        count: pasRecordCountInScanCell,
        topPeriods: (pasTopPeriods ?? []).filter(Boolean).slice(0, 3),
        topTypes: (pasTopTypes ?? []).filter(Boolean).slice(0, 3),
        evaluatedAt: now_iso,
      };
    }

    await db.permissions.update(permissionId, permUpdates);
  });

  // 8. Generate and diff. The source guard also rejects unknown runtime rule
  // IDs from an in-flight scan produced by an older deployed bundle.
  const candidates = generateCandidates(scanCtx, gateCtx)
    .filter(candidate => !ruleScope || ruleScope.has(candidate.ruleId))
    .filter(candidate => hasRequiredSources(candidate.ruleId, sourceAvailability));

  // Keep the read/diff/write lifecycle atomic. This prevents two detached scan
  // completions from advancing or replacing the same question from stale state.
  await db.transaction('rw', [db.outstandingQuestions, db.permissions, db.questionNotes], async () => {
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

    const existingById = new Map(existing.map(question => [question.id, question]));
    const changedQuestions = [...result.upserts, ...result.resolved];
    const changedQuestionIds = changedQuestions.map(question => question.id);
    const notes = changedQuestionIds.length > 0
      ? await db.questionNotes.where('questionId').anyOf(changedQuestionIds).toArray()
      : [];
    const notesByQuestion = new Map<string, typeof notes>();
    for (const note of notes) {
      const grouped = notesByQuestion.get(note.questionId) ?? [];
      grouped.push(note);
      notesByQuestion.set(note.questionId, grouped);
    }
    const historyNotes: QuestionNote[] = [];

    for (const question of changedQuestions) {
      const previous = existingById.get(question.id);
      if (!previous) {
        question.priorityState = { scansSinceEvidenceChange: 0 };
      } else if (question.updatedAt === previous.updatedAt) {
        // Out-of-scope questions were not examined by this scan and do not age.
        question.priorityState = previous.priorityState ?? { scansSinceEvidenceChange: 0 };
      } else {
        const questionNotes = notesByQuestion.get(question.id) ?? [];
        const evidenceChanged = previous.status !== question.status ||
          metricsChanged(previous.metrics, question.metrics) ||
          questionNotes.some(note =>
            isControlledObservation(note) && note.createdAt > previous.updatedAt
          );
        question.priorityState = {
          scansSinceEvidenceChange: evidenceChanged
            ? 0
            : (previous.priorityState?.scansSinceEvidenceChange ?? 0) + 1,
        };
      }

      if (question.status === 'RESOLVED' && question.resolvedReason === 'preconditions_cleared') {
        question.resolvedOutcome = resolvedOutcomeFor(
          question,
          notesByQuestion.get(question.id) ?? [],
        );
      }

      if (previous && previous.status !== question.status) {
        historyNotes.push({
          id: uuid(),
          questionId: question.id,
          author: 'system',
          type: 'status_change',
          text: statusTransitionText(previous.status, question.status),
          createdAt: now,
        });
      }
    }

    const questionById = new Map<string, OutstandingQuestion>([
      ...existing.map(question => [question.id, question] as const),
      ...changedQuestions.map(question => [question.id, question] as const),
    ]);
    for (const superseded of result.resolved.filter(question =>
      question.resolvedReason === 'superseded' && question.supersededByIds?.[0]
    )) {
      const immediateSuccessorId = superseded.supersededByIds![0];
      const terminalSuccessorId = terminalSupersedingQuestionId(immediateSuccessorId, questionById);
      const userNotes = (notesByQuestion.get(superseded.id) ?? [])
        .filter(note => note.author === 'user');
      for (const note of userNotes) {
        await db.questionNotes.update(note.id, { questionId: terminalSuccessorId });
      }
      historyNotes.push({
        id: uuid(),
        questionId: terminalSuccessorId,
        author: 'system',
        type: 'merged_from',
        text: mergedFromText(superseded.title),
        createdAt: now,
      });
    }
    if (historyNotes.length > 0) {
      await db.questionNotes.bulkPut(historyNotes);
    }

    // Stamp permissionId on new questions (differ doesn't know it).
    for (const q of result.upserts) {
      q.permissionId = permissionId;
    }

    const allQuestions = changedQuestions;
    if (allQuestions.length > 0) {
      await db.outstandingQuestions.bulkPut(allQuestions);
    }
    await db.permissions.update(permissionId, {
      questionsEvaluatedAt: new Date(now).toISOString(),
    });
  });
}
