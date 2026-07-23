import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const TERRAIN_HOOK = new URL('../../src/hooks/useTerrainScan.ts', import.meta.url);

function occurrences(source: string, expression: RegExp): number {
  return source.match(expression)?.length ?? 0;
}

describe('terrain scan architecture characterization', () => {
  it('records the inline terrain pipeline before extraction', async () => {
    const hook = await readFile(TERRAIN_HOOK, 'utf8');

    expect(hook.trimEnd().split(/\r?\n/)).toHaveLength(625);
    expect(occurrences(hook, /useEffect\(/g)).toBe(1);
    expect(occurrences(hook, /useCallback\(/g)).toBe(2);
    expect(occurrences(hook, /scanDataSource\(/g)).toBe(6);
    expect(hook).toContain('const runTerrainScan = useCallback(async (');
    expect(hook).toContain('// ── Cache check');
    expect(hook).toContain('// ── Fire remaining parallel requests for fresh scan');
  });

  it('characterizes cancellation, cache and route-fallback behaviour', async () => {
    const hook = await readFile(TERRAIN_HOOK, 'utf8');

    expect(hook).toContain('abortRef.current?.abort()');
    expect(hook).toContain('workersRef.current.forEach(w => w.terminate())');
    expect(hook).toContain('safeParseFieldGuideScanCache(persisted)');
    expect(hook).toContain('cached.engineVersion === ENGINE_VERSION');
    expect(hook).toContain('applyRouteUnavailableFallback(contextualized)');
    expect(hook).toContain('saveTerrainScanCache({');
    expect(hook).toContain('if (!noSignal)');
  });
});
