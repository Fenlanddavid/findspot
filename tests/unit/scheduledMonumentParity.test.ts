// ─── SM R2 parity tests (W1) ──────────────────────────────────────────────────
// These tests verify that the R2 static index path returns the same
// clear/flag verdict as the live ArcGIS FeatureServer for the W0 fixture set.
//
// Running modes:
//   PARITY=live  — runs against the live R2 worker (requires network + R2 deployed)
//   (default)    — runs against the fixture file only, verifying test structure
//
// To run full parity check after deploying R2:
//   PARITY=live npx vitest run tests/unit/scheduledMonumentParity.test.ts

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { bboxIntersectsWales } from '../../src/utils/jurisdictionDetect';
import { isScheduledMonumentOverlap } from '../../src/services/fieldguide/landscapeInterpretation/scheduledMonumentGate';

const nativeFetch = typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : undefined;

// ─── Fixture ──────────────────────────────────────────────────────────────────

const FIXTURE_PATH = join(__dirname, '../fixtures/smVerification.json');

type FixturePoint = {
    lat: number;
    lon: number;
    label: string;
    expected: 'flag' | 'clear';
    listEntry: string | null;
    note: string;
    source?: 'NHLE' | 'Cadw' | 'HES';
};

type Fixture = {
    capturedAt: string;
    source: string;
    points: FixturePoint[];
};

function loadFixture(): Fixture | null {
    if (!existsSync(FIXTURE_PATH)) return null;
    return JSON.parse(readFileSync(FIXTURE_PATH, 'utf-8')) as Fixture;
}

// ─── R2 path mock helpers ─────────────────────────────────────────────────────

// Mock the feature flags module so we can flip USE_R2_DESIGNATIONS
vi.mock('../../src/utils/featureFlags', () => ({
    USE_R2_DESIGNATIONS: true,
    FINDSPOT_STATIC_BASE_URL: 'https://findspot-static.trials-uk.workers.dev',
}));

vi.mock('../../src/db', () => ({ db: {} }));

// Stub the global `caches` object (not available in Node test env).
// cachedFetchAny calls caches.match() before falling through to fetch().
// We stub it to always return undefined (cache miss) so tests exercise the
// fetch() path, which is controlled by vi.stubGlobal('fetch', ...).
vi.stubGlobal('caches', {
    match: vi.fn().mockResolvedValue(undefined),
    open: vi.fn().mockResolvedValue({ match: vi.fn().mockResolvedValue(undefined) }),
    keys: vi.fn().mockResolvedValue([]),
    has: vi.fn().mockResolvedValue(false),
    delete: vi.fn().mockResolvedValue(true),
});

// ─── Fixture structure tests (always run) ─────────────────────────────────────

describe('SM verification fixture', () => {
    it('fixture file exists', () => {
        // Run scripts/build-sm-verification.mjs to generate this file
        expect(existsSync(FIXTURE_PATH)).toBe(true);
    });

    it('fixture has enough points (>=25)', () => {
        const fixture = loadFixture();
        expect(fixture).not.toBeNull();
        expect(fixture!.points.length).toBeGreaterThanOrEqual(25);
    });

    it('fixture has at least 15 flag points', () => {
        const fixture = loadFixture();
        const flagCount = fixture!.points.filter(p => p.expected === 'flag').length;
        expect(flagCount).toBeGreaterThanOrEqual(15);
    });

    it('fixture has at least 10 clear points', () => {
        const fixture = loadFixture();
        const clearCount = fixture!.points.filter(p => p.expected === 'clear').length;
        expect(clearCount).toBeGreaterThanOrEqual(10);
    });

    it('every flag point has a listEntry (skip on placeholder)', () => {
        const fixture = loadFixture();
        // Placeholder fixture (before running build-sm-verification.mjs) has no listEntries
        const raw = JSON.parse(readFileSync(FIXTURE_PATH, 'utf-8'));
        if (raw._note?.includes('PLACEHOLDER')) return;
        const badFlags = fixture!.points.filter(p => p.expected === 'flag' && !p.listEntry);
        expect(badFlags).toHaveLength(0);
    });

    it('all points have required fields', () => {
        const fixture = loadFixture();
        for (const p of fixture!.points) {
            expect(typeof p.lat).toBe('number');
            expect(typeof p.lon).toBe('number');
            expect(['flag', 'clear']).toContain(p.expected);
        }
    });
});

