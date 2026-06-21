// ─── summarisePersistedSignals unit tests ────────────────────────────────────
// Pure function — no DB, no mocks needed.

import { describe, it, expect } from 'vitest';
import { summarisePersistedSignals } from '../../src/services/findHotspotService';
import type { FindHotspotSignal } from '../../src/db';

// ─── Minimal fixture helper ───────────────────────────────────────────────────

function makeRecord(overrides: Partial<FindHotspotSignal> = {}): FindHotspotSignal {
    return {
        signalKey:                  'perm1:gcpvh0',
        geohash6:                   'gcpvh0',
        permissionId:               'perm1',
        lastFindAt:                 '2026-05-01T10:00:00.000Z',
        findCount:                  1,
        periodCounts:               {},
        lastHotspotClassification:  'Settlement Edge Candidate',
        lastHotspotScore:           72,
        updatedAt:                  Date.now(),
        ...overrides,
    };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('summarisePersistedSignals', () => {
    it('returns null for empty input', () => {
        expect(summarisePersistedSignals([])).toBeNull();
    });

    it('returns null when all records have findCount 0', () => {
        const records = [
            makeRecord({ findCount: 0, periodCounts: {} }),
            makeRecord({ signalKey: 'perm2:gcpvh0', permissionId: 'perm2', findCount: 0, periodCounts: {} }),
        ];
        expect(summarisePersistedSignals(records)).toBeNull();
    });

    it('sums findCount across records', () => {
        const records = [
            makeRecord({ findCount: 3, periodCounts: { Roman: 2, Medieval: 1 } }),
            makeRecord({ signalKey: 'perm2:gcpvh0', permissionId: 'perm2', findCount: 5, periodCounts: { Roman: 3, 'Bronze Age': 2 } }),
        ];
        const result = summarisePersistedSignals(records);
        expect(result).not.toBeNull();
        expect(result!.totalFinds).toBe(8);
        expect(result!.sessionsSeen).toBe(2);
    });

    it('merges periodCounts and sorts by descending count', () => {
        const records = [
            makeRecord({ findCount: 3, periodCounts: { Roman: 1, Medieval: 2 } }),
            makeRecord({ signalKey: 'perm2:gcpvh0', permissionId: 'perm2', findCount: 4, periodCounts: { Roman: 4 } }),
        ];
        const result = summarisePersistedSignals(records);
        // Roman: 1+4=5, Medieval: 2 — Roman should be first
        expect(result!.periods[0]).toBe('Roman');
        expect(result!.periods[1]).toBe('Medieval');
    });

    it('note: single period', () => {
        const records = [makeRecord({ findCount: 2, periodCounts: { Roman: 2 } })];
        const result = summarisePersistedSignals(records);
        expect(result!.note).toBe('2 finds logged here across past sessions — Roman.');
    });

    it('note: two periods', () => {
        const records = [makeRecord({ findCount: 3, periodCounts: { Roman: 2, Medieval: 1 } })];
        const result = summarisePersistedSignals(records);
        expect(result!.note).toBe('3 finds logged here across past sessions — Roman and Medieval.');
    });

    it('note: three or more periods uses "and other periods"', () => {
        const records = [makeRecord({ findCount: 5, periodCounts: { Roman: 3, Medieval: 1, 'Bronze Age': 1 } })];
        const result = summarisePersistedSignals(records);
        expect(result!.note).toBe('5 finds logged here across past sessions — Roman and other periods.');
    });

    it('note: no period data omits period string', () => {
        const records = [makeRecord({ findCount: 2, periodCounts: {} })];
        const result = summarisePersistedSignals(records);
        expect(result!.note).toBe('2 finds logged here across past sessions.');
    });

    it('note: singular "find" for count of 1', () => {
        const records = [makeRecord({ findCount: 1, periodCounts: { Roman: 1 } })];
        const result = summarisePersistedSignals(records);
        expect(result!.note).toContain('1 find logged');
    });

    it('preserves geohash6 from first record', () => {
        const records = [makeRecord({ geohash6: 'gcpvh0', findCount: 1, periodCounts: {} })];
        const result = summarisePersistedSignals(records);
        expect(result!.geohash6).toBe('gcpvh0');
    });
});
