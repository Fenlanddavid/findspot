import { describe, it, expect } from 'vitest';
import {
    analyzeContext,
    applyAIMEnrichment,
    applyRouteUnavailableFallback,
    isPointProtectedByNHLE,
    suppressDisturbance,
} from '../../src/utils/fieldGuideAnalysis';
import type { Cluster } from '../../src/pages/fieldGuideTypes';

function cluster(overrides: Partial<Cluster> = {}): Cluster {
    return {
        id: 'c1',
        points: [],
        minX: 0, maxX: 1, minY: 0, maxY: 1,
        type: 'Ring Ditch',
        score: 50,
        number: 1,
        isProtected: false,
        confidence: 'Medium',
        findPotential: 0.5,
        center: [0, 57] as [number, number],
        source: 'terrain',
        sources: ['terrain'],
        polarity: 'Raised',
        metrics: { circularity: 0.8, density: 0.6, ratio: 1.2, area: 500 },
        ...overrides,
    };
}

describe('analyzeContext spatial grid', () => {
    it('does not miss 200 m neighbours across narrow longitude cells', () => {
        const result = analyzeContext([
            // At 57N this pair is about 194 m apart, but fixed 0.003 degree
            // longitude cells place them two columns apart.
            cluster({ id: 'west', center: [0.00299, 57] }),
            cluster({ id: 'east', center: [0.00620, 57] }),
        ]);

        expect(result.find(c => c.id === 'west')?.relationshipTag).toBe('barrow_group');
        expect(result.find(c => c.id === 'east')?.relationshipTag).toBe('barrow_group');
    });
});

describe('applyAIMEnrichment', () => {
    it('treats missing AIM features as no enrichment', () => {
        const input = [cluster({ id: 'safe-aim' })];

        expect(() => applyAIMEnrichment(input, {})).not.toThrow();
        expect(applyAIMEnrichment(input, {})[0].sources).toEqual(['terrain']);
    });
});

describe('isPointProtectedByNHLE', () => {
    const scheduledMonuments = {
        features: [{
            geometry: {
                type: 'Polygon',
                coordinates: [[
                    [-0.001, 51.999], [0.001, 51.999], [0.001, 52.001],
                    [-0.001, 52.001], [-0.001, 51.999],
                ]],
            },
        }],
    };

    it('recognises an anchor inside a scheduled monument', () => {
        expect(isPointProtectedByNHLE(52, 0, scheduledMonuments)).toBe(true);
    });

    it('allows an anchor clear of scheduled monuments and their buffer', () => {
        expect(isPointProtectedByNHLE(52.01, 0, scheduledMonuments)).toBe(false);
    });
});

// ─── suppressDisturbance characterisation ────────────────────────────────────
// Snapshots the suppression output for each code path. These are not meant to
// be aspirational specs — they lock the current behaviour so regressions are
// visible. If you deliberately change the logic, re-baseline with -u.

describe('suppressDisturbance', () => {
    it('leaves low-risk clusters unchanged', () => {
        // circularity-like cluster with no disturbance triggers
        const c = cluster({ id: 'clean', metrics: { circularity: 0.8, density: 0.3, ratio: 1.2, area: 500 }, findPotential: 60 });
        const [result] = suppressDisturbance([c]);
        expect(result.disturbanceRisk).toBe('Low');
        expect(result.findPotential).toBe(60);
    });

    it('flags systematic_parallelism (High) for 3+ co-bearing linears within 100m', () => {
        // Three elongated clusters with matching bearings ~0°, spaced within 100m.
        // bearing is in degrees; center is [lon, lat] at 52°N so longitude delta ≈ metres.
        const base = { bearing: 0, metrics: { circularity: 0.1, density: 0.3, ratio: 5.0, area: 400 }, findPotential: 70 };
        const a = cluster({ id: 'a', center: [0, 52], ...base });
        const b = cluster({ id: 'b', center: [0.0005, 52], ...base }); // ~40m east
        const c2 = cluster({ id: 'c2', center: [0.001, 52], ...base }); // ~80m east
        const results = suppressDisturbance([a, b, c2]);
        expect(results.find(r => r.id === 'a')?.disturbanceRisk).toBe('High');
        expect(results.find(r => r.id === 'a')?.suppressedBy).toContain('systematic_parallelism');
    });

    it('flags machinery_track_scar (High) for ratio > 8 + parallel neighbour', () => {
        const base = { bearing: 0, metrics: { circularity: 0.05, density: 0.3, ratio: 9.0, area: 600 }, findPotential: 75 };
        const a = cluster({ id: 'track-a', center: [0, 52], ...base });
        const b = cluster({ id: 'track-b', center: [0.0005, 52], ...base });
        const results = suppressDisturbance([a, b]);
        expect(results.find(r => r.id === 'track-a')?.disturbanceRisk).toBe('High');
        expect(results.find(r => r.id === 'track-a')?.suppressedBy).toContain('machinery_track_scar');
    });

    it('applies proportional findPotential penalty (High = 40% remaining)', () => {
        const base = { bearing: 0, metrics: { circularity: 0.1, density: 0.3, ratio: 5.0, area: 400 }, findPotential: 100 };
        const a = cluster({ id: 'pen-a', center: [0, 52], ...base });
        const b = cluster({ id: 'pen-b', center: [0.0005, 52], ...base });
        const c2 = cluster({ id: 'pen-c', center: [0.001, 52], ...base });
        const results = suppressDisturbance([a, b, c2]);
        const penalised = results.find(r => r.id === 'pen-a')!;
        expect(penalised.disturbanceRisk).toBe('High');
        // High penalty = 40% retained, min 5
        expect(penalised.findPotential).toBe(Math.max(5, Math.round(100 * 0.6)));
    });

    it('snapshot — full suppression pipeline output', () => {
        const base = { bearing: 45, metrics: { circularity: 0.1, density: 0.3, ratio: 5.5, area: 500 }, findPotential: 80 };
        const input = [
            cluster({ id: 'snap-a', center: [0, 52], ...base }),
            cluster({ id: 'snap-b', center: [0.0005, 52], ...base }),
            cluster({ id: 'snap-c', center: [0.001, 52], ...base }),
        ];
        expect(suppressDisturbance(input)).toMatchSnapshot();
    });
});

describe('route-unavailable target fallback', () => {
    it('hides elongated road-like geometry after contextual relabelling', () => {
        const roadShaped = cluster({
            id: 'cached-road-shape',
            type: 'Ancient Watercourse Signal',
            bearing: 90,
            sources: ['terrain', 'hydrology'],
            metrics: {
                circularity: 0.18,
                density: 0.52,
                ratio: 4.2,
                area: 420,
            },
        });

        expect(applyRouteUnavailableFallback([roadShaped])).toBe(1);
        expect(roadShaped.isRouteArtefactRisk).toBe(true);
        expect(roadShaped.suppressedBy).toContain('route_data_unavailable_fallback');
    });

    it('retains non-elongated context signals when road data is unavailable', () => {
        const compactSignal = cluster({
            id: 'cached-compact-signal',
            type: 'Ancient Watercourse Signal',
            bearing: 90,
            metrics: {
                circularity: 0.72,
                density: 0.62,
                ratio: 1.8,
                area: 420,
            },
        });

        expect(applyRouteUnavailableFallback([compactSignal])).toBe(0);
        expect(compactSignal.isRouteArtefactRisk).toBeUndefined();
    });
});
