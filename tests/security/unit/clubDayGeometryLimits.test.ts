import { describe, expect, it } from 'vitest';
import { CLUB_DAY_LIMITS, validateClubDayPack } from '../../../src/services/clubDayValidation';
import { validClubDayPack } from '../fixtures/clubDayHostileCorpus';

describe('Club Day geometry limits', () => {
  it('accepts the maximum point count and rejects maximum plus one', () => {
    const ring = Array.from({ length: CLUB_DAY_LIMITS.pointsPerRing - 1 }, (_, index) => [-1 + index / 100_000, 52]);
    ring.push(ring[0]);
    expect(() => validateClubDayPack(validClubDayPack({ fields: [{ id: 'field', name: 'Field', boundary: { type: 'Polygon', coordinates: [ring] } }] }))).not.toThrow();
    ring.splice(ring.length - 1, 0, [-1.5, 52]);
    expect(() => validateClubDayPack(validClubDayPack({ fields: [{ id: 'field', name: 'Field', boundary: { type: 'Polygon', coordinates: [ring] } }] }))).toThrow();
  });

  it('rejects malformed nesting, open rings and non-number coordinates', () => {
    for (const coordinates of [
      [[[-1, 52], [-1, 53], [-2, 53], [-2, 52]]],
      [[["-1", 52], [-1, 53], [-2, 53], ["-1", 52]]],
      [[[[[-1, 52]]]]],
    ]) {
      expect(() => validateClubDayPack(validClubDayPack({ fields: [{ id: 'field', name: 'Field', boundary: { type: 'Polygon', coordinates } }] }))).toThrow();
    }
  });
});
