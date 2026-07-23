import { DurableObject } from 'cloudflare:workers';
import { CACHE_POLICIES } from '../../src/shared/cachePolicy';

const UPSTREAM_BASE_URL = 'https://nominatim.openstreetmap.org';
const UPSTREAM_INTERVAL_MS = 1_100;
const EDGE_CACHE_TTL_SECONDS =
  CACHE_POLICIES.geocodeEdge.expiry.durationMs / 1_000;
const ORIGIN_CACHE_TTL_MS = CACHE_POLICIES.geocodeOrigin.expiry.durationMs;
const ORIGIN_CACHE_VERSION = 1;
const APP_URL = 'https://fenlanddavid.github.io/findspot/';
const USER_AGENT = `FindSpot/${ORIGIN_CACHE_VERSION} (${APP_URL})`;

type GeocodeKind = 'search' | 'reverse';

type CoordinatorRequest = {
  cacheKey: string;
  kind: GeocodeKind;
  upstreamUrl: string;
};

type StoredResult = {
  body: string;
  contentType: string;
  cachedAt: number;
};

export class GeocodeCoordinator extends DurableObject<Env> {
  private queue: Promise<void> = Promise.resolve();

  async fetch(request: Request): Promise<Response> {
    if (request.method !== 'POST') return jsonError('Method not allowed', 405);

    let input: CoordinatorRequest;
    try {
      input = await request.json<CoordinatorRequest>();
    } catch {
      return jsonError('Invalid request', 400);
    }

    if (!isCoordinatorRequest(input)) return jsonError('Invalid request', 400);

    let release!: () => void;
    const previous = this.queue;
    this.queue = new Promise<void>((resolve) => { release = resolve; });
    await previous;

    try {
      return await this.fetchSerialised(input);
    } finally {
      release();
    }
  }

  private async fetchSerialised(input: CoordinatorRequest): Promise<Response> {
    const storageKey = `result:${ORIGIN_CACHE_VERSION}:${input.cacheKey}`;
    const stored = await this.ctx.storage.get<StoredResult>(storageKey);
    if (stored && Date.now() - stored.cachedAt <= ORIGIN_CACHE_TTL_MS) {
      return storedResponse(stored, 'origin-cache');
    }
    if (stored) await this.ctx.storage.delete(storageKey);

    const lastUpstreamAt = await this.ctx.storage.get<number>('lastUpstreamAt') ?? 0;
    const delay = Math.max(0, lastUpstreamAt + UPSTREAM_INTERVAL_MS - Date.now());
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));

    // Persist before the fetch. If the instance is evicted mid-request, its
    // replacement still honours the application-wide upstream interval.
    await this.ctx.storage.put('lastUpstreamAt', Date.now());

    const upstream = await fetch(input.upstreamUrl, {
      headers: {
        Accept: 'application/json',
        Referer: APP_URL,
        'User-Agent': USER_AGENT,
      },
    });

    if (!upstream.ok) return jsonError('Upstream geocoder unavailable', 503);
    const body = await upstream.text();
    const contentType = upstream.headers.get('content-type') ?? 'application/json';
    const result: StoredResult = { body, contentType, cachedAt: Date.now() };
    await this.ctx.storage.put(storageKey, result);
    return storedResponse(result, 'upstream');
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const origin = request.headers.get('Origin');
    if (!originAllowed(origin, env.ALLOWED_ORIGINS)) {
      return jsonError('Origin not allowed', 403, origin);
    }

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }
    if (request.method !== 'GET') return jsonError('Method not allowed', 405, origin);

    const normalised = normaliseRequest(new URL(request.url));
    if ('error' in normalised) return jsonError(normalised.error, 400, origin);

    const edgeCache = caches.default;
    const edgeKey = new Request(`https://geocode-cache.findspot/${normalised.cacheKey}`);
    const edgeHit = await edgeCache.match(edgeKey);
    if (edgeHit) return withPublicHeaders(edgeHit, origin, 'edge-cache');

    const coordinator = env.GEOCODE_COORDINATOR.getByName('nominatim-global');
    const coordinated = await coordinator.fetch('https://coordinator.internal/geocode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(normalised),
    });

    if (!coordinated.ok) return withPublicHeaders(coordinated, origin, 'error');

    const cacheable = new Response(coordinated.body, coordinated);
    cacheable.headers.set('Cache-Control', `public, max-age=${EDGE_CACHE_TTL_SECONDS}`);
    ctx.waitUntil(edgeCache.put(edgeKey, cacheable.clone()));
    return withPublicHeaders(cacheable, origin, coordinated.headers.get('X-FindSpot-Cache') ?? 'origin');
  },
} satisfies ExportedHandler<Env>;

