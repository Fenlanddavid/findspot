import { describe, expect, it } from 'vitest';
import { computeBurialBehaviour } from '../../src/services/fieldguide/landscapeInterpretation/burialBehaviour';
import type { PrimaryProcessId, PrimaryProcessScore } from '../../src/types/landscapeInterpretation';

function process(processId: PrimaryProcessId, finalScore: number): PrimaryProcessScore {
  return { processId, finalScore, rawScore: finalScore, regionalMultiplier: 1, contributingSignals: [] };
}

const prominentLandscape = [
  process('landscape_prominence', 90),
  process('movement', 80),
  process('occupation_potential', 20),
  process('boundary_relationships', 70),
];

describe('burial interpretation evidence gate', () => {
  it('cannot infer funerary use from landscape shape alone', () => {
    const result = computeBurialBehaviour(prominentLandscape, [], 'insufficient_chronological_evidence', false);
    expect(result.barrowLandscape).toBe(0);
    expect(result.cemeteryLandscape).toBe(0);
    expect(result.mortuaryComplex).toBe(false);
  });

  it('allows cautious contextual scoring only after relevant dated evidence exists', () => {
    const result = computeBurialBehaviour(prominentLandscape, [{
      period: 'prehistoric_bronze_age', recordCount: 1, certaintyWeightedCount: 1,
    }], 'transient', false);
    expect(result.barrowLandscape).toBeGreaterThan(0);
    expect(result.mortuaryComplex).toBe(false);
  });
});
