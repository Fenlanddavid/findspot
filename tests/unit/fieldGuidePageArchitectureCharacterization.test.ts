import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const FIELD_GUIDE_PAGE = new URL('../../src/pages/FieldGuide.tsx', import.meta.url);

function occurrences(source: string, expression: RegExp): number {
  return source.match(expression)?.length ?? 0;
}

describe('FieldGuide page architecture characterization', () => {
  it('records the pre-change page state and derived-data ownership', async () => {
    const page = await readFile(FIELD_GUIDE_PAGE, 'utf8');

    expect(page.trimEnd().split(/\r?\n/)).toHaveLength(1_845);
    expect(occurrences(page, /useState(?:<[^;]+>)?\(/g)).toBe(53);
    expect(occurrences(page, /useEffect\(/g)).toBe(10);
    expect(occurrences(page, /useMemo(?:<[^;]+>)?\(/g)).toBe(9);
    expect(occurrences(page, /useCallback\(/g)).toBe(15);
    expect(occurrences(page, /useLiveQuery(?:<[^;]+>)?\(/g)).toBe(6);
    expect(page).toContain('const contextValue = {');
  });

  it('records scan, map-action and shell responsibilities still in the page', async () => {
    const page = await readFile(FIELD_GUIDE_PAGE, 'utf8');

    expect(page).toContain('const runHistoricPhase = useCallback(async (');
    expect(page).toContain('const runGeologyContextPhase = useCallback(async (');
    expect(page).toContain('const executeScan = async (');
    expect(page).toContain('const findMe = () =>');
    expect(page).toContain('const searchLocation = async (');
    expect(page).toContain('const handleAnnotationConfirm = useCallback(');
    expect(page).toContain('<FieldGuideContext.Provider value={contextValue}>');
    expect(page).toContain('{devMode && pendingAnnotation && (');
  });
});
