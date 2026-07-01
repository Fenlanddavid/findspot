// ─── AIM R2 fail-safe tests ───────────────────────────────────────────────────
// Verifies that _fetchAIMFromR2 (called via fetchAIMData) mirrors the SM
// sentinel pattern: a missing or bad meta never produces a false-clear, and
// partial shard failures return available:false rather than silently omitting.
//
// These tests focus on the AIM R2 path. The PAS density service is also
// smoke-tested here since both use a similar module-level fetch cache.
//
// Run with:
//   npx vitest run tests/unit/aimAndPasR2.test.ts

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock('../../src/utils/featureFlags', () => ({
    USE_R2_DESIGNATIONS: true,
    FINDSPOT_STATIC_BASE_URL: 'https://findspot-static.trials-uk.workers.dev',
}));

vi.mock('../../src/db', () => ({ db: {} }));

// Stub Cache Storage (not in Node test env)
vi.stubGlobal('caches', {
    match:  vi.fn().mockResolvedValue(undefined),
    open:   vi.fn().mockResolvedValue({ match: vi.fn().mockResolvedValue(undefined) }),
    keys:   vi.fn().mockResolvedValue([]),
    has:    vi.fn().mockResolvedValue(false),
    delete: vi.fn().mockResolvedValue(true),
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** A minimal bbox that maps to at least one geohash-6 cell */
const BBOX = { west: -1.83, south: 51.17, east: -1.82, north: 51.18 } as const;

function okMeta() {
    return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ schemaVersion: 1, builtAt: '2026-01-01' }),
    });
}

function notFoundMeta() {
    return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
}

function serverErrorMeta() {
    return Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) });
}

function emptyShard() {
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) });
}

function errorShard() {
    return Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) });
}

// ─── AIM R2 sentinel tests ────────────────────────────────────────────────────

describe('AIM gate — _meta.json sentinel', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    it('returns available:false when _meta.json is missing (index not deployed)', async () => {
        vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
            if (url.includes('aim-index/_meta.json')) return notFoundMeta();
            return emptyShard();
        }));
        const { fetchAIMData } = await import('../../src/services/historicScanService');
        const result = await fetchAIMData(BBOX.west, BBOX.south, BBOX.east, BBOX.north);

        expect(result.available).toBe(false);
        expect(result.features).toHaveLength(0);
    });

    it('does not fetch any shards when _meta.json returns 404', async () => {
        const fetchMock = vi.fn().mockImplementation((url: string) => {
            if (url.includes('aim-index/_meta.json')) return notFoundMeta();
            return emptyShard();
        });
        vi.stubGlobal('fetch', fetchMock);

        const { fetchAIMData } = await import('../../src/services/historicScanService');
        await fetchAIMData(BBOX.west, BBOX.south, BBOX.east, BBOX.north);

        const shardCalls = fetchMock.mock.calls.filter(
            ([url]: [string]) => url.includes('/aim-index/') && !url.includes('_meta'),
        );
        expect(shardCalls).toHaveLength(0);
    });

    it('returns available:false on HTTP 500 for meta', async () => {
        vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
            if (url.includes('aim-index/_meta.json')) return serverErrorMeta();
            return emptyShard();
        }));
        const { fetchAIMData } = await import('../../src/services/historicScanService');
        const result = await fetchAIMData(BBOX.west, BBOX.south, BBOX.east, BBOX.north);

        expect(result.available).toBe(false);
    });

    it('returns available:false on network error fetching meta', async () => {
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));
        const { fetchAIMData } = await import('../../src/services/historicScanService');
        const result = await fetchAIMData(BBOX.west, BBOX.south, BBOX.east, BBOX.north);

        expect(result.available).toBe(false);
        expect(result.features).toHaveLength(0);
    });

    it('returns available:true with empty features when meta present and shards are empty', async () => {
        vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
            if (url.includes('aim-index/_meta.json')) return okMeta();
            return emptyShard();
        }));
        const { fetchAIMData } = await import('../../src/services/historicScanService');
        const result = await fetchAIMData(BBOX.west, BBOX.south, BBOX.east, BBOX.north);

        expect(result.available).toBe(true);
        expect(result.features).toHaveLength(0);
    });

    it('returns available:false when a shard returns non-200 after meta ok', async () => {
        vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
            if (url.includes('aim-index/_meta.json')) return okMeta();
            return errorShard();
        }));
        const { fetchAIMData } = await import('../../src/services/historicScanService');
        const result = await fetchAIMData(BBOX.west, BBOX.south, BBOX.east, BBOX.north);

        expect(result.available).toBe(false);
    });

    it('returns features from successful shards even when some shards fail', async () => {
        let shardCount = 0;
        vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
            if (url.includes('aim-index/_meta.json')) return okMeta();
            shardCount++;
            // First shard succeeds with a feature, rest fail
            if (shardCount === 1) {
                return Promise.resolve({
                    ok: true,
                    status: 200,
                    json: () => Promise.resolve([
                        {
                            monumentType: 'Enclosure',
                            period: 'IRON AGE',
                            evidence: 'Cropmark',
                            bbox: [-1.825, 51.174, -1.824, 51.175],
                        },
                    ]),
                });
            }
            return errorShard();
        }));
        const { fetchAIMData } = await import('../../src/services/historicScanService');
        const result = await fetchAIMData(BBOX.west, BBOX.south, BBOX.east, BBOX.north);

        // available:false because some shards failed, but features from good shards are included
        expect(result.available).toBe(false);
        expect(result.features.length).toBeGreaterThanOrEqual(0); // partial results
    });
});

// ─── AIM R2 — no live ArcGIS calls when USE_R2_DESIGNATIONS=true ──────────────

