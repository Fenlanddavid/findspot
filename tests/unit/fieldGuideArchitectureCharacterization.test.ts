import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const FIELD_GUIDE_MODULES = {
  'pages/FieldGuide.tsx': new URL('../../src/pages/FieldGuide.tsx', import.meta.url),
  'pages/FieldGuideController.tsx': new URL(
    '../../src/pages/FieldGuideController.tsx',
    import.meta.url,
  ),
  'components/fieldGuide/FieldGuideWorkspace.tsx': new URL(
    '../../src/components/fieldGuide/FieldGuideWorkspace.tsx',
    import.meta.url,
  ),
  'components/session/ActiveSessionGuideWorkspace.tsx': new URL(
    '../../src/components/session/ActiveSessionGuideWorkspace.tsx',
    import.meta.url,
  ),
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
  'services/fieldguide/historicScanCoordinator.ts': new URL(
    '../../src/services/fieldguide/historicScanCoordinator.ts',
    import.meta.url,
  ),
  'services/fieldguide/historicScanRecords.ts': new URL(
    '../../src/services/fieldguide/historicScanRecords.ts',
    import.meta.url,
  ),
  'services/fieldguide/historicScanSupport.ts': new URL(
    '../../src/services/fieldguide/historicScanSupport.ts',
    import.meta.url,
  ),
  'hooks/useFieldGuidePageState.ts': new URL(
    '../../src/hooks/useFieldGuidePageState.ts',
    import.meta.url,
  ),
  'hooks/useFieldGuideProjectData.ts': new URL(
    '../../src/hooks/useFieldGuideProjectData.ts',
    import.meta.url,
  ),
  'hooks/useFieldGuideRouteActions.ts': new URL(
    '../../src/hooks/useFieldGuideRouteActions.ts',
    import.meta.url,
  ),
  'hooks/useActiveSessionGuideAutoScan.ts': new URL(
    '../../src/hooks/useActiveSessionGuideAutoScan.ts',
    import.meta.url,
  ),
  'hooks/useActiveSessionGuideContext.ts': new URL(
    '../../src/hooks/useActiveSessionGuideContext.ts',
    import.meta.url,
  ),
  'services/fieldguide/fieldGuidePageSupport.ts': new URL(
    '../../src/services/fieldguide/fieldGuidePageSupport.ts',
    import.meta.url,
  ),
  'services/fieldguide/scanOrchestrator.ts': new URL(
    '../../src/services/fieldguide/scanOrchestrator.ts',
    import.meta.url,
  ),
  'services/fieldguide/postScanOrchestrator.ts': new URL(
    '../../src/services/fieldguide/postScanOrchestrator.ts',
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
      'pages/FieldGuide.tsx': 11,
      'pages/FieldGuideController.tsx': 15,
      'components/fieldGuide/FieldGuideWorkspace.tsx': 1_318,
      'components/session/ActiveSessionGuideWorkspace.tsx': 44,
      'hooks/useFieldGuideMap.ts': 309,
      'hooks/useTerrainScan.ts': 77,
      'hooks/useHistoricScan.ts': 82,
      'hooks/useFieldGuidePageState.ts': 290,
      'hooks/useFieldGuideProjectData.ts': 297,
      'hooks/useFieldGuideRouteActions.ts': 94,
      'hooks/useActiveSessionGuideAutoScan.ts': 53,
      'hooks/useActiveSessionGuideContext.ts': 55,
      'services/fieldguide/terrainScanCoordinator.ts': 473,
      'services/fieldguide/terrainScanSupport.ts': 142,
      'services/fieldguide/historicScanCoordinator.ts': 405,
      'services/fieldguide/historicScanRecords.ts': 241,
      'services/fieldguide/historicScanSupport.ts': 118,
      'services/fieldguide/fieldGuidePageSupport.ts': 83,
      'services/fieldguide/scanOrchestrator.ts': 160,
      'services/fieldguide/postScanOrchestrator.ts': 71,
    });
  });

  it('keeps combined scan sequencing out of the page', async () => {
    const page = await readFile(
      FIELD_GUIDE_MODULES['pages/FieldGuideController.tsx'],
      'utf8',
    );
    const workspace = await readFile(
      FIELD_GUIDE_MODULES['components/fieldGuide/FieldGuideWorkspace.tsx'],
      'utf8',
    );
    const sessionGuideWorkspace = await readFile(
      FIELD_GUIDE_MODULES['components/session/ActiveSessionGuideWorkspace.tsx'],
      'utf8',
    );
    const orchestrator = await readFile(
      FIELD_GUIDE_MODULES['services/fieldguide/scanOrchestrator.ts'],
      'utf8',
    );

    expect(page).toContain('<ActiveSessionGuideWorkspace {...props} />');
    expect(page).not.toContain('runFieldGuideScan');
    expect(sessionGuideWorkspace).toContain('<FieldGuideWorkspace key="field-guide-workspace"');
    expect(sessionGuideWorkspace).not.toContain('runFieldGuideScan');
    expect(workspace).toContain('runFieldGuideScan({');
    expect(workspace).toContain('const runHistoricPhase = useCallback(async (');
    expect(workspace).not.toContain('await runTerrainScan(');
    expect(workspace).not.toContain('void runHistoricPhase(');
    expect(workspace).not.toContain('updatePermissionIntelligenceQuestions');
    expect(orchestrator).toContain('const permissionIntelligence = requestedPermission');
    expect(orchestrator).toContain('options.runHistoricPhase(');
    expect(orchestrator.trimEnd().split(/\r?\n/)).toHaveLength(160);
  });
});
