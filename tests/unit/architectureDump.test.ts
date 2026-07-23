import { describe, expect, it } from 'vitest';

// The operational script is JavaScript so it can run in plain Node without a
// build step. TypeScript intentionally checks its public values at usage sites.
// @ts-expect-error No separate declaration file is needed for this test import.
import {
  listDumpFiles,
  verifyDumpCoverage,
} from '../../scripts/dumpArchitecture.mjs';

describe('architecture dump coverage', () => {
  it('includes every permanent verification file and the dump mechanism itself', () => {
    const files = new Set(listDumpFiles());

    expect(files).toContain('scripts/dumpArchitecture.mjs');
    expect(files).toContain('docs/adr/0001-local-only-data-model.md');
    expect(files).toContain('.github/workflows/deploy.yml');
    expect(files).toContain('src/vite-env.d.ts');
    expect(files).toContain('workers/geocode-proxy/wrangler.toml');
    expect(files).toContain('workers/findspot-static/worker-configuration.d.ts');
  });

  it('passes its dynamic coverage verification', () => {
    expect(verifyDumpCoverage()).toEqual(listDumpFiles());
  });
});
