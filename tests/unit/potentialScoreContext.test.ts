import { describe, expect, it, vi } from 'vitest';
import type { NHLEResponse } from '../../src/services/historicScanService';
const state = vi.hoisted(() => ({ values: [] as unknown[] }));
vi.mock('react', () => ({ useState: (initial: unknown) => [initial, (value: unknown) => state.values.push(value)] }));
import { usePotentialScore } from '../../src/hooks/usePotentialScore';
import { buildNhleHistoricFinds } from '../../src/services/fieldguide/historicScanRecords';

describe('monument geometry in legacy potential scoring', () => {
    it('recognises containing geometry beyond the point cutoff without changing the 35-point monument weight', () => {
        state.values = [];
        const monuments: NHLEResponse = { available: true, features: [{ type: 'Feature', properties: { ListEntry: 'fixture' },
            geometry: { type: 'Polygon', coordinates: [[[0.08, 51.99], [0.12, 51.99], [0.12, 52.01], [0.08, 52.01], [0.08, 51.99]]] } }] };
        usePotentialScore().calculatePotentialScore(buildNhleHistoricFinds(monuments), [[0.08, 51.99]], [], 52, 0.1,
            { monuments, bounds: { west: 0.099, east: 0.101, south: 51.999, north: 52.001 } });
        expect(state.values[0]).toMatchObject({ score: 18, breakdown: { historic: 35, terrain: 0, imagery: 0 } });
    });

    it('retains point-only proximity when geometry is not supplied', () => {
        state.values = [];
        usePotentialScore().calculatePotentialScore([], [[0.1, 52]], [], 52, 0.1);
        expect(state.values[0]).toMatchObject({ breakdown: { historic: 35 } });
        state.values = [];
        usePotentialScore().calculatePotentialScore([], [[0.08, 51.99]], [], 52, 0.1);
        expect(state.values[0]).toMatchObject({ breakdown: { historic: 0 } });
    });
});
