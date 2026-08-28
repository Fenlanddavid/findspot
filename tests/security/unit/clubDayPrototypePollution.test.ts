import { describe, expect, it } from 'vitest';
import { validateClubDayPack } from '../../../src/services/clubDayValidation';
import { validClubDayPack } from '../fixtures/clubDayHostileCorpus';

describe('Club Day object injection', () => {
  it.each(['__proto__', 'prototype', 'constructor'])('does not retain %s', key => {
    const raw = JSON.parse(JSON.stringify(validClubDayPack())) as Record<string, unknown>;
    Object.defineProperty(raw, key, { value: { polluted: true }, enumerable: true });
    const trusted = validateClubDayPack(raw) as unknown as Record<string, unknown>;
    expect(Object.hasOwn(trusted, key)).toBe(false);
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });

  it('drops unexpected nested field keys', () => {
    const raw = validClubDayPack() as unknown as Record<string, unknown>;
    const fields = raw.fields as Array<Record<string, unknown>>;
    fields[0].constructor = { polluted: true };
    fields[0].unexpected = 'not trusted';
    const trusted = validateClubDayPack(raw);
    expect(Object.keys(trusted.fields[0]).sort()).toEqual(['boundary', 'createdAt', 'id', 'name', 'notes', 'updatedAt']);
  });
});
