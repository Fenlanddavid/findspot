import { v4 as uuid } from 'uuid';
import { db } from '../db';
import type {
    Find,
    HotspotPrediction,
    HotspotPredictionAggregate,
    HotspotPredictionEvidence,
    Session,
    Track,
} from '../db';
import type { Hotspot } from '../pages/fieldGuideTypes';
import { getDistance } from '../utils/fieldGuideAnalysis';
import { interpolateAcceptedTrackPoints } from '../shared/trackSegments';
import { HOTSPOT_ENGINE_VERSION } from '../engines/hotspot/hotspotEngine';
import {
    PREDICTION_TRACK_COVERAGE_THRESHOLD,
    resolvePredictionDecisions,
    type ExplicitPredictionReport,
} from '../engines/coverage/sectionCoverageEngine';
import { geohashEncode } from './findHotspotService';
import { diagLog } from './diagLog';

export const HOTSPOT_PREDICTION_TTL_MS = 180 * 24 * 60 * 60 * 1000;
export const SEARCHED_COVERAGE_THRESHOLD = PREDICTION_TRACK_COVERAGE_THRESHOLD;
/** Positional proximity assumption, not detector sweep width. */
const TRACK_POSITION_PROXIMITY_RADIUS_M = 5;
const GRID_SIZE = 10;

export async function recordHotspotPredictions(
    hotspots: Hotspot[],
    context: { permissionId?: string | null; sessionId?: string | null } = {},
): Promise<void> {
    if (hotspots.length === 0) return;
    const surfacedAt = Date.now();
    const rows: HotspotPrediction[] = hotspots.map(hotspot => ({
        id: uuid(),
        engineVersion: HOTSPOT_ENGINE_VERSION,
        confidence: hotspot.confidence,
        classification: hotspot.classification,
        surfacedAt,
        permissionId: context.permissionId ?? null,
        sessionId: context.sessionId ?? null,
        center: hotspot.center,
        bounds: hotspot.bounds,
        geohash6: geohashEncode(hotspot.center[1], hotspot.center[0]),
        outcome: 'unvisited',
    }));
    await db.hotspotPredictions.bulkPut(rows);
}

function interpolateTrackPoints(track: Track, surfacedAt: number): Array<[number, number]> {
    return interpolateAcceptedTrackPoints(track.points, track.gaps, {
        fromTimestamp: surfacedAt,
        sampleSpacingM: TRACK_POSITION_PROXIMITY_RADIUS_M,
    });
}

export function predictionTrackCoverage(
    prediction: HotspotPrediction,
    tracks: Track[],
    sessions: Session[],
): number {
    const permissionBySession = new Map(sessions.map(session => [session.id, session.permissionId]));
    const relevantTracks = tracks.filter(track => {
        // Permission-scoped predictions can accumulate evidence on later
        // visits. Session is the fallback scope only for an unowned target.
        if (prediction.permissionId) {
            return !!track.sessionId && permissionBySession.get(track.sessionId) === prediction.permissionId;
        }
        return !!prediction.sessionId && track.sessionId === prediction.sessionId;
    });
    const samples = relevantTracks.flatMap(track => interpolateTrackPoints(track, prediction.surfacedAt));
    if (samples.length === 0) return 0;

    const [[west, south], [east, north]] = prediction.bounds;
    let covered = 0;
    for (let y = 0; y < GRID_SIZE; y++) {
        for (let x = 0; x < GRID_SIZE; x++) {
            const point: [number, number] = [
                west + (east - west) * ((x + 0.5) / GRID_SIZE),
                south + (north - south) * ((y + 0.5) / GRID_SIZE),
            ];
            if (samples.some(sample => getDistance(sample, point) <= TRACK_POSITION_PROXIMITY_RADIUS_M)) covered++;
        }
    }
    return covered / (GRID_SIZE * GRID_SIZE);
}

