import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const MAP_HOOK = new URL('../../src/hooks/useFieldGuideMap.ts', import.meta.url);
const USER_LAYERS_HOOK = new URL(
  '../../src/hooks/useFieldGuideUserLayers.ts',
  import.meta.url,
);
const SAVED_POINTS_HOOK = new URL(
  '../../src/hooks/useSavedPointMarkers.ts',
  import.meta.url,
);

describe('FieldGuide user-map architecture characterization', () => {
  it('ratchets user-owned overlays out of the parent map hook', async () => {
    const [mapHook, userLayersHook, savedPointsHook] = await Promise.all([
      readFile(MAP_HOOK, 'utf8'),
      readFile(USER_LAYERS_HOOK, 'utf8'),
      readFile(SAVED_POINTS_HOOK, 'utf8'),
    ]);

    expect(mapHook.trimEnd().split(/\r?\n/)).toHaveLength(294);
    expect(userLayersHook.trimEnd().split(/\r?\n/).length).toBeLessThanOrEqual(300);
    expect(savedPointsHook.trimEnd().split(/\r?\n/).length).toBeLessThanOrEqual(300);
    expect(userLayersHook.match(/useEffect\(/g)).toHaveLength(6);
    expect(savedPointsHook.match(/useEffect\(/g)).toHaveLength(1);
    expect(mapHook).toContain('useFieldGuideUserLayers({');
    expect(mapHook).toContain('useSavedPointMarkers({');
    expect(mapHook).not.toContain('makeFieldLabelElement');
    expect(mapHook).not.toContain('makeAnnotationLabelElement');
    expect(mapHook).not.toContain('deletePack');
    expect(mapHook).not.toContain('removeSavedPoint');
  });

  it('keeps safe labels and saved-point deletion behaviour in bounded owners', async () => {
    const [userLayersHook, savedPointsHook] = await Promise.all([
      readFile(USER_LAYERS_HOOK, 'utf8'),
      readFile(SAVED_POINTS_HOOK, 'utf8'),
    ]);

    expect(userLayersHook).toContain('el.textContent = label');
    expect(savedPointsHook).toContain('labelElement.textContent = savedPoint.label');
    expect(savedPointsHook).toContain('deleteConfirmPending = true');
    expect(savedPointsHook).toContain("ownerType: 'savedPoint'");
    expect(savedPointsHook).toContain('await removeSavedPoint(savedPoint.id)');
    expect(savedPointsHook).toContain('callbacksRef.current.onSavedPointClick()');
  });
});