// ─── SM gate R2 failure and sentinel tests ────────────────────────────────────
// Critical: R2 returning 500/network error must NOT clear the SM gate.
// It must return available:false (amber state), never { features:[], available:true }.
//
// The sentinel design: _meta.json must be present before shards are trusted.
// This prevents a missing/un-deployed index from silently returning "clear."

describe('SM gate — R2 failure returns available:false', () => {
    beforeEach(() => {
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));
    });

    it('returns available:false on network error, not a false-clear', async () => {
        const { fetchScheduledMonuments } = await import('../../src/services/historicScanService');
        const result = await fetchScheduledMonuments(-1.83, 51.17, -1.82, 51.18);
        expect(result.available).toBe(false);
        expect(result.features).toHaveLength(0);
    });

    it('returns available:false on HTTP 500 for meta, not a false-clear', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: false,
            status: 500,
            json: () => Promise.resolve({}),
        }));
        const { fetchScheduledMonuments } = await import('../../src/services/historicScanService');
        const result = await fetchScheduledMonuments(-1.83, 51.17, -1.82, 51.18);
        expect(result.available).toBe(false);
    });
});

describe('SM gate — _meta.json sentinel', () => {
    it('returns available:false when _meta.json is missing (index not built)', async () => {
        // _meta.json 404 = no build deployed = cannot confirm clear
        // This is the critical case: un-deployed index must not produce false-clear
        const fetchMock = vi.fn().mockImplementation((url: string) => {
            if (url.includes('_meta.json')) {
                return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
            }
            if (url.includes('services-eu1.arcgis.com')) {
                return Promise.resolve({ ok: false, status: 503, json: () => Promise.resolve({}) });
            }
            // Shards would return [] — but they must never be reached without meta
            return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) });
        });
        vi.stubGlobal('fetch', fetchMock);

        const { fetchScheduledMonuments } = await import('../../src/services/historicScanService');
        const result = await fetchScheduledMonuments(-1.83, 51.17, -1.82, 51.18);

        expect(result.available).toBe(false);
        expect(result.features).toHaveLength(0);
        // Confirm meta was fetched and shards were NOT fetched
        const shardCalls = fetchMock.mock.calls.filter(([url]: [string]) => url.includes('/sm-index/') && !url.includes('_meta'));
        expect(shardCalls).toHaveLength(0);
    });

    it('returns available:true with empty features when meta present and all shards return []', async () => {
        // Meta present + shards return [] = genuinely clear area (no SMs in cells)
        vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
            if (url.includes('_meta.json')) {
                return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ builtAt: '2026-01-01', generationVersion: 'v2', schemaVersion: 2, geometryMode: 'full-geojson' }) });
            }
            return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) });
        }));

        const { fetchScheduledMonuments } = await import('../../src/services/historicScanService');
        const result = await fetchScheduledMonuments(-1.83, 51.17, -1.82, 51.18);

        expect(result.available).toBe(true);
        expect(result.features).toHaveLength(0);
    });

    it('returns available:false when a shard returns non-200 (service error after meta ok)', async () => {
        vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
            if (url.includes('_meta.json')) {
                return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ builtAt: '2026-01-01', generationVersion: 'v2', schemaVersion: 2, geometryMode: 'full-geojson' }) });
            }
            return Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) });
        }));

        const { fetchScheduledMonuments } = await import('../../src/services/historicScanService');
        const result = await fetchScheduledMonuments(-1.83, 51.17, -1.82, 51.18);

        expect(result.available).toBe(false);
    });

    it('returns available:false for populated old-format shards without geometry', async () => {
        vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
            if (url.includes('_meta.json')) {
                return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ builtAt: '2026-01-01', generationVersion: 'v2', schemaVersion: 2, geometryMode: 'full-geojson' }) });
            }
            if (url.includes('services-eu1.arcgis.com')) {
                return Promise.resolve({ ok: false, status: 503, json: () => Promise.resolve({}) });
            }
            return Promise.resolve({
                ok: true,
                status: 200,
                json: () => Promise.resolve([
                    { listEntry: '1000001', name: 'Old format SM', bbox: [-1.001, 51.001, -0.999, 51.003] },
                ]),
            });
        }));

        const { fetchScheduledMonuments } = await import('../../src/services/historicScanService');
        const result = await fetchScheduledMonuments(-1.0005, 51.0015, -0.9995, 51.0025);

        expect(result.available).toBe(false);
        expect(result.features).toHaveLength(0);
    });

    it('returns the full shard geometry, not a bbox rectangle', async () => {
        const geometry = {
            type: 'Polygon',
            coordinates: [[
                [-1.0001, 51.0001],
                [-0.9999, 51.0001],
                [-0.9999, 51.0003],
                [-1.0001, 51.0003],
                [-1.0001, 51.0001],
            ]],
        };
        vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
            if (url.includes('_meta.json')) {
                return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ builtAt: '2026-01-01', generationVersion: 'v2', schemaVersion: 2, geometryMode: 'full-geojson' }) });
            }
            return Promise.resolve({
                ok: true,
                status: 200,
                json: () => Promise.resolve([
                    { listEntry: '1000002', name: 'Full geometry SM', bbox: [-1.001, 51.000, -0.999, 51.001], geometry },
                ]),
            });
        }));

        const { fetchScheduledMonuments } = await import('../../src/services/historicScanService');
        const result = await fetchScheduledMonuments(-1.0005, 51.0002, -0.9995, 51.0008);

        expect(result.available).toBe(true);
        expect(result.features).toHaveLength(1);
        expect(result.features[0].geometry).toEqual(geometry);
    });

    it('does not return a monument when only the stored bbox intersects the query', async () => {
        const geometry = {
            type: 'Polygon',
            coordinates: [[
                [-1.0100, 51.0100],
                [-1.0090, 51.0100],
                [-1.0090, 51.0110],
                [-1.0100, 51.0110],
                [-1.0100, 51.0100],
            ]],
        };
        vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
            if (url.includes('_meta.json')) {
                return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ builtAt: '2026-01-01', generationVersion: 'v2', schemaVersion: 2, geometryMode: 'full-geojson' }) });
            }
            return Promise.resolve({
                ok: true,
                status: 200,
                json: () => Promise.resolve([
                    { listEntry: '1000003', name: 'BBox only overlap', bbox: [-1.02, 51.00, -0.99, 51.02], geometry },
                ]),
            });
        }));

        const { fetchScheduledMonuments } = await import('../../src/services/historicScanService');
        const result = await fetchScheduledMonuments(-1.0005, 51.0002, -0.9995, 51.0008);

        expect(result.available).toBe(true);
        expect(result.features).toHaveLength(0);
    });
});

