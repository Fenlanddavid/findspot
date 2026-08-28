import { describe, expect, it } from 'vitest';
import {
  compactClubDayPack,
  decodeClubDayUrlPayload,
  validateClubDayPack,
} from '../../../src/services/clubDayValidation';
import { hostileClubDayCorpus, validClubDayPack } from '../fixtures/clubDayHostileCorpus';

function base64Url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  bytes.forEach(byte => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

describe('Club Day untrusted-input boundary', () => {
  it.each(hostileClubDayCorpus)('rejects $name', ({ value }) => {
    expect(() => validateClubDayPack(value)).toThrow();
  });

  it('converges compact and full packs on the same trusted schema', () => {
    const full = validateClubDayPack(validClubDayPack());
    const compact = validateClubDayPack(compactClubDayPack(full));
    expect(compact).toEqual({
      ...full,
      fields: full.fields.map(field => ({ ...field, notes: '', createdAt: full.createdAt, updatedAt: full.createdAt })),
    });
  });

  it('strictly decodes a valid bounded URL payload', () => {
    const result = decodeClubDayUrlPayload(base64Url(JSON.stringify(validClubDayPack())));
    expect(result.eventName).toBe('Fenland Club Day');
  });
});
