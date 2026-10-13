import { HILLFORT_DATASET } from '../shared/staticDatasetContract';
import { hillfortDatasetSchema, type HillfortContext, type HillfortDataset, type HillfortScanGeometry } from '../types/hillforts';
import { HILLFORT_CONTEXT_PADDING_M, hillfortGeometryFingerprint, queryHillforts } from './fieldguide/hillfortSpatial';
import type { NHLEFeature } from './historicScanService';

export const HILLFORT_CACHE = 'findspot-hillforts-public-v1';
export function hillfortAssetUrl(): string {
    return new URL(`${import.meta.env.BASE_URL}${HILLFORT_DATASET.assetPath}`, globalThis.location?.origin ?? 'http://localhost:5174').href;
}
let loaded: HillfortDataset | null = null;
let pending: Promise<HillfortDataset> | null = null;
let cacheRequest: Promise<HillfortDataset> | null = null;

export async function validateHillfortResponse(response: Response): Promise<HillfortDataset> {
    if (!response.ok) throw new Error('Hillfort download failed');
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength !== HILLFORT_DATASET.bytes) throw new Error('Incomplete hillfort download');
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const hash = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
    if (hash !== HILLFORT_DATASET.sha256) throw new Error('Hillfort checksum mismatch');
    const data = hillfortDatasetSchema.parse(JSON.parse(new TextDecoder().decode(bytes)));
    if (data.metadata.generation !== HILLFORT_DATASET.generation || data.records.length !== HILLFORT_DATASET.recordCount
        || data.metadata.recordCount !== data.records.length || new Set(data.records.map(r => r.id)).size !== data.records.length
        || data.records.some(r => r.generation !== data.metadata.generation)) throw new Error('Hillfort generation mismatch');
    return data;
}

/** Commit only after complete validation. A failed refresh never replaces good data. */
export async function cacheHillfortDataset(signal?: AbortSignal, refresh = false): Promise<HillfortDataset> {
    signal?.throwIfAborted();
    if (!cacheRequest) cacheRequest = readOrDownloadHillforts(refresh).finally(() => { cacheRequest = null; });
    const data = await cacheRequest;
    signal?.throwIfAborted();
    return data;
}

async function readOrDownloadHillforts(refresh: boolean): Promise<HillfortDataset> {
    const cache = typeof caches === 'undefined' ? null : await caches.open(HILLFORT_CACHE);
    const url = hillfortAssetUrl();
    if (!refresh && cache) {
        const cached = await cache.match(url);
        if (cached) {
            try { return await validateHillfortResponse(cached); } catch { /* retry without deleting last cached bytes */ }
        }
    }
    const response = await fetch(url, { signal: AbortSignal.timeout(30_000), cache: refresh ? 'reload' : 'default' });
    const data = await validateHillfortResponse(response.clone());
    // Cache failure (quota/private mode) must not discard usable online context.
    try { await cache?.put(url, response); } catch { /* offline availability is checked against actual bytes */ }
    return data;
}

export function resetHillfortMemory(): void { loaded = null; }

/** Abort just this consumer; concurrent scans/packs can keep their shared request. */
async function loadHillforts(signal?: AbortSignal): Promise<HillfortDataset> {
    signal?.throwIfAborted();
    if (loaded) return loaded;
    if (!pending) pending = cacheHillfortDataset().then(data => { loaded = data; return data; }).finally(() => { pending = null; });
    const request = pending;
    if (!signal) return request;
    return new Promise((resolve, reject) => {
        const abort = () => reject(new DOMException('Aborted', 'AbortError'));
        signal.addEventListener('abort', abort, { once: true });
        request.then(data => { if (!signal.aborted) resolve(data); }, reject).finally(() => signal.removeEventListener('abort', abort));
    });
}

export async function lookupHillfortContext(geometry: HillfortScanGeometry, centre: [number, number], signal: AbortSignal, features: NHLEFeature[] = []): Promise<HillfortContext> {
    try {
        const dataset = await loadHillforts(signal);
        signal.throwIfAborted();
        return queryHillforts(dataset, geometry, centre, features);
    } catch (error) {
        signal.throwIfAborted();
        return {
            status: typeof navigator !== 'undefined' && navigator.onLine === false ? 'unavailable_offline' : 'load_failure',
            generation: HILLFORT_DATASET.generation, centre, contextPaddingM: HILLFORT_CONTEXT_PADDING_M,
            geometryFingerprint: hillfortGeometryFingerprint(geometry, centre), results: [],
        };
    }
}

/** Checks actual shared bytes, not historic pack metadata; demand-only. */
export async function hasCachedHillfortDataset(): Promise<boolean> {
    if (typeof caches === 'undefined') return false;
    const cache = await caches.open(HILLFORT_CACHE);
    const response = await cache.match(hillfortAssetUrl());
    if (!response) return false;
    try { await validateHillfortResponse(response); return true; } catch { return false; }
}
