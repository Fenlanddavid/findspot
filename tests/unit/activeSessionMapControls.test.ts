import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('active session map controls', () => {
  it('shows GPS as map data without location or boundary shortcut buttons', async () => {
    const [workspace, session, mapHook, viewport, sessionData, layerPicker] = await Promise.all([
      readFile(new URL('../../src/components/session/ActiveSessionWorkspace.tsx', import.meta.url), 'utf8'),
      readFile(new URL('../../src/pages/Session.tsx', import.meta.url), 'utf8'),
      readFile(new URL('../../src/hooks/useSessionMap.ts', import.meta.url), 'utf8'),
      readFile(new URL('../../src/services/session/sessionMapViewport.ts', import.meta.url), 'utf8'),
      readFile(new URL('../../src/hooks/useSessionData.ts', import.meta.url), 'utf8'),
      readFile(new URL('../../src/components/session/SessionMapLayerPicker.tsx', import.meta.url), 'utf8'),
    ]);

    expect(workspace).not.toContain('Follow my location');
    expect(workspace).not.toContain('Get my location');
    expect(workspace).not.toContain('Fit recorded boundary');
    expect(workspace).not.toContain('onRecenterMap');
    expect(workspace).not.toContain('onFitPermission');
    expect(layerPicker).toContain('Field history');
    expect(layerPicker).toContain('Field trails');
    expect(layerPicker).toContain('Past finds');
    expect(layerPicker).toContain('type="range"');
    expect(layerPicker).toContain('writingMode: \'vertical-rl\'');
    expect(layerPicker).toContain('control.setOverlayOpacity');

    expect(session).toContain("workspaceTab !== 'map'");
    expect(session).toContain('navigator.geolocation.watchPosition(');
    expect(session).toContain('navigator.geolocation.clearWatch(watchId)');
    expect(session).toContain('isTracking || isCompanionTracking');

    expect(mapHook).toContain("map.addSource('session-location'");
    expect(mapHook).toContain("map.addSource('field-tracks'");
    expect(mapHook).toContain("map.addSource('field-finds'");
    expect(mapHook).toContain("filter(track => !currentTrackIds.has(track.id))");
    expect(mapHook).toContain("'visibility', showFieldTrails ? 'visible' : 'none'");
    expect(mapHook).toContain('initialSessionMapCoordinates({ boundary, tracks, center, liveLocation, markers })');
    expect(mapHook).toContain('if (!boundaryReady ||');
    expect(sessionData).toContain("db.sessions.where('fieldId').equals(fieldId)");
    expect(sessionData).toContain("db.finds.where('fieldId').equals(fieldId)");
    expect(session).toContain('fieldId ? fieldTracks : tracks');
    expect(mapHook).toContain("map.addLayer({ id: 'session-location', type: 'circle'");
    expect(mapHook).toContain('!markers?.length && !liveLocation');
    expect(viewport).toContain('[input.liveLocation.lon, input.liveLocation.lat]');
  });
});
