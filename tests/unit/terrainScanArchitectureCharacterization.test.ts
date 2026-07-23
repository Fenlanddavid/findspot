import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const TERRAIN_HOOK = new URL('../../src/hooks/useTerrainScan.ts', import.meta.url);
const TERRAIN_COORDINATOR = new URL(
  '../../src/services/fieldguide/terrainScanCoordinator.ts',
  import.meta.url,
);
const TERRAIN_SUPPORT = new URL(
  '../../src/services/fieldguide/terrainScanSupport.ts',
  import.meta.url,
);

function occurrences(source: string, expression: RegExp): number {
  return source.match(expression)?.length ?? 0;
}

describe('terrain scan architecture characterization', () => {
  it('ratchets the terrain pipeline out of the React hook', async () => {
    const [hook, coordinator, support] = await Promise.all([
      readFile(TERRAIN_HOOK, 'utf8'),
      readFile(TERRAIN_COORDINATOR, 'utf8'),
      readFile(TERRAIN_SUPPORT, 'utf8'),
    ]);

    expect(hook.trimEnd().split(/\r?\n/)).toHaveLength(77);
    expect(coordinator.trimEnd().split(/\r?\n/).length).toBeLessThanOrEqual(500);
    expect(support.trimEnd().split(/\r?\n/).length).toBeLessThanOrEqual(300);
    expect(occurrences(hook, /useEffect\(/g)).toBe(1);
    expect(occurrences(hook, /useCallback\(/g)).toBe(2);
    expect(occurrences(hook, /scanDataSource\(/g)).toBe(0);
    expect(occurrences(coordinator, /scanDataSource\(/g)).toBe(6);
    expect(hook).toContain('const runTerrainScan = useCallback(async (');
    expect(hook).toContain('runTerrainScanPipeline(params, {');
    expect(hook).not.toContain('fieldGuideCache');
    expect(coordinator).toContain('// ── Cache check');
    expect(coordinator).toContain('// ── Fire remaining parallel requests for fresh scan');
  });

  it('characterizes cancellation, cache and route-fallback behaviour', async () => {
    const [hook, coordinator] = await Promise.all([
      readFile(TERRAIN_HOOK, 'utf8'),
      readFile(TERRAIN_COORDINATOR, 'utf8'),
    ]);

    expect(hook).toContain('abortRef.current?.abort()');
    expect(hook).toContain('workersRef.current.forEach(worker => worker.terminate())');
    expect(hook).toContain('tokenRef.current === token');
    expect(hook).toContain('!abort.signal.aborted');
    expect(coordinator).toContain('safeParseFieldGuideScanCache(persisted)');
    expect(coordinator).toContain('cached.engineVersion === ENGINE_VERSION');
    expect(coordinator).toContain('applyRouteUnavailableFallback(contextualized)');
    expect(coordinator).toContain('saveTerrainScanCache({');
    expect(coordinator).toContain('if (!noSignal)');
  });
});
