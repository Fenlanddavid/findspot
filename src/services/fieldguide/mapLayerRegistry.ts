import maplibregl, { addProtocol } from 'maplibre-gl';
import { cogProtocol } from '@geomatico/maplibre-cog-protocol';
import { cacheBackedTileUrl, ensureTileCacheProtocolRegistered } from '../../utils/mapTileCache';

function emptyGeoJSON(): GeoJSON.FeatureCollection {
    return { type: 'FeatureCollection', features: [] };
}

// Replace this URL with the hosted reprojected COG (EPSG:3857) after the Wales
// LiDAR preparation brief is complete.
const WALES_LIDAR_COG_URL = 'https://findspot-wales-lidar.trials-uk.workers.dev/wales_hillshade_3857.tif';

let protocolsRegistered = false;

export function ensureFieldGuideMapProtocolsRegistered(): void {
    if (protocolsRegistered) return;
    addProtocol('cog', cogProtocol);
    ensureTileCacheProtocolRegistered();
    protocolsRegistered = true;
}

export function createFieldGuideMapStyle(): maplibregl.StyleSpecification {
    return {
        version: 8,
        sources: {
            'osm': { type: 'raster', tiles: [cacheBackedTileUrl('https://a.tile.openstreetmap.org/{z}/{x}/{y}.png')], tileSize: 256, attribution: '&copy; OSM' },
            'satellite': { type: 'raster', tiles: [cacheBackedTileUrl('https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}')], tileSize: 256, attribution: 'Esri' },
            'overlay-lidar': { type: 'raster', tiles: ['https://environment.data.gov.uk/spatialdata/lidar-composite-digital-terrain-model-dtm-1m-2022/wms?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&FORMAT=image%2Fpng&TRANSPARENT=true&LAYERS=Lidar_Composite_Hillshade_DTM_1m&CRS=EPSG%3A3857&WIDTH=256&HEIGHT=256&BBOX={bbox-epsg-3857}'], tileSize: 256, attribution: 'Environment Agency (OGL)' },
            'overlay-lidar-wales': { type: 'raster', url: `cog://${WALES_LIDAR_COG_URL}`, tileSize: 256, minzoom: 10, attribution: '© Crown copyright (OGL) — Welsh Government / NRW, DataMapWales' },
            'overlay-os1930': { type: 'raster', tiles: ['https://mapseries-tilesets.s3.amazonaws.com/os/6inchsecond/{z}/{x}/{y}.png'], tileSize: 256, minzoom: 6, maxzoom: 16, attribution: '&copy; National Library of Scotland' },
            'overlay-os1880': { type: 'raster', tiles: ['https://mapseries-tilesets.s3.amazonaws.com/1inch_2nd_ed/{z}/{x}/{y}.png'], tileSize: 256, minzoom: 6, maxzoom: 15, attribution: '&copy; National Library of Scotland' },
        },
        layers: [
            { id: 'osm', type: 'raster', source: 'osm', minzoom: 0, maxzoom: 19 },
            { id: 'satellite', type: 'raster', source: 'satellite', minzoom: 0, maxzoom: 19, layout: { visibility: 'none' } },
            { id: 'overlay-lidar', type: 'raster', source: 'overlay-lidar', layout: { visibility: 'none' }, paint: { 'raster-opacity': 0.8, 'raster-contrast': 0.3, 'raster-brightness-max': 0.9, 'raster-fade-duration': 0 } },
            { id: 'overlay-lidar-wales', type: 'raster', source: 'overlay-lidar-wales', layout: { visibility: 'none' }, paint: { 'raster-opacity': 0.8, 'raster-contrast': 0.6, 'raster-brightness-max': 0.9, 'raster-saturation': -1, 'raster-fade-duration': 0 } },
            { id: 'overlay-os1880', type: 'raster', source: 'overlay-os1880', layout: { visibility: 'none' }, paint: { 'raster-opacity': 0.85, 'raster-fade-duration': 0 } },
            { id: 'overlay-os1930', type: 'raster', source: 'overlay-os1930', layout: { visibility: 'none' }, paint: { 'raster-opacity': 0.85, 'raster-fade-duration': 0 } },
        ],
    };
}

