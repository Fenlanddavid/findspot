import { describe, expect, it } from 'vitest';
import { CLUB_DAY_LIMITS, decodeClubDayUrlPayload, validateClubDayPack } from '../../../src/services/clubDayValidation';
import { validClubDayPack } from '../fixtures/clubDayHostileCorpus';

describe('Club Day resource limits', () => {
  it('accepts zero, normal and maximum field counts and rejects larger arrays', () => {
    for (const count of [0, 1, CLUB_DAY_LIMITS.fields]) {
      const fields = Array.from({ length: count }, (_, index) => ({
        id: `field-${index}`,
        name: `Field ${index}`,
        boundary: validClubDayPack().fields[0].boundary,
      }));
      expect(() => validateClubDayPack(validClubDayPack({ fields }))).not.toThrow();
    }
    expect(() => validateClubDayPack(validClubDayPack({ fields: Array(CLUB_DAY_LIMITS.fields + 1).fill(null) }))).toThrow();
    expect(() => validateClubDayPack(validClubDayPack({ fields: Array(10_000).fill(null) }))).toThrow();
  });

  it('rejects an encoded payload before base64 decoding when it is oversized', () => {
    expect(() => decodeClubDayUrlPayload('A'.repeat(CLUB_DAY_LIMITS.encodedPayloadChars + 1))).toThrow();
  });

  it('rejects invalid base64 and valid base64 containing invalid JSON', () => {
    expect(() => decodeClubDayUrlPayload('%%%')).toThrow();
    expect(() => decodeClubDayUrlPayload(btoa('not json'))).toThrow();
  });
});
