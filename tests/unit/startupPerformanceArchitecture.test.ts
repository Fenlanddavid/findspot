import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('startup performance architecture', () => {
  it('keeps Home permission enrichment independent of raw GPS tracks and Turf', async () => {
    const source = await readFile(
      new URL('../../src/services/permissions.ts', import.meta.url),
      'utf8',
    );
    expect(source).not.toContain('db.tracks');
    expect(source).not.toContain('calculateCoverage');
    expect(source).not.toContain('@turf/');
  });

  it('does not run global hotspot outcome resolution during application launch', async () => {
    const source = await readFile(new URL('../../src/App.tsx', import.meta.url), 'utf8');
    expect(source).not.toContain('refreshHotspotPredictionOutcomes');
    expect(source).not.toContain('aggregateAndSweepHotspotPredictions');
    expect(source).toContain("where('derivationStatus').equals('pending')");
  });
});
