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
});

afterEach(async () => {
    await db.hotspotPredictions.clear();
    await db.hotspotPredictionAggregates.clear();
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

    it('rolls up surfaced/searched/hit counts before deleting expired raw rows', async () => {
        await db.hotspotPredictions.bulkPut([
            prediction({ id: 'unvisited', surfacedAt: 1, outcome: 'unvisited' }),
            prediction({ id: 'searched', surfacedAt: 1, outcome: 'searched_no_find' }),
            prediction({ id: 'hit', surfacedAt: 1, outcome: 'hit' }),
        ]);
        const swept = await aggregateAndSweepHotspotPredictions(NOW, 1_000);
        expect(swept).toBe(3);
        expect(await db.hotspotPredictions.count()).toBe(0);
        expect(await db.hotspotPredictionAggregates.get('engine-v1:Strong Signal')).toMatchObject({
            surfacedCount: 3,
            searchedCount: 2,
            hitCount: 1,
        });
    });
});
