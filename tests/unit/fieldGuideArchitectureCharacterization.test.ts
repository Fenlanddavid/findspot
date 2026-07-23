import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const FIELD_GUIDE_MODULES = {
  'pages/FieldGuide.tsx': new URL('../../src/pages/FieldGuide.tsx', import.meta.url),
  'hooks/useFieldGuideMap.ts': new URL('../../src/hooks/useFieldGuideMap.ts', import.meta.url),
  'hooks/useTerrainScan.ts': new URL('../../src/hooks/useTerrainScan.ts', import.meta.url),
  'hooks/useHistoricScan.ts': new URL('../../src/hooks/useHistoricScan.ts', import.meta.url),
} as const;

async function sourceLines(url: URL): Promise<number> {
  const source = await readFile(url, 'utf8');
  return source.trimEnd().split(/\r?\n/).length;
}

describe('FieldGuide architecture characterization', () => {
  it('records the pre-Workstream E module sizes', async () => {
    const inventory = Object.fromEntries(await Promise.all(
      Object.entries(FIELD_GUIDE_MODULES).map(async ([name, url]) => [
        name,
        await sourceLines(url),
      ]),
    ));

    expect(inventory).toEqual({
      'pages/FieldGuide.tsx': 1_934,
      'hooks/useFieldGuideMap.ts': 1_191,
      'hooks/useTerrainScan.ts': 625,
      'hooks/useHistoricScan.ts': 654,
    });
  });

  it('records the combined scan orchestration currently owned by the page', async () => {
    const source = await readFile(FIELD_GUIDE_MODULES['pages/FieldGuide.tsx'], 'utf8');

    expect(source).toContain('const runHistoricPhase = useCallback(async (');
    expect(source).toContain('const executeScan = async (');
    expect(source).toContain('await runTerrainScan(');
    expect(source).toContain('void runHistoricPhase(');
  });
});
