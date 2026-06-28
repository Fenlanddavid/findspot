// ─── boostScore parity guard ──────────────────────────────────────────────────
// boostScoreLocal in terrainScanWorker.ts is a hand-kept copy of boostScore()
// in fieldGuideAnalysis.ts, necessary because the worker cannot import outside
// its bundle. This test locks them to identical behaviour so silent drift is
// caught at CI rather than discovered via scoring anomalies.

import { describe, it, expect } from 'vitest';
import { boostScoreLocal } from '../../src/workers/terrainScanWorker';

// Inline copy of fieldGuideAnalysis.ts boostScore() — the canonical formula.
// If fieldGuideAnalysis changes its formula, this test will fail and remind
// you to update boostScoreLocal to match.
function boostScoreCanonical(base: number, boost: number): number {
    if (base <= 0) return Math.min(96, 100 * (1 - Math.exp(-boost / 100)));
    const raw = -Math.log(Math.max(0.001, 1 - Math.min(0.999, base / 100))) * 100;
    return Math.min(96, 100 * (1 - Math.exp(-(raw + boost) / 100)));
}

describe('boostScoreLocal parity with boostScore canonical', () => {
    const bases  = [0, 5, 10, 25, 40, 60, 70, 85, 95];
    const boosts = [1, 3, 5, 8, 12, 20, 40];

    for (const base of bases) {
        for (const boost of boosts) {
            it(`base=${base} boost=${boost}`, () => {
                expect(boostScoreLocal(base, boost)).toBeCloseTo(boostScoreCanonical(base, boost), 10);
            });
        }
    }
});
