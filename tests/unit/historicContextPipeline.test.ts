import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HistoricScanOptions } from '../../src/services/fieldguide/historicScanSupport';
import { HISTORIC_CACHE_VERSION } from '../../src/domain/engineVersions';

const mocks = vi.hoisted(() => ({
    get: vi.fn(), save: vi.fn(), context: vi.fn(), nhle: vi.fn(), aim: vi.fn(), roads: vi.fn(),
}));
vi.mock('../../src/db', () => ({ db: { fieldGuideCache: { get: mocks.get } } }));
vi.mock('../../src/services/fieldGuideMutations', () => ({ saveHistoricScanCache: mocks.save, discardFieldGuideScanCache: vi.fn() }));
vi.mock('../../src/services/historicScanService', () => ({
    fetchLocationLabel: vi.fn(async () => null), fetchHistoricContextFeatures: mocks.context,
    fetchScheduledMonuments: mocks.nhle, fetchAIMData: mocks.aim, fetchHistoricRoutes: vi.fn(async () => ({ elements: [] })),
    describeAIMCoverage: vi.fn(() => 'fixture'), parseOverpassContextRoutes: vi.fn(() => []),
}));
vi.mock('../../src/services/romanRoadService', () => ({ prefetchRomanRoads: vi.fn(), fetchRomanRoadsResult: mocks.roads }));
vi.mock('../../src/services/pasDensityService', () => ({ prefetchPASDensity: vi.fn(), getPASDensityNear: vi.fn(async () => null), pasPeriodLabels: vi.fn(() => []) }));
vi.mock('../../src/services/hillfortService', () => ({ lookupHillfortContext: vi.fn(async () => null) }));

import { runHistoricScanPipeline } from '../../src/services/fieldguide/historicScanCoordinator';

const nhle = { features: [{ type: 'Feature', properties: { Name: 'Synthetic wetland monument', ListEntry: 'fixture' },
    geometry: { type: 'Polygon', coordinates: [[[0.08, 51.99], [0.12, 51.99], [0.12, 52.01], [0.08, 52.01], [0.08, 51.99]]] } }], available: true };
const aim = { features: [], available: true };
const centre = { lat: 52, lng: 0.1 };
const originalBounds = { west: 0.099, south: 51.999, east: 0.101, north: 52.001 };
function options(panned = false): HistoricScanOptions {
    return {
        mapRef: { current: { getZoom: () => 16, getCenter: () => panned ? { lat: 53, lng: 1 } : centre,
            getBounds: () => ({ getWest: () => 0.099, getSouth: () => 51.999, getEast: () => 0.101, getNorth: () => 52.001 }) } },
        scanCenter: centre, analysisBounds: originalBounds, terrainClusters: [], monumentPoints: [], routes: [], nhleData: null, aimData: null,
        permissions: [], fields: [], targetPeriod: 'all', questionTerrainAvailability: {}, historicRoutesAvailable: false,
    } as unknown as HistoricScanOptions;
}
const lifecycle = () => ({ onLog: vi.fn(), onStatusChange: vi.fn(), signal: new AbortController().signal, isActive: () => true });

describe('completed historic scan evidence snapshot', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.get.mockResolvedValue(undefined);
        mocks.context.mockResolvedValue({ elements: [] });
        mocks.nhle.mockResolvedValue(nhle);
        mocks.aim.mockResolvedValue(aim);
        mocks.roads.mockResolvedValue({ routes: [], available: true });
    });

    it('anchors heritage lookups and summary to the original scan when the map has moved', async () => {
        const result = await runHistoricScanPipeline(options(true), lifecycle());
        expect(result).not.toBeNull();
        expect(result!.center).toEqual(centre);
        expect(result!.drifted).toBe(true);
        expect(result!.supportingContext?.centre).toEqual(centre);
        expect(result!.supportingContext?.bounds).toEqual(originalBounds);
        expect(result!.supportingContext?.title).toBe('Recorded archaeological context present');
        expect(result!.supportingContext?.recordedHeritage[0].relationship).toBe('contains_scan_centre');
        expect(mocks.context.mock.calls[0].slice(0, 2)).toEqual([52, 0.1]);
    });

    it('rebuilds cached summaries with the same rules as fresh source retrieval', async () => {
        const fresh = await runHistoricScanPipeline(options(), lifecycle());
        const stored = mocks.save.mock.calls[0][0];
        expect(stored.engineVersion).toBe(HISTORIC_CACHE_VERSION);
        mocks.get.mockResolvedValue(stored);
        vi.clearAllMocks();
        const cached = await runHistoricScanPipeline(options(), lifecycle());
        expect(cached!.supportingContext).toEqual(fresh!.supportingContext);
        expect(mocks.context).not.toHaveBeenCalled();
        expect(mocks.nhle).not.toHaveBeenCalled();
        expect(mocks.aim).not.toHaveBeenCalled();
    });

    it('reports failed heritage retrieval without inventing a negative historic assessment', async () => {
        mocks.nhle.mockResolvedValue({ features: [], available: false, error: 'offline' });
        mocks.context.mockResolvedValue(null);
        const result = await runHistoricScanPipeline(options(), lifecycle());
        expect(result!.supportingContext?.title).toBe('Historic context could not be fully assessed');
        expect(result!.supportingContext?.coverage.limitations.join(' ')).toContain('Scheduled monument records: unavailable');
        expect(result!.supportingContext?.terrain.every(s => s.state === 'not_assessed')).toBe(true);
    });

    it('refreshes legacy cached routes when segment identity is insufficient for counting', async () => {
        await runHistoricScanPipeline(options(), lifecycle());
        const stored = mocks.save.mock.calls[0][0];
        stored.historicLookup.romanRoads = [{ id: 'legacy-segment', source: 'rrra', type: 'roman_road',
            confidenceClass: 'C', certaintyScore: 40, geometry: [[0.09, 52], [0.11, 52]], bbox: [[0.09, 52], [0.11, 52]] }];
        mocks.get.mockResolvedValue(stored);
        mocks.roads.mockClear();
        const result = await runHistoricScanPipeline(options(), lifecycle());
        expect(mocks.roads).toHaveBeenCalledOnce();
        expect(result!.supportingContext?.historicRoutes).toHaveLength(0);
    });
});
