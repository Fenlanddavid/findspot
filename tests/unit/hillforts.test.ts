import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { hillfortContextSchema, hillfortDatasetSchema, type HillfortDataset } from '../../src/types/hillforts';
import { HILLFORT_DATASET } from '../../src/shared/staticDatasetContract';
import { hillfortContextSignature, hillfortScanPolygon, hillfortStatusLabel, matchHillfortSources, queryHillforts } from '../../src/services/fieldguide/hillfortSpatial';
import { cacheHillfortDataset, HILLFORT_CACHE, hillfortAssetUrl, lookupHillfortContext, resetHillfortMemory, validateHillfortResponse } from '../../src/services/hillfortService';
import { runLandscapeInterpretation } from '../../src/workers/landscapeInterpretation.worker';
import { safeParseLandscapeInterpretationRecord } from '../../src/services/persistenceValidation';
import { hillfortContextNarrative } from '../../src/services/fieldguide/landscapeInterpretation/narrativeGenerator';
import type { LandscapeInterpretationWorkerInput } from '../../src/types/landscapeInterpretation';

const bytes = readFileSync(new URL(`../../public/${HILLFORT_DATASET.assetPath}`, import.meta.url));
const dataset = hillfortDatasetSchema.parse(JSON.parse(bytes.toString()));
const geometry = hillfortScanPolygon({ west: -2.73, south: 51.99, east: -2.72, north: 52.00 });
const centre: [number, number] = [-2.725, 51.995];
const baseInput: LandscapeInterpretationWorkerInput = {
    geohash6: 'gcj2z7', nhleFeatures: [], aimFeatures: [], routeFeatures: [], geologyContext: null,
    hotspotMetrics: null, centerLat: centre[1], centerLon: centre[0], elevationM: null, slopePercent: null,
    aspectDegrees: null, potentialBreakdown: null,
};

function synthetic(positions: Array<[number, number]>): HillfortDataset {
    return { metadata: { ...dataset.metadata, recordCount: positions.length }, records: positions.map((position, i) => ({ ...dataset.records[0], id: `EN${String(i).padStart(4, '0')}`, position })) };
}

function installCache() {
    const entries = new Map<string, Response>();
    const cache = {
        match: vi.fn(async (url: string) => entries.get(url)?.clone()),
        put: vi.fn(async (url: string, response: Response) => { entries.set(url, response.clone()); }),
    };
    vi.stubGlobal('caches', { open: vi.fn(async () => cache) });
    return { cache, entries };
}

