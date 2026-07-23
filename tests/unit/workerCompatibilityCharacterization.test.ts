import { afterEach, describe, expect, it, vi } from 'vitest';
import { CACHE_POLICIES } from '../../src/shared/cachePolicy';
// @ts-expect-error The deliberately plain-JavaScript Workers are runtime-tested here.
import bgsWorker from '../../workers/bgs-proxy/index.js';
// @ts-expect-error The deliberately plain-JavaScript Workers are runtime-tested here.
import walesLidarWorker from '../../workers/wales-lidar/index.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('BGS proxy compatibility characterization', () => {
  it('preserves validation, edge caching, CORS, and the registered TTL', async () => {
    const cachePut = vi.fn(async () => {});
    vi.stubGlobal('caches', {
      default: {
        match: vi.fn(async () => undefined),
        put: cachePut,
      },
    });
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<xml/>', {
      status: 200,
      headers: { 'Content-Type': 'text/xml' },
    })));
    const waitUntil = vi.fn();

    const response = await bgsWorker.fetch(
      new Request('https://bgs.test/?service=WMS&request=GetCapabilities&version=1.3.0'),
      {},
      { waitUntil },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(response.headers.get('cache-control')).toBe(
      `public, max-age=${CACHE_POLICIES.bgsEdge.expiry.durationMs / 1_000}`,
    );
    expect(waitUntil).toHaveBeenCalledTimes(1);
    expect(cachePut).toHaveBeenCalledTimes(1);
  });

  it('continues to reject non-allowlisted WMS requests before fetching', async () => {
    const upstream = vi.fn();
    vi.stubGlobal('fetch', upstream);

    const response = await bgsWorker.fetch(
      new Request('https://bgs.test/?service=WFS&request=GetCapabilities'),
      {},
      { waitUntil: vi.fn() },
    );

    expect(response.status).toBe(400);
    expect(upstream).not.toHaveBeenCalled();
  });
});

describe('Wales LiDAR compatibility characterization', () => {
  it('forwards a byte range and returns the existing partial-content contract', async () => {
    const get = vi.fn(async (_key: string, options: {
      range?: { offset: number; length: number };
    }) => ({
      body: new Blob(['0123456789']).stream(),
      size: 100,
      range: options.range,
      writeHttpMetadata(headers: Headers) {
        headers.set('etag', '"fixture"');
      },
    }));

    const response = await walesLidarWorker.fetch(
      new Request('https://lidar.test/wales_hillshade_3857.tif', {
        headers: { Range: 'bytes=10-19' },
      }),
      { WALES_LIDAR_BUCKET: { get } },
    );

    expect(get).toHaveBeenCalledWith('wales_hillshade_3857.tif', {
      range: { offset: 10, length: 10 },
    });
    expect(response.status).toBe(206);
    expect(response.headers.get('content-range')).toBe('bytes 10-19/100');
    expect(response.headers.get('content-length')).toBe('10');
    expect(response.headers.get('content-type')).toBe('image/tiff');
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('preserves method and object-key allowlists', async () => {
    const bucket = { get: vi.fn() };
    const [method, key] = await Promise.all([
      walesLidarWorker.fetch(
        new Request('https://lidar.test/wales_hillshade_3857.tif', { method: 'POST' }),
        { WALES_LIDAR_BUCKET: bucket },
      ),
      walesLidarWorker.fetch(
        new Request('https://lidar.test/private.tif'),
        { WALES_LIDAR_BUCKET: bucket },
      ),
    ]);

    expect(method.status).toBe(405);
    expect(key.status).toBe(404);
    expect(bucket.get).not.toHaveBeenCalled();
  });
});
