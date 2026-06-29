// ─── Tile pre-warm hook ───────────────────────────────────────────────────────
// When the map settles after a move, prefetch the 3×3 scan tile grid for all
// terrain sources at TERRAIN_ZOOM. Tiles land in the browser's HTTP cache so
// when the user hits Scan they're already available for the workers.

import { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import { SCAN_CONFIG } from '../utils/scanConfig';
import { resolveWaybackIds, waybackTileUrl } from '../utils/waybackService';
import { findPackCoveringBbox } from '../services/offlinePack';

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
                `https://services.arcgisonline.com/arcgis/rest/services/Elevation/World_Hillshade_Dark/MapServer/tile/${zoom}/${ty}/${tx}`,
                `https://services.arcgisonline.com/arcgis/rest/services/World_Shaded_Relief/MapServer/tile/${zoom}/${ty}/${tx}`,
                `https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${zoom}/${ty}/${tx}`,
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

function tileLon(x: number, zoom: number): number {
    return x / Math.pow(2, zoom) * 360 - 180;
}

function tileLat(y: number, zoom: number): number {
    return (180 / Math.PI) * (2 * Math.atan(Math.exp(Math.PI * (1 - 2 * y / Math.pow(2, zoom)))) - Math.PI / 2);
}

export function useTilePrewarm(mapRef: React.RefObject<maplibregl.Map | null>) {
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        const map = mapRef.current;
        if (!map) return;

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
                const scanBbox: [number, number, number, number] = [
                    tileLon(tX, ZOOM),
                    tileLat(tY + 3, ZOOM),
                    tileLon(tX + 3, ZOOM),
                    tileLat(tY, ZOOM),
                ];
                const offlinePack = await findPackCoveringBbox(scanBbox, ZOOM).catch(() => null);
                if (offlinePack) return;

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
