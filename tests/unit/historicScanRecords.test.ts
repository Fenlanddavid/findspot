import { describe, expect, it } from 'vitest';
import {
  buildAimFeatures,
  buildNhleHistoricFinds,
  buildOsmHistoricFinds,
  buildPlaceSignals,
  extractMonumentPoints,
  mergeHistoricFinds,
} from '../../src/services/fieldguide/historicScanRecords';
import type {
  AIMResponse,
  NHLEResponse,
  OverpassResponse,
} from '../../src/services/historicScanService';

describe('historic scan record transformations', () => {
  it('builds sorted place-name signals without duplicating reverse-geocoded names', () => {
    const context: OverpassResponse = {
      elements: [{
        id: 1,
        type: 'node',
        lat: 52,
        lon: 0.1,
        tags: { name: 'Chesterford', place: 'village' },
      }],
    };

    const { placeSignals: signals, overpassSignalCount } = buildPlaceSignals(
      context,
      { address: { village: 'Chesterford', parish: 'Ashdon' } },
      { lat: 52, lng: 0.1 },
    );

    expect(overpassSignalCount).toBeGreaterThan(0);
    expect(signals[0]).toMatchObject({
      name: 'Chesterford',
      meaning: 'Roman fort',
      confidence: 0.95,
      type: 'village',
    });
    expect(signals.filter(signal => (
      signal.name === 'Chesterford' && signal.meaning === 'Roman fort'
    ))).toHaveLength(1);
    expect(signals.map(signal => signal.confidence)).toEqual(
      [...signals].map(signal => signal.confidence).sort((a, b) => b - a),
    );
  });

  it('keeps only nearby heritage elements and infers their periods', () => {
    const context: OverpassResponse = {
      elements: [
        {
          id: 1,
          type: 'node',
          lat: 52,
          lon: 0.1,
          tags: { name: 'Camp', historic: 'fort' },
        },
        {
          id: 2,
          type: 'node',
          lat: 52.1,
          lon: 0.1,
          tags: { historic: 'castle' },
        },
        {
          id: 3,
          type: 'node',
          lat: 52,
          lon: 0.1,
          tags: { amenity: 'cafe' },
        },
      ],
    };

    expect(buildOsmHistoricFinds(context, { lat: 52, lng: 0.1 })).toEqual([
      expect.objectContaining({
        id: 'OSM-1',
        objectType: 'Camp (fort)',
        broadperiod: 'Roman',
      }),
    ]);
  });

  it('extracts monument points, builds finds and deduplicates nearby OSM sites', () => {
    const nhle: NHLEResponse = {
      features: [
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [0.1, 52] },
          properties: { Name: 'Roman villa', ListEntry: '1001' },
        },
        {
          type: 'Feature',
          geometry: {
            type: 'Polygon',
            coordinates: [[[0.2, 52.1], [0.21, 52.1], [0.2, 52.1]]],
          },
          properties: { Name: 'Round barrow', ListEntry: '1002' },
        },
      ],
    };
    const nhleFinds = buildNhleHistoricFinds(nhle);
    const osmFind = {
      id: 'OSM-9',
      internalId: '9',
      objectType: 'Roman villa',
      broadperiod: 'Roman',
      county: 'Local Area',
      workflow: 'PAS' as const,
      lat: 52.0001,
      lon: 0.1001,
    };

    expect(extractMonumentPoints(nhle)).toEqual([[0.1, 52], [0.2, 52.1]]);
    expect(nhleFinds).toHaveLength(2);
    expect(mergeHistoricFinds([osmFind], nhleFinds).map(find => find.id)).toEqual([
      'NHLE-1002',
      'OSM-9',
    ]);
  });

  it('uses points and polygon centroids for AIM enrichment', () => {
    const aim: AIMResponse = {
      features: [
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [0.1, 52] },
          properties: { MONUMENT_TYPE: 'Mound', PERIOD: 'Roman' },
        },
        {
          type: 'Feature',
          geometry: {
            type: 'Polygon',
            coordinates: [[[0, 0], [2, 0], [2, 2], [0, 2]]],
          },
          properties: {},
        },
      ],
    };

    expect(buildAimFeatures(aim)).toEqual([
      { center: [0.1, 52], type: 'Mound', period: 'Roman' },
      { center: [1, 1], type: 'Cropmark', period: '' },
    ]);
  });
});
