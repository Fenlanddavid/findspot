import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db, type HotspotPrediction, type Session, type Track } from '../../src/db';
import {
    aggregateAndSweepHotspotPredictions,
    predictionTrackCoverage,
    resolveHotspotPredictionOutcomes,
} from '../../src/services/hotspotPredictionService';
import {
    deleteQuestionInvestigationNote,
    saveQuestionInvestigationNote,
} from '../../src/services/investigationMutations';

const NOW = 1_800_000_000_000;

function prediction(overrides: Partial<HotspotPrediction> = {}): HotspotPrediction {
    return {
        id: 'prediction-1',
        engineVersion: 'engine-v1',
        confidence: 'Strong Signal',
        classification: 'Settlement Edge Candidate',
        surfacedAt: NOW - 1_000,
        permissionId: 'permission-1',
        sessionId: null,
        center: [-1, 52],
        bounds: [[-1.0005, 51.9995], [-0.9995, 52.0005]],
        geohash6: 'gcpuuz',
        outcome: 'unvisited',
        ...overrides,
    };
}

const session = { id: 'session-1', permissionId: 'permission-1' } as Session;

function crossingTrack(): Track {
    const points = Array.from({ length: 10 }, (_, row) => {
        const lat = 51.99955 + row * 0.0001;
        const westToEast = row % 2 === 0;
        return [
            { lat, lon: westToEast ? -1.00045 : -0.99955, timestamp: NOW + row * 2 },
            { lat, lon: westToEast ? -0.99955 : -1.00045, timestamp: NOW + row * 2 + 1 },
        ];
    }).flat();
    return {
        id: 'track-1',
        projectId: 'project-1',
        sessionId: 'session-1',
        name: 'Search',
        points,
        isActive: false,
        color: '#fff',
        createdAt: new Date(NOW).toISOString(),
        updatedAt: new Date(NOW).toISOString(),
    };
}

beforeEach(async () => {
    await db.open();
    await db.hotspotPredictions.clear();
    await db.hotspotPredictionAggregates.clear();
    await db.hotspotPredictionEvidence.clear();
    await db.permissionSections.clear();
    await db.sessionCoverage.clear();
    await db.outstandingQuestions.clear();
    await db.questionNotes.clear();
});

afterEach(async () => {
    await db.hotspotPredictions.clear();
    await db.hotspotPredictionAggregates.clear();
    await db.hotspotPredictionEvidence.clear();
    await db.permissionSections.clear();
    await db.sessionCoverage.clear();
    await db.outstandingQuestions.clear();
    await db.questionNotes.clear();
});

