import { beforeAll, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ cachedFetchAny: vi.fn() }));

vi.mock('../../src/utils/cachedFetch', () => ({
  cachedFetchAny: mocks.cachedFetchAny,
}));

describe('Roman road context fetch', () => {
  beforeAll(() => {
    vi.stubGlobal('window', { location: { origin: 'https://example.test' } });
    mocks.cachedFetchAny.mockResolvedValue(new Response(JSON.stringify({
      features: [{
        type: 'Feature',
        properties: {
          Segment_s: 'crossing', Name: 'Long road', Type: 'road', confidenceClass: 'A',
        },
        geometry: {
          type: 'LineString',
          // Neither stored vertex is inside the padded query bounds, but the
          // segment and its bbox cross them.
          coordinates: [[-0.05, 52], [0.05, 52]],
        },
      }],
    }), { status: 200 }));
  });

  it('keeps a long segment whose bbox crosses the 2km context area', async () => {
    const { fetchRomanRoads } = await import('../../src/services/romanRoadService');
    const routes = await fetchRomanRoads(-0.005, 51.995, 0.005, 52.005);

    expect(routes).toHaveLength(1);
    expect(routes[0]).toMatchObject({ type: 'roman_road', name: 'Long road' });
  });
});