function normaliseRequest(url: URL): CoordinatorRequest | { error: string } {
  if (url.pathname === '/search') {
    const query = (url.searchParams.get('q') ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
    if (!query || query.length > 200) return { error: 'Invalid search query' };
    const limit = boundedInteger(url.searchParams.get('limit'), 1, 10, 10);
    const upstream = new URL('/search', UPSTREAM_BASE_URL);
    upstream.search = new URLSearchParams({
      format: 'jsonv2', addressdetails: '1', q: query, limit: String(limit),
    }).toString();
    return {
      kind: 'search',
      cacheKey: `search:${encodeURIComponent(query)}:limit:${limit}`,
      upstreamUrl: upstream.toString(),
    };
  }

  if (url.pathname === '/reverse') {
    const lat = Number(url.searchParams.get('lat'));
    const lon = Number(url.searchParams.get('lon'));
    if (!Number.isFinite(lat) || lat < -90 || lat > 90
      || !Number.isFinite(lon) || lon < -180 || lon > 180) {
      return { error: 'Invalid coordinates' };
    }
    const roundedLat = lat.toFixed(4);
    const roundedLon = lon.toFixed(4);
    const zoom = boundedInteger(url.searchParams.get('zoom'), 3, 18, 18);
    const upstream = new URL('/reverse', UPSTREAM_BASE_URL);
    upstream.search = new URLSearchParams({
      format: 'jsonv2', addressdetails: '1', lat: roundedLat, lon: roundedLon, zoom: String(zoom),
    }).toString();
    return {
      kind: 'reverse',
      cacheKey: `reverse:${roundedLat}:${roundedLon}:zoom:${zoom}`,
      upstreamUrl: upstream.toString(),
    };
  }

  return { error: 'Not found' };
}

function isCoordinatorRequest(value: unknown): value is CoordinatorRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const input = value as Record<string, unknown>;
  if (typeof input.cacheKey !== 'string'
    || (input.kind !== 'search' && input.kind !== 'reverse')
    || typeof input.upstreamUrl !== 'string') return false;
  try {
    return new URL(input.upstreamUrl).origin === UPSTREAM_BASE_URL;
  } catch {
    return false;
  }
}

function boundedInteger(value: string | null, min: number, max: number, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function configuredOrigins(value?: string): Set<string> {
  return new Set((value ?? `${APP_URL},http://localhost:5173,http://127.0.0.1:5173`)
    .split(',')
    .map((entry) => entry.trim().replace(/\/$/, ''))
    .filter(Boolean));
}

function originAllowed(origin: string | null, configured?: string): boolean {
  if (origin === null) return true;
  return configuredOrigins(configured).has(origin.replace(/\/$/, ''));
}

function corsHeaders(origin: string | null): Headers {
  const headers = new Headers({
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Accept, Content-Type',
    Vary: 'Origin',
  });
  if (origin) headers.set('Access-Control-Allow-Origin', origin);
  return headers;
}

function withPublicHeaders(response: Response, origin: string | null, cacheStatus: string): Response {
  const outgoing = new Response(response.body, response);
  corsHeaders(origin).forEach((value, key) => outgoing.headers.set(key, value));
  outgoing.headers.set('Content-Type', 'application/json; charset=utf-8');
  outgoing.headers.set('X-FindSpot-Cache', cacheStatus);
  return outgoing;
}

function storedResponse(result: StoredResult, cacheStatus: string): Response {
  return new Response(result.body, {
    headers: {
      'Content-Type': result.contentType,
      'X-FindSpot-Cache': cacheStatus,
    },
  });
}

function jsonError(message: string, status: number, origin: string | null = null): Response {
  const headers = corsHeaders(origin);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify({ error: message }), { status, headers });
}
