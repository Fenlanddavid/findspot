import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const HISTORIC_HOOK = new URL('../../src/hooks/useHistoricScan.ts', import.meta.url);

function occurrences(source: string, expression: RegExp): number {
  return source.match(expression)?.length ?? 0;
}

describe('historic scan architecture characterization', () => {
  it('records the inline historic pipeline before extraction', async () => {
    const hook = await readFile(HISTORIC_HOOK, 'utf8');

    expect(hook.trimEnd().split(/\r?\n/)).toHaveLength(654);
    expect(occurrences(hook, /useEffect\(/g)).toBe(1);
    expect(occurrences(hook, /useCallback\(/g)).toBe(2);
    expect(hook).toContain('const runHistoricScan = useCallback(async (');
    expect(hook).toContain('const [geoTimed, contextTimed, nhleTimed, aimTimed, routeTimed]');
    expect(hook).toContain('// ── Hotspot enhancement');
  });

  it('characterizes cancellation, cache, drift and source availability', async () => {
    const hook = await readFile(HISTORIC_HOOK, 'utf8');

    expect(hook).toContain('abortRef.current?.abort()');
    expect(hook).toContain('cached.engineVersion === HISTORIC_CACHE_VERSION');
    expect(hook).toContain('saveHistoricScanCache({');
    expect(hook).toContain('const drifted = driftM > SCAN_CONFIG.DRIFT_THRESHOLD_M');
    expect(hook).toContain('if (!drifted)');
    expect(hook).toContain('scheduled_monuments: nhleData.available !== false');
    expect(hook).toContain('historic_routes:  historicRoutesAvailable');
    expect(hook).toContain('pas_density:      pasCellResult !== null');
  });
});