/** Resolves only evidence-backed outcomes. Time passing never creates a miss. */
export async function resolveHotspotPredictionOutcomes(
    finds: Find[],
    tracks: Track[],
    sessions: Session[],
    scopePermissionId?: string,
    database = db,
): Promise<{ hits: number; searchedNoFind: number; visitedTracked: number; searchReported: number }> {
    const eligible = (await database.hotspotPredictions.toArray())
        .filter(prediction => !prediction.legacyOutcome);
    const predictions = scopePermissionId
        ? eligible.filter(prediction => prediction.permissionId === scopePermissionId)
        : eligible;
    const [sections, observations, questions, notes] = await Promise.all(scopePermissionId
        ? [
              database.permissionSections.where('permissionId').equals(scopePermissionId).toArray(),
              database.sessionCoverage.where('permissionId').equals(scopePermissionId).toArray(),
              database.outstandingQuestions.where('permissionId').equals(scopePermissionId).toArray(),
              database.questionNotes.toArray(),
          ]
        : [
              database.permissionSections.toArray(), database.sessionCoverage.toArray(),
              database.outstandingQuestions.toArray(), database.questionNotes.toArray(),
          ]);
    const questionById = new Map(questions.map(question => [question.id, question]));
    const explicitNegativeReports: ExplicitPredictionReport[] = notes.flatMap(note => {
        if (note.author !== 'user' || note.type !== 'searched_nothing') return [];
        const question = questionById.get(note.questionId);
        if (!question) return [];
        return [{
            id: note.id,
            permissionId: question.permissionId,
            anchor: [question.anchor.lon, question.anchor.lat],
            observedAt: note.createdAt,
            ...(note.sessionId ? { sessionId: note.sessionId } : {}),
        }];
    });
    const trackedCoverageByPrediction = new Map(predictions.map(prediction => [
        prediction.id,
        predictionTrackCoverage(prediction, tracks, sessions),
    ]));
    const decisions = resolvePredictionDecisions({
        predictions,
        finds,
        sections,
        observations,
        trackedCoverageByPrediction,
        explicitNegativeReports,
    });
    const resolvedAt = Date.now();
    const observationById = new Map(observations.map(observation => [observation.id, observation]));
    const negativeById = new Map(explicitNegativeReports.map(report => [report.id, report]));
    const findById = new Map(finds.map(find => [find.id, find]));
    const existingEvidence = await database.hotspotPredictionEvidence.toArray();
    const evidenceById = new Map(existingEvidence.map(item => [item.id, item]));
    await database.transaction('rw', [database.hotspotPredictions, database.hotspotPredictionEvidence], async () => {
        for (const decision of decisions) {
            const previous = predictions.find(prediction => prediction.id === decision.predictionId);
            if (!previous) continue;
            const nextHistory = [...(previous.outcomeHistory ?? [])];
            if (previous.outcome !== decision.outcome) nextHistory.push({ outcome: decision.outcome, at: resolvedAt });
            const nextAssociatedFindIds = decision.outcome === 'find_recorded'
                ? decision.matchedFindIds
                : [];
            const arraysEqual = (left: string[] | undefined, right: string[]) =>
                (left ?? []).length === right.length && (left ?? []).every((item, index) => item === right[index]);
            const materiallyChanged = previous.outcome !== decision.outcome
                || previous.resolutionEvidence !== decision.evidence
                || previous.reportedConfirmationCount !== decision.reportedConfirmationCount
                || previous.searchedCoverage !== decision.searchedCoverage
                || previous.matchedFindId !== (decision.outcome === 'find_recorded' ? decision.matchedFindId : undefined)
                || !arraysEqual(previous.associatedFindIds, nextAssociatedFindIds);
            if (materiallyChanged) await database.hotspotPredictions.update(decision.predictionId, {
                outcome: decision.outcome,
                resolutionEvidence: decision.evidence,
                reportedConfirmationCount: decision.reportedConfirmationCount,
                searchedCoverage: decision.searchedCoverage,
                matchedFindId: decision.outcome === 'find_recorded'
                    ? decision.matchedFindId
                    : undefined,
                associatedFindIds: nextAssociatedFindIds,
                resolvedAt: previous.outcome !== decision.outcome ? resolvedAt : previous.resolvedAt,
                evidenceUpdatedAt: resolvedAt,
                outcomeHistory: nextHistory,
            });

            const desired: HotspotPredictionEvidence[] = [];
            const addEvidence = (
                kind: HotspotPredictionEvidence['kind'], sourceRecordId: string,
                observedAt: number, sessionId?: string, coverageFraction?: number,
            ) => {
                const id = `${decision.predictionId}:${kind}:${sourceRecordId}`;
                desired.push({
                    id, predictionId: decision.predictionId, kind, sourceRecordId, observedAt,
                    permissionId: previous.permissionId ?? undefined,
                    ...(sessionId ? { sessionId } : {}),
                    ...(coverageFraction === undefined ? {} : { coverageFraction }),
                    createdAt: evidenceById.get(id)?.createdAt ?? new Date(observedAt).toISOString(),
                });
            };
            if (decision.searchedCoverage !== undefined) {
                const prior = evidenceById.get(`${decision.predictionId}:tracked_visit:track-coverage`);
                addEvidence('tracked_visit', 'track-coverage', prior?.observedAt ?? resolvedAt, undefined, decision.searchedCoverage);
            }
            for (const id of decision.reportedObservationIds) {
                const observation = observationById.get(id);
                if (observation) addEvidence('search_report', id, observation.observedAt, observation.sessionId);
            }
            for (const id of decision.explicitNegativeReportIds) {
                const report = negativeById.get(id);
                if (report) addEvidence('explicit_negative', id, report.observedAt, report.sessionId);
            }
            if (decision.outcome === 'find_recorded') {
                for (const id of decision.matchedFindIds) {
                    const find = findById.get(id);
                    const foundAt = find?.foundAt ? Date.parse(find.foundAt) : Number.NaN;
                    const createdAt = find ? Date.parse(find.createdAt) : Number.NaN;
                    addEvidence('find_association', id, Number.isFinite(foundAt) ? foundAt : createdAt, find?.sessionId ?? undefined);
                }
            }
            const previousRows = await database.hotspotPredictionEvidence
                .where('predictionId').equals(decision.predictionId).toArray();
            const desiredIds = new Set(desired.map(item => item.id));
            const retracted = previousRows
                .filter(item => !desiredIds.has(item.id) && item.retractedAt === undefined)
                .map(item => ({ ...item, retractedAt: resolvedAt }));
            if (retracted.length > 0) await database.hotspotPredictionEvidence.bulkPut(retracted);
            if (desired.length > 0) await database.hotspotPredictionEvidence.bulkPut(desired);
            void diagLog.debug(
                'coverage-resolution',
                `${decision.outcome} via ${decision.evidence ?? 'none'}`,
                JSON.stringify({
                    reportedConfirmations: decision.reportedConfirmationCount,
                    searchedCoverage: decision.outcome === 'visited_tracked'
                        ? decision.searchedCoverage
                        : undefined,
                }),
            );
        }
    });
    return {
        hits: decisions.filter(decision => decision.outcome === 'find_recorded').length,
        searchedNoFind: 0,
        visitedTracked: decisions.filter(decision => decision.outcome === 'visited_tracked').length,
        searchReported: decisions.filter(decision => decision.outcome === 'search_reported').length,
    };
}