describe('hotspot prediction outcomes', () => {
    it('never infers a miss from elapsed time alone', async () => {
        await db.hotspotPredictions.put(prediction({ surfacedAt: 1 }));
        await resolveHotspotPredictionOutcomes([], [], [session]);
        expect((await db.hotspotPredictions.get('prediction-1'))?.outcome).toBe('unvisited');
    });

    it('records measured track exposure as visited, not a negative result', async () => {
        const row = prediction();
        expect(predictionTrackCoverage(row, [crossingTrack()], [session])).toBeGreaterThan(0);
        await db.hotspotPredictions.put(row);
        const result = await resolveHotspotPredictionOutcomes([], [crossingTrack()], [session]);
        expect(result.searchedNoFind).toBe(0);
        expect(result.visitedTracked).toBe(1);
        expect((await db.hotspotPredictions.get(row.id))?.outcome).toBe('visited_tracked');
    });

    it('does not interpolate prediction exposure across a recorded GPS gap', () => {
        const track: Track = {
            ...crossingTrack(),
            points: [
                { lat: 52, lon: -1.002, timestamp: NOW },
                { lat: 52, lon: -0.998, timestamp: NOW + 2_000 },
            ],
            gaps: [{ start: NOW + 500, end: NOW + 1_500 }],
        };
        expect(predictionTrackCoverage(prediction(), [track], [session])).toBe(0);
    });

    it('allows a permission-scoped prediction to gain track evidence on a later session', () => {
        const surfacedEarlier = prediction({ sessionId: 'session-original' });
        expect(predictionTrackCoverage(surfacedEarlier, [crossingTrack()], [session]))
            .toBeGreaterThan(0);
    });

    it('can scope review feedback resolution to the current permission', async () => {
        const otherSession = {
            id: 'session-2',
            permissionId: 'permission-2',
        } as Session;
        const otherTrack = {
            ...crossingTrack(),
            id: 'track-2',
            sessionId: otherSession.id,
        };
        await db.hotspotPredictions.bulkPut([
            prediction(),
            prediction({
                id: 'prediction-2',
                permissionId: 'permission-2',
            }),
        ]);

        const result = await resolveHotspotPredictionOutcomes(
            [],
            [crossingTrack(), otherTrack],
            [session, otherSession],
            'permission-1',
        );

        expect(result.visitedTracked).toBe(1);
        expect((await db.hotspotPredictions.get('prediction-1'))?.outcome)
            .toBe('visited_tracked');
        expect((await db.hotspotPredictions.get('prediction-2'))?.outcome)
            .toBe('unvisited');
    });

    it('pins current hit matching by post-surfacing find proximity', async () => {
        const row = prediction();
        await db.hotspotPredictions.put(row);
        const result = await resolveHotspotPredictionOutcomes([{
            id: 'find-1',
            projectId: 'project-1',
            permissionId: 'permission-1',
            fieldId: null,
            sessionId: 'session-1',
            findCode: 'F1',
            objectType: 'Coin',
            lat: 52,
            lon: -0.998,
            gpsAccuracyM: 5,
            osGridRef: '',
            w3w: '',
            period: 'Roman',
            material: 'Copper alloy',
            weightG: null,
            widthMm: null,
            heightMm: null,
            depthMm: null,
            decoration: '',
            completeness: 'Complete',
            findContext: '',
            storageLocation: '',
            notes: '',
            createdAt: new Date(NOW).toISOString(),
            updatedAt: new Date(NOW).toISOString(),
        }], [], [session]);
        expect(result.hits).toBe(1);
        expect(await db.hotspotPredictions.get(row.id)).toMatchObject({
            outcome: 'find_recorded',
            matchedFindId: 'find-1',
            resolutionEvidence: 'find',
        });
    });

    it('rolls up surfaced/searched/hit counts before deleting expired raw rows', async () => {
        await db.hotspotPredictions.bulkPut([
            prediction({ id: 'unvisited', surfacedAt: 1, outcome: 'unvisited' }),
            prediction({
                id: 'searched', surfacedAt: 1, outcome: 'search_reported',
                resolutionEvidence: 'reported',
            }),
            prediction({
                id: 'hit', surfacedAt: 1, outcome: 'find_recorded',
                resolutionEvidence: 'tracked',
            }),
        ]);
        const swept = await aggregateAndSweepHotspotPredictions(NOW, 1_000);
        expect(swept).toBe(3);
        expect(await db.hotspotPredictions.count()).toBe(0);
        expect(await db.hotspotPredictionAggregates.get('engine-v1:Strong Signal')).toMatchObject({
            surfacedCount: 3,
            searchedCount: 1,
            hitCount: 0,
            trackedSearchedCount: 0,
            trackedHitCount: 0,
            reportedSearchedCount: 1,
            reportedHitCount: 0,
        });
    });

    it('sweeps but excludes legacy inferred outcomes from calibration aggregates', async () => {
        await db.hotspotPredictions.bulkPut([
            prediction({ id: 'current', surfacedAt: 1, outcome: 'search_reported', resolutionEvidence: 'reported' }),
            prediction({ id: 'legacy', surfacedAt: 1, outcome: 'visited_tracked', legacyOutcome: 'searched_no_find', resolutionEvidence: 'tracked' }),
        ]);
        expect(await aggregateAndSweepHotspotPredictions(NOW, 1_000)).toBe(2);
        expect(await db.hotspotPredictionAggregates.get('engine-v1:Strong Signal')).toMatchObject({
            surfacedCount: 1,
            searchedCount: 1,
            hitCount: 0,
        });
    });

    it('re-evaluates a tracked visit when a later find is recorded and remains idempotent', async () => {
        const row = prediction();
        const find = {
            id: 'later-find', permissionId: 'permission-1', sessionId: 'session-1',
            lat: 52, lon: -1, createdAt: new Date(NOW + 10_000).toISOString(),
        } as Parameters<typeof resolveHotspotPredictionOutcomes>[0][number];
        await db.hotspotPredictions.put(row);
        await resolveHotspotPredictionOutcomes([], [crossingTrack()], [session]);
        expect((await db.hotspotPredictions.get(row.id))?.outcome).toBe('visited_tracked');

        await resolveHotspotPredictionOutcomes([find], [crossingTrack()], [session]);
        expect(await db.hotspotPredictions.get(row.id)).toMatchObject({
            outcome: 'find_recorded', associatedFindIds: ['later-find'],
        });
        const evidenceUpdatedAt = (await db.hotspotPredictions.get(row.id))?.evidenceUpdatedAt;
        const firstCount = await db.hotspotPredictionEvidence.where('predictionId').equals(row.id).count();
        await resolveHotspotPredictionOutcomes([find], [crossingTrack()], [session]);
        expect(await db.hotspotPredictionEvidence.where('predictionId').equals(row.id).count()).toBe(firstCount);
        expect((await db.hotspotPredictions.get(row.id))?.evidenceUpdatedAt).toBe(evidenceUpdatedAt);
    });

    it('lets a reported search acquire a later find association without changing its interpretation label', async () => {
        const row = prediction({
            outcome: 'search_reported', resolutionEvidence: 'reported',
            classification: 'Settlement Edge Candidate',
        });
        const find = {
            id: 'post-report-find', permissionId: 'permission-1', sessionId: 'session-later',
            lat: 52, lon: -1, createdAt: new Date(NOW + 10_000).toISOString(),
        } as Parameters<typeof resolveHotspotPredictionOutcomes>[0][number];
        await db.hotspotPredictions.put(row);

        await resolveHotspotPredictionOutcomes([find], [], [session]);

        expect(await db.hotspotPredictions.get(row.id)).toMatchObject({
            outcome: 'find_recorded', associatedFindIds: ['post-report-find'],
            classification: 'Settlement Edge Candidate',
        });
    });

    it('preserves an explicit negative report when a later find changes the summary outcome', async () => {
        const row = prediction();
        await db.hotspotPredictions.put(row);
        await db.outstandingQuestions.put({
            id: 'question-1', permissionId: 'permission-1', ruleId: 'SETTLEMENT_QUIET',
            anchor: { lat: 52, lon: -1 }, title: 'Test target', description: 'Test it',
            category: 'CONTRADICTION', status: 'NEEDS_EVIDENCE', confidence: 0.5,
            createdAt: NOW, updatedAt: NOW, generatedByScanId: 'scan',
            supportingEvidence: [], contradictingEvidence: [],
        });
        await db.questionNotes.put({
            id: 'negative-note', questionId: 'question-1', author: 'user',
            type: 'searched_nothing', sessionId: 'session-1', createdAt: NOW + 2_000,
        });
        await resolveHotspotPredictionOutcomes([], [], [session]);
        expect((await db.hotspotPredictions.get(row.id))?.outcome).toBe('no_relevant_find_reported');

        const find = {
            id: 'later-find', permissionId: 'permission-1', sessionId: 'session-1',
            lat: 52, lon: -1, createdAt: new Date(NOW + 10_000).toISOString(),
        } as Parameters<typeof resolveHotspotPredictionOutcomes>[0][number];
        await resolveHotspotPredictionOutcomes([find], [], [session]);
        const evidence = await db.hotspotPredictionEvidence.where('predictionId').equals(row.id).toArray();
        expect(evidence.map(item => item.kind).sort()).toEqual(['explicit_negative', 'find_association']);
        expect(await db.hotspotPredictions.get(row.id)).toMatchObject({
            outcome: 'find_recorded',
            outcomeHistory: [
                { outcome: 'no_relevant_find_reported', at: expect.any(Number) },
                { outcome: 'find_recorded', at: expect.any(Number) },
            ],
        });
    });

    it('retracts a stale find association when the find is deleted or relocated', async () => {
        const row = prediction();
        const find = {
            id: 'movable-find', permissionId: 'permission-1', lat: 52, lon: -1,
            createdAt: new Date(NOW + 10_000).toISOString(),
        } as Parameters<typeof resolveHotspotPredictionOutcomes>[0][number];
        await db.hotspotPredictions.put(row);
        await resolveHotspotPredictionOutcomes([find], [], [session]);
        expect((await db.hotspotPredictions.get(row.id))?.outcome).toBe('find_recorded');
        await resolveHotspotPredictionOutcomes([{ ...find, lon: 1 }], [], [session]);
        expect(await db.hotspotPredictions.get(row.id)).toMatchObject({ outcome: 'unvisited', associatedFindIds: [] });
        expect(await db.hotspotPredictionEvidence.where('predictionId').equals(row.id).toArray())
            .toEqual([expect.objectContaining({ kind: 'find_association', retractedAt: expect.any(Number) })]);
    });

    it('retracts an explicit negative when its user report is edited or deleted', async () => {
        const row = prediction();
        await db.hotspotPredictions.put(row);
        await db.outstandingQuestions.put({
            id: 'question-1', permissionId: 'permission-1', ruleId: 'SETTLEMENT_QUIET',
            anchor: { lat: 52, lon: -1 }, title: 'Test target', description: 'Test it',
            category: 'CONTRADICTION', status: 'NEEDS_EVIDENCE', confidence: 0.5,
            createdAt: NOW, updatedAt: NOW, generatedByScanId: 'scan',
            supportingEvidence: [], contradictingEvidence: [],
        });
        const report = {
            id: 'negative-note', questionId: 'question-1', author: 'user' as const,
            type: 'searched_nothing' as const, createdAt: NOW + 2_000,
        };
        await saveQuestionInvestigationNote(report);
        expect((await db.hotspotPredictions.get(row.id))?.outcome).toBe('no_relevant_find_reported');

        await saveQuestionInvestigationNote({ ...report, type: 'poor_conditions' });
        expect((await db.hotspotPredictions.get(row.id))?.outcome).toBe('unvisited');
        expect(await db.hotspotPredictionEvidence.where('predictionId').equals(row.id).toArray())
            .toEqual([expect.objectContaining({ kind: 'explicit_negative', retractedAt: expect.any(Number) })]);

        await saveQuestionInvestigationNote(report);
        await deleteQuestionInvestigationNote(report.id);
        expect((await db.hotspotPredictions.get(row.id))?.outcome).toBe('unvisited');
        expect(await db.hotspotPredictionEvidence.where('predictionId').equals(row.id).toArray())
            .toEqual([expect.objectContaining({ kind: 'explicit_negative', retractedAt: expect.any(Number) })]);
    });
});
