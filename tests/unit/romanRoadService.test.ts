import { beforeAll, describe, expect, it, vi } from 'vitest';
import { HISTORIC_CONTEXT_RADIUS_KM } from '../../src/outstandingQuestions/contextRadius';

const mocks = vi.hoisted(() => ({ cachedFetchAny: vi.fn() }));

vi.mock('../../src/utils/cachedFetch', () => ({
  cachedFetchAny: mocks.cachedFetchAny,
}));

describe('Roman road context fetch', () => {
  beforeAll(() => {
    vi.stubGlobal('window', { location: { origin: 'https://example.test' } });
    mocks.cachedFetchAny.mockResolvedValue(new Response(JSON.stringify({
      features: [
        {
          type: 'Feature',
          properties: {
            source: 'rrra', name: 'Long road', reference: '2a', confidenceClass: 'A',
          },
          geometry: {
            type: 'LineString',
            // Neither stored vertex is inside the padded query bounds, but the
            // segment and its bbox cross them.
            coordinates: [[-0.05, 52], [0.05, 52]],
          },
        },
        {
          type: 'Feature',
          properties: {
            source: 'rrra', name: 'Padding road', reference: null, confidenceClass: 'A',
          },
          geometry: {
            type: 'LineString',
            coordinates: [[0, 52.022], [0.001, 52.022]],
          },
        },
        {
          type: 'Feature',
          properties: {
            source: 'rrra', name: 'Outside road', reference: null, confidenceClass: 'A',
          },
          geometry: {
            type: 'LineString',
            coordinates: [[0, 52.024], [0.001, 52.024]],
          },
        },
        {
          type: 'Feature',
          properties: {
            source: 'rrra', name: 'Split road', reference: null, confidenceClass: 'A',
          },
          geometry: {
            type: 'MultiLineString',
            coordinates: [
              [[-0.002, 51.999], [0.002, 52.001]],
              [[-0.003, 52.002], [0.003, 52.003]],
            ],
          },
        },
        {
          type: 'Feature',
          properties: {
            source: 'rrra', name: 'Distant road', reference: null, confidenceClass: 'A',
          },
          geometry: {
            type: 'LineString',
            coordinates: [[0.999, 52], [1.001, 52]],
          },
        },
      ],
    }), { status: 200 }));
  });

  it('characterizes output shape, scoring and MultiLineString splitting', async () => {
    const { fetchRomanRoads } = await import('../../src/services/romanRoadService');
    const routes = await fetchRomanRoads(-0.005, 51.995, 0.005, 52.005);

    expect(routes.map(({ id: _id, ...route }) => route)).toEqual([
      {
        type: 'roman_road',
        source: 'rrra',
        name: 'Long road',
        reference: '2a',
        confidenceClass: 'A',
        certaintyScore: 90,
        geometry: [[-0.05, 52], [0.05, 52]],
        bbox: [[-0.05, 52], [0.05, 52]],
        period: 'roman',
      },
      {
        type: 'roman_road',
        source: 'rrra',
        name: 'Padding road',
        reference: undefined,
        confidenceClass: 'A',
        certaintyScore: 90,
        geometry: [[0, 52.022], [0.001, 52.022]],
        bbox: [[0, 52.022], [0.001, 52.022]],
        period: 'roman',
      },
      {
        type: 'roman_road',
        source: 'rrra',
        name: 'Split road',
        reference: undefined,
        confidenceClass: 'A',
        certaintyScore: 90,
        geometry: [[-0.002, 51.999], [0.002, 52.001]],
        bbox: [[-0.002, 51.999], [0.002, 52.001]],
        period: 'roman',
      },
      {
        type: 'roman_road',
        source: 'rrra',
        name: 'Split road',
        reference: undefined,
        confidenceClass: 'A',
        certaintyScore: 90,
        geometry: [[-0.003, 52.002], [0.003, 52.003]],
        bbox: [[-0.003, 52.002], [0.003, 52.003]],
        period: 'roman',
      },
    ]);
  });

  it('characterizes shared historic-context bbox padding', async () => {
    const { fetchRomanRoads } = await import('../../src/services/romanRoadService');
    const routes = await fetchRomanRoads(-0.005, 51.995, 0.005, 52.005);
    const names = routes.map(route => route.name);

    expect(HISTORIC_CONTEXT_RADIUS_KM).toBe(2);
    expect(names).toContain('Padding road');
    expect(names).not.toContain('Outside road');
  });

  it('keeps a long segment whose bbox crosses the context area', async () => {
    const { fetchRomanRoads } = await import('../../src/services/romanRoadService');
    const routes = await fetchRomanRoads(-0.005, 51.995, 0.005, 52.005);

    expect(routes).toContainEqual(expect.objectContaining({
      type: 'roman_road',
      source: 'rrra',
      name: 'Long road',
      confidenceClass: 'A',
      certaintyScore: 90,
    }));
  });

  it('keeps the same physical segment ID across different bbox queries', async () => {
    const { fetchRomanRoads } = await import('../../src/services/romanRoadService');
    const wideRoutes = await fetchRomanRoads(-0.1, 51.99, 1.1, 52.01);
    const narrowRoutes = await fetchRomanRoads(0.995, 51.995, 1.005, 52.005);
    const wideDistant = wideRoutes.find(route => route.name === 'Distant road');
    const narrowDistant = narrowRoutes.find(route => route.name === 'Distant road');

    expect(wideDistant).toBeDefined();
    expect(narrowDistant).toBeDefined();
    expect(narrowDistant?.id).toBe(wideDistant?.id);
  });
});