describe('bboxIntersectsWales', () => {
    it('is true for a Cardiff-area bbox', () => {
        expect(bboxIntersectsWales([-3.24, 51.47, -3.22, 51.49])).toBe(true);
    });

    it('is false for Norfolk', () => {
        expect(bboxIntersectsWales([0.65, 52.45, 0.70, 52.50])).toBe(false);
    });

    it('is true for a bbox straddling the Welsh border', () => {
        expect(bboxIntersectsWales([-2.70, 51.60, -2.55, 51.72])).toBe(true);
    });

    it('is true when the bbox crosses Wales even if no sampled point would be inside', () => {
        expect(bboxIntersectsWales([-6.0, 52.0, -2.0, 52.1])).toBe(true);
    });
});

describe('SM R2 path — Welsh Cadw fixtures', () => {
    it('returns the Cadw entry at each Welsh fixture location and trips the gate', async () => {
        const fixture = loadFixture();
        const welshPoints = fixture!.points.filter(p => p.source === 'Cadw');
        expect(welshPoints).toHaveLength(3);

        const entries = welshPoints.map(point => ({
            listEntry: point.listEntry!,
            name: point.label,
            bbox: [point.lon - 0.001, point.lat - 0.001, point.lon + 0.001, point.lat + 0.001],
            geometry: {
                type: 'Polygon',
                coordinates: [[
                    [point.lon - 0.001, point.lat - 0.001],
                    [point.lon + 0.001, point.lat - 0.001],
                    [point.lon + 0.001, point.lat + 0.001],
                    [point.lon - 0.001, point.lat + 0.001],
                    [point.lon - 0.001, point.lat - 0.001],
                ]],
            },
        }));

        vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
            if (url.includes('_meta.json')) {
                return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ builtAt: '2026-01-01', generationVersion: 'v2', schemaVersion: 2, geometryMode: 'full-geojson' }) });
            }
            return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(entries) });
        }));

        const { fetchScheduledMonuments } = await import('../../src/services/historicScanService');

        for (const point of welshPoints) {
            const result = await fetchScheduledMonuments(
                point.lon - 0.005,
                point.lat - 0.005,
                point.lon + 0.005,
                point.lat + 0.005,
            );
            expect(result.available).toBe(true);
            expect(result.features.map(f => f.properties.ListEntry)).toContain(point.listEntry);
            expect(isScheduledMonumentOverlap('', result.features)).toBe(true);
        }
    });
});

