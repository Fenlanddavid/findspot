import { describe, it, expect, vi, beforeEach } from 'vitest';
import { bboxRequiredSMJurisdictions } from '../../src/utils/jurisdictionDetect';

const EDINBURGH: [number, number, number, number] = [-3.191, 55.944, -3.181, 55.954];
const BELFAST: [number, number, number, number] = [-5.935, 54.592, -5.925, 54.602];
const HAWICK: [number, number, number, number] = [-2.795, 55.417, -2.785, 55.427];
const NEWCASTLE: [number, number, number, number] = [-1.623, 54.973, -1.613, 54.983];
const LONDON: [number, number, number, number] = [-0.132, 51.503, -0.122, 51.513];
const CARDIFF: [number, number, number, number] = [-3.185, 51.477, -3.175, 51.487];
const YORK: [number, number, number, number] = [-1.087, 53.955, -1.077, 53.965];
const CALAIS: [number, number, number, number] = [1.848, 50.947, 1.858, 50.957];

vi.stubGlobal('caches', {
    match: vi.fn().mockResolvedValue(undefined),
    open: vi.fn().mockResolvedValue({ match: vi.fn().mockResolvedValue(undefined) }),
    keys: vi.fn().mockResolvedValue([]),
    has: vi.fn().mockResolvedValue(false),
    delete: vi.fn().mockResolvedValue(true),
});

function asArray(result: Set<string> | 'outside_uk') {
    return result === 'outside_uk' ? result : [...result].sort();
}

function jsonResponse(body: unknown, ok = true, status = ok ? 200 : 500) {
    return {
        ok,
        status,
        json: () => Promise.resolve(body),
    };
}

async function importService(useR2 = true) {
    vi.resetModules();
    vi.doMock('../../src/utils/featureFlags', () => ({
        USE_R2_DESIGNATIONS: useR2,
        FINDSPOT_STATIC_BASE_URL: 'https://static.test',
    }));
    vi.doMock('../../src/db', () => ({ db: {} }));
    return import('../../src/services/historicScanService');
}

describe('bboxRequiredSMJurisdictions', () => {
    it('classifies Scotland, Northern Ireland, border strip, England/Wales, and outside UK', () => {
        expect(asArray(bboxRequiredSMJurisdictions(EDINBURGH))).toEqual(['scotland']);
        expect(asArray(bboxRequiredSMJurisdictions(BELFAST))).toEqual(['northern_ireland']);
        expect(asArray(bboxRequiredSMJurisdictions(HAWICK))).toEqual(['england_wales', 'scotland']);
        expect(asArray(bboxRequiredSMJurisdictions(NEWCASTLE))).toEqual(['england_wales', 'scotland']);
        expect(asArray(bboxRequiredSMJurisdictions(LONDON))).toEqual(['england_wales']);
        expect(asArray(bboxRequiredSMJurisdictions(CARDIFF))).toEqual(['england_wales']);
        expect(asArray(bboxRequiredSMJurisdictions(YORK))).toEqual(['england_wales']);
        expect(bboxRequiredSMJurisdictions(CALAIS)).toBe('outside_uk');
    });
});

