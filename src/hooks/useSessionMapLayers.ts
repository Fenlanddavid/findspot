import { useEffect, useState, type RefObject } from 'react';
import type maplibregl from 'maplibre-gl';
import { useDurableSetting, useInitialFieldGuideMapStyle } from '../services/clientStorage';
import {
    DEFAULT_RASTER_OVERLAY_OPACITY,
    RASTER_OVERLAY_STORAGE_KEY,
    type RasterOverlayKey,
    type RasterOverlayOpacity,
    type RomanStandaloneLayerStatus,
} from '../services/fieldguide/rasterOverlaySettings';
import { clampOpacity } from '../services/fieldguide/fieldGuidePageSupport';

export type SessionRasterOverlay = RasterOverlayKey;
export type SessionRasterOverlayState = Record<SessionRasterOverlay, boolean>;

export interface SessionMapLayerControl {
    isSatellite: boolean;
    toggleSatellite: () => void;
    overlays: SessionRasterOverlayState;
    toggleOverlay: (key: SessionRasterOverlay) => void;
    overlayOpacity: RasterOverlayOpacity;
    activeOpacityLayer: SessionRasterOverlay | null;
    setOverlayOpacity: (key: SessionRasterOverlay, opacity: number) => void;
    romanRoads: boolean;
    romanRoadStatus: RomanStandaloneLayerStatus;
    toggleRomanRoads: () => void;
}

function viewportBounds(map: maplibregl.Map) {
    const bounds = map.getBounds();
    return { west: bounds.getWest(), south: bounds.getSouth(), east: bounds.getEast(), north: bounds.getNorth() };
}

export function useSessionMapLayers(
    mapRef: RefObject<maplibregl.Map | null>,
    mapReadyVersion: number,
): { control: SessionMapLayerControl; mapPreferenceReady: boolean } {
    const [isSatellite, setIsSatellite, mapPreferenceReady] = useInitialFieldGuideMapStyle();
    const [overlays, setOverlays] = useState<SessionRasterOverlayState>({ lidar: false, 'lidar-wales': false, os1880: false, os1930: false });
    const [overlayOpacity, setStoredOverlayOpacity] = useDurableSetting<RasterOverlayOpacity>(
        RASTER_OVERLAY_STORAGE_KEY,
        DEFAULT_RASTER_OVERLAY_OPACITY,
    );
    const [activeOpacityLayer, setActiveOpacityLayer] = useState<SessionRasterOverlay | null>(null);
    const [romanRoads, setRomanRoads] = useState(false);
    const [romanRoadStatus, setRomanRoadStatus] = useState<RomanStandaloneLayerStatus>('idle');

    useEffect(() => {
        const map = mapRef.current;
        if (!map || !mapReadyVersion) return;
        if (map.getLayer('osm')) map.setLayoutProperty('osm', 'visibility', isSatellite ? 'none' : 'visible');
        if (map.getLayer('satellite')) map.setLayoutProperty('satellite', 'visibility', isSatellite ? 'visible' : 'none');
        const layerIds: Record<SessionRasterOverlay, string> = {
            lidar: 'overlay-lidar', 'lidar-wales': 'overlay-lidar-wales', os1880: 'overlay-os1880', os1930: 'overlay-os1930',
        };
        for (const key of Object.keys(layerIds) as SessionRasterOverlay[]) {
            const layerId = layerIds[key];
            if (!map.getLayer(layerId)) continue;
            map.setLayoutProperty(layerId, 'visibility', overlays[key] ? 'visible' : 'none');
            map.setPaintProperty(layerId, 'raster-opacity', overlayOpacity[key] ?? DEFAULT_RASTER_OVERLAY_OPACITY[key]);
        }
        for (const layerId of ['roman-standalone-casing', 'roman-standalone']) {
            if (map.getLayer(layerId)) map.setLayoutProperty(layerId, 'visibility', romanRoads ? 'visible' : 'none');
        }
    }, [isSatellite, mapReadyVersion, overlayOpacity, overlays, romanRoads]);

    useEffect(() => {
        const map = mapRef.current;
        if (!map || !mapReadyVersion || !romanRoads) {
            setRomanRoadStatus('idle');
            return;
        }
        let cancelled = false;
        let timer: ReturnType<typeof setTimeout> | null = null;
        let requestVersion = 0;
        const refresh = async () => {
            const version = ++requestVersion;
            setRomanRoadStatus('loading');
            const { populateRomanStandaloneRoads } = await import('../services/fieldguide/romanStandaloneLayer');
            const status = await populateRomanStandaloneRoads(map, viewportBounds(map));
            if (!cancelled && version === requestVersion) setRomanRoadStatus(status);
        };
        const schedule = () => {
            if (timer) clearTimeout(timer);
            timer = setTimeout(() => { void refresh(); }, 300);
        };
        map.on('moveend', schedule);
        void refresh();
        return () => {
            cancelled = true;
            requestVersion++;
            if (timer) clearTimeout(timer);
            map.off('moveend', schedule);
        };
    }, [mapReadyVersion, romanRoads]); // eslint-disable-line react-hooks/exhaustive-deps

    const toggleOverlay = (key: SessionRasterOverlay) => {
        const enabled = overlays[key];
        const otherOldMapKey: SessionRasterOverlay | null = key === 'os1880' ? 'os1930' : key === 'os1930' ? 'os1880' : null;
        setOverlays(current => ({
            ...current,
            [key]: !enabled,
            ...(!enabled && otherOldMapKey ? { [otherOldMapKey]: false } : {}),
        }));
        if (enabled) {
            if (activeOpacityLayer === key) setActiveOpacityLayer(null);
            return;
        }
        setStoredOverlayOpacity(current => ({ ...current, [key]: 1 }));
        setActiveOpacityLayer(key);
    };

    const updateOverlayOpacity = (key: SessionRasterOverlay, opacity: number) => {
        const next = clampOpacity(opacity, overlayOpacity[key] ?? DEFAULT_RASTER_OVERLAY_OPACITY[key]);
        setStoredOverlayOpacity(current => ({ ...current, [key]: next }));
    };

    return {
        mapPreferenceReady,
        control: {
            isSatellite,
            toggleSatellite: () => setIsSatellite(value => !value),
            overlays,
            toggleOverlay,
            overlayOpacity,
            activeOpacityLayer,
            setOverlayOpacity: updateOverlayOpacity,
            romanRoads,
            romanRoadStatus,
            toggleRomanRoads: () => setRomanRoads(value => !value),
        },
    };
}