describe('SM R2 path — Scottish HES fixtures', () => {
    it('returns the HES entry at each Scottish fixture location and trips the gate', async () => {
        const fixture = loadFixture();
        const scottishPoints = fixture!.points.filter(p => p.source === 'HES');
        expect(scottishPoints).toHaveLength(3);

        const entries = scottishPoints.map(point => ({
            listEntry: point.listEntry!,
            name: point.label,
            bbox: [point.lon - 0.001, point.lat - 0.001, point.lon + 0.001, point.lat + 0.001],
            geometry: {
                type: 'Polygon',
                coordinates: [[
                    [point.lon - 0.001, point.lat - 0.001],
                    [point.lon + 0.001, point.lat - 0.001],
                    [point.lon + 0.001, point.lat + 0.001],
                    [point.lon - 0.001, point.lat + 0.001],
                    [point.lon - 0.001, point.lat - 0.001],
                ]],
            },
        }));

        vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
            if (url.includes('_meta.json')) {
                return Promise.resolve({
                    ok: true,
                    status: 200,
                    json: () => Promise.resolve({
                        builtAt: '2026-01-01',
                        generationVersion: 'v2', schemaVersion: 2,
                        geometryMode: 'full-geojson',
                        coverage: ['england', 'wales', 'scotland'],
                    }),
                });
            }
            return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(entries) });
        }));

        const { fetchScheduledMonuments } = await import('../../src/services/historicScanService');

        for (const point of scottishPoints) {
            const result = await fetchScheduledMonuments(
                point.lon - 0.005,
                point.lat - 0.005,
                point.lon + 0.005,
                point.lat + 0.005,
            );
            expect(result.available).toBe(true);
            expect(result.features.map(f => f.properties.ListEntry)).toContain(point.listEntry);
            expect(isScheduledMonumentOverlap('', result.features)).toBe(true);
        }
    });
});

// ─── No live ArcGIS calls when USE_R2_DESIGNATIONS=true ──────────────────────

describe('SM R2 path — no ArcGIS FeatureServer calls', () => {
    it('makes no calls to services-eu1.arcgis.com when flag is on', async () => {
        const fetchSpy = vi.fn().mockImplementation((url: string) => {
            if (url.includes('_meta.json')) {
                return Promise.resolve({
                    ok: true,
                    status: 200,
                    json: () => Promise.resolve({ builtAt: '2026-01-01', generationVersion: 'v2', schemaVersion: 2, geometryMode: 'full-geojson' }),
                });
            }
            return Promise.resolve({
                ok: true,
                status: 200,
                json: () => Promise.resolve([]),
            });
        });
        vi.stubGlobal('fetch', fetchSpy);

        const { fetchScheduledMonuments } = await import('../../src/services/historicScanService');
        await fetchScheduledMonuments(-1.83, 51.17, -1.82, 51.18);

        const arcgisCalls = fetchSpy.mock.calls.filter(([url]) =>
            typeof url === 'string' && url.includes('services-eu1.arcgis.com')
        );
        expect(arcgisCalls).toHaveLength(0);
    });
});