describe('SM coverage gate', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.unstubAllGlobals();
        vi.stubGlobal('caches', {
            match: vi.fn().mockResolvedValue(undefined),
            open: vi.fn().mockResolvedValue({ match: vi.fn().mockResolvedValue(undefined) }),
            keys: vi.fn().mockResolvedValue([]),
            has: vi.fn().mockResolvedValue(false),
            delete: vi.fn().mockResolvedValue(true),
        });
    });

    it('coverage England/Wales + Edinburgh ambers before shard fetches', async () => {
        const fetchSpy = vi.fn((url: string) => {
            if (url.includes('/sm-index/_meta.json')) {
                return Promise.resolve(jsonResponse({ schemaVersion: 2, geometryMode: 'full-geojson', coverage: ['england', 'wales'] }));
            }
            return Promise.resolve(jsonResponse([]));
        });
        vi.stubGlobal('fetch', fetchSpy);

        const { fetchScheduledMonuments } = await importService();
        const result = await fetchScheduledMonuments(...EDINBURGH);

        expect(result.available).toBe(false);
        expect(result.unavailableReason).toBe('coverage_scotland');
        expect(result.error).toBe('Scheduled monument data does not cover this area');
        expect(fetchSpy.mock.calls.filter(([url]) => String(url).includes('/sm-index/') && !String(url).includes('_meta'))).toHaveLength(0);
    });

    it('coverage including Scotland proceeds to shard fetches', async () => {
        const fetchSpy = vi.fn((url: string) => {
            if (url.includes('/sm-index/_meta.json')) {
                return Promise.resolve(jsonResponse({ schemaVersion: 2, geometryMode: 'full-geojson', coverage: ['england', 'wales', 'scotland'] }));
            }
            return Promise.resolve(jsonResponse([]));
        });
        vi.stubGlobal('fetch', fetchSpy);

        const { fetchScheduledMonuments } = await importService();
        const result = await fetchScheduledMonuments(...EDINBURGH);

        expect(result.available).toBe(true);
        expect(fetchSpy.mock.calls.some(([url]) => String(url).includes('/sm-index/') && !String(url).includes('_meta'))).toBe(true);
    });

    it('missing coverage field defaults to current England/Wales truth', async () => {
        const fetchSpy = vi.fn((url: string) => {
            if (url.includes('/sm-index/_meta.json')) {
                return Promise.resolve(jsonResponse({ schemaVersion: 2, geometryMode: 'full-geojson' }));
            }
            return Promise.resolve(jsonResponse([]));
        });
        vi.stubGlobal('fetch', fetchSpy);

        const { fetchScheduledMonuments } = await importService();
        const result = await fetchScheduledMonuments(...EDINBURGH);

        expect(result.available).toBe(false);
        expect(result.unavailableReason).toBe('coverage_scotland');
    });

    it('cacheOnly Scottish bbox ambers instead of returning silently empty', async () => {
        vi.stubGlobal('caches', {
            match: vi.fn((url: string) => {
                if (url.includes('/sm-index/_meta.json')) {
                    return Promise.resolve(new Response(JSON.stringify({
                        schemaVersion: 2,
                        geometryMode: 'full-geojson',
                        coverage: ['england', 'wales'],
                    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
                }
                return Promise.resolve(undefined);
            }),
            open: vi.fn().mockResolvedValue({ match: vi.fn().mockResolvedValue(undefined) }),
            keys: vi.fn().mockResolvedValue([]),
            has: vi.fn().mockResolvedValue(false),
            delete: vi.fn().mockResolvedValue(true),
        });
        const fetchSpy = vi.fn((url: string) => Promise.resolve(jsonResponse([])));
        vi.stubGlobal('fetch', fetchSpy);

        const { fetchScheduledMonuments } = await importService();
        const result = await fetchScheduledMonuments(...EDINBURGH, undefined, { cacheOnly: true });

        expect(result.available).toBe(false);
        expect(result.unavailableReason).toBe('coverage_scotland');
        expect(fetchSpy.mock.calls.filter(([url]) => String(url).includes('/sm-index/') && !String(url).includes('_meta'))).toHaveLength(0);
    });
});

describe('SM live fallback guard', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.unstubAllGlobals();
        vi.stubGlobal('caches', {
            match: vi.fn().mockResolvedValue(undefined),
            open: vi.fn().mockResolvedValue({ match: vi.fn().mockResolvedValue(undefined) }),
            keys: vi.fn().mockResolvedValue([]),
            has: vi.fn().mockResolvedValue(false),
            delete: vi.fn().mockResolvedValue(true),
        });
    });

    it('meta unreachable + Edinburgh never calls live NHLE', async () => {
        const fetchSpy = vi.fn((url: string) => {
            if (url.includes('/sm-index/_meta.json')) return Promise.resolve(jsonResponse({}, false, 500));
            return Promise.resolve(jsonResponse({ type: 'FeatureCollection', features: [] }));
        });
        vi.stubGlobal('fetch', fetchSpy);

        const { fetchScheduledMonuments } = await importService();
        const result = await fetchScheduledMonuments(...EDINBURGH);

        expect(result.available).toBe(false);
        expect(result.unavailableReason).toBe('coverage_scotland');
        expect(fetchSpy.mock.calls.some(([url]) => String(url).includes('services-eu1.arcgis.com'))).toBe(false);
    });

    it('meta unreachable + York proceeds to live NHLE fallback', async () => {
        const fetchSpy = vi.fn((url: string) => {
            if (url.includes('/sm-index/_meta.json')) return Promise.resolve(jsonResponse({}, false, 500));
            if (url.includes('services-eu1.arcgis.com')) {
                return Promise.resolve(jsonResponse({ type: 'FeatureCollection', features: [] }));
            }
            return Promise.resolve(jsonResponse([]));
        });
        vi.stubGlobal('fetch', fetchSpy);

        const { fetchScheduledMonuments } = await importService();
        const result = await fetchScheduledMonuments(...YORK);

        expect(result.available).toBe(true);
        expect(fetchSpy.mock.calls.some(([url]) => String(url).includes('services-eu1.arcgis.com'))).toBe(true);
    });

    it('Wales fallback keeps existing error string', async () => {
        const fetchSpy = vi.fn((url: string) => {
            if (url.includes('/sm-index/_meta.json')) return Promise.resolve(jsonResponse({}, false, 500));
            return Promise.resolve(jsonResponse({ type: 'FeatureCollection', features: [] }));
        });
        vi.stubGlobal('fetch', fetchSpy);

        const { fetchScheduledMonuments } = await importService();
        const result = await fetchScheduledMonuments(...CARDIFF);

        expect(result.available).toBe(false);
        expect(result.error).toBe('SM live fallback unavailable for Wales');
        expect(fetchSpy.mock.calls.some(([url]) => String(url).includes('services-eu1.arcgis.com'))).toBe(false);
    });

    it('non-R2 live path is also guarded outside NHLE coverage', async () => {
        const fetchSpy = vi.fn((url: string) => Promise.resolve(jsonResponse({ type: 'FeatureCollection', features: [] })));
        vi.stubGlobal('fetch', fetchSpy);

        const { fetchScheduledMonuments } = await importService(false);
        const result = await fetchScheduledMonuments(...EDINBURGH);

        expect(result.available).toBe(false);
        expect(result.unavailableReason).toBe('coverage_scotland');
        expect(fetchSpy.mock.calls.some(([url]) => String(url).includes('services-eu1.arcgis.com'))).toBe(false);
    });
});
