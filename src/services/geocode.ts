import { db } from '../db';
import { CACHE_POLICIES } from '../shared/cachePolicy';

export const GEOCODE_PROXY_BASE_URL = (
  import.meta.env.VITE_GEOCODE_BASE_URL
  || 'https://findspot-geocode.trials-uk.workers.dev'
).replace(/\/$/, '');

const CACHE_TTL_MS = CACHE_POLICIES.geocodeBrowser.expiry.durationMs;
const MIN_REQUEST_INTERVAL_MS = 1_000;

export type GeocodeAddress = {
  hamlet?: string;
  village?: string;
  suburb?: string;
  town?: string;
  city?: string;
  parish?: string;
  county?: string;
  state?: string;
  state_district?: string;
};

export type ReverseGeocodeResult = {
  address?: GeocodeAddress;
  display_name?: string;
};

export type GeocodeSearchResult = {
  lat: string;
  lon: string;
  display_name?: string;
};

let requestTail: Promise<void> = Promise.resolve();
let nextRequestAt = 0;

export function normaliseGeocodeQuery(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function normaliseGeocodeCoordinate(value: number): string {
  if (!Number.isFinite(value)) throw new TypeError('Geocode coordinates must be finite');
  return value.toFixed(4);
}

function isAddress(value: unknown): value is GeocodeAddress {
  if (value === undefined) return true;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.values(value).every((part) => typeof part === 'string');
}

function isReverseResult(value: unknown): value is ReverseGeocodeResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const result = value as Record<string, unknown>;
  return isAddress(result.address)
    && (result.display_name === undefined || typeof result.display_name === 'string');
}

function isSearchResult(value: unknown): value is GeocodeSearchResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const result = value as Record<string, unknown>;
  return typeof result.lat === 'string'
    && Number.isFinite(Number(result.lat))
    && typeof result.lon === 'string'
    && Number.isFinite(Number(result.lon))
    && (result.display_name === undefined || typeof result.display_name === 'string');
}

async function readCache<T>(
  cacheKey: string,
  validate: (value: unknown) => value is T,
): Promise<T | null> {
  const record = await db.geocodeCache.get(cacheKey);
  if (!record) return null;
  if (Date.now() - record.fetchedAt <= CACHE_TTL_MS && validate(record.response)) {
    return record.response;
  }
  await db.geocodeCache.delete(cacheKey);
  return null;
}

async function wait(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return;
  await new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      window.clearTimeout(timer);
      reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
    }, { once: true });
  });
}

async function serialisedFetch(url: string, signal?: AbortSignal): Promise<Response> {
  let release!: () => void;
  const previous = requestTail;
  requestTail = new Promise<void>((resolve) => { release = resolve; });

  await previous;
  try {
    signal?.throwIfAborted();
    await wait(Math.max(0, nextRequestAt - Date.now()), signal);
    nextRequestAt = Date.now() + MIN_REQUEST_INTERVAL_MS;
    return await fetch(url, {
      signal,
      headers: { Accept: 'application/json' },
    });
  } finally {
    release();
  }
}

async function fetchAndCache<T>(
  cacheKey: string,
  path: string,
  validate: (value: unknown) => value is T,
  signal?: AbortSignal,
): Promise<T> {
  const cached = await readCache(cacheKey, validate);
  if (cached !== null) return cached;

  const response = await serialisedFetch(`${GEOCODE_PROXY_BASE_URL}${path}`, signal);
  if (!response.ok) throw new Error(`Geocoding unavailable (${response.status})`);
  const value: unknown = await response.json();
  if (!validate(value)) throw new Error('Geocoding service returned an invalid response');

  await db.geocodeCache.put({ cacheKey, response: value, fetchedAt: Date.now() });
  return value;
}

export async function searchLocations(
  query: string,
  options: { limit?: number; signal?: AbortSignal } = {},
): Promise<GeocodeSearchResult[]> {
  const normalised = normaliseGeocodeQuery(query);
  if (!normalised) return [];
  const limit = Math.min(10, Math.max(1, Math.trunc(options.limit ?? 10)));
  const cacheKey = `search:${normalised}:limit:${limit}`;
  const params = new URLSearchParams({ q: normalised, limit: String(limit) });
  return fetchAndCache(
    cacheKey,
    `/search?${params}`,
    (value): value is GeocodeSearchResult[] => Array.isArray(value) && value.every(isSearchResult),
    options.signal,
  );
}

export async function reverseGeocode(
  lat: number,
  lon: number,
  options: { zoom?: number; signal?: AbortSignal } = {},
): Promise<ReverseGeocodeResult> {
  const normalisedLat = normaliseGeocodeCoordinate(lat);
  const normalisedLon = normaliseGeocodeCoordinate(lon);
  const zoom = Math.min(18, Math.max(3, Math.trunc(options.zoom ?? 18)));
  const cacheKey = `reverse:${normalisedLat}:${normalisedLon}:zoom:${zoom}`;
  const params = new URLSearchParams({ lat: normalisedLat, lon: normalisedLon, zoom: String(zoom) });
  return fetchAndCache(cacheKey, `/reverse?${params}`, isReverseResult, options.signal);
}