describe('SM R2 path — live fallback when static worker is unavailable', () => {
    it('falls back to live ArcGIS geometry when R2 meta is unavailable', async () => {
        const liveGeometry = {
            type: 'Polygon',
            coordinates: [[
                [-1.001, 51.001],
                [-1.000, 51.001],
                [-1.000, 51.002],
                [-1.001, 51.002],
                [-1.001, 51.001],
            ]],
        };
        const fetchSpy = vi.fn().mockImplementation((url: string) => {
            if (url.includes('/sm-index/_meta.json')) {
                return Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) });
            }
            if (url.includes('services-eu1.arcgis.com')) {
                return Promise.resolve({
                    ok: true,
                    status: 200,
                    json: () => Promise.resolve({
                        type: 'FeatureCollection',
                        features: [{
                            type: 'Feature',
                            geometry: liveGeometry,
                            properties: { Name: 'Live SM', ListEntry: '1000004' },
                        }],
                    }),
                });
            }
            return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) });
        });
        vi.stubGlobal('fetch', fetchSpy);

        const { fetchScheduledMonuments } = await import('../../src/services/historicScanService');
        const result = await fetchScheduledMonuments(-1.001, 51.001, -1.000, 51.002);

        expect(result.available).toBe(true);
        expect(result.features[0].geometry).toEqual(liveGeometry);
        expect(fetchSpy.mock.calls.some(([url]) => typeof url === 'string' && url.includes('services-eu1.arcgis.com'))).toBe(true);
    });

    it('returns available:false for Wales instead of false-clearing through the England live fallback', async () => {
        const fetchSpy = vi.fn().mockImplementation((url: string) => {
            if (url.includes('/sm-index/_meta.json')) {
                return Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) });
            }
            if (url.includes('services-eu1.arcgis.com')) {
                return Promise.resolve({
                    ok: true,
                    status: 200,
                    json: () => Promise.resolve({ type: 'FeatureCollection', features: [] }),
                });
            }
            return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) });
        });
        vi.stubGlobal('fetch', fetchSpy);

        const { fetchScheduledMonuments } = await import('../../src/services/historicScanService');
        const result = await fetchScheduledMonuments(-3.235, 51.472, -3.225, 51.482);

        expect(result.available).toBe(false);
        expect(result.features).toHaveLength(0);
        expect(fetchSpy.mock.calls.some(([url]) => typeof url === 'string' && url.includes('services-eu1.arcgis.com'))).toBe(false);
    });
});

// ─── Live parity test (opt-in: PARITY=live) ──────────────────────────────────
// Skipped by default. Set PARITY=live to run against the real R2 worker.

const RUN_LIVE = process.env.PARITY === 'live';

describe.skipIf(!RUN_LIVE)('SM R2 parity — live check against W0 fixture', () => {
    it('R2 path matches live verdict for all fixture points', async () => {
        expect(nativeFetch, 'Native fetch is required for PARITY=live').toBeTypeOf('function');
        vi.stubGlobal('fetch', nativeFetch);

        const fixture = loadFixture();
        expect(fixture).not.toBeNull();

        const { fetchScheduledMonuments } = await import('../../src/services/historicScanService');
        const HALF = 0.005;

        for (const point of fixture!.points) {
            const result = await fetchScheduledMonuments(
                point.lon - HALF,
                point.lat - HALF,
                point.lon + HALF,
                point.lat + HALF,
            );
            const verdict = result.features.length > 0 ? 'flag' : 'clear';
            expect(
                verdict,
                `${point.label} (${point.lat},${point.lon}): expected ${point.expected}; available=${result.available}; error=${result.error ?? 'none'}`,
            ).toBe(point.expected);
        }
    }, 60_000);
});
