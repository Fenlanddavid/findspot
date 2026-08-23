import { describe, expect, it } from 'vitest';
import type { GeoJSONPolygon } from '../../src/db';
import { initialSessionMapCenter, initialSessionMapCoordinates } from '../../src/services/session/sessionMapViewport';

describe('active session initial map viewport', () => {
  it('uses the marked field boundary even when session and GPS locations are elsewhere', () => {
    const boundary: GeoJSONPolygon = {
      type: 'Polygon',
      coordinates: [[
        [0.1208, 52.2048],
        [0.1228, 52.2048],
        [0.1228, 52.2062],
        [0.1208, 52.2062],
        [0.1208, 52.2048],
      ]],
    };

    expect(initialSessionMapCoordinates({
      boundary,
      center: { lat: 55, lon: -3 },
      liveLocation: { lat: 53.3811, lon: -1.4701 },
      markers: [{ lat: 54, lon: -2 }],
    })).toEqual(boundary.coordinates[0]);
  });

  it('falls back to session content when no boundary was recorded', () => {
    expect(initialSessionMapCoordinates({
      center: { lat: 52.2, lon: 0.12 },
      liveLocation: { lat: 52.21, lon: 0.13 },
    })).toEqual([[0.12, 52.2], [0.13, 52.21]]);
  });

  it('centres the map constructor on the field while the style loads', () => {
    expect(initialSessionMapCenter({
      boundary: {
        type: 'Polygon',
        coordinates: [[
          [0.12, 52.2],
          [0.14, 52.2],
          [0.14, 52.22],
          [0.12, 52.22],
          [0.12, 52.2],
        ]],
      },
    })).toEqual([0.13, 52.21]);
  });
});
