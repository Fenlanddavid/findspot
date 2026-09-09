import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('MapLibre production worker packaging', () => {
  it('emits and precaches the sibling module worker required by MapLibre 6', async () => {
    const config = await readFile(new URL('../../vite.config.ts', import.meta.url), 'utf8');

    expect(config).toContain("node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs");
    expect(config).toContain("fileName: 'assets/maplibre-gl-worker.mjs'");
    expect(config).toContain("node_modules/maplibre-gl/dist/maplibre-gl-shared.mjs");
    expect(config).toContain("fileName: 'assets/maplibre-gl-shared.mjs'");
    expect(config).toContain("globPatterns: ['**/*.{js,mjs,css,html,ico,png,svg}']");
  });
});
