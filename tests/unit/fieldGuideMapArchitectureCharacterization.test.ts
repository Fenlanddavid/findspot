import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const MAP_HOOK = new URL('../../src/hooks/useFieldGuideMap.ts', import.meta.url);
const LAYER_REGISTRY = new URL(
  '../../src/services/fieldguide/mapLayerRegistry.ts',
  import.meta.url,
);
const INTERACTIONS = new URL(
  '../../src/services/fieldguide/mapInteractions.ts',
  import.meta.url,
);

function occurrences(source: string, expression: RegExp): number {
  return source.match(expression)?.length ?? 0;
}

describe('FieldGuide map architecture characterization', () => {
  it('ratchets map lifecycle construction out of the React hook', async () => {
    const [hook, registry, interactions] = await Promise.all([
      readFile(MAP_HOOK, 'utf8'),
      readFile(LAYER_REGISTRY, 'utf8'),
      readFile(INTERACTIONS, 'utf8'),
    ]);

    expect(hook.trimEnd().split(/\r?\n/)).toHaveLength(294);
    expect(registry.trimEnd().split(/\r?\n/).length).toBeLessThanOrEqual(300);
    expect(interactions.trimEnd().split(/\r?\n/).length).toBeLessThanOrEqual(300);
    expect(occurrences(hook, /map\.addSource\(/g)).toBe(0);
    expect(occurrences(hook, /map\.addLayer\(/g)).toBe(0);
    expect(occurrences(hook, /map\.on\(/g)).toBe(0);
    expect(occurrences(registry, /map\.addSource\(/g)).toBe(16);
    expect(occurrences(registry, /map\.addLayer\(/g)).toBe(34);
    expect(occurrences(interactions, /map\.on\(/g)).toBe(18);
    expect(hook).toContain('registerFieldGuideMapLayers(map)');
    expect(hook).toContain('bindFieldGuideMapInteractions(map, {');
  });

  it('keeps interaction priority and specialist labels in the headless router', async () => {
    const source = await readFile(INTERACTIONS, 'utf8');

    expect(source).toContain(
      "layers: ['targets-circle', 'trace-targets-circle', 'user-finds-hitbox', 'pas-circles']",
    );
    expect(source).toContain(
      "layers: ['targets-circle', 'trace-targets-circle', 'pas-circles', 'hotspots-fill', 'user-finds-hitbox', 'monuments-fill', 'monument-buffer-fill']",
    );
    expect(source).toContain("showLabel('Historic Trackway')");
    expect(source).toContain('showLabel(`Route Crossing: ${a} × ${b}`)');
    expect(source).toContain(
      'callbacks().onAnnotationDrop(event.lngLat.lat, event.lngLat.lng)',
    );
  });
});
