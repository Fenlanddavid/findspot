import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { HISTORIC_LAYER_GROUPS, HISTORIC_LAYER_OPTIONS } from '../../src/components/fieldGuide/FieldGuideContext';

async function source(path: string) {
  return readFile(new URL(path, import.meta.url), 'utf8');
}

describe('session and navigation safety ratchets', () => {
  it('keeps the sole active-session Finish action behind confirmation', async () => {
    const [session, workspace] = await Promise.all([
      source('../../src/pages/Session.tsx'),
      source('../../src/components/session/ActiveSessionWorkspace.tsx'),
    ]);
    expect(session).not.toContain('onClick={finishSession}');
    expect(session).toContain('onFinish={requestFinishSession}');
    expect(workspace).toContain('onClick={props.onFinish}');
    expect(workspace).not.toContain('Open classic session');
  });

  it('keeps Home quick actions stable and exposes the remainder explicitly', async () => {
    const home = await source('../../src/pages/Home.tsx');
    expect(home).not.toContain('fs_used_actions');
    expect(home).toContain('showMoreActions');
    expect(home).toContain("showMoreActions ? 'Less' : `More (${adaptiveActions.length - 2})`");
  });

  it('distinguishes a paused trail from one that has never started', async () => {
    const [workspace, guideContext, session] = await Promise.all([
      source('../../src/components/session/ActiveSessionWorkspace.tsx'),
      source('../../src/hooks/useActiveSessionGuideContext.ts'),
      source('../../src/pages/Session.tsx'),
    ]);
    expect(workspace).toContain("detail: 'Trail paused'");
    expect(workspace).toContain("detail: 'Trail not started'");
    expect(guideContext).toContain('hasRecordedTrail: (recordedTrailCount ?? 0) > 0');
    expect(session).toContain('hasRecordedTrail={!!tracks?.some');
  });

  it('groups every historic layer once without changing the option set', () => {
    expect(HISTORIC_LAYER_GROUPS.map(group => group.label)).toEqual([
      'Heritage Records',
      'Routes & Movement',
      'Your Records',
    ]);
    const keys = HISTORIC_LAYER_OPTIONS.map(option => option.key);
    expect(keys).toHaveLength(9);
    expect(new Set(keys).size).toBe(9);
    expect(keys).toEqual([
      'context', 'monuments', 'aim', 'pasDensity',
      'routes', 'romanStandalone', 'corridors', 'crossings',
      'userFinds',
    ]);
  });

  it('keeps optional features visible rather than burying them in data attribution', async () => {
    const settings = await source('../../src/pages/Settings.tsx');
    const appearance = settings.indexOf('Appearance\n');
    const features = settings.indexOf('>Features</h2>');
    const geology = settings.indexOf('>BGS Geology Context</div>');
    const externalData = settings.indexOf('>External Data Sources</h2>');
    expect(appearance).toBeGreaterThan(-1);
    expect(features).toBeGreaterThan(appearance);
    expect(geology).toBeGreaterThan(features);
    expect(externalData).toBeGreaterThan(geology);
  });
});
