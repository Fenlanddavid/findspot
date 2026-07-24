import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db, type HotspotPrediction, type Session, type Track } from '../../src/db';
import {
    aggregateAndSweepHotspotPredictions,
    predictionTrackCoverage,
    resolveHotspotPredictionOutcomes,
} from '../../src/services/hotspotPredictionService';

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
    await db.permissionSections.clear();
    await db.sessionCoverage.clear();
});

afterEach(async () => {
    await db.hotspotPredictions.clear();
    await db.hotspotPredictionAggregates.clear();
    await db.permissionSections.clear();
    await db.sessionCoverage.clear();
});

describe('hotspot prediction outcomes', () => {
    it('never infers a miss from elapsed time alone', async () => {
        await db.hotspotPredictions.put(prediction({ surfacedAt: 1 }));
        await resolveHotspotPredictionOutcomes([], [], [session]);
        expect((await db.hotspotPredictions.get('prediction-1'))?.outcome).toBe('unvisited');
    });

    it('uses measured track coverage as searched-no-find evidence', async () => {
        const row = prediction();
        expect(predictionTrackCoverage(row, [crossingTrack()], [session])).toBeGreaterThan(0);
        await db.hotspotPredictions.put(row);
        const result = await resolveHotspotPredictionOutcomes([], [crossingTrack()], [session]);
        expect(result.searchedNoFind).toBe(1);
        expect((await db.hotspotPredictions.get(row.id))?.outcome).toBe('searched_no_find');
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

        expect(result.searchedNoFind).toBe(1);
        expect((await db.hotspotPredictions.get('prediction-1'))?.outcome)
            .toBe('searched_no_find');
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
            outcome: 'hit',
            matchedFindId: 'find-1',
            resolutionEvidence: 'find',
        });
    });

    it('rolls up surfaced/searched/hit counts before deleting expired raw rows', async () => {
        await db.hotspotPredictions.bulkPut([
            prediction({ id: 'unvisited', surfacedAt: 1, outcome: 'unvisited' }),
            prediction({
                id: 'searched', surfacedAt: 1, outcome: 'searched_no_find',
                resolutionEvidence: 'reported',
            }),
            prediction({
                id: 'hit', surfacedAt: 1, outcome: 'hit',
                resolutionEvidence: 'tracked',
            }),
        ]);
        const swept = await aggregateAndSweepHotspotPredictions(NOW, 1_000);
        expect(swept).toBe(3);
        expect(await db.hotspotPredictions.count()).toBe(0);
        expect(await db.hotspotPredictionAggregates.get('engine-v1:Strong Signal')).toMatchObject({
            surfacedCount: 3,
            searchedCount: 2,
            hitCount: 1,
            trackedSearchedCount: 1,
            trackedHitCount: 1,
            reportedSearchedCount: 1,
            reportedHitCount: 0,
        });
    });
});