export function registerFieldGuideMapLayers(map: maplibregl.Map): boolean {
    if (map.getSource('targets')) return false;

    map.addSource('monument-buffers', { type: 'geojson', data: emptyGeoJSON() });
    map.addLayer({ id: 'monument-buffer-fill', type: 'fill', source: 'monument-buffers', paint: { 'fill-color': '#f97316', 'fill-opacity': 0.16 } });
    map.addLayer({ id: 'monument-buffer-outline', type: 'line', source: 'monument-buffers', paint: { 'line-color': '#f97316', 'line-width': 2, 'line-opacity': 0.85, 'line-dasharray': [3, 2] } });

    map.addSource('monuments', { type: 'geojson', data: emptyGeoJSON() });
    map.addLayer({ id: 'monuments-fill', type: 'fill', source: 'monuments', paint: { 'fill-color': '#ef4444', 'fill-opacity': 0.25 } });
    map.addLayer({ id: 'monuments-outline', type: 'line', source: 'monuments', paint: { 'line-color': '#ef4444', 'line-width': 3 } });

    map.addSource('aim-monuments', { type: 'geojson', data: emptyGeoJSON() });
    map.addLayer({ id: 'aim-fill', type: 'fill', source: 'aim-monuments', layout: { visibility: 'none' }, paint: { 'fill-color': '#f97316', 'fill-opacity': 0.2 } });
    map.addLayer({ id: 'aim-outline', type: 'line', source: 'aim-monuments', layout: { visibility: 'none' }, paint: { 'line-color': '#f97316', 'line-width': 2, 'line-opacity': 0.8 } });

    map.addSource('pas-density', { type: 'geojson', data: emptyGeoJSON() });
    map.addLayer({
        id: 'pas-density-fill', type: 'fill', source: 'pas-density',
        layout: { visibility: 'none' },
        paint: {
            'fill-color': [
                'match', ['get', 'tier'],
                'very-high', '#7c3aed',
                'high', '#2563eb',
                'moderate', '#0891b2',
                '#a3e7fc',
            ],
            'fill-opacity': 0.22,
        },
    });
    map.addLayer({
        id: 'pas-density-outline', type: 'line', source: 'pas-density',
        layout: { visibility: 'none' },
        paint: {
            'line-color': [
                'match', ['get', 'tier'],
                'very-high', '#7c3aed',
                'high', '#2563eb',
                'moderate', '#0891b2',
                '#a3e7fc',
            ],
            'line-width': 0.8,
            'line-opacity': 0.5,
        },
    });

    map.addSource('hotspots-overlay', { type: 'geojson', data: emptyGeoJSON() });
    map.addLayer({
        id: 'hotspots-outline', type: 'line', source: 'hotspots-overlay',
        paint: { 'line-color': ['case', ['>=', ['get', 'score'], 80], '#f59e0b', ['>=', ['get', 'score'], 45], '#10b981', '#3b82f6'], 'line-width': 2.5, 'line-opacity': 0.72 },
    });
    map.addLayer({
        id: 'hotspots-fill', type: 'fill', source: 'hotspots-overlay',
        paint: { 'fill-color': ['case', ['>=', ['get', 'score'], 80], '#f59e0b', ['>=', ['get', 'score'], 45], '#10b981', '#3b82f6'], 'fill-opacity': 0.10 },
    });

    map.addSource('cluster-links', { type: 'geojson', data: emptyGeoJSON() });
    map.addLayer({
        id: 'cluster-links-casing', type: 'line', source: 'cluster-links',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': '#064e3b', 'line-width': 5, 'line-opacity': 0.45 },
    });
    map.addLayer({
        id: 'cluster-links-line', type: 'line', source: 'cluster-links',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': '#34d399', 'line-width': 2.5, 'line-opacity': 0.85, 'line-dasharray': [6, 3] },
    });

    map.addSource('trace-targets', { type: 'geojson', data: emptyGeoJSON() });
    map.addLayer({
        id: 'trace-targets-circle', type: 'circle', source: 'trace-targets',
        paint: {
            'circle-radius': 7,
            'circle-color': '#f59e0b',
            'circle-opacity': 0.12,
            'circle-stroke-width': 2,
            'circle-stroke-color': '#f59e0b',
            'circle-stroke-opacity': 0.82,
        },
    });
    map.addLayer({
        id: 'trace-targets-selected', type: 'circle', source: 'trace-targets',
        filter: ['==', ['get', 'id'], ''],
        paint: {
            'circle-radius': 12,
            'circle-color': '#f59e0b',
            'circle-opacity': 0.18,
            'circle-stroke-width': 1.5,
            'circle-stroke-color': '#f59e0b',
            'circle-stroke-opacity': 0.70,
        },
    });

    map.addSource('targets', { type: 'geojson', data: emptyGeoJSON() });
    map.addLayer({
        id: 'targets-halo', type: 'circle', source: 'targets',
        filter: ['==', ['get', 'isPrimary'], true],
        paint: {
            'circle-radius': ['interpolate', ['linear'], ['get', 'consensus'], 1, 24, 2, 28, 3, 32],
            'circle-color': '#10b981',
            'circle-opacity': 0.16,
            'circle-stroke-width': 0,
        },
    });
    map.addLayer({
        id: 'targets-selected', type: 'circle', source: 'targets',
        filter: ['==', ['get', 'id'], ''],
        paint: {
            'circle-radius': ['interpolate', ['linear'], ['get', 'consensus'], 1, 20, 2, 23, 3, 26],
            'circle-color': '#ffffff',
            'circle-opacity': 0,
            'circle-stroke-width': 3,
            'circle-stroke-color': '#f8fafc',
            'circle-stroke-opacity': 0.95,
        },
    });
    map.addLayer({
        id: 'targets-circle', type: 'circle', source: 'targets',
        paint: {
            'circle-radius': ['interpolate', ['linear'], ['get', 'consensus'], 1, 13, 2, 15, 3, 17],
            'circle-color': ['case', ['get', 'isProtected'], '#7f1d1d', ['get', 'isPrimary'], '#0f766e', ['>=', ['get', 'consensus'], 2], '#d97706', ['==', ['get', 'source'], 'terrain'], '#059669', ['==', ['get', 'source'], 'historic'], '#d97706', '#2563eb'],
            'circle-opacity': ['case', ['get', 'isProtected'], 0.62, 0.92],
            'circle-stroke-width': ['case', ['get', 'isProtected'], 1.5, ['get', 'isPrimary'], 2.5, 2],
            'circle-stroke-color': ['case', ['get', 'isProtected'], '#fecaca', ['get', 'isPrimary'], '#d1fae5', '#f8fafc'],
        },
    });
    map.moveLayer('trace-targets-circle');
    map.moveLayer('trace-targets-selected');

    map.addSource('pas-finds', { type: 'geojson', data: emptyGeoJSON() });
    map.addLayer({ id: 'pas-circles', type: 'circle', source: 'pas-finds', layout: { visibility: 'none' }, paint: { 'circle-radius': 10, 'circle-color': '#3b82f6', 'circle-stroke-width': 2, 'circle-stroke-color': '#fff' } });

    map.addSource('historic-routes', { type: 'geojson', data: emptyGeoJSON() });
    map.addLayer({ id: 'historic-routes-roman-casing', type: 'line', source: 'historic-routes', filter: ['==', ['get', 'type'], 'roman_road'], layout: { visibility: 'none', 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#ffffff', 'line-width': 10, 'line-opacity': 0.35 } });
    map.addLayer({ id: 'historic-routes-roman', type: 'line', source: 'historic-routes', filter: ['==', ['get', 'type'], 'roman_road'], layout: { visibility: 'none', 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#3b82f6', 'line-width': 5, 'line-opacity': 0.97 } });
    map.addLayer({ id: 'historic-routes-trackway-casing', type: 'line', source: 'historic-routes', filter: ['!=', ['get', 'type'], 'roman_road'], layout: { visibility: 'none', 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#ffffff', 'line-width': 7, 'line-opacity': 0.2 } });
    map.addLayer({ id: 'historic-routes-trackway', type: 'line', source: 'historic-routes', filter: ['!=', ['get', 'type'], 'roman_road'], layout: { visibility: 'none', 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#93c5fd', 'line-width': 3, 'line-opacity': 0.95, 'line-dasharray': [5, 4] } });

    map.addSource('corridors', { type: 'geojson', data: emptyGeoJSON() });
    map.addLayer({ id: 'corridors-fill', type: 'fill', source: 'corridors', layout: { visibility: 'none' }, paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.12 } });
    map.addLayer({ id: 'corridors-outline', type: 'line', source: 'corridors', layout: { visibility: 'none', 'line-join': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': 1, 'line-opacity': 0.3, 'line-dasharray': [3, 3] } });

    map.addSource('landscape-context', { type: 'geojson', data: emptyGeoJSON() });
    map.addLayer({ id: 'landscape-context-fill', type: 'fill', source: 'landscape-context', layout: { visibility: 'none' }, paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.08 } });
    map.addLayer({ id: 'landscape-context-outline', type: 'line', source: 'landscape-context', layout: { visibility: 'none', 'line-join': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': 1, 'line-opacity': 0.35, 'line-dasharray': [2, 4] } });

    map.addSource('crossings', { type: 'geojson', data: emptyGeoJSON() });
    map.addLayer({ id: 'crossings-halo', type: 'circle', source: 'crossings', layout: { visibility: 'none' }, paint: { 'circle-radius': 14, 'circle-color': '#f59e0b', 'circle-opacity': 0.25, 'circle-stroke-width': 0 } });
    map.addLayer({ id: 'crossings-circle', type: 'circle', source: 'crossings', layout: { visibility: 'none' }, paint: { 'circle-radius': 6, 'circle-color': '#f59e0b', 'circle-opacity': 0.95, 'circle-stroke-width': 2, 'circle-stroke-color': '#fff' } });

    map.addSource('permission-fields', { type: 'geojson', data: emptyGeoJSON() });
    map.addLayer({ id: 'permission-fields-fill', type: 'fill', source: 'permission-fields', layout: { visibility: 'none' }, paint: { 'fill-color': '#0d9488', 'fill-opacity': 0.08 } });
    map.addLayer({ id: 'permission-fields-outline', type: 'line', source: 'permission-fields', layout: { visibility: 'none' }, paint: { 'line-color': '#0d9488', 'line-width': 2, 'line-opacity': 0.9, 'line-dasharray': [4, 2] } });

    map.addSource('user-finds', { type: 'geojson', data: emptyGeoJSON() });
    map.addLayer({ id: 'user-finds-circles', type: 'circle', source: 'user-finds', layout: { visibility: 'none' }, paint: { 'circle-radius': 4, 'circle-color': '#34d399', 'circle-opacity': 0.5, 'circle-stroke-width': 1, 'circle-stroke-color': '#000', 'circle-stroke-opacity': 0.3 } });
    map.addLayer({ id: 'user-finds-hitbox', type: 'circle', source: 'user-finds', layout: { visibility: 'none' }, paint: { 'circle-radius': 16, 'circle-color': 'transparent', 'circle-opacity': 0 } });

    map.addSource('dev-annotations', { type: 'geojson', data: emptyGeoJSON() });
    map.addLayer({ id: 'dev-annotations-halo', type: 'circle', source: 'dev-annotations', paint: { 'circle-radius': 18, 'circle-color': '#f97316', 'circle-opacity': 0.15, 'circle-stroke-width': 0 } });
    map.addLayer({ id: 'dev-annotations-circle', type: 'circle', source: 'dev-annotations', paint: { 'circle-radius': 6, 'circle-color': '#f97316', 'circle-opacity': 1, 'circle-stroke-width': 2, 'circle-stroke-color': '#fff', 'circle-stroke-opacity': 0.9 } });

    return true;
}