export async function refreshHotspotPredictionOutcomes(
    scopePermissionId?: string,
): Promise<{
    hits: number;
    searchedNoFind: number;
    visitedTracked: number;
    searchReported: number;
}> {
    if (scopePermissionId) {
        const [finds, sessions] = await Promise.all([
            db.finds.where('permissionId').equals(scopePermissionId).toArray(),
            db.sessions.where('permissionId').equals(scopePermissionId).toArray(),
        ]);
        const sessionIds = sessions.map(session => session.id);
        const tracks = sessionIds.length > 0
            ? await db.tracks.where('sessionId').anyOf(sessionIds).toArray()
            : [];
        return resolveHotspotPredictionOutcomes(
            finds,
            tracks,
            sessions,
            scopePermissionId,
        );
    }
    const [finds, tracks, sessions] = await Promise.all([
        db.finds.toArray(),
        db.tracks.toArray(),
        db.sessions.toArray(),
    ]);
    return resolveHotspotPredictionOutcomes(finds, tracks, sessions, scopePermissionId);
}

/**
 * Rolls evidence up before deleting raw rows, preserving long-term calibration.
 * Aggregates are deliberately frozen: after the raw 180-day prediction and its
 * ledger are swept, later evidence cannot be attached or rewrite that historic
 * denominator. Resolve current evidence immediately before scheduled sweeping.
 */
