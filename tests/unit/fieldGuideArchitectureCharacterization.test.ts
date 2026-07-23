import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const FIELD_GUIDE_MODULES = {
  'pages/FieldGuide.tsx': new URL('../../src/pages/FieldGuide.tsx', import.meta.url),
  'hooks/useFieldGuideMap.ts': new URL('../../src/hooks/useFieldGuideMap.ts', import.meta.url),
  'hooks/useTerrainScan.ts': new URL('../../src/hooks/useTerrainScan.ts', import.meta.url),
  'hooks/useHistoricScan.ts': new URL('../../src/hooks/useHistoricScan.ts', import.meta.url),
  'services/fieldguide/terrainScanCoordinator.ts': new URL(
    '../../src/services/fieldguide/terrainScanCoordinator.ts',
    import.meta.url,
  ),
  'services/fieldguide/terrainScanSupport.ts': new URL(
    '../../src/services/fieldguide/terrainScanSupport.ts',
    import.meta.url,
  ),
  'services/fieldguide/scanOrchestrator.ts': new URL(
    '../../src/services/fieldguide/scanOrchestrator.ts',
    import.meta.url,
  ),
} as const;

async function sourceLines(url: URL): Promise<number> {
  const source = await readFile(url, 'utf8');
  return source.trimEnd().split(/\r?\n/).length;
}

describe('FieldGuide architecture characterization', () => {
  it('ratchets the characterized FieldGuide module sizes', async () => {
    const inventory = Object.fromEntries(await Promise.all(
      Object.entries(FIELD_GUIDE_MODULES).map(async ([name, url]) => [
        name,
        await sourceLines(url),
      ]),
    ));

    expect(inventory).toEqual({
      'pages/FieldGuide.tsx': 1_845,
      'hooks/useFieldGuideMap.ts': 294,
      'hooks/useTerrainScan.ts': 77,
      'hooks/useHistoricScan.ts': 654,
      'services/fieldguide/terrainScanCoordinator.ts': 472,
      'services/fieldguide/terrainScanSupport.ts': 142,
      'services/fieldguide/scanOrchestrator.ts': 160,
    });
  });

  it('keeps combined scan sequencing out of the page', async () => {
    const source = await readFile(FIELD_GUIDE_MODULES['pages/FieldGuide.tsx'], 'utf8');
    const orchestrator = await readFile(
      FIELD_GUIDE_MODULES['services/fieldguide/scanOrchestrator.ts'],
      'utf8',
    );

    expect(source).toContain('runFieldGuideScan({');
    expect(source).toContain('const runHistoricPhase = useCallback(async (');
    expect(source).not.toContain('await runTerrainScan(');
    expect(source).not.toContain('void runHistoricPhase(');
    expect(source).not.toContain('updatePermissionIntelligenceQuestions');
    expect(orchestrator).toContain('const permissionIntelligence = requestedPermission');
    expect(orchestrator).toContain('options.runHistoricPhase(');
    expect(orchestrator.trimEnd().split(/\r?\n/)).toHaveLength(160);
  });
});
