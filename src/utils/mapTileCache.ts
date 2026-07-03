import { addProtocol } from 'maplibre-gl';
import { cachedFetchAny } from './cachedFetch';

export const MAP_TILE_CACHE_PROTOCOL = 'findspot-cache';

export function cacheBackedTileUrl(realTileUrl: string): string {
    return `${MAP_TILE_CACHE_PROTOCOL}://${realTileUrl}`;
}

export function osmTileUrl(zoom: number, tx: number, ty: number): string {
    return `https://a.tile.openstreetmap.org/${zoom}/${tx}/${ty}.png`;
}

export function worldImageryTileUrl(zoom: number, tx: number, ty: number): string {
    return `https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${zoom}/${ty}/${tx}`;
}

let tileCacheProtocolRegistered = false;
export function ensureTileCacheProtocolRegistered(): void {
    if (tileCacheProtocolRegistered) return;
    addProtocol(MAP_TILE_CACHE_PROTOCOL, (params, abortController) =>
        loadCacheBackedTile(params.url, abortController.signal)
    );
    tileCacheProtocolRegistered = true;
}

export async function loadCacheBackedTile(
    protocolUrl: string,
    signal?: AbortSignal,
): Promise<{ data: ArrayBuffer }> {
    const prefix = `${MAP_TILE_CACHE_PROTOCOL}://`;
    const realUrl = protocolUrl.startsWith(prefix) ? protocolUrl.slice(prefix.length) : protocolUrl;
    const res = await cachedFetchAny(realUrl, { signal });
    if (!res.ok) throw new Error(`Tile fetch error: ${res.status}`);
    return { data: await res.arrayBuffer() };
}
