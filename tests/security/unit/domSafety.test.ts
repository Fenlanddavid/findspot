import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('unsafe DOM ratchet', () => {
  it('permits only content-hashed static literals', () => {
    const source = readFileSync('scripts/checkDomSafety.mjs', 'utf8');
    expect(source.match(/sink: 'innerHTML'/g)).toHaveLength(5);
    expect(source).toContain('dangerouslySetInnerHTML');
    expect(source).toContain('insertAdjacentHTML');
    expect(source).toContain('sha256');
  });
});
