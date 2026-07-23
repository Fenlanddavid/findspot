import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const MAP_HOOK = new URL('../../src/hooks/useFieldGuideMap.ts', import.meta.url);

function occurrences(source: string, expression: RegExp): number {
  return source.match(expression)?.length ?? 0;
}

describe('FieldGuide map architecture characterization', () => {
  it('records the inline map lifecycle before extraction', async () => {
    const source = await readFile(MAP_HOOK, 'utf8');

    expect(source.trimEnd().split(/\r?\n/)).toHaveLength(1_191);
    expect(occurrences(source, /map\.addSource\(/g)).toBe(16);
    expect(occurrences(source, /map\.addLayer\(/g)).toBe(34);
    expect(occurrences(source, /map\.on\(/g)).toBe(18);
  });

  it('records interaction priority and specialist labels', async () => {
    const source = await readFile(MAP_HOOK, 'utf8');

    expect(source).toContain(
      "layers: ['targets-circle', 'trace-targets-circle', 'user-finds-hitbox', 'pas-circles']",
    );
    expect(source).toContain(
      "layers: ['targets-circle', 'trace-targets-circle', 'pas-circles', 'hotspots-fill', 'user-finds-hitbox', 'monuments-fill', 'monument-buffer-fill']",
    );
    expect(source).toContain("showLabel('Historic Trackway')");
    expect(source).toContain('showLabel(`Route Crossing: ${a} × ${b}`)');
    expect(source).toContain("callbacksRef.current.onAnnotationDrop(e.lngLat.lat, e.lngLat.lng)");
  });
});
