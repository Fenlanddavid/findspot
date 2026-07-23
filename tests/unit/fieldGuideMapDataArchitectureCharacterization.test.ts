import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const MAP_HOOK = new URL('../../src/hooks/useFieldGuideMap.ts', import.meta.url);
const SCAN_LAYERS_HOOK = new URL(
  '../../src/hooks/useFieldGuideScanLayers.ts',
  import.meta.url,
);
const HISTORIC_LAYERS_HOOK = new URL(
  '../../src/hooks/useFieldGuideHistoricLayers.ts',
  import.meta.url,
);

function occurrences(source: string, expression: RegExp): number {
  return source.match(expression)?.length ?? 0;
}

describe('FieldGuide map-data architecture characterization', () => {
  it('ratchets scan and historic overlays out of the parent map hook', async () => {
    const [mapHook, scanLayersHook, historicLayersHook] = await Promise.all([
      readFile(MAP_HOOK, 'utf8'),
      readFile(SCAN_LAYERS_HOOK, 'utf8'),
      readFile(HISTORIC_LAYERS_HOOK, 'utf8'),
    ]);

    expect(mapHook.trimEnd().split(/\r?\n/)).toHaveLength(294);
    expect(scanLayersHook.trimEnd().split(/\r?\n/).length).toBeLessThanOrEqual(300);
    expect(historicLayersHook.trimEnd().split(/\r?\n/).length).toBeLessThanOrEqual(300);
    expect(occurrences(mapHook, /useEffect\(/g)).toBe(6);
    expect(occurrences(scanLayersHook, /useEffect\(/g)).toBe(7);
    expect(occurrences(historicLayersHook, /useEffect\(/g)).toBe(4);
    expect(occurrences(
      `${scanLayersHook}\n${historicLayersHook}`,
      /getSource\('(hotspots-overlay|targets|trace-targets|cluster-links|pas-finds|pas-density|historic-routes|corridors|crossings|landscape-context)'/g,
    )).toBe(11);
    expect(mapHook).toContain('useFieldGuideScanLayers({');
    expect(mapHook).toContain('useFieldGuideHistoricLayers({');
    expect(mapHook).not.toContain('getPASDensityGeoJSON');
    expect(mapHook).not.toContain('turf.');
  });

  it('keeps target, route and PAS behaviour in bounded owners', async () => {
    const [scanLayersHook, historicLayersHook] = await Promise.all([
      readFile(SCAN_LAYERS_HOOK, 'utf8'),
      readFile(HISTORIC_LAYERS_HOOK, 'utf8'),
    ]);

    expect(scanLayersHook).toContain('.filter(feature => !feature.isRouteArtefactRisk)');
    expect(scanLayersHook).toContain(
      '.filter(feature => !feature.isRouteArtefactRisk && !feature.isProtected)',
    );
    expect(scanLayersHook).toContain("const key = [feature.id, linkedId].sort().join('|')");
    expect(historicLayersHook).toContain(
      'coordinates: [find.lon + count * 0.0001, find.lat + count * 0.0001]',
    );
    expect(historicLayersHook).toContain("historicRoutes[i].source === 'itinere'");
    expect(historicLayersHook).toContain("'Malformed route corridor skipped'");
    expect(historicLayersHook).toContain("'Malformed route crossing skipped'");
    expect(historicLayersHook).toContain('callbacksRef.current.onCrossingsLog(');
  });
});
