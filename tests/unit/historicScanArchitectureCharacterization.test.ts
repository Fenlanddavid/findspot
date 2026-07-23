import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const HISTORIC_MODULES = {
  hook: new URL('../../src/hooks/useHistoricScan.ts', import.meta.url),
  coordinator: new URL(
    '../../src/services/fieldguide/historicScanCoordinator.ts',
    import.meta.url,
  ),
  records: new URL(
    '../../src/services/fieldguide/historicScanRecords.ts',
    import.meta.url,
  ),
  support: new URL(
    '../../src/services/fieldguide/historicScanSupport.ts',
    import.meta.url,
  ),
} as const;

function occurrences(source: string, expression: RegExp): number {
  return source.match(expression)?.length ?? 0;
}

async function readHistoricModules() {
  return Object.fromEntries(await Promise.all(
    Object.entries(HISTORIC_MODULES).map(async ([name, url]) => [
      name,
      await readFile(url, 'utf8'),
    ]),
  )) as Record<keyof typeof HISTORIC_MODULES, string>;
}

describe('historic scan architecture characterization', () => {
  it('keeps the lifecycle hook and headless pipeline bounded', async () => {
    const source = await readHistoricModules();

    expect(source.hook.trimEnd().split(/\r?\n/)).toHaveLength(82);
    expect(source.coordinator.trimEnd().split(/\r?\n/).length).toBeLessThanOrEqual(500);
    expect(source.records.trimEnd().split(/\r?\n/).length).toBeLessThanOrEqual(300);
    expect(source.support.trimEnd().split(/\r?\n/).length).toBeLessThanOrEqual(200);

    expect(occurrences(source.hook, /useEffect\(/g)).toBe(1);
    expect(occurrences(source.hook, /useCallback\(/g)).toBe(2);
    expect(source.hook).toContain('runHistoricScanPipeline(options, {');
    expect(source.hook).not.toContain('fieldGuideCache');
    expect(source.hook).not.toContain('enhanceHotspotsWithHistoric');
  });

  it('preserves cancellation, cache, drift and source availability boundaries', async () => {
    const source = await readHistoricModules();

    expect(source.hook).toContain('abortRef.current?.abort()');
    expect(source.hook).toContain('tokenRef.current === token');
    expect(source.hook).toContain('!abort.signal.aborted');
    expect(source.coordinator).toContain('if (!isActive()) return null');
    expect(source.coordinator).toContain('cached.engineVersion === HISTORIC_CACHE_VERSION');
    expect(source.coordinator).toContain('saveHistoricScanCache({');
    expect(source.coordinator).toContain(
      'const drifted = driftM > SCAN_CONFIG.DRIFT_THRESHOLD_M',
    );
    expect(source.coordinator).toContain('if (!drifted)');
    expect(source.coordinator).toContain(
      'scheduled_monuments: nhleData.available !== false',
    );
    expect(source.coordinator).toContain('historic_routes:  historicRoutesAvailable');
    expect(source.coordinator).toContain('pas_density:      pasCellResult !== null');
  });

  it('keeps source-record transformations outside the coordinator', async () => {
    const source = await readHistoricModules();

    expect(source.coordinator).toContain('buildPlaceSignals(');
    expect(source.coordinator).toContain('buildOsmHistoricFinds(');
    expect(source.coordinator).toContain('buildNhleHistoricFinds(');
    expect(source.coordinator).toContain('buildAimFeatures(');
    expect(source.coordinator).not.toContain('ETYMOLOGY_SIGNALS');
    expect(source.coordinator).not.toContain('getDistanceKm');
    expect(source.records).toContain('export function mergeHistoricFinds(');
  });
});
