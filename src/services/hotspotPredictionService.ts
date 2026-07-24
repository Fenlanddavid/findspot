import { v4 as uuid } from 'uuid';
import { db } from '../db';
import type {
    Find,
    HotspotPrediction,
    HotspotPredictionAggregate,
    Session,
    Track,
} from '../db';
import type { Hotspot } from '../pages/fieldGuideTypes';
import { getDistance } from '../utils/fieldGuideAnalysis';
import { HOTSPOT_ENGINE_VERSION } from '../engines/hotspot/hotspotEngine';
import {
    PREDICTION_TRACK_COVERAGE_THRESHOLD,
    resolvePredictionDecisions,
} from '../engines/coverage/sectionCoverageEngine';
import { geohashEncode } from './findHotspotService';
import { diagLog } from './diagLog';

export const HOTSPOT_PREDICTION_TTL_MS = 180 * 24 * 60 * 60 * 1000;
export const SEARCHED_COVERAGE_THRESHOLD = PREDICTION_TRACK_COVERAGE_THRESHOLD;
const TRACK_SWATH_RADIUS_M = 5;
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
    const source = track.points.filter(point => point.timestamp >= surfacedAt);
    if (source.length < 2) return [];
    const samples: Array<[number, number]> = [];
    for (let index = 1; index < source.length; index++) {
        const previous = source[index - 1];
        const current = source[index];
        const distanceM = getDistance([previous.lon, previous.lat], [current.lon, current.lat]);
        const steps = Math.max(1, Math.ceil(distanceM / TRACK_SWATH_RADIUS_M));
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

export function predictionTrackCoverage(
    prediction: HotspotPrediction,
    tracks: Track[],
    sessions: Session[],
): number {
    const permissionBySession = new Map(sessions.map(session => [session.id, session.permissionId]));
    const relevantTracks = tracks.filter(track => {
        if (prediction.sessionId && track.sessionId !== prediction.sessionId) return false;
        if (!prediction.permissionId) return true;
        return !!track.sessionId && permissionBySession.get(track.sessionId) === prediction.permissionId;
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
            if (samples.some(sample => getDistance(sample, point) <= TRACK_SWATH_RADIUS_M)) covered++;
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
): Promise<{ hits: number; searchedNoFind: number }> {
    const unresolved = await db.hotspotPredictions.where('outcome').equals('unvisited').toArray();
    const predictions = scopePermissionId
        ? unresolved.filter(prediction => prediction.permissionId === scopePermissionId)
        : unresolved;
    const [sections, observations] = await Promise.all([
        db.permissionSections.toArray(),
        db.sessionCoverage.toArray(),
    ]);
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
    });
    const resolvedAt = Date.now();
    await db.transaction('rw', db.hotspotPredictions, async () => {
        for (const decision of decisions) {
            await db.hotspotPredictions.update(decision.predictionId, {
                outcome: decision.outcome,
                resolutionEvidence: decision.evidence,
                reportedConfirmationCount: decision.reportedConfirmationCount,
                searchedCoverage: decision.outcome === 'searched_no_find'
                    ? decision.searchedCoverage
                    : undefined,
                matchedFindId: decision.outcome === 'hit'
                    ? decision.matchedFindId
                    : undefined,
                resolvedAt,
            });
            void diagLog.debug(
                'coverage-resolution',
                `${decision.outcome} via ${decision.evidence}`,
                JSON.stringify({
                    predictionId: decision.predictionId,
                    reportedConfirmations: decision.reportedConfirmationCount,
                    searchedCoverage: decision.outcome === 'searched_no_find'
                        ? decision.searchedCoverage
                        : undefined,
                }),
            );
        }
    });
    return {
        hits: decisions.filter(decision => decision.outcome === 'hit').length,
        searchedNoFind: decisions.filter(
            decision => decision.outcome === 'searched_no_find'
        ).length,
    };
}

export async function refreshHotspotPredictionOutcomes(
    scopePermissionId?: string,
): Promise<{
    hits: number;
    searchedNoFind: number;
}> {
    const [finds, tracks, sessions] = await Promise.all([
        db.finds.toArray(),
        db.tracks.toArray(),
        db.sessions.toArray(),
    ]);
    return resolveHotspotPredictionOutcomes(finds, tracks, sessions, scopePermissionId);
}

/** Rolls evidence up before deleting raw rows, preserving long-term calibration. */
export async function aggregateAndSweepHotspotPredictions(
    now = Date.now(),
    ttlMs = HOTSPOT_PREDICTION_TTL_MS,
): Promise<number> {
    const cutoff = now - ttlMs;
    return db.transaction('rw', [db.hotspotPredictions, db.hotspotPredictionAggregates], async () => {
        const expired = await db.hotspotPredictions.where('surfacedAt').below(cutoff).toArray();
        const groups = new Map<string, HotspotPrediction[]>();
        for (const prediction of expired) {
            const id = `${prediction.engineVersion}:${prediction.confidence}`;
            const group = groups.get(id);
            if (group) group.push(prediction);
            else groups.set(id, [prediction]);
        }

        for (const [id, predictions] of groups) {
            const existing = await db.hotspotPredictionAggregates.get(id);
            const aggregate: HotspotPredictionAggregate = {
                id,
                engineVersion: predictions[0].engineVersion,
                confidence: predictions[0].confidence,
                surfacedCount: (existing?.surfacedCount ?? 0) + predictions.length,
                searchedCount: (existing?.searchedCount ?? 0) + predictions.filter(row => row.outcome !== 'unvisited').length,
                hitCount: (existing?.hitCount ?? 0) + predictions.filter(row => row.outcome === 'hit').length,
                trackedSearchedCount: (existing?.trackedSearchedCount ?? 0)
                    + predictions.filter(row => row.resolutionEvidence === 'tracked').length,
                trackedHitCount: (existing?.trackedHitCount ?? 0)
                    + predictions.filter(row =>
                        row.outcome === 'hit' && row.resolutionEvidence === 'tracked'
                    ).length,
                reportedSearchedCount: (existing?.reportedSearchedCount ?? 0)
                    + predictions.filter(row => row.resolutionEvidence === 'reported').length,
                reportedHitCount: (existing?.reportedHitCount ?? 0)
                    + predictions.filter(row =>
                        row.outcome === 'hit' && row.resolutionEvidence === 'reported'
                    ).length,
                mixedSearchedCount: (existing?.mixedSearchedCount ?? 0)
                    + predictions.filter(row => row.resolutionEvidence === 'mixed').length,
                mixedHitCount: (existing?.mixedHitCount ?? 0)
                    + predictions.filter(row =>
                        row.outcome === 'hit' && row.resolutionEvidence === 'mixed'
                    ).length,
                findOnlyHitCount: (existing?.findOnlyHitCount ?? 0)
                    + predictions.filter(row =>
                        row.outcome === 'hit' && (
                            row.resolutionEvidence === 'find'
                            || row.resolutionEvidence === undefined
                        )
                    ).length,
                updatedAt: now,
            };
            await db.hotspotPredictionAggregates.put(aggregate);
        }
        if (expired.length > 0) await db.hotspotPredictions.bulkDelete(expired.map(row => row.id));
        return expired.length;
    });
}
