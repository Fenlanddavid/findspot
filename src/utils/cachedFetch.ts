// ─── Cache-Storage-aware fetch wrapper (W3) ───────────────────────────────────
// fetch() does NOT automatically consult Cache Storage. A Response stored via
// cache.put() is only returned if code explicitly calls caches.match(). This
// wrapper provides that explicit check before falling back to the network.
//
// Used by: tile fetch loops in offlinePack.ts and any scan path that should
// benefit from a prepared offline pack.
//
// Design:
//   - cachedFetch(url, cacheName, opts?) checks the named cache first.
//   - On a hit: returns the cached Response directly (no network call).
//   - On a miss: falls through to fetch(url, opts) — does NOT populate the
//     cache. Population is buildPack()'s responsibility.
//   - The named cache is pack-specific; callers pass the CACHE_NAME from
//     offlinePack so only the pack's own cache is consulted.
//
// `caches` is available in Window and in dedicated Web Workers in all modern
// browsers (Chrome 43+, Firefox 44+, Safari 16+). The terrain worker can
// use this directly.

import { reportNonFatal } from '../services/diagLog';

/**
 * Fetch a resource, serving from the named Cache Storage entry if available.
 * Falls through to network on a miss. Does not populate the cache on miss.
 *
 * @param url       The resource URL to fetch.
 * @param cacheName The Cache Storage cache name to check first.
 * @param opts      Optional fetch options (passed to the network fetch on miss).
 */
export async function cachedFetch(
    url: string,
    cacheName: string,
    opts?: RequestInit,
): Promise<Response> {
    if (typeof caches !== 'undefined') {
        try {
            const cache = await caches.open(cacheName);
            const cached = await cache.match(url);
            if (cached) return cached;
        } catch (error) {
            reportNonFatal('cache', 'Named cache read failed; using network', error);
        }
    }
    return fetch(url, opts);
}

/**
 * Fetch a resource, checking ALL open Cache Storage caches before hitting the
 * network. The caller does not need to know the specific cache name.
 *
 * Use this in scan read paths (terrain worker tile fetches, R2 shard reads)
 * so any prepared offline pack is transparently served regardless of which
 * pack cache holds the entry.
 *
 * `caches.match()` searches all open caches in creation order, returning the
 * first hit. Available in Window and dedicated/shared Workers in Chrome 43+,
 * Firefox 44+, Safari 16+.
 *
 * @param url   The resource URL to fetch.
 * @param opts  Optional fetch options (forwarded to network fallback only).
 */
export async function cachedFetchAny(
    url: string,
    opts?: RequestInit,
    options?: { cacheOnly?: boolean },
): Promise<Response> {
    if (typeof caches !== 'undefined') {
        try {
            const cached = await caches.match(url);
            if (cached) return cached;
        } catch (error) {
            reportNonFatal('cache', 'Cache read failed; using network', error);
        }
    }
    if (options?.cacheOnly) {
        return new Response(null, { status: 504, statusText: 'Cache miss' });
    }
    return fetch(url, opts);
}
