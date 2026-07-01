import { describe, it, expect } from 'vitest';
import { selectPrimaryAndSecondary } from '../../src/services/fieldguide/landscapeInterpretation/secondaryInterpretationEngine';
import type { SecondaryInterpretationScore, SecondaryInterpretationId } from '../../src/types/landscapeInterpretation';

function score(interpretationId: SecondaryInterpretationId, derivedScore: number): SecondaryInterpretationScore {
  return {
    interpretationId,
    derivedScore,
    periodAffinity: [],
    confidenceTier: derivedScore >= 55 ? 'high' : derivedScore >= 35 ? 'moderate' : 'lower',
  };
}

describe('selectPrimaryAndSecondary', () => {
  it('keeps movement primary when riverine is only slightly stronger than a corridor-strength movement signal', () => {
    const selected = selectPrimaryAndSecondary([
      score('riverine_activity', 58),
      score('movement_corridor', 42),
      score('agricultural_landscape', 20),
    ]);

    expect(selected).toEqual({
      primaryId: 'movement_corridor',
      secondaryId: 'riverine_activity',
    });
  });

  it('leaves riverine primary when water evidence is much stronger than movement', () => {
    const selected = selectPrimaryAndSecondary([
      score('riverine_activity', 78),
      score('movement_corridor', 42),
      score('agricultural_landscape', 20),
    ]);

    expect(selected.primaryId).toBe('riverine_activity');
  });
});
