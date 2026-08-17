import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('active session map controls', () => {
  it('shows GPS as map data without location or boundary shortcut buttons', async () => {
    const [workspace, session, mapHook] = await Promise.all([
      readFile(new URL('../../src/components/session/ActiveSessionWorkspace.tsx', import.meta.url), 'utf8'),
      readFile(new URL('../../src/pages/Session.tsx', import.meta.url), 'utf8'),
      readFile(new URL('../../src/hooks/useSessionMap.ts', import.meta.url), 'utf8'),
    ]);

    expect(workspace).not.toContain('Follow my location');
    expect(workspace).not.toContain('Get my location');
    expect(workspace).not.toContain('Fit recorded boundary');
    expect(workspace).not.toContain('onRecenterMap');
    expect(workspace).not.toContain('onFitPermission');

    expect(session).toContain("workspaceTab !== 'map'");
    expect(session).toContain('navigator.geolocation.watchPosition(');
    expect(session).toContain('navigator.geolocation.clearWatch(watchId)');
    expect(session).toContain('isTracking || isCompanionTracking');

    expect(mapHook).toContain("map.addSource('session-location'");
    expect(mapHook).toContain("map.addLayer({ id: 'session-location', type: 'circle'");
    expect(mapHook).toContain('!markers?.length && !liveLocation');
    expect(mapHook).toContain('bounds.extend([liveLocation.lon, liveLocation.lat])');
  });
});