export async function aggregateAndSweepHotspotPredictions(
    now = Date.now(),
    ttlMs = HOTSPOT_PREDICTION_TTL_MS,
): Promise<number> {
    const cutoff = now - ttlMs;
    return db.transaction('rw', [db.hotspotPredictions, db.hotspotPredictionAggregates, db.hotspotPredictionEvidence], async () => {
        const expired = await db.hotspotPredictions.where('surfacedAt').below(cutoff).toArray();
        const groups = new Map<string, HotspotPrediction[]>();
        for (const prediction of expired) {
            // Legacy inferred outcomes remain in raw history for traceability but
            // are not calibration observations and must not influence aggregates.
            if (prediction.legacyOutcome) continue;
            const id = `${prediction.engineVersion}:${prediction.confidence}`;
            const group = groups.get(id);
            if (group) group.push(prediction);
            else groups.set(id, [prediction]);
        }

        for (const [id, predictions] of groups) {
            const existing = await db.hotspotPredictionAggregates.get(id);
            const searchedTrials = predictions.filter(row =>
                row.outcome === 'search_reported'
                || row.outcome === 'no_relevant_find_reported'
                || (row.outcome === 'find_recorded' && (row.resolutionEvidence === 'reported' || row.resolutionEvidence === 'mixed'))
            );
            const supportedHits = predictions.filter(row =>
                row.outcome === 'find_recorded'
                && (row.resolutionEvidence === 'reported' || row.resolutionEvidence === 'mixed')
            );
            const aggregate: HotspotPredictionAggregate = {
                id,
                engineVersion: predictions[0].engineVersion,
                confidence: predictions[0].confidence,
                surfacedCount: (existing?.surfacedCount ?? 0) + predictions.length,
                searchedCount: (existing?.searchedCount ?? 0) + searchedTrials.length,
                hitCount: (existing?.hitCount ?? 0) + supportedHits.length,
                trackedSearchedCount: (existing?.trackedSearchedCount ?? 0)
                    + searchedTrials.filter(row => row.resolutionEvidence === 'tracked').length,
                trackedHitCount: (existing?.trackedHitCount ?? 0)
                    + supportedHits.filter(row => row.resolutionEvidence === 'tracked').length,
                reportedSearchedCount: (existing?.reportedSearchedCount ?? 0)
                    + searchedTrials.filter(row => row.resolutionEvidence === 'reported').length,
                reportedHitCount: (existing?.reportedHitCount ?? 0)
                    + supportedHits.filter(row => row.resolutionEvidence === 'reported').length,
                mixedSearchedCount: (existing?.mixedSearchedCount ?? 0)
                    + searchedTrials.filter(row => row.resolutionEvidence === 'mixed').length,
                mixedHitCount: (existing?.mixedHitCount ?? 0)
                    + supportedHits.filter(row => row.resolutionEvidence === 'mixed').length,
                findOnlyHitCount: (existing?.findOnlyHitCount ?? 0)
                    + predictions.filter(row =>
                        row.outcome === 'find_recorded' && (
                            row.resolutionEvidence === 'find'
                            || row.resolutionEvidence === undefined
                        )
                    ).length,
                updatedAt: now,
            };
            await db.hotspotPredictionAggregates.put(aggregate);
        }
        if (expired.length > 0) {
            const expiredIds = expired.map(row => row.id);
            await db.hotspotPredictionEvidence.where('predictionId').anyOf(expiredIds).delete();
            await db.hotspotPredictions.bulkDelete(expiredIds);
        }
        return expired.length;
    });
}
