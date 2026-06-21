// ─── Shared basemap helper ─────────────────────────────────────────────────
// Used by BoundaryPickerModal and PermissionFieldsColumn.
// All five layers are added ONCE, hidden; applyBasemap() toggles visibility.
// This preserves the camera and any in-progress drawn geometry across switches.
//
// LiDAR detail (1 m DTM) covers England only — the global coarse hillshade
// acts as a fallback so LiDAR mode is never blank outside England.
// OS source is the same 6-inch-second tileset FieldGuide already uses (NLS).

import type maplibregl from 'maplibre-gl';

export type BasemapMode = 'satellite' | 'os' | 'lidar' | 'streets';

export const BASEMAP_MODES: { id: BasemapMode; label: string; emoji: string }[] = [
    { id: 'satellite', label: 'Satellite', emoji: '🛰️' },
    { id: 'os',        label: 'OS Maps',   emoji: '🗺️' },
    { id: 'lidar',     label: 'LiDAR',     emoji: '⛰️' },
    { id: 'streets',   label: 'Streets',   emoji: '🛣️' },
];

export const BASEMAP_SOURCES: Record<string, maplibregl.RasterSourceSpecification> = {
    'bm-streets': {
        type: 'raster', tileSize: 256, maxzoom: 19, attribution: '© OpenStreetMap',
        tiles: ['https://a.tile.openstreetmap.org/{z}/{x}/{y}.png'],
    },
    'bm-satellite': {
        type: 'raster', tileSize: 256, maxzoom: 19, attribution: '© Esri World Imagery',
        tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
    },
    'bm-os': {
        type: 'raster', tileSize: 256, maxzoom: 18,
        attribution: 'Historic OS mapping — National Library of Scotland',
        tiles: ['https://mapseries-tilesets.s3.amazonaws.com/os/6inchsecond/{z}/{x}/{y}.png'],
    },
    // Global coarse hillshade — covers everywhere, used as LiDAR fallback.
    'bm-lidar-coarse': {
        type: 'raster', tileSize: 256, attribution: '© Esri',
        tiles: ['https://services.arcgisonline.com/arcgis/rest/services/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}'],
    },
    // High-res 1 m DTM hillshade — England only (blank elsewhere; coarse shows through).
    'bm-lidar-detail': {
        type: 'raster', tileSize: 256,
        attribution: '© Environment Agency (OGL)',
        tiles: ['https://services.arcgis.com/JJT1S6cy9mS999Xy/arcgis/rest/services/LIDAR_Composite_1m_DTM_2025_Hillshade/MapServer/tile/{z}/{y}/{x}'],
    },
};

// All layers start hidden; applyBasemap() reveals the active set.
// Paint values mirror existing LocationPickerModal LiDAR tuning.
export const BASEMAP_LAYERS: maplibregl.LayerSpecification[] = [
    { id: 'bm-streets',      type: 'raster', source: 'bm-streets',      layout: { visibility: 'none' } },
    { id: 'bm-satellite',    type: 'raster', source: 'bm-satellite',    layout: { visibility: 'none' } },
    { id: 'bm-os',           type: 'raster', source: 'bm-os',           layout: { visibility: 'none' } },
    {
        id: 'bm-lidar-coarse', type: 'raster', source: 'bm-lidar-coarse',
        layout: { visibility: 'none' },
        paint: { 'raster-contrast': 0.2, 'raster-brightness-max': 0.9, 'raster-fade-duration': 0 },
    },
    {
        id: 'bm-lidar-detail', type: 'raster', source: 'bm-lidar-detail',
        layout: { visibility: 'none' },
        paint: { 'raster-contrast': 0.4, 'raster-brightness-max': 0.9, 'raster-fade-duration': 0 },
    },
];

const VISIBLE_BY_MODE: Record<BasemapMode, string[]> = {
    satellite: ['bm-satellite'],
    streets:   ['bm-streets'],
    os:        ['bm-os'],
    lidar:     ['bm-lidar-coarse', 'bm-lidar-detail'],
};

const ALL_BASE_IDS = BASEMAP_LAYERS.map(l => l.id);

/** Toggle layer visibility — no map rebuild, camera + drawing untouched. */
export function applyBasemap(map: maplibregl.Map, mode: BasemapMode): void {
    const show = new Set(VISIBLE_BY_MODE[mode] ?? VISIBLE_BY_MODE.satellite);
    for (const id of ALL_BASE_IDS) {
        if (!map.getLayer(id)) continue;
        map.setLayoutProperty(id, 'visibility', show.has(id) ? 'visible' : 'none');
    }
}
