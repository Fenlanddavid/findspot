// ─── Tile pre-warm hook ───────────────────────────────────────────────────────
// When the map settles after a move, prefetch the 3×3 scan tile grid for all
// terrain sources at TERRAIN_ZOOM. Tiles land in the browser's HTTP cache so
// when the user hits Scan they're already available for the workers.

import { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import { SCAN_CONFIG } from '../utils/scanConfig';
import { resolveWaybackIds, waybackTileUrl } from '../utils/waybackService';

const ZOOM = SCAN_CONFIG.TERRAIN_ZOOM;

function tileUrls(zoom: number, tX: number, tY: number, waybackIds: { spring: number; summer: number } | null): string[] {
    const urls: string[] = [];
    for (let dy = 0; dy < 3; dy++) {
        for (let dx = 0; dx < 3; dx++) {
            const tx = tX + dx, ty = tY + dy;
            urls.push(
                `https://services.arcgis.com/JJT1S6cy9mS999Xy/arcgis/rest/services/LIDAR_Composite_1m_DTM_2025_Hillshade/MapServer/tile/${zoom}/${ty}/${tx}`,
                `https://services.arcgis.com/JJT1S6cy9mS999Xy/arcgis/rest/services/LIDAR_Composite_1m_DTM_2022_Multi_Directional_Hillshade/MapServer/tile/${zoom}/${ty}/${tx}`,
                `https://environment.data.gov.uk/image/rest/services/SURVEY/LIDAR_Composite_DTM_1m_2022_Slope/ImageServer/tile/${zoom}/${ty}/${tx}`,
                `https://services.arcgisonline.com/arcgis/rest/services/Elevation/World_Hillshade/MapServer/tile/${zoom}/${ty}/${tx}`,
            );
            if (waybackIds) {
                urls.push(
                    waybackTileUrl(waybackIds.spring, zoom, ty, tx),
                    waybackTileUrl(waybackIds.summer, zoom, ty, tx),
                );
            }
        }
    }
    return urls;
}

export function useTilePrewarm(mapRef: React.RefObject<maplibregl.Map | null>) {
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        const map = mapRef.current;
        if (!map) return;

        // Kick off a Wayback catalog resolve in the background immediately —
        // it'll be cached by the time the user initiates a scan.
        resolveWaybackIds().catch(() => {});

        const prewarm = () => {
            // Debounce — wait until the map has settled for 600 ms
            if (timerRef.current) clearTimeout(timerRef.current);
            timerRef.current = setTimeout(async () => {
                const center = map.getCenter();
                const n  = Math.pow(2, ZOOM);
                const cX = (center.lng + 180) / 360 * n;
                const cY = (1 - Math.log(Math.tan(center.lat * Math.PI / 180) + 1 / Math.cos(center.lat * Math.PI / 180)) / Math.PI) / 2 * n;
                const tX = Math.floor(cX) - 1;
                const tY = Math.floor(cY) - 1;

                // Wayback IDs will already be cached from the init call above
                const waybackIds = await resolveWaybackIds().catch(() => null);
                const urls = tileUrls(ZOOM, tX, tY, waybackIds);

                for (const url of urls) {
                    fetch(url, { priority: 'low' } as RequestInit).catch(() => {});
                }
            }, 600);
        };

        map.on('moveend', prewarm);
        // Also prewarm on initial load once the map is idle
        map.once('idle', prewarm);

        return () => {
            map.off('moveend', prewarm);
            if (timerRef.current) clearTimeout(timerRef.current);
        };
    }, [mapRef]);
}
