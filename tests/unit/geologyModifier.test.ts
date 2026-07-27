import { describe, expect, it } from 'vitest';
import { computeGeologyModifier } from '../../src/engines/geologyContext/geologyModifiers';
import type { GeologyLandscapeClass } from '../../src/engines/geologyContext/geologyContextTypes';

describe('class-level geology modifier', () => {
  it('preserves the effective outputs of the former slot table', () => {
    const expected: Record<GeologyLandscapeClass, number> = {
      chalk_downland: 7,
      river_gravel_terrace: 9,
      alluvial_floodplain: -1,
      peat_fen: 1,
      heavy_clay: -5,
      sand_gravel: -9,
      foreshore: -5,
      mixed_uncertain: 0,
      unknown: 0,
    };

    for (const [landscapeClass, modifier] of Object.entries(expected)) {
      expect(computeGeologyModifier(
        landscapeClass as GeologyLandscapeClass,
        {},
      )).toBe(modifier);
    }
  });
});
