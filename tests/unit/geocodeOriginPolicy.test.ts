import { describe, expect, it } from 'vitest';
import { originAllowed } from '../../workers/geocode-proxy/originPolicy';

describe('geocode proxy origin policy', () => {
  const allowed = 'https://fenlanddavid.github.io,http://127.0.0.1:5173';

  it('allows only configured browser origins', () => {
    expect(originAllowed('https://fenlanddavid.github.io', allowed)).toBe(true);
    expect(originAllowed('http://127.0.0.1:5173/', allowed)).toBe(true);
    expect(originAllowed('https://example.test', allowed)).toBe(false);
  });

  it('rejects requests without an Origin header', () => {
    expect(originAllowed(null, allowed)).toBe(false);
  });
});
