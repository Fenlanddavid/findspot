import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('active session Companion controls', () => {
  it('keeps foreground FindSpot tracking and locked-screen Companion tracking explicit', async () => {
    const workspace = await readFile(
      new URL('../../src/components/session/ActiveSessionWorkspace.tsx', import.meta.url),
      'utf8',
    );

    expect(workspace).toContain('Start in FindSpot');
    expect(workspace).toContain('Keeps the screen awake');
    expect(workspace).toContain('Use Companion beta');
    expect(workspace).toContain('Works with screen locked');
    expect(workspace).toContain('Stop Companion');
    expect(workspace).toContain('Stop &amp; finish');
    expect(workspace).toContain('Import a Companion trail');
    expect(workspace).toContain('Low distraction');
  });

  it('wires shell controls to the existing session-scoped Companion handoff', async () => {
    const session = await readFile(new URL('../../src/pages/Session.tsx', import.meta.url), 'utf8');

    expect(session).toContain("companionControlHref('start', sessionId)");
    expect(session).toContain("companionControlHref('stop', sessionId)");
    expect(session).toContain("companionControlHref('stop', sessionId, true)");
    expect(session).toContain('window.location.assign(finishAfterImport ? companionStopAndFinishHref : companionStopHref)');
    expect(session).toContain('onCompanionStart={() => void launchCompanionStart()}');
    expect(session).toContain('onCompanionStop={() => void launchCompanionStop(false)}');
    expect(session).toContain("action: 'stop'");
    expect(session).toContain('finishAfterImport,');
    expect(session).toContain('await launchCompanionStop(true)');
    expect(session).not.toContain("onCompanionStop={() => setCompanionActiveSessionId('')}");
    expect(session).toContain("setError(\"Confirm that Companion started, or choose 'It didn't start'");
    expect(session).toContain('onImportTrail={() => nav(`/companion-import?session=${sessionId}`)}');
  });
});
