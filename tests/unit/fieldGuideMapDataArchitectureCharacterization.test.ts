import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const MAP_HOOK = new URL('../../src/hooks/useFieldGuideMap.ts', import.meta.url);

function occurrences(source: string, expression: RegExp): number {
  return source.match(expression)?.length ?? 0;
}

describe('FieldGuide map-data architecture characterization', () => {
  it('records the inline scan and historic overlay boundary before extraction', async () => {
    const hook = await readFile(MAP_HOOK, 'utf8');

    expect(hook.trimEnd().split(/\r?\n/)).toHaveLength(614);
    expect(occurrences(hook, /useEffect\(/g)).toBe(17);
    expect(occurrences(
      hook,
      /getSource\('(hotspots-overlay|targets|trace-targets|cluster-links|pas-finds|pas-density|historic-routes|corridors|crossings|landscape-context)'/g,
    )).toBe(13);
    expect(hook).toContain("getPASDensityGeoJSON().then(geojson =>");
    expect(hook).toContain('const intersects = turf.lineIntersect(a, b)');
  });

  it('characterizes target, route and PAS behaviour owned by the map hook', async () => {
    const hook = await readFile(MAP_HOOK, 'utf8');

    expect(hook).toContain('.filter(f => !f.isRouteArtefactRisk)');
    expect(hook).toContain('.filter(f => !f.isRouteArtefactRisk && !f.isProtected)');
    expect(hook).toContain("const key = [f.id, linkedId].sort().join('|')");
    expect(hook).toContain('coordinates: [f.lon + count * 0.0001, f.lat + count * 0.0001]');
    expect(hook).toContain("historicRoutes[i].source === 'itinere'");
    expect(hook).toContain("'Malformed route corridor skipped'");
    expect(hook).toContain("'Malformed route crossing skipped'");
    expect(hook).toContain('callbacksRef.current.onCrossingsLog(');
  });
});