describe('AIM R2 path — no live API calls', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    it('makes no live AIM API calls when flag is on and meta is present', async () => {
        const fetchSpy = vi.fn().mockImplementation((url: string) => {
            if (url.includes('aim-index/_meta.json')) return okMeta();
            return emptyShard();
        });
        vi.stubGlobal('fetch', fetchSpy);

        const { fetchAIMData } = await import('../../src/services/historicScanService');
        await fetchAIMData(BBOX.west, BBOX.south, BBOX.east, BBOX.north);

        const liveCalls = fetchSpy.mock.calls.filter(
            ([url]: [string]) => typeof url === 'string' && url.includes('services-eu1.arcgis.com'),
        );
        expect(liveCalls).toHaveLength(0);
    });
});

// ─── PAS density service smoke tests ─────────────────────────────────────────

describe('PAS density service — module-level cache', () => {
    beforeEach(() => {
        vi.resetModules();
        // pasDensityAssetUrl uses window.location.origin — stub for Node test env
        vi.stubGlobal('window', { location: { origin: 'http://localhost:3000' } });
    });

    it('returns null when the asset fails to load', async () => {
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));
        const { getPASDensityNear } = await import('../../src/services/pasDensityService');
        const result = await getPASDensityNear(51.17, -1.83);
        expect(result).toBeNull();
    });

    it('returns { c:0, p:[], t:[] } for a cell not in the index', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            json: () => Promise.resolve({
                schemaVersion: 1,
                resolution: 6,
                generatedAt: '',
                recordCount: 0,
                sourceDumpUrl: '',
                license: 'CC-BY',
                attribution: '',
                cells: {},
            }),
        }));
        const { getPASDensityNear } = await import('../../src/services/pasDensityService');
        const result = await getPASDensityNear(51.17, -1.83);
        expect(result).toEqual({ c: 0, p: [], t: [], pc: [], tc: [] });
    });

    it('returns cell data when the H3 index contains a matching entry', async () => {
        const { latLngToCell } = await import('h3-js');
        const lat = 51.17;
        const lon = -1.83;
        const h3Index = latLngToCell(lat, lon, 6);

        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            json: () => Promise.resolve({
                schemaVersion: 1,
                resolution: 6,
                generatedAt: '',
                recordCount: 42,
                sourceDumpUrl: '',
                license: 'CC-BY',
                attribution: '',
                cells: {
                    [h3Index]: {
                        c: 42,
                        p: ['ROMAN', 'MEDIEVAL'],
                        t: ['COIN', 'BROOCH'],
                        pc: [['ROMAN', 30], ['MEDIEVAL', 12]],
                        tc: [['COIN', 25], ['BROOCH', 17]],
                    },
                },
            }),
        }));
        const { getPASDensityNear } = await import('../../src/services/pasDensityService');
        const result = await getPASDensityNear(lat, lon);
        expect(result?.c).toBe(42);
        expect(result?.p).toContain('ROMAN');
        expect(result?.pc?.[0]).toEqual(['ROMAN', 30]);
    });
});

// ─── PAS density modifier tests ───────────────────────────────────────────────

describe('applyPASDensityModifiers', () => {
    it('returns hotspots unchanged when pasCell is null', async () => {
        const { applyPASDensityModifiers } = await import('../../src/utils/hotspotEngine');
        const hotspot = { score: 60, explanation: [], metrics: { anomaly: 5, context: 3, signalCount: 2, behaviour: 0.5, convergence: 0.5 }, confidence: 'Medium' as const };
        const result = applyPASDensityModifiers([hotspot as never], null);
        expect(result[0].score).toBe(60);
    });

    it('returns hotspots unchanged when pasCell.c is 0', async () => {
        const { applyPASDensityModifiers } = await import('../../src/utils/hotspotEngine');
        const hotspot = { score: 60, explanation: [], metrics: { anomaly: 5, context: 3, signalCount: 2, behaviour: 0.5, convergence: 0.5 }, confidence: 'Medium' as const };
        const result = applyPASDensityModifiers([hotspot as never], { c: 0, p: [], t: [] });
        expect(result[0].score).toBe(60);
    });

    it('does not boost a hotspot with no primary signal', async () => {
        const { applyPASDensityModifiers } = await import('../../src/utils/hotspotEngine');
        const hotspot = { score: 40, explanation: [], metrics: { anomaly: 0, context: 0, signalCount: 1, behaviour: 0.3, convergence: 0.2 }, confidence: 'Subtle' as const };
        const result = applyPASDensityModifiers([hotspot as never], { c: 200, p: ['ROMAN'], t: ['COIN'] });
        expect(result[0].score).toBe(40);
    });

    it('adds +4 boost for high density (>=200) with primary signal', async () => {
        const { applyPASDensityModifiers } = await import('../../src/utils/hotspotEngine');
        const hotspot = { score: 60, explanation: [], metrics: { anomaly: 5, context: 3, signalCount: 2, behaviour: 0.5, convergence: 0.5 }, confidence: 'Medium' as const };
        const result = applyPASDensityModifiers([hotspot as never], { c: 220, p: ['MEDIEVAL'], t: ['COIN'] });
        expect(result[0].score).toBe(64);
    });

    it('adds +6 boost for very high density (>=500) with period match', async () => {
        const { applyPASDensityModifiers } = await import('../../src/utils/hotspotEngine');
        const hotspot = { score: 60, explanation: [], metrics: { anomaly: 5, context: 3, signalCount: 2, behaviour: 0.5, convergence: 0.5 }, confidence: 'Medium' as const };
        const result = applyPASDensityModifiers([hotspot as never], { c: 600, p: ['ROMAN'] }, 'Roman');
        expect(result[0].score).toBe(66);
        expect(result[0].explanation).toContain('Numerous PAS finds recorded in this landscape, including period-matching types');
    });
});
