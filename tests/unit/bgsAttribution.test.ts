import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  BGS_ATTRIBUTION,
  BGS_ATTRIBUTION_YEAR,
} from '../../src/shared/bgsAttribution';

describe('BGS attribution', () => {
  it('uses the reviewed year and ratchets stale copies out of source and docs', async () => {
    expect(BGS_ATTRIBUTION_YEAR).toBe(2026);
    expect(BGS_ATTRIBUTION)
      .toBe('Contains British Geological Survey materials © UKRI 2026.');

    const files = await Promise.all([
      readFile(new URL('../../src/engines/geologyContext/geologyContextClient.ts', import.meta.url), 'utf8'),
      readFile(new URL('../../src/pages/Settings.tsx', import.meta.url), 'utf8'),
      readFile(new URL('../../workers/bgs-proxy/index.js', import.meta.url), 'utf8'),
      readFile(new URL('../../docs/bgs/bgs-queryable-layers.md', import.meta.url), 'utf8'),
    ]);
    expect(files.every(source => !source.includes('UKRI 2025'))).toBe(true);
  });
});
