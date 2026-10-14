import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ValidatedFieldGuideScanCache } from '../../src/services/persistenceValidation';
const mocks = vi.hoisted(() => ({ discard: vi.fn() }));
vi.mock('../../src/services/fieldGuideMutations', () => ({ discardFieldGuideScanCache: mocks.discard }));
import { canReuseTerrainSourceAssessments } from '../../src/services/fieldguide/terrainScanSupport';

const legacy: ValidatedFieldGuideScanCache = { id: 'fixture', createdAt: 1, rawClusters: [], sourceAvailability: { terrain: true } };
describe('terrain cache assessment migration', () => {
    beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal('navigator', { onLine: true }); });
    afterEach(() => vi.unstubAllGlobals());

    it('reuses evidence with known processing and completion states', async () => {
        expect(await canReuseTerrainSourceAssessments({ ...legacy, sourceStatus: { terrain: 'ok' }, sourceCompleteness: { terrain: true } }, vi.fn())).toBe(true);
        expect(mocks.discard).not.toHaveBeenCalled();
    });
    it('invalidates insufficient legacy metadata online so scan-again really assesses the sources', async () => {
        const log = vi.fn();
        expect(await canReuseTerrainSourceAssessments(legacy, log)).toBe(false);
        expect(mocks.discard).toHaveBeenCalledWith('fixture');
        expect(log.mock.calls[0][0]).toContain('fresh terrain assessment is required');
    });
    it('retains legacy evidence offline, leaving its assessment state explicitly incomplete', async () => {
        vi.stubGlobal('navigator', { onLine: false });
        expect(await canReuseTerrainSourceAssessments(legacy, vi.fn())).toBe(true);
        expect(mocks.discard).not.toHaveBeenCalled();
    });
    it('retains known failures as failures rather than inventing a successful zero-signal assessment', async () => {
        expect(await canReuseTerrainSourceAssessments({ ...legacy, sourceStatus: { terrain: 'processing_failed' }, sourceCompleteness: { terrain: false } }, vi.fn())).toBe(true);
    });
});
