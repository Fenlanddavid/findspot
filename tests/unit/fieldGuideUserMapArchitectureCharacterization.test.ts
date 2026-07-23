import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const MAP_HOOK = new URL('../../src/hooks/useFieldGuideMap.ts', import.meta.url);

describe('FieldGuide user-map architecture characterization', () => {
  it('records the inline user-overlay lifecycle before extraction', async () => {
    const source = await readFile(MAP_HOOK, 'utf8');
    const userOverlaySection = source.slice(
      source.indexOf('// ── Field boundaries data'),
      source.indexOf('// ── Exposed helpers'),
    );

    expect(source.trimEnd().split(/\r?\n/)).toHaveLength(878);
    expect(userOverlaySection.trimEnd().split(/\r?\n/)).toHaveLength(237);
    expect(userOverlaySection.match(/useEffect\(/g)).toHaveLength(7);
  });

  it('records safe labels and saved-point deletion behaviour', async () => {
    const source = await readFile(MAP_HOOK, 'utf8');

    expect(source).toContain('labelEl.textContent = sp.label');
    expect(source).toContain('deleteConfirmPending = true');
    expect(source).toContain("deletePack({ ownerType: 'savedPoint', ownerId: sp.id })");
    expect(source).toContain('await removeSavedPoint(sp.id)');
    expect(source).toContain('callbacksRef.current.onSavedPointClick()');
  });
});
