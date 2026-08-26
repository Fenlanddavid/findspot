import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('active-session map objects architecture', () => {
  it('keeps selection extracted and all active-map navigation behind labelled sheet actions', async () => {
    const [session, mapHook, selectionHook, sheet] = await Promise.all([
      readFile(new URL('../../src/pages/Session.tsx', import.meta.url), 'utf8'),
      readFile(new URL('../../src/hooks/useSessionMap.ts', import.meta.url), 'utf8'),
      readFile(new URL('../../src/hooks/useSessionMapSelection.ts', import.meta.url), 'utf8'),
      readFile(new URL('../../src/components/session/SessionMapObjectSheet.tsx', import.meta.url), 'utf8'),
    ]);

    expect(session).toContain('sessionMapSelection && <SessionMapObjectSheet');
    expect(session).toContain('onOpenFullRecord={openWorkspaceMapObject}');
    expect(session).not.toContain('function openWorkspaceMapMarker');
    expect(mapHook).toContain('useSessionMapSelection({');
    expect(selectionHook).toContain("map.on('click', onClick)");
    expect(selectionHook).toContain('map.queryRenderedFeatures(sessionMapTapBox(point), { layers })');
    expect(sheet).toContain('Open full record');
    expect(sheet).toContain('Open permission observations');
    expect(sheet).toContain('Open in Field Guide');
    expect(sheet).toContain('Open session record');
  });

  it('keeps the inspection surface readable and free of new network or persistence work', async () => {
    const [selectionHook, sheet] = await Promise.all([
      readFile(new URL('../../src/hooks/useSessionMapSelection.ts', import.meta.url), 'utf8'),
      readFile(new URL('../../src/components/session/SessionMapObjectSheet.tsx', import.meta.url), 'utf8'),
    ]);
    const sources = `${selectionHook}\n${sheet}`;

    expect(sheet).not.toMatch(/\btext-(?:2xs|3xs)\b/);
    expect(sources).not.toContain('fetch(');
    expect(sources).not.toContain('pagePersistence');
    expect(sources).not.toContain('useLiveQuery');
    expect(sources).not.toContain('db.');
  });

  it('leaves the Companion control and handoff wiring separate from map selection', async () => {
    const [session, selectionHook, sheet] = await Promise.all([
      readFile(new URL('../../src/pages/Session.tsx', import.meta.url), 'utf8'),
      readFile(new URL('../../src/hooks/useSessionMapSelection.ts', import.meta.url), 'utf8'),
      readFile(new URL('../../src/components/session/SessionMapObjectSheet.tsx', import.meta.url), 'utf8'),
    ]);
    expect(session).toContain("companionControlHref('start', sessionId)");
    expect(session).toContain("companionControlHref('stop', sessionId)");
    expect(session).toContain('onCompanionStart={() => void launchCompanionStart()}');
    expect(session).toContain('onCompanionStop={() => void launchCompanionStop(false)}');
    expect(`${selectionHook}\n${sheet}`).not.toMatch(/companion|Companion/);
  });
});
