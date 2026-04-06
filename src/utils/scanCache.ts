// ─── In-memory scan cache — avoids redundant rescans of the same area ────────

import { Cluster } from '../pages/fieldGuideTypes';

const cache = new Map<string, { result: Cluster[]; ts: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function getCacheKey(lat: number, lng: number, zoom: number): string {
    // Round to ~500m grid
    return `${(lat * 100).toFixed(0)}_${(lng * 100).toFixed(0)}_${zoom}`;
}

export function getCached(lat: number, lng: number, zoom: number): Cluster[] | null {
    const key = getCacheKey(lat, lng, zoom);
    const entry = cache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.ts > CACHE_TTL) {
        cache.delete(key);
        return null;
    }
    return entry.result;
}

export function setCached(lat: number, lng: number, zoom: number, result: Cluster[]): void {
    const key = getCacheKey(lat, lng, zoom);
    cache.set(key, { result, ts: Date.now() });
}
