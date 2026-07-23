import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const FIELD_GUIDE_MODULES = {
  page: new URL('../../src/pages/FieldGuide.tsx', import.meta.url),
  controller: new URL('../../src/pages/FieldGuideController.tsx', import.meta.url),
  workspace: new URL(
    '../../src/components/fieldGuide/FieldGuideWorkspace.tsx',
    import.meta.url,
  ),
  state: new URL('../../src/hooks/useFieldGuidePageState.ts', import.meta.url),
  projectData: new URL('../../src/hooks/useFieldGuideProjectData.ts', import.meta.url),
  support: new URL(
    '../../src/services/fieldguide/fieldGuidePageSupport.ts',
    import.meta.url,
  ),
} as const;

function occurrences(source: string, expression: RegExp): number {
  return source.match(expression)?.length ?? 0;
}

async function readModules() {
  return Object.fromEntries(await Promise.all(
    Object.entries(FIELD_GUIDE_MODULES).map(async ([name, url]) => [
      name,
      await readFile(url, 'utf8'),
    ]),
  )) as Record<keyof typeof FIELD_GUIDE_MODULES, string>;
}

describe('FieldGuide page architecture characterization', () => {
  it('keeps the route page declarative and below the programme boundary', async () => {
    const source = await readModules();

    expect(source.page.trimEnd().split(/\r?\n/)).toHaveLength(11);
    expect(source.page).toContain('<FieldGuideController {...props} />');
    expect(source.page).not.toContain('useState(');
    expect(source.page).not.toContain('useEffect(');
    expect(source.page).not.toContain('useLiveQuery');
    expect(source.page).not.toContain('runFieldGuideScan');
    expect(source.page).not.toContain('useFieldGuideMap');
  });

  it('keeps state, project data and pure support owners bounded', async () => {
    const source = await readModules();

    expect(source.state.trimEnd().split(/\r?\n/).length).toBeLessThanOrEqual(300);
    expect(source.projectData.trimEnd().split(/\r?\n/).length).toBeLessThanOrEqual(300);
    expect(source.support.trimEnd().split(/\r?\n/).length).toBeLessThanOrEqual(150);
    expect(source.state).toContain('useReducer(engineReducer, initialEngineState)');
    expect(source.projectData).toContain('useLiveQuery(');
    expect(source.projectData).toContain('computeTraceTargets(');
    expect(source.projectData).toContain('computeHotspotLandscapeIntelligence(');
    expect(source.support).toContain('export function hasTargetEvidence(');
    expect(source.support).toContain('export function buildMonumentBufferGeoJSON(');
  });

  it('keeps the controller composition-only and live-query construction behind hooks', async () => {
    const source = await readModules();

    expect(source.controller.trimEnd().split(/\r?\n/).length).toBeLessThan(500);
    expect(source.controller).toContain('<FieldGuideWorkspace {...props} />');
    expect(source.controller).not.toContain('useFieldGuidePageState()');
    expect(source.controller).not.toContain('runFieldGuideScan({');
    expect(source.workspace).toContain('useFieldGuidePageState()');
    expect(source.workspace).toContain('useFieldGuideProjectData({');
    expect(source.workspace).toContain('runFieldGuideScan({');
    expect(source.workspace).toContain('<FieldGuideContext.Provider value={contextValue}>');
    expect(occurrences(source.controller, /useState\(/g)).toBe(0);
    expect(occurrences(source.controller, /useReducer\(/g)).toBe(0);
    expect(occurrences(source.controller, /useLiveQuery/g)).toBe(0);
    expect(occurrences(source.controller, /useMemo\(/g)).toBe(0);
    expect(occurrences(source.workspace, /useLiveQuery/g)).toBe(0);
  });
});
