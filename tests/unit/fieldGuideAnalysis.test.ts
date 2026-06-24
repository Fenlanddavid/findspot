import { describe, it, expect } from 'vitest';
import { analyzeContext } from '../../src/utils/fieldGuideAnalysis';
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
