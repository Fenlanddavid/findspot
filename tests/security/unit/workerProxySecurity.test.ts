import { afterEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error The BGS deployment intentionally remains a plain-JavaScript Worker.
import bgsWorker from '../../../workers/bgs-proxy/index.js';

const ORIGIN = 'https://fenlanddavid.github.io';
const ENV = { ALLOWED_ORIGINS: ORIGIN };
const context = () => ({ waitUntil: vi.fn() });

function request(query: string, init?: RequestInit): Request {
  return new Request(`https://proxy.example/?${query}`, {
    ...init,
    headers: { Origin: ORIGIN, ...init?.headers },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('BGS proxy request and SSRF policy', () => {
  it.each([
    'service=WFS&request=GetCapabilities',
    'service=WMS&request=GetMap',
    'service=WMS&request=GetCapabilities&version=9.9.9',
    'service=WMS&request=GetCapabilities&url=https://attacker.example',
    'service=WMS&SERVICE=WMS&request=GetCapabilities',
    'service=WMS&request=GetFeatureInfo&layers=bad&query_layers=bad&bbox=52,-1,53,0&width=101&height=101&i=50&j=50',
    'service=WMS&request=GetFeatureInfo&layers=GBR_BGS_625k_BLT&query_layers=GBR_BGS_625k_SLT&bbox=52,-1,53,0&width=101&height=101&i=50&j=50',
    'service=WMS&request=GetFeatureInfo&layers=GBR_BGS_625k_BLT&query_layers=GBR_BGS_625k_BLT&bbox=0,0,90,180&width=101&height=101&i=50&j=50',
    'service=WMS&request=GetFeatureInfo&layers=GBR_BGS_625k_BLT&query_layers=GBR_BGS_625k_BLT&bbox=52,-1,53,0&width=0&height=101&i=0&j=50',
    'service=WMS&request=GetFeatureInfo&layers=GBR_BGS_625k_BLT&query_layers=GBR_BGS_625k_BLT&bbox=52,-1,53,0&width=10&height=10&i=10&j=5',
    'service=WMS&request=GetFeatureInfo&layers=GBR_BGS_625k_BLT&query_layers=GBR_BGS_625k_BLT&bbox=52,-1,53,0&width=10&height=10&i=5&j=5&info_format=text/html',
  ])('rejects unsupported query %s before upstream access', async query => {
    const upstream = vi.fn();
    vi.stubGlobal('fetch', upstream);
    const response = await bgsWorker.fetch(request(query), ENV, context());
    expect(response.status).toBe(400);
    expect(upstream).not.toHaveBeenCalled();
  });

  it('uses only the fixed BGS upstream for an allowed request', async () => {
    vi.stubGlobal('caches', { default: { match: vi.fn(async () => undefined), put: vi.fn(async () => undefined) } });
    const upstream = vi.fn(async () => new Response('<xml/>', { headers: { 'content-type': 'text/xml' } }));
    vi.stubGlobal('fetch', upstream);
    const response = await bgsWorker.fetch(request('service=WMS&request=GetCapabilities&version=1.3.0'), ENV, context());
    expect(response.status).toBe(200);
    expect(new URL(upstream.mock.calls[0][0] as string).origin).toBe('https://ogc.bgs.ac.uk');
  });
});
