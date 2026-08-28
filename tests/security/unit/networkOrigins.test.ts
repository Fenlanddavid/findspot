import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import entries from '../../../src/shared/networkOrigins.json';
import { approvedAutomaticBaseUrl } from '../../../src/shared/networkOriginPolicy';

describe('network origin inventory', () => {
  it('has unique canonical origins with review metadata', () => {
    const origins = entries.map(entry => entry.origin);
    expect(new Set(origins).size).toBe(origins.length);
    for (const entry of entries) {
      expect(new URL(entry.origin).origin).toBe(entry.origin);
      expect(entry.purpose.length).toBeGreaterThan(3);
    }
    expect(readFileSync('docs/NETWORK-PRIVACY.md', 'utf8')).toContain('private FindSpot records');
  });

  it('rejects arbitrary build-time automatic service origins', () => {
    expect(approvedAutomaticBaseUrl('https://findspot-geocode.trials-uk.workers.dev/', 'test'))
      .toBe('https://findspot-geocode.trials-uk.workers.dev');
    expect(() => approvedAutomaticBaseUrl('https://attacker.example', 'test')).toThrow('unapproved');
    expect(() => approvedAutomaticBaseUrl('http://findspot-geocode.trials-uk.workers.dev', 'test')).toThrow('unapproved');
  });
});