afterEach(() => { resetHillfortMemory(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('published Atlas data contract', () => {
    it('pins real data, unique source identities, provenance, uncertainty and all six jurisdictions', () => {
        expect(bytes.length).toBe(HILLFORT_DATASET.bytes);
        expect(createHash('sha256').update(bytes).digest('hex')).toBe(HILLFORT_DATASET.sha256);
        expect(dataset.records).toHaveLength(4147);
        expect(new Set(dataset.records.map(r => r.id)).size).toBe(4147);
        expect(new Set(dataset.records.map(r => r.country)).size).toBe(6);
        expect(dataset.records.filter(r => r.dating.Unknown === 'Yes')).toHaveLength(3546);
        expect(dataset.records.filter(r => r.interpretationStatus === 'Unconfirmed')).toHaveLength(722);
        expect(dataset.records.filter(r => r.interpretationStatus === 'Irreconciled issues')).toHaveLength(71);
        expect(dataset.metadata.edition).toBe('Atlas data 1.1 2017');
        expect(dataset.metadata.acquiredAt).not.toBe(dataset.metadata.publicationDate);
        expect(dataset.metadata.catalogueChecksumVerified).toBe(false);
    });
    it('rejects changed bytes, even with unchanged record counts, and invalid downloaded positions', async () => {
        const modified = bytes.toString().replace('Aconbury Camp', 'Aconbury Hill');
        await expect(validateHillfortResponse(new Response(modified))).rejects.toThrow();
        expect(hillfortDatasetSchema.safeParse({ ...dataset, records: [{ ...dataset.records[0], position: [NaN, 52] }] }).success).toBe(false);
    });
});

describe('scan geometry and relationships', () => {
    it('includes boundary points, excludes holes, includes bounded surrounding context', () => {
        const irregular: GeoJSON.Polygon = { type: 'Polygon', coordinates: [
            [[-2.8,52],[-2.7,52],[-2.7,52.1],[-2.75,52.04],[-2.8,52.1],[-2.8,52]],
            [[-2.78,52.01],[-2.76,52.01],[-2.76,52.03],[-2.78,52.03],[-2.78,52.01]],
        ] };
        const result = queryHillforts(synthetic([[-2.8,52.02],[-2.77,52.02],[-2.75,52.095],[-2.81,52.02],[-3,52]]), irregular, [-2.75,52.02]);
        expect(result.results.find(r => r.record.id === 'EN0000')?.relationship).toBe('within_scan');
        expect(result.results.find(r => r.record.id === 'EN0001')?.relationship).toBe('surrounding_context');
        expect(result.results.find(r => r.record.id === 'EN0002')).toBeUndefined();
        expect(result.results.find(r => r.record.id === 'EN0003')?.relationship).toBe('surrounding_context');
        expect(result.results.find(r => r.record.id === 'EN0004')).toBeUndefined();
    });
    it('uses centre distances and changes signatures for content, status, matches and exact geometry', () => {
        const result = queryHillforts(dataset, geometry, centre);
        expect(result.results.some(r => r.record.id === 'EN0001')).toBe(true);
        const signature = hillfortContextSignature(result);
        const changed = structuredClone(result);
        changed.results[0].record.dating.Comments += ' revised';
        expect(hillfortContextSignature(changed)).not.toBe(signature);
        changed.results = result.results; changed.status = 'partial';
        expect(hillfortContextSignature(changed)).not.toBe(signature);
        const shifted = hillfortScanPolygon({ west: -2.7301, south: 51.99, east: -2.72, north: 52.00 });
        expect(hillfortContextSignature(queryHillforts(dataset, shifted, centre))).not.toBe(signature);
        expect(result.results[0].distanceFromCentreM).toBeGreaterThan(0);
        expect(result.results[0].distanceFromBoundaryM).toBe(0);
    });
    it('matches explicit English NHLE identifiers without assigning legal geometry to Atlas', () => {
        const record = dataset.records.find(r => r.id === 'EN0001')!;
        const item = queryHillforts({ ...dataset, records: [record] }, geometry, centre).results[0];
        const feature = { type: 'Feature' as const, geometry: { type: 'Point' as const, coordinates: record.position }, properties: { ListEntry: '1001754', Name: 'Aconbury Camp' } };
        expect(matchHillfortSources(item, [feature])[0].relationship).toBe('shared_identifier');
        expect(matchHillfortSources(item, [{ ...feature, properties: { ListEntry: '1999999', Name: record.name } }])).toEqual([]);
        expect(record).not.toHaveProperty('protectionBoundary');
    });
});

describe('ALIE contextual separation and saved interpretations', () => {
    it.each(['loaded', 'empty', 'partial', 'load_failure', 'unavailable_offline'] as const)('keeps every numerical inference unchanged for %s', status => {
        const context = queryHillforts(dataset, geometry, centre);
        context.status = status;
        if (status !== 'loaded' && status !== 'partial') context.results = [];
        const baseline = runLandscapeInterpretation(baseInput);
        const enriched = runLandscapeInterpretation({ ...baseInput, hillfortContext: context });
        const { hillfortContext, generatedAt: _time, ...rest } = enriched;
        const { generatedAt: _baselineTime, ...original } = baseline;
        expect(rest).toEqual(original);
        expect(hillfortContext).toEqual(context);
        expect(hillfortContextNarrative(context)).not.toMatch(/visibility|trade|control|occupation|Iron Age/);
    });
    it('preserves old unassessed saves, rejects malformed new context and never makes absence negative evidence', () => {
        const old = runLandscapeInterpretation(baseInput);
        const wrapper = { geohash6: old.geohash6, generatedAt: 1, interpretation: old };
        expect(safeParseLandscapeInterpretationRecord(wrapper)?.interpretation.hillfortContext).toBeUndefined();
        expect(safeParseLandscapeInterpretationRecord({ ...wrapper, interpretation: { ...old, hillfortContext: { status: 'loaded' } } })).toBeNull();
        const empty = queryHillforts(synthetic([]), geometry, centre);
        expect(hillfortStatusLabel(empty)).toContain('does not establish an absence');
        expect(hillfortStatusLabel()).toContain('not assessed');
    });
});

describe('demand loading, offline and cancellation', () => {
    it('deduplicates simultaneous consumers without transmitting scan geometry and survives one cancellation', async () => {
        const { cache } = installCache();
        let release!: (r: Response) => void;
        const fetcher = vi.fn(() => new Promise<Response>(resolve => { release = resolve; }));
        vi.stubGlobal('fetch', fetcher);
        const a = new AbortController();
        const first = lookupHillfortContext(geometry, centre, a.signal);
        const firstRejected = expect(first).rejects.toMatchObject({ name: 'AbortError' });
        const second = lookupHillfortContext(geometry, centre, new AbortController().signal);
        await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
        a.abort();
        release(new Response(bytes));
        await firstRejected;
        expect((await second).status).toBe('loaded');
        expect(fetcher.mock.calls[0][0]).toBe(hillfortAssetUrl());
        expect(cache.put).toHaveBeenCalledTimes(1);
        await lookupHillfortContext(geometry, centre, new AbortController().signal);
        expect(fetcher).toHaveBeenCalledTimes(1);
    });
    it('retains validated bytes after a failed refresh and loads without networking offline', async () => {
        const { entries } = installCache();
        entries.set(hillfortAssetUrl(), new Response(bytes));
        vi.stubGlobal('fetch', vi.fn(async () => new Response('interrupted')));
        await expect(cacheHillfortDataset(undefined, true)).rejects.toThrow();
        expect((await entries.get(hillfortAssetUrl())!.clone().arrayBuffer()).byteLength).toBe(bytes.length);
        vi.stubGlobal('navigator', { onLine: false });
        const fetcher = vi.fn(async () => { throw new Error('offline'); });
        vi.stubGlobal('fetch', fetcher);
        expect((await lookupHillfortContext(geometry, centre, new AbortController().signal)).status).toBe('loaded');
        expect(fetcher).not.toHaveBeenCalled();
        resetHillfortMemory(); entries.clear();
        const missing = await lookupHillfortContext(geometry, centre, new AbortController().signal);
        expect(missing.status).toBe('unavailable_offline');
        expect(hillfortContextSchema.safeParse(missing).success).toBe(true);
    });
    it('does not report interrupted data as a valid cache', async () => {
        const { cache } = installCache();
        vi.stubGlobal('navigator', { onLine: true });
        vi.stubGlobal('fetch', vi.fn(async () => new Response(bytes.subarray(0, 500))));
        const context = await lookupHillfortContext(geometry, centre, new AbortController().signal);
        expect(context.status).toBe('load_failure');
        expect(cache.put).not.toHaveBeenCalled();
        expect(HILLFORT_CACHE).toContain('public');
    });
});
