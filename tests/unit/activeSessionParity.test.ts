import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

async function source(path: string) {
  return readFile(new URL(path, import.meta.url), 'utf8');
}

describe('active session Classic-to-V5 parity', () => {
  it('keeps every active Classic recording action represented in V5', async () => {
    const [workspace, session, layerPicker] = await Promise.all([
      source('../../src/components/session/ActiveSessionWorkspace.tsx'),
      source('../../src/pages/Session.tsx'),
      source('../../src/components/session/SessionMapLayerPicker.tsx'),
    ]);

    const activeShell = `${workspace}\n${session}\n${layerPicker}`;
    for (const label of [
      'Open permission',
      'Add Find to Session',
      'Un-dug Signal',
      'Record significant find',
      'Surface observation',
      'Mark location',
      'Field notes',
      'Stubble',
      'Ploughed',
      'Pasture',
      'Show gaps',
      'Start in FindSpot',
      'Stop FindSpot trail',
      'Low distraction',
      'Use Companion beta',
      'Stop Companion',
      'Stop &amp; finish',
      'Import a Companion trail',
      'Quick session note',
      'Review and finish',
      'Session finds',
    ]) expect(activeShell).toContain(label);

    expect(session).toContain('recordSurfaceAction={<RecordSurfaceFindButton');
    expect(session).toContain('onToggleStubble={() => void quickSetStubble(!isStubble)}');
    expect(session).toContain("onToggleLandUse={condition => void quickSetLandUse(landUse === condition ? '' : condition)}");
    expect(workspace).not.toContain('Show coverage gaps on map');
    expect(session).toContain('toggle: () => setShowCoverage(current => !current)');
    expect(session).toContain('onFieldNotes={() => setShowFieldNotes(true)}');
    expect(session).toContain('findActivity={workspaceFindActivity}');
  });

  it('preserves the deliberate automatic-location replacement for the removed GPS button', async () => {
    const [workspace, session] = await Promise.all([
      source('../../src/components/session/ActiveSessionWorkspace.tsx'),
      source('../../src/pages/Session.tsx'),
    ]);
    expect(workspace).not.toContain('GPS location');
    expect(session).toContain("workspaceTab !== 'map'");
    expect(session).toContain('navigator.geolocation.watchPosition');
    expect(session).toContain('setWorkspaceGpsLocation({');
  });

  it('keeps all destructive finish entry points on the authoritative confirmation path', async () => {
    const session = await source('../../src/pages/Session.tsx');
    expect(session).not.toContain('onClick={finishSession}');
    expect(session).toContain('onFinish={requestFinishSession}');
    expect(session).toContain('void requestFinishSession()');
    expect(session).toContain("title: 'Finish this visit?'");
  });

  it('retires the Classic escape and obsolete workspace preference', async () => {
    const [workspace, session, settings, storage, onboarding] = await Promise.all([
      source('../../src/components/session/ActiveSessionWorkspace.tsx'),
      source('../../src/pages/Session.tsx'),
      source('../../src/pages/Settings.tsx'),
      source('../../src/services/clientStorage.ts'),
      source('../../src/components/OnboardingFlow.tsx'),
    ]);
    const currentApp = `${workspace}\n${session}\n${settings}`;
    expect(currentApp).not.toContain('Open classic session');
    expect(currentApp).not.toContain('fs_v5_active_session_preview');
    expect(currentApp).not.toContain('Use detecting workspace');
    expect(storage).toContain("db.settings.delete('fs_v5_active_session_preview')");
    expect(onboarding).toContain('Map, Record, Session and Guide workspace');
  });
});
