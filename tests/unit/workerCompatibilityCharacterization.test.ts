import { afterEach, describe, expect, it, vi } from 'vitest';
import { CACHE_POLICIES } from '../../src/shared/cachePolicy';
// @ts-expect-error The deliberately plain-JavaScript Workers are runtime-tested here.
import bgsWorker from '../../workers/bgs-proxy/index.js';
// @ts-expect-error The deliberately plain-JavaScript Workers are runtime-tested here.
import walesLidarWorker from '../../workers/wales-lidar/index.js';

const BGS_ORIGIN = 'https://fenlanddavid.github.io';
const BGS_ENV = { ALLOWED_ORIGINS: BGS_ORIGIN };

function bgsRequest(url: string, origin = BGS_ORIGIN): Request {
  return new Request(url, { headers: { Origin: origin } });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('BGS proxy compatibility characterization', () => {
  it('preserves validation, edge caching, CORS, and the registered TTL', async () => {
    const cachePut = vi.fn(async (_key: Request, _response: Response) => {});
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
      bgsRequest('https://bgs.test/?service=WMS&request=GetCapabilities&version=1.3.0'),
      BGS_ENV,
      { waitUntil },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBe(BGS_ORIGIN);
    expect(response.headers.get('vary')).toBe('Origin');
    expect(response.headers.get('cache-control')).toBe(
      `public, max-age=${CACHE_POLICIES.bgsEdge.expiry.durationMs / 1_000}`,
    );
    expect(waitUntil).toHaveBeenCalledTimes(1);
    expect(cachePut).toHaveBeenCalledTimes(1);
    const cachedResponse = cachePut.mock.calls[0][1] as Response;
    expect(cachedResponse.headers.has('access-control-allow-origin')).toBe(false);
  });

  it('continues to reject non-allowlisted WMS requests before fetching', async () => {
    const upstream = vi.fn();
    vi.stubGlobal('fetch', upstream);

    const response = await bgsWorker.fetch(
      bgsRequest('https://bgs.test/?service=WFS&request=GetCapabilities'),
      BGS_ENV,
      { waitUntil: vi.fn() },
    );

    expect(response.status).toBe(400);
    expect(upstream).not.toHaveBeenCalled();
  });

  it('rejects missing and non-allowlisted origins before cache or upstream work', async () => {
    const cacheMatch = vi.fn();
    const upstream = vi.fn();
    vi.stubGlobal('caches', { default: { match: cacheMatch } });
    vi.stubGlobal('fetch', upstream);

    const [missing, denied] = await Promise.all([
      bgsWorker.fetch(
        new Request('https://bgs.test/?service=WMS&request=GetCapabilities'),
        BGS_ENV,
        { waitUntil: vi.fn() },
      ),
      bgsWorker.fetch(
        bgsRequest(
          'https://bgs.test/?service=WMS&request=GetCapabilities',
          'https://example.test',
        ),
        BGS_ENV,
        { waitUntil: vi.fn() },
      ),
    ]);

    expect(missing.status).toBe(403);
    expect(denied.status).toBe(403);
    expect(denied.headers.has('access-control-allow-origin')).toBe(false);
    expect(cacheMatch).not.toHaveBeenCalled();
    expect(upstream).not.toHaveBeenCalled();
  });

  it('echoes an allowed development origin for preflight and cached responses', async () => {
    const developmentOrigin = 'http://127.0.0.1:5174';
    vi.stubGlobal('caches', {
      default: {
        match: vi.fn(async () => new Response('<cached/>', {
          headers: { 'Access-Control-Allow-Origin': '*' },
        })),
      },
    });

    const preflight = await bgsWorker.fetch(
      new Request('https://bgs.test/', {
        method: 'OPTIONS',
        headers: { Origin: developmentOrigin },
      }),
      { ALLOWED_ORIGINS: `${BGS_ORIGIN},${developmentOrigin}` },
      { waitUntil: vi.fn() },
    );
    const cached = await bgsWorker.fetch(
      bgsRequest(
        'https://bgs.test/?service=WMS&request=GetCapabilities',
        developmentOrigin,
      ),
      { ALLOWED_ORIGINS: `${BGS_ORIGIN},${developmentOrigin}` },
      { waitUntil: vi.fn() },
    );

    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-origin')).toBe(developmentOrigin);
    expect(cached.headers.get('access-control-allow-origin')).toBe(developmentOrigin);
    expect(cached.headers.get('vary')).toBe('Origin');
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

  it('returns suffix ranges from the end of the object', async () => {
    const get = vi.fn(async (_key: string, options: {
      range?: { suffix: number };
    }) => ({
      body: new Blob(['0123456789']).stream(),
      size: 100,
      range: options.range,
      writeHttpMetadata() {},
    }));

    const response = await walesLidarWorker.fetch(
      new Request('https://lidar.test/wales_hillshade_3857.tif', {
        headers: { Range: 'bytes=-10' },
      }),
      { WALES_LIDAR_BUCKET: { get } },
    );

    expect(get).toHaveBeenCalledWith('wales_hillshade_3857.tif', {
      range: { suffix: 10 },
    });
    expect(response.status).toBe(206);
    expect(response.headers.get('content-range')).toBe('bytes 90-99/100');
    expect(response.headers.get('content-length')).toBe('10');
  });

  it('clamps an oversized suffix range to the full object', async () => {
    const get = vi.fn(async (_key: string, options: {
      range?: { suffix: number };
    }) => ({
      body: new Blob(['01234']).stream(),
      size: 5,
      range: options.range,
      writeHttpMetadata() {},
    }));

    const response = await walesLidarWorker.fetch(
      new Request('https://lidar.test/wales_hillshade_3857.tif', {
        headers: { Range: 'bytes=-10' },
      }),
      { WALES_LIDAR_BUCKET: { get } },
    );

    expect(response.status).toBe(206);
    expect(response.headers.get('content-range')).toBe('bytes 0-4/5');
    expect(response.headers.get('content-length')).toBe('5');
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
