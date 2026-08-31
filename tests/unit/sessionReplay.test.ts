import { describe, expect, it } from 'vitest';
import type { Find, SavedPoint, SurfaceObservation, Track, UndugSignal } from '../../src/db';
import { buildSessionReplay } from '../../src/services/session/sessionReplay';

describe('session replay timeline', () => {
  it('orders timestamped objects and preserves explicit trail gaps', () => {
    const track = {
      id: 'track',
      points: [
        { lat: 51, lon: -1, timestamp: 1_000 },
        { lat: 51.001, lon: -1, timestamp: 2_000 },
        { lat: 51.002, lon: -1, timestamp: 4_000 },
      ],
      gaps: [{ start: 2_500, end: 3_500 }],
    } as Track;
    const replay = buildSessionReplay({
      sessionId: 'session',
      sessionStartedAt: 1_000,
      sessionEndedAt: 5_000,
      tracks: [track],
      finds: [{ id: 'find', lat: 51, lon: -1, foundAt: new Date(3_000).toISOString(), findCode: 'F1' } as Find],
      signals: [{ id: 'signal', lat: 51, lng: -1, createdAt: 2_500 } as UndugSignal],
      observations: [{ id: 'iron', lat: 51, lon: -1, observedAt: new Date(3_500).toISOString(), observationKind: 'iron_patch' } as SurfaceObservation],
      savedPoints: [{ id: 'point', lat: 51, lon: -1, label: 'Gate', note: 'Session session', createdAt: new Date(4_500).toISOString() } as SavedPoint],
    });

    expect(replay.trailSegments.map(segment => segment.length)).toEqual([2, 1]);
    expect(replay.markers.map(marker => marker.kind)).toEqual(['signal', 'find', 'observation', 'saved_point']);
    expect(replay.startedAt).toBe(1_000);
    expect(replay.endedAt).toBe(5_000);
  });

  it('does not borrow saved points from another session', () => {
    const replay = buildSessionReplay({
      sessionId: 'one', sessionStartedAt: 1, tracks: [], finds: [], signals: [], observations: [],
      savedPoints: [{ note: 'Session two', createdAt: new Date(2).toISOString(), lat: 51, lon: -1 } as SavedPoint],
    });
    expect(replay.markers).toHaveLength(0);
  });
});
