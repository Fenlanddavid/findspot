import { describe, expect, it } from 'vitest';
import {
  resolveSessionMapHits,
  sessionMapTapBox,
  SESSION_MAP_POINT_LAYERS,
  SESSION_MAP_TAP_TOLERANCE_PX,
  SESSION_MAP_TRAIL_LAYERS,
  type SessionMapHit,
} from '../../src/hooks/useSessionMapSelection';

function marker(id: string, kind: 'find' | 'signal' | 'observation' | 'point', distancePx: number): SessionMapHit {
  return { object: { id, kind, lat: 52.2, lon: 0.12 }, distancePx };
}

function trail(id: string, distancePx: number): SessionMapHit {
  return { object: { id, kind: 'trail', sessionId: `session-${id}` }, distancePx };
}

describe('active-session map selection', () => {
  it('uses the exact twelve-pixel CSS query box', () => {
    expect(SESSION_MAP_TAP_TOLERANCE_PX).toBe(12);
    expect(sessionMapTapBox({ x: 100, y: 80 })).toEqual([[88, 68], [112, 92]]);
    expect(SESSION_MAP_POINT_LAYERS).toEqual(['session-markers', 'field-finds']);
    expect(SESSION_MAP_TRAIL_LAYERS).toEqual(['tracks-line', 'field-tracks-line']);
  });

  it('deduplicates split/rendered features and retains the nearest hit per kind', () => {
    expect(resolveSessionMapHits([
      marker('find-far', 'find', 10),
      marker('find-near', 'find', 3),
      marker('find-near', 'find', 7),
    ])).toEqual({ mode: 'object', object: { id: 'find-near', kind: 'find', lat: 52.2, lon: 0.12 } });
  });

  it('offers different point kinds in explicit precedence order', () => {
    expect(resolveSessionMapHits([
      marker('point-1', 'point', 1),
      marker('observation-1', 'observation', 2),
      marker('signal-1', 'signal', 3),
      marker('find-1', 'find', 4),
    ])).toEqual({
      mode: 'choices',
      objects: [
        { id: 'find-1', kind: 'find', lat: 52.2, lon: 0.12 },
        { id: 'signal-1', kind: 'signal', lat: 52.2, lon: 0.12 },
        { id: 'observation-1', kind: 'observation', lat: 52.2, lon: 0.12 },
        { id: 'point-1', kind: 'point', lat: 52.2, lon: 0.12 },
      ],
    });
  });

  it('suppresses every trail whenever a point-like object is in range', () => {
    expect(resolveSessionMapHits([
      trail('near-trail', 0),
      trail('other-trail', 1),
      marker('point-1', 'point', 11),
    ])).toEqual({ mode: 'object', object: { id: 'point-1', kind: 'point', lat: 52.2, lon: 0.12 } });
  });

  it('deduplicates trail segments and chooses the nearest trail', () => {
    expect(resolveSessionMapHits([
      trail('trail-far', 8),
      trail('trail-near', 2),
      trail('trail-near', 5),
    ])).toEqual({ mode: 'object', object: { id: 'trail-near', kind: 'trail', sessionId: 'session-trail-near' } });
  });

  it('returns no selection when nothing addressable was hit', () => {
    expect(resolveSessionMapHits([])).toBeNull();
  });
});
