import { useEffect, useRef, useState } from 'react';
import maplibregl, { addProtocol } from 'maplibre-gl';
import { cogProtocol } from '@geomatico/maplibre-cog-protocol';
import * as turf from '@turf/turf';
import { Cluster, Hotspot, HistoricFind, HistoricRoute, TraceTarget } from '../pages/fieldGuideTypes';
import { Find, SavedPoint, db } from '../db';
import { deletePack } from '../services/offlinePack';
import { DevAnnotation } from '../utils/devAnnotation';
import { cacheBackedTileUrl, loadCacheBackedTile, MAP_TILE_CACHE_PROTOCOL } from '../utils/mapTileCache';
import { getPASDensityGeoJSON } from '../services/pasDensityService';

// ─── Types ────────────────────────────────────────────────────────────────────

interface LayerState {
    historicMode: boolean;
    devMode:      boolean;
    visibility: { routes: boolean; corridors: boolean; crossings: boolean; monuments: boolean; aim: boolean; context: boolean; pasDensity: boolean };
}

const LAYER_VISIBILITY_CONFIG: Array<{ id: string; visibleWhen: (s: LayerState) => boolean }> = [
    { id: 'pas-circles',                     visibleWhen: s => s.historicMode && s.visibility.monuments },
    { id: 'historic-routes-roman-casing',    visibleWhen: s => s.historicMode && s.visibility.routes },
    { id: 'historic-routes-roman',           visibleWhen: s => s.historicMode && s.visibility.routes },
    { id: 'historic-routes-trackway-casing', visibleWhen: s => s.historicMode && s.visibility.routes },
    { id: 'historic-routes-trackway',        visibleWhen: s => s.historicMode && s.visibility.routes },
    { id: 'aim-fill',                        visibleWhen: s => s.historicMode && s.visibility.aim },
    { id: 'aim-outline',                     visibleWhen: s => s.historicMode && s.visibility.aim },
    { id: 'pas-density-fill',               visibleWhen: s => s.historicMode && s.visibility.pasDensity },
    { id: 'pas-density-outline',            visibleWhen: s => s.historicMode && s.visibility.pasDensity },
    { id: 'corridors-fill',                  visibleWhen: s => s.historicMode && s.visibility.corridors },
    { id: 'corridors-outline',               visibleWhen: s => s.historicMode && s.visibility.corridors },
    { id: 'landscape-context-fill',          visibleWhen: s => s.historicMode && s.visibility.context },
    { id: 'landscape-context-outline',       visibleWhen: s => s.historicMode && s.visibility.context },
    { id: 'crossings-halo',                  visibleWhen: s => s.historicMode && s.visibility.crossings },
    { id: 'crossings-circle',                visibleWhen: s => s.historicMode && s.visibility.crossings },
    { id: 'cluster-links-casing',            visibleWhen: s => !s.historicMode && s.devMode },
    { id: 'cluster-links-line',              visibleWhen: s => !s.historicMode && s.devMode },
    // Keep targets/hotspots available in landscape review mode. The combined
    // scan overlays historic context, but target pins must remain inspectable.
    { id: 'trace-targets-circle',            visibleWhen: () => true },
    { id: 'trace-targets-selected',          visibleWhen: () => true },
    { id: 'targets-halo',                    visibleWhen: () => true },
    { id: 'targets-selected',                visibleWhen: () => true },
    { id: 'targets-circle',                  visibleWhen: () => true },
    { id: 'hotspots-outline',                visibleWhen: () => true },
    { id: 'hotspots-fill',                   visibleWhen: () => true },
];

function getPolygonCenter(boundary: any): [number, number] | null {
    const ring = boundary?.coordinates?.[0];
    if (!Array.isArray(ring) || ring.length === 0) return null;
    try {
        const coords = turf.centroid(boundary).geometry.coordinates;
        return [coords[0], coords[1]];
    } catch {
        return null;
    }
}

function makeFieldLabelElement(label: string) {
    const el = document.createElement('div');
    el.textContent = label;
    el.style.background = 'rgba(13, 148, 136, 0.9)';
    el.style.border = '1px solid rgba(94, 234, 212, 0.7)';
    el.style.borderRadius = '999px';
    el.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.35)';
    el.style.color = '#ccfbf1';
    el.style.font = "800 10px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
    el.style.letterSpacing = '0.04em';
    el.style.maxWidth = '9rem';
    el.style.overflow = 'hidden';
    el.style.padding = '0.2rem 0.45rem';
    el.style.pointerEvents = 'none';
    el.style.textOverflow = 'ellipsis';
    el.style.textTransform = 'uppercase';
    el.style.whiteSpace = 'nowrap';
    return el;
}

function makeAnnotationLabelElement(index: number) {
    const el = document.createElement('div');
    el.textContent = String(index);
    el.style.background = 'rgba(17, 24, 39, 0.92)';
    el.style.border = '1px solid rgba(249, 115, 22, 0.85)';
    el.style.borderRadius = '999px';
    el.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.35)';
    el.style.color = '#fb923c';
    el.style.font = "800 9px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
    el.style.minWidth = '1.1rem';
    el.style.padding = '0.05rem 0.25rem';
    el.style.pointerEvents = 'none';
    el.style.textAlign = 'center';
    return el;
}

function makeTargetLabelElement(label: string, primary: boolean) {
    const el = document.createElement('div');
    el.style.alignItems = 'center';
    el.style.background = primary
        ? 'linear-gradient(135deg, rgba(6, 78, 59, 0.98), rgba(13, 148, 136, 0.96))'
        : 'rgba(15, 23, 42, 0.94)';
    el.style.border = primary ? '1px solid rgba(209, 250, 229, 0.92)' : '1px solid rgba(226, 232, 240, 0.82)';
    el.style.borderRadius = '999px';
    el.style.boxShadow = primary
        ? '0 0 0 4px rgba(16, 185, 129, 0.16), 0 8px 18px rgba(0, 0, 0, 0.42), inset 0 1px 0 rgba(255, 255, 255, 0.28)'
        : '0 5px 14px rgba(0, 0, 0, 0.38), inset 0 1px 0 rgba(255, 255, 255, 0.20)';
    el.style.color = primary ? '#ecfdf5' : '#f8fafc';
    el.style.display = 'flex';
    el.style.font = "900 9px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
    el.style.gap = '0';
    el.style.height = primary ? '1.55rem' : '1.45rem';
    el.style.justifyContent = 'center';
    el.style.letterSpacing = '0.06em';
    el.style.minWidth = primary ? '2.75rem' : '1.55rem';
    el.style.padding = primary ? '0 0.55rem' : '0 0.36rem';
    el.style.pointerEvents = 'none';
    el.style.textTransform = 'uppercase';

    if (primary) {
        const start = document.createElement('span');
        start.textContent = 'Start';
        start.style.color = '#a7f3d0';
        start.style.fontSize = '0.48rem';
        start.style.letterSpacing = '0.12em';
        start.style.lineHeight = '1';
        el.append(start);
        return el;
    }

    el.textContent = label.padStart(2, '0');
    return el;
}

function routeLabel(type: unknown, nameValue: unknown, fallback?: string) {
    const base = type === 'roman_road' ? 'Roman Road' : 'Historic Trackway';
    const name = typeof nameValue === 'string' ? nameValue.trim() : '';
    return name && name.toLowerCase() !== 'null' ? `${base} - ${name}` : fallback || base;
}

function romanRoadLabel(props: Record<string, unknown> | undefined) {
    return routeLabel('roman_road', props?.name, 'Roman Road');
}

// Callbacks are stored in a ref so map event handlers never go stale
// without needing to be in the map-init effect's dependency array.
type MapCallbacks = {
    onFeatureClick: (id: string) => void;
    onHotspotClick: (id: string) => void;
    onTraceTargetClick: (id: string) => void;
    onDeselect: () => void;
    onDragStart: () => void;
    onZoomChange: (z: number) => void;
    onSetClickLabel: (label: string | null) => void;
    onPASFindLog: (msg: string) => void;
    onPASFindSelect: (find: HistoricFind) => void;
    onCrossingsLog: (msg: string) => void;
    onMonumentClick: (name: string | null) => void;
    onUserFindClick: (id: string) => void;
    onAnnotationDrop: (lat: number, lng: number) => void;
    onSavedPointClick: () => void;
};

export type UseFieldGuideMapOptions = {
    // Data that drives source updates
    hotspots: Hotspot[];
    selectedHotspotId: string | null;
    detectedFeatures: Cluster[];
    selectedTargetId: string | null;
    traceTargets: TraceTarget[];
    selectedTraceId: string | null;
    primaryTargetId: string | null;
    pasFinds: HistoricFind[];
    historicRoutes: HistoricRoute[];
    fieldBoundaries: Array<{ id: string; name: string; permissionId: string; boundary: any }>;
    // Layer visibility drivers
    isSatellite: boolean;
    historicMode: boolean;
    showFields: false | 'all' | string;
    historicLayerVisibility: { routes: boolean; corridors: boolean; crossings: boolean; monuments: boolean; aim: boolean; context: boolean; pasDensity: boolean; userFinds: boolean };
    userFinds: Find[];
    historicLayerToggles: { lidar: boolean; 'lidar-wales': boolean; os1930: boolean; os1880: boolean };
    historicLayerOpacity: { lidar: number; 'lidar-wales': number; os1930: number; os1880: number };
    savedPoints: SavedPoint[];
    showSavedPoints: boolean;
    // Initial fly-to coordinates
    initLat?: number;
    initLng?: number;
    initPinLabel?: string;
    // Dev annotation support
    devMode:        boolean;
    annotationMode: boolean;
    devAnnotations: DevAnnotation[];
    // Event handler callbacks
    callbacks: MapCallbacks;
};

// ─── Wales LiDAR COG ─────────────────────────────────────────────────────────
// Replace this URL with your hosted reprojected COG (EPSG:3857) after completing
// Parts 0-2 of the Wales LiDAR brief (reproject + upload to R2 with range support).
const WALES_LIDAR_COG_URL = 'https://findspot-wales-lidar.trials-uk.workers.dev/wales_hillshade_3857.tif';

let cogProtocolRegistered = false;
function ensureCogProtocolRegistered() {
    if (cogProtocolRegistered) return;
    addProtocol('cog', cogProtocol);
    addProtocol(MAP_TILE_CACHE_PROTOCOL, (params, abortController) =>
        loadCacheBackedTile(params.url, abortController.signal)
    );
    cogProtocolRegistered = true;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useFieldGuideMap({
    hotspots, selectedHotspotId, detectedFeatures, selectedTargetId, traceTargets, selectedTraceId, primaryTargetId, pasFinds, historicRoutes, fieldBoundaries,
    isSatellite, historicMode, showFields, historicLayerVisibility, historicLayerToggles, historicLayerOpacity, userFinds,
    savedPoints, showSavedPoints,
    initLat, initLng, initPinLabel, devMode, annotationMode, devAnnotations, callbacks,
}: UseFieldGuideMapOptions) {
    const mapContainerRef    = useRef<HTMLDivElement>(null);
    const mapRef             = useRef<maplibregl.Map | null>(null);
    const clickLabelTimer    = useRef<ReturnType<typeof setTimeout> | null>(null);
    const callbacksRef       = useRef<MapCallbacks>(callbacks);
    const annotationModeRef  = useRef(false);
    const fieldLabelMarkersRef = useRef<maplibregl.Marker[]>([]);
    const targetLabelMarkersRef = useRef<maplibregl.Marker[]>([]);
    const devAnnotationMarkersRef = useRef<maplibregl.Marker[]>([]);
    const savedPointMarkersRef = useRef<maplibregl.Marker[]>([]);
    const initialPinMarkerRef = useRef<maplibregl.Marker | null>(null);
    const [mapReadyVersion, setMapReadyVersion] = useState(0);

    // Keep callbacks and annotation mode ref current on every render
    useEffect(() => { callbacksRef.current = callbacks; });
    useEffect(() => { annotationModeRef.current = annotationMode; });

    // ── Map initialisation (runs once) ────────────────────────────────────────
    useEffect(() => {
        if (mapRef.current || !mapContainerRef.current) return;

        const showLabel = (label: string) => {
            if (clickLabelTimer.current) clearTimeout(clickLabelTimer.current);
            callbacksRef.current.onSetClickLabel(label);
            clickLabelTimer.current = setTimeout(() => callbacksRef.current.onSetClickLabel(null), 3000);
        };

        ensureCogProtocolRegistered();

        const map = new maplibregl.Map({
            container: mapContainerRef.current,
            style: {
                version: 8,
                sources: {
                    'osm':          { type: 'raster', tiles: [cacheBackedTileUrl('https://a.tile.openstreetmap.org/{z}/{x}/{y}.png')], tileSize: 256, attribution: '&copy; OSM' },
                    'satellite':    { type: 'raster', tiles: [cacheBackedTileUrl('https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}')], tileSize: 256, attribution: 'Esri' },
                    'overlay-lidar':       { type: 'raster', tiles: ['https://environment.data.gov.uk/spatialdata/lidar-composite-digital-terrain-model-dtm-1m-2022/wms?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&FORMAT=image%2Fpng&TRANSPARENT=true&LAYERS=Lidar_Composite_Hillshade_DTM_1m&CRS=EPSG%3A3857&WIDTH=256&HEIGHT=256&BBOX={bbox-epsg-3857}'], tileSize: 256, attribution: 'Environment Agency (OGL)' },
                    'overlay-lidar-wales': { type: 'raster', url: `cog://${WALES_LIDAR_COG_URL}`, tileSize: 256, minzoom: 10, attribution: '© Crown copyright (OGL) — Welsh Government / NRW, DataMapWales' },
                    'overlay-os1930': { type: 'raster', tiles: ['https://mapseries-tilesets.s3.amazonaws.com/os/6inchsecond/{z}/{x}/{y}.png'], tileSize: 256, minzoom: 6, maxzoom: 16, attribution: '&copy; National Library of Scotland' },
                    'overlay-os1880': { type: 'raster', tiles: ['https://mapseries-tilesets.s3.amazonaws.com/1inch_2nd_ed/{z}/{x}/{y}.png'], tileSize: 256, minzoom: 6, maxzoom: 15, attribution: '&copy; National Library of Scotland' },
                },
                layers: [
                    { id: 'osm',      type: 'raster', source: 'osm',      minzoom: 0, maxzoom: 19 },
                    { id: 'satellite',type: 'raster', source: 'satellite', minzoom: 0, maxzoom: 19, layout: { visibility: 'none' } },
                    { id: 'overlay-lidar',       type: 'raster', source: 'overlay-lidar',       layout: { visibility: 'none' }, paint: { 'raster-opacity': 0.8, 'raster-contrast': 0.3, 'raster-brightness-max': 0.9, 'raster-fade-duration': 0 } },
                    { id: 'overlay-lidar-wales', type: 'raster', source: 'overlay-lidar-wales', layout: { visibility: 'none' }, paint: { 'raster-opacity': 0.8, 'raster-contrast': 0.6, 'raster-brightness-max': 0.9, 'raster-saturation': -1, 'raster-fade-duration': 0 } },
                    { id: 'overlay-os1880', type: 'raster', source: 'overlay-os1880', layout: { visibility: 'none' }, paint: { 'raster-opacity': 0.85, 'raster-fade-duration': 0 } },
                    { id: 'overlay-os1930', type: 'raster', source: 'overlay-os1930', layout: { visibility: 'none' }, paint: { 'raster-opacity': 0.85, 'raster-fade-duration': 0 } },
                ],
            } as maplibregl.StyleSpecification,
            center: [-2.0, 54.5],
            zoom: 5.5,
            clickTolerance: 40,
        });

        const initialiseMapLayers = () => {
            if (map.getSource('targets')) return;
            map.addSource('monument-buffers', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
            map.addLayer({ id: 'monument-buffer-fill',    type: 'fill', source: 'monument-buffers', paint: { 'fill-color': '#f97316', 'fill-opacity': 0.16 } });
            map.addLayer({ id: 'monument-buffer-outline', type: 'line', source: 'monument-buffers', paint: { 'line-color': '#f97316', 'line-width': 2, 'line-opacity': 0.85, 'line-dasharray': [3, 2] } });

            map.addSource('monuments', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
            map.addLayer({ id: 'monuments-fill',    type: 'fill', source: 'monuments', paint: { 'fill-color': '#ef4444', 'fill-opacity': 0.25 } });
            map.addLayer({ id: 'monuments-outline', type: 'line', source: 'monuments', paint: { 'line-color': '#ef4444', 'line-width': 3 } });

            map.addSource('aim-monuments', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
            map.addLayer({ id: 'aim-fill',    type: 'fill', source: 'aim-monuments', layout: { visibility: 'none' }, paint: { 'fill-color': '#f97316', 'fill-opacity': 0.2 } });
            map.addLayer({ id: 'aim-outline', type: 'line', source: 'aim-monuments', layout: { visibility: 'none' }, paint: { 'line-color': '#f97316', 'line-width': 2, 'line-opacity': 0.8 } });

            // PAS public-record density — H3 res-6 hexagon grid coloured by count tier
            map.addSource('pas-density', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
            map.addLayer({
                id: 'pas-density-fill', type: 'fill', source: 'pas-density',
                layout: { visibility: 'none' },
                paint: {
                    'fill-color': [
                        'match', ['get', 'tier'],
                        'very-high', '#7c3aed',
                        'high',      '#2563eb',
                        'moderate',  '#0891b2',
                        /* low */    '#a3e7fc',
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
                        'high',      '#2563eb',
                        'moderate',  '#0891b2',
                        '#a3e7fc',
                    ],
                    'line-width': 0.8,
                    'line-opacity': 0.5,
                },
            });

            map.addSource('hotspots-overlay', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
            map.addLayer({
                id: 'hotspots-outline', type: 'line', source: 'hotspots-overlay',
                paint: { 'line-color': ['case', ['>=', ['get', 'score'], 80], '#f59e0b', ['>=', ['get', 'score'], 45], '#10b981', '#3b82f6'], 'line-width': 2.5, 'line-opacity': 0.72 },
            });
            map.addLayer({
                id: 'hotspots-fill', type: 'fill', source: 'hotspots-overlay',
                paint: { 'fill-color': ['case', ['>=', ['get', 'score'], 80], '#f59e0b', ['>=', ['get', 'score'], 45], '#10b981', '#3b82f6'], 'fill-opacity': 0.10 },
            });

            map.addSource('cluster-links', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
            // Casing gives the dashed line definition against any map background
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

            // Trace Signals — translucent secondary layer, always below main targets
            map.addSource('trace-targets', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
            map.addLayer({
                id: 'trace-targets-circle', type: 'circle', source: 'trace-targets',
                paint: {
                    'circle-radius':        7,
                    'circle-color':         '#f59e0b',
                    'circle-opacity':       0.12,
                    'circle-stroke-width':  2,
                    'circle-stroke-color':  '#f59e0b',
                    'circle-stroke-opacity': 0.82,
                },
            });
            // Selected trace — amber highlight ring, rendered above base layer
            map.addLayer({
                id: 'trace-targets-selected', type: 'circle', source: 'trace-targets',
                filter: ['==', ['get', 'id'], ''],
                paint: {
                    'circle-radius':        12,
                    'circle-color':         '#f59e0b',
                    'circle-opacity':       0.18,
                    'circle-stroke-width':  1.5,
                    'circle-stroke-color':  '#f59e0b',
                    'circle-stroke-opacity': 0.70,
                },
            });

            map.addSource('targets', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
            // Primary target halo — static glow ring behind the primary target circle
            map.addLayer({
                id: 'targets-halo', type: 'circle', source: 'targets',
                filter: ['==', ['get', 'isPrimary'], true],
                paint: {
                    'circle-radius': ['interpolate', ['linear'], ['get', 'consensus'], 1, 24, 2, 28, 3, 32],
                    'circle-color':  '#10b981',
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
                    'circle-color':  ['case', ['get', 'isProtected'], '#7f1d1d', ['get', 'isPrimary'], '#0f766e', ['>=', ['get', 'consensus'], 2], '#d97706', ['==', ['get', 'source'], 'terrain'], '#059669', ['==', ['get', 'source'], 'historic'], '#d97706', '#2563eb'],
                    'circle-opacity': ['case', ['get', 'isProtected'], 0.62, 0.92],
                    'circle-stroke-width': ['case', ['get', 'isProtected'], 1.5, ['get', 'isPrimary'], 2.5, 2],
                    'circle-stroke-color': ['case', ['get', 'isProtected'], '#fecaca', ['get', 'isPrimary'], '#d1fae5', '#f8fafc'],
                },
            });
            // Trace signals are secondary, but must remain visible beside the
            // numbered target system. Keep them above target circles while the
            // HTML target badges still sit on top.
            map.moveLayer('trace-targets-circle');
            map.moveLayer('trace-targets-selected');
            map.addSource('pas-finds', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
            map.addLayer({ id: 'pas-circles', type: 'circle', source: 'pas-finds', layout: { visibility: 'none' }, paint: { 'circle-radius': 10, 'circle-color': '#3b82f6', 'circle-stroke-width': 2, 'circle-stroke-color': '#fff' } });

            map.addSource('historic-routes', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
            map.addLayer({ id: 'historic-routes-roman-casing',    type: 'line', source: 'historic-routes', filter: ['==', ['get', 'type'], 'roman_road'],  layout: { visibility: 'none', 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#ffffff', 'line-width': 10, 'line-opacity': 0.35 } });
            map.addLayer({ id: 'historic-routes-roman',           type: 'line', source: 'historic-routes', filter: ['==', ['get', 'type'], 'roman_road'],  layout: { visibility: 'none', 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#3b82f6', 'line-width': 5,  'line-opacity': 0.97 } });
            map.addLayer({ id: 'historic-routes-trackway-casing', type: 'line', source: 'historic-routes', filter: ['!=', ['get', 'type'], 'roman_road'],  layout: { visibility: 'none', 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#ffffff', 'line-width': 7,  'line-opacity': 0.2  } });
            map.addLayer({ id: 'historic-routes-trackway',        type: 'line', source: 'historic-routes', filter: ['!=', ['get', 'type'], 'roman_road'],  layout: { visibility: 'none', 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#93c5fd', 'line-width': 3,  'line-opacity': 0.95, 'line-dasharray': [5, 4] } });

            map.addSource('corridors', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
            map.addLayer({ id: 'corridors-fill',    type: 'fill', source: 'corridors', layout: { visibility: 'none' }, paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.12 } });
            map.addLayer({ id: 'corridors-outline', type: 'line', source: 'corridors', layout: { visibility: 'none', 'line-join': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': 1, 'line-opacity': 0.3, 'line-dasharray': [3, 3] } });

            map.addSource('landscape-context', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
            map.addLayer({ id: 'landscape-context-fill', type: 'fill', source: 'landscape-context', layout: { visibility: 'none' }, paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.08 } });
            map.addLayer({ id: 'landscape-context-outline', type: 'line', source: 'landscape-context', layout: { visibility: 'none', 'line-join': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': 1, 'line-opacity': 0.35, 'line-dasharray': [2, 4] } });

            map.addSource('crossings', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
            map.addLayer({ id: 'crossings-halo',   type: 'circle', source: 'crossings', layout: { visibility: 'none' }, paint: { 'circle-radius': 14, 'circle-color': '#f59e0b', 'circle-opacity': 0.25, 'circle-stroke-width': 0 } });
            map.addLayer({ id: 'crossings-circle', type: 'circle', source: 'crossings', layout: { visibility: 'none' }, paint: { 'circle-radius': 6, 'circle-color': '#f59e0b', 'circle-opacity': 0.95, 'circle-stroke-width': 2, 'circle-stroke-color': '#fff' } });

            // ── Permission field boundaries overlay ───────────────────────────
            map.addSource('permission-fields', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
            map.addLayer({ id: 'permission-fields-fill',    type: 'fill',   source: 'permission-fields', layout: { visibility: 'none' }, paint: { 'fill-color': '#0d9488', 'fill-opacity': 0.08 } });
            map.addLayer({ id: 'permission-fields-outline', type: 'line',   source: 'permission-fields', layout: { visibility: 'none' }, paint: { 'line-color': '#0d9488', 'line-width': 2, 'line-opacity': 0.9, 'line-dasharray': [4, 2] } });


            // ── User recorded finds overlay ───────────────────────────────────
            map.addSource('user-finds', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
            map.addLayer({ id: 'user-finds-circles', type: 'circle', source: 'user-finds', layout: { visibility: 'none' }, paint: { 'circle-radius': 4, 'circle-color': '#34d399', 'circle-opacity': 0.5, 'circle-stroke-width': 1, 'circle-stroke-color': '#000', 'circle-stroke-opacity': 0.3 } });
            // Transparent hitbox layer with larger radius for easier tapping
            map.addLayer({ id: 'user-finds-hitbox', type: 'circle', source: 'user-finds', layout: { visibility: 'none' }, paint: { 'circle-radius': 16, 'circle-color': 'transparent', 'circle-opacity': 0 } });

            // ── Dev annotation pins (dev mode only, never shown to normal users) ──
            map.addSource('dev-annotations', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
            map.addLayer({
                id: 'dev-annotations-halo', type: 'circle', source: 'dev-annotations',
                paint: { 'circle-radius': 18, 'circle-color': '#f97316', 'circle-opacity': 0.15, 'circle-stroke-width': 0 },
            });
            map.addLayer({
                id: 'dev-annotations-circle', type: 'circle', source: 'dev-annotations',
                paint: { 'circle-radius': 6, 'circle-color': '#f97316', 'circle-opacity': 1, 'circle-stroke-width': 2, 'circle-stroke-color': '#fff', 'circle-stroke-opacity': 0.9 },
            });
            setMapReadyVersion(v => v + 1);

            // ── Event handlers — all use callbacksRef so they never go stale ──
            map.on('click', 'targets-circle', (e) => {
                if (annotationModeRef.current) return;
                if (e.features?.[0]) callbacksRef.current.onFeatureClick(e.features[0].properties?.id);
            });
            map.on('click', 'trace-targets-circle', (e) => {
                if (annotationModeRef.current) return;
                if (e.features?.[0]) callbacksRef.current.onTraceTargetClick(e.features[0].properties?.id);
            });
            map.on('mouseenter', 'trace-targets-circle', () => { if (!annotationModeRef.current) map.getCanvas().style.cursor = 'pointer'; });
            map.on('mouseleave', 'trace-targets-circle', () => { map.getCanvas().style.cursor = ''; });
            map.on('click', 'pas-circles', (e) => {
                if (annotationModeRef.current) return;
                if (e.features?.[0]) {
                    const props = e.features[0].properties as Record<string, unknown>;
                    callbacksRef.current.onPASFindLog(`HERITAGE: ${props.objectType} - ${props.id}`);
                    callbacksRef.current.onPASFindSelect({
                        id: String(props.id), internalId: String(props.internalId || ''),
                        objectType: String(props.objectType), broadperiod: String(props.broadperiod),
                        county: String(props.county), workflow: 'PAS',
                        lat: Number(props.lat), lon: Number(props.lon),
                        isApprox: !!props.isApprox, osmType: String(props.osmType || ''),
                    });
                }
            });
            map.on('click', 'hotspots-fill', (e) => {
                if (annotationModeRef.current) return;
                // If a target or other interactive feature is at this point, let it take priority
                const priority = map.queryRenderedFeatures(e.point, { layers: ['targets-circle', 'trace-targets-circle', 'user-finds-hitbox', 'pas-circles'] });
                if (priority.length > 0) return;
                if (e.features?.[0]) callbacksRef.current.onHotspotClick(e.features[0].properties?.id);
            });
            map.on('click', 'user-finds-hitbox', (e) => {
                if (annotationModeRef.current) return;
                const props = e.features?.[0]?.properties as Record<string, unknown> | undefined;
                if (props?.id) callbacksRef.current.onUserFindClick(String(props.id));
            });
            map.on('click', (e) => {
                if (annotationModeRef.current) {
                    callbacksRef.current.onAnnotationDrop(e.lngLat.lat, e.lngLat.lng);
                    return;
                }
                const hits = map.queryRenderedFeatures(e.point, { layers: ['targets-circle', 'trace-targets-circle', 'pas-circles', 'hotspots-fill', 'user-finds-hitbox', 'monuments-fill', 'monument-buffer-fill'] });
                if (hits.length > 0) return;
                callbacksRef.current.onMonumentClick(null);
                callbacksRef.current.onDeselect();
            });
            map.on('dragstart', () => callbacksRef.current.onDragStart());
            map.on('move',      () => callbacksRef.current.onZoomChange(map.getZoom()));

            map.on('click', 'historic-routes-roman',    (e) => { if (!annotationModeRef.current) showLabel(romanRoadLabel(e.features?.[0]?.properties as Record<string, unknown> | undefined)); });
            map.on('click', 'historic-routes-trackway', () => { if (!annotationModeRef.current) showLabel('Historic Trackway'); });
            map.on('click', 'corridors-fill', (e) => {
                if (annotationModeRef.current) return;
                const props = e.features?.[0]?.properties as Record<string, unknown> | undefined;
                showLabel(routeLabel(
                    props?.type,
                    props?.name,
                    props?.type === 'roman_road' ? 'Roman Road Corridor' : 'Historic Trackway Corridor',
                ));
            });
            map.on('click', 'landscape-context-fill', (e) => {
                if (annotationModeRef.current) return;
                const label = e.features?.[0]?.properties?.label;
                showLabel(String(label || 'Landscape Context'));
            });
            map.on('click', 'crossings-circle', (e) => {
                if (annotationModeRef.current) return;
                const p = e.features?.[0]?.properties as Record<string, unknown> | undefined;
                const a = routeLabel(p?.typeA, p?.nameA, p?.typeA === 'roman_road' ? 'Roman Road' : 'Trackway');
                const b = routeLabel(p?.typeB, p?.nameB, p?.typeB === 'roman_road' ? 'Roman Road' : 'Trackway');
                showLabel(`Route Crossing: ${a} × ${b}`);
            });
            map.on('click', 'monuments-fill', (e) => {
                if (annotationModeRef.current) return;
                const name = e.features?.[0]?.properties?.Name as string | undefined;
                callbacksRef.current.onMonumentClick(name ?? '');
            });
            map.on('click', 'monument-buffer-fill', (e) => {
                if (annotationModeRef.current) return;
                const name = e.features?.[0]?.properties?.Name as string | undefined;
                callbacksRef.current.onMonumentClick(name ?? '');
            });
            map.on('click', 'aim-fill', (e) => {
                if (annotationModeRef.current) return;
                const p = e.features?.[0]?.properties as Record<string, unknown> | undefined;
                const type   = String(p?.MONUMENT_TYPE || 'Aerial Monument');
                const period = p?.PERIOD ? ` · ${p.PERIOD}` : '';
                showLabel(`${type}${period}`);
            });

            if (initLat !== undefined && initLng !== undefined && !isNaN(initLat) && !isNaN(initLng)) {
                map.flyTo({ center: [initLng, initLat], zoom: initPinLabel ? 18 : 14 });
                if (initPinLabel) {
                    initialPinMarkerRef.current?.remove();
                    const marker = document.createElement('div');
                    marker.style.alignItems = 'center';
                    marker.style.display = 'flex';
                    marker.style.flexDirection = 'column';
                    marker.style.gap = '0.25rem';
                    marker.style.pointerEvents = 'none';

                    const dot = document.createElement('div');
                    dot.style.width = '1.1rem';
                    dot.style.height = '1.1rem';
                    dot.style.borderRadius = '999px';
                    dot.style.background = '#10b981';
                    dot.style.border = '3px solid #ecfdf5';
                    dot.style.boxShadow = '0 0 0 6px rgba(16,185,129,0.22), 0 10px 24px rgba(0,0,0,0.38)';

                    const label = document.createElement('div');
                    label.textContent = initPinLabel;
                    label.style.background = 'rgba(2, 6, 23, 0.94)';
                    label.style.border = '1px solid rgba(16, 185, 129, 0.55)';
                    label.style.borderRadius = '999px';
                    label.style.boxShadow = '0 8px 20px rgba(0, 0, 0, 0.35)';
                    label.style.color = '#a7f3d0';
                    label.style.font = "900 9px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
                    label.style.letterSpacing = '0.08em';
                    label.style.padding = '0.18rem 0.5rem';
                    label.style.textTransform = 'uppercase';
                    label.style.whiteSpace = 'nowrap';

                    marker.append(dot, label);
                    initialPinMarkerRef.current = new maplibregl.Marker({ element: marker, anchor: 'bottom', offset: [0, -6] })
                        .setLngLat([initLng, initLat])
                        .addTo(map);
                }
            }
            setTimeout(() => map.resize(), 300);
        };

        if (map.isStyleLoaded()) initialiseMapLayers();
        else map.once('style.load', initialiseMapLayers);
        map.once('load', initialiseMapLayers);

        mapRef.current = map;
        return () => {
            if (clickLabelTimer.current) clearTimeout(clickLabelTimer.current);
            fieldLabelMarkersRef.current.forEach(marker => marker.remove());
            fieldLabelMarkersRef.current = [];
            targetLabelMarkersRef.current.forEach(marker => marker.remove());
            targetLabelMarkersRef.current = [];
            devAnnotationMarkersRef.current.forEach(marker => marker.remove());
            devAnnotationMarkersRef.current = [];
            savedPointMarkersRef.current.forEach(marker => marker.remove());
            savedPointMarkersRef.current = [];
            initialPinMarkerRef.current?.remove();
            initialPinMarkerRef.current = null;
            if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }
        };
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // ── Basemap toggle ────────────────────────────────────────────────────────
    useEffect(() => {
        const map = mapRef.current;
        if (!map) return;
        if (map.getLayer('osm'))       map.setLayoutProperty('osm',       'visibility', isSatellite ? 'none' : 'visible');
        if (map.getLayer('satellite')) map.setLayoutProperty('satellite',  'visibility', isSatellite ? 'visible' : 'none');
    }, [isSatellite]);

    // ── Hotspot overlay source ────────────────────────────────────────────────
    useEffect(() => {
        const map = mapRef.current;
        if (!map) return;
        const source = map.getSource('hotspots-overlay') as maplibregl.GeoJSONSource;
        if (!source) return;
        source.setData({
            type: 'FeatureCollection',
            features: hotspots
                .filter(h => h.id === selectedHotspotId)
                .map(h => ({
                    type: 'Feature' as const,
                    geometry: { type: 'Polygon' as const, coordinates: [[[h.bounds[0][0], h.bounds[0][1]], [h.bounds[1][0], h.bounds[0][1]], [h.bounds[1][0], h.bounds[1][1]], [h.bounds[0][0], h.bounds[1][1]], [h.bounds[0][0], h.bounds[0][1]]]] },
                    properties: { id: h.id, type: h.type, score: h.score },
                })),
        } as GeoJSON.FeatureCollection);
    }, [hotspots, selectedHotspotId, mapReadyVersion]);

    // ── Detected features (targets) source ───────────────────────────────────
    useEffect(() => {
        const map = mapRef.current;
        if (!map) return;
        const source = map.getSource('targets') as maplibregl.GeoJSONSource;
        if (!source) return;
        source.setData({
            type: 'FeatureCollection',
            features: detectedFeatures.filter(f => !f.isRouteArtefactRisk).map(f => ({
                type: 'Feature' as const,
                geometry: { type: 'Point' as const, coordinates: f.center },
                properties: {
                    id: f.id,
                    number: f.number.toString(),
                    isProtected: f.isProtected,
                    source: f.sources[0],
                    consensus: f.sources.length,
                    isPrimary: f.id === primaryTargetId,
                },
            })),
        } as GeoJSON.FeatureCollection);
    }, [detectedFeatures, primaryTargetId, mapReadyVersion]);

    // ── Selected target highlight ────────────────────────────────────────────
    useEffect(() => {
        const map = mapRef.current;
        if (!map) return;
        const layer = map.getLayer('targets-selected');
        if (!layer) return;
        map.setFilter('targets-selected', ['==', ['get', 'id'], selectedTargetId ?? '']);
    }, [selectedTargetId, mapReadyVersion]);

    // ── Target pin labels ────────────────────────────────────────────────────
    useEffect(() => {
        const map = mapRef.current;
        if (!map) return;
        targetLabelMarkersRef.current.forEach(marker => marker.remove());
        targetLabelMarkersRef.current = [];

        detectedFeatures
            .filter(f => !f.isRouteArtefactRisk && !f.isProtected)
            .forEach(f => {
                const primary = f.id === primaryTargetId;
                const marker = new maplibregl.Marker({
                    element: makeTargetLabelElement(f.number.toString(), primary),
                    anchor: 'center',
                })
                    .setLngLat(f.center)
                    .addTo(map);
                targetLabelMarkersRef.current.push(marker);
            });
    }, [detectedFeatures, primaryTargetId, mapReadyVersion]);

    // ── Trace Signals source ──────────────────────────────────────────────────
    useEffect(() => {
        const map = mapRef.current;
        if (!map) return;
        const source = map.getSource('trace-targets') as maplibregl.GeoJSONSource;
        if (!source) return;
        source.setData({
            type: 'FeatureCollection',
            features: traceTargets.map(t => ({
                type: 'Feature' as const,
                geometry: { type: 'Point' as const, coordinates: t.center },
                properties: { id: t.id, traceLabel: t.traceLabel, traceScore: t.traceScore },
            })),
        } as GeoJSON.FeatureCollection);
    }, [traceTargets, mapReadyVersion]);

    // ── Trace selected highlight filter ──────────────────────────────────────
    useEffect(() => {
        const map = mapRef.current;
        if (!map) return;
        const layer = map.getLayer('trace-targets-selected');
        if (!layer) return;
        map.setFilter('trace-targets-selected', ['==', ['get', 'id'], selectedTraceId ?? '']);
    }, [selectedTraceId, mapReadyVersion]);

    // ── Cluster link lines ────────────────────────────────────────────────────
    useEffect(() => {
        const map = mapRef.current;
        if (!map) return;
        const source = map.getSource('cluster-links') as maplibregl.GeoJSONSource;
        if (!source) return;
        const validFeatures = detectedFeatures.filter(f => !f.isRouteArtefactRisk);
        const idToCenter = new Map(validFeatures.map(f => [f.id, f.center]));
        const seen = new Set<string>();
        const features: GeoJSON.Feature[] = [];
        for (const f of validFeatures) {
            if (!f.linkedClusterIds?.length) continue;
            for (const linkedId of f.linkedClusterIds) {
                const key = [f.id, linkedId].sort().join('|');
                if (seen.has(key)) continue;
                seen.add(key);
                const target = idToCenter.get(linkedId);
                if (!target) continue;
                features.push({
                    type: 'Feature',
                    geometry: { type: 'LineString', coordinates: [f.center, target] },
                    properties: {},
                } as GeoJSON.Feature);
            }
        }
        source.setData({ type: 'FeatureCollection', features } as GeoJSON.FeatureCollection);
    }, [detectedFeatures, mapReadyVersion]);

    // ── PAS finds source ──────────────────────────────────────────────────────
    useEffect(() => {
        const map = mapRef.current;
        if (!map) return;
        const coordGroups: Record<string, number> = {};
        const pasGeoJSON: GeoJSON.FeatureCollection = {
            type: 'FeatureCollection',
            features: pasFinds.map(f => {
                const key = `${f.lat.toFixed(4)},${f.lon.toFixed(4)}`;
                const count = coordGroups[key] || 0;
                coordGroups[key] = count + 1;
                return {
                    type: 'Feature' as const,
                    geometry: { type: 'Point' as const, coordinates: [f.lon + count * 0.0001, f.lat + count * 0.0001] },
                    properties: { ...f },
                };
            }),
        };
        let canceled = false;
        const updateSource = () => {
            if (canceled) return;
            const source = mapRef.current?.getSource('pas-finds') as maplibregl.GeoJSONSource;
            if (source) { source.setData(pasGeoJSON); }
            else if (!mapRef.current?.loaded()) { setTimeout(updateSource, 500); }
        };
        updateSource();
        return () => { canceled = true; };
    }, [pasFinds]);

    // ── PAS density hexagons ──────────────────────────────────────────────────
    // Loaded once after the map is ready; the index is cached at module level
    // so subsequent renders (e.g. visibility toggle) don't re-fetch.
    useEffect(() => {
        if (!mapReadyVersion) return;
        let canceled = false;
        getPASDensityGeoJSON().then(geojson => {
            if (canceled) return;
            const source = mapRef.current?.getSource('pas-density') as maplibregl.GeoJSONSource;
            if (source) source.setData(geojson);
        }).catch(() => { /* index unavailable — layer stays empty */ });
        return () => { canceled = true; };
    }, [mapReadyVersion]);

    // ── Historic routes → route lines, corridors, crossings ──────────────────
    useEffect(() => {
        const map = mapRef.current;
        if (!map) return;
        const doUpdate = () => {
            const routeSrc = map.getSource('historic-routes') as maplibregl.GeoJSONSource;
            if (routeSrc) {
                routeSrc.setData({
                    type: 'FeatureCollection',
                    features: historicRoutes.map(r => ({
                        type: 'Feature' as const,
                        geometry: { type: 'LineString' as const, coordinates: r.geometry },
                        properties: { type: r.type, id: r.id, ...(r.name ? { name: r.name } : {}) },
                    })),
                });
            }
            if (historicRoutes.length === 0) {
                const cSrc = map.getSource('corridors') as maplibregl.GeoJSONSource;
                if (cSrc) cSrc.setData({ type: 'FeatureCollection', features: [] });
                const xSrc = map.getSource('crossings') as maplibregl.GeoJSONSource;
                if (xSrc) xSrc.setData({ type: 'FeatureCollection', features: [] });
                return;
            }

            const corridorFeatures: GeoJSON.Feature[] = [];
            for (const r of historicRoutes) {
                try {
                    const line = turf.lineString(r.geometry);
                    const bufferKm = r.type === 'roman_road' ? 0.3 : 0.15;
                    const color    = r.type === 'roman_road' ? '#3b82f6' : '#93c5fd';
                    const buffered = turf.buffer(line, bufferKm, { units: 'kilometers' });
                    if (buffered) { buffered.properties = { routeId: r.id, type: r.type, name: r.name, color }; corridorFeatures.push(buffered as GeoJSON.Feature); }
                } catch { /* skip malformed geometry */ }
            }
            const corridorSrc = map.getSource('corridors') as maplibregl.GeoJSONSource;
            if (corridorSrc) corridorSrc.setData({ type: 'FeatureCollection', features: corridorFeatures });

            const crossingFeatures: GeoJSON.Feature[] = [];
            const seen = new Set<string>();
            for (let i = 0; i < historicRoutes.length; i++) {
                for (let j = i + 1; j < historicRoutes.length; j++) {
                    // Skip adjacent segments of the same Itiner-e road — shared endpoints
                    // are segment joins, not genuine route crossings.
                    if (historicRoutes[i].source === 'itinere' && historicRoutes[j].source === 'itinere' &&
                        historicRoutes[i].name && historicRoutes[i].name === historicRoutes[j].name) continue;
                    try {
                        const a = turf.lineString(historicRoutes[i].geometry);
                        const b = turf.lineString(historicRoutes[j].geometry);
                        const intersects = turf.lineIntersect(a, b);
                        for (const pt of intersects.features) {
                            const key = pt.geometry.coordinates.map(c => c.toFixed(5)).join(',');
                            if (seen.has(key)) continue;
                            seen.add(key);
                            crossingFeatures.push({
                                ...pt,
                                properties: {
                                    typeA: historicRoutes[i].type, typeB: historicRoutes[j].type,
                                    nameA: historicRoutes[i].name, nameB: historicRoutes[j].name,
                                    label: `${historicRoutes[i].type === 'roman_road' ? 'Roman road' : 'Trackway'} × ${historicRoutes[j].type === 'roman_road' ? 'Roman road' : 'Trackway'}`,
                                },
                            });
                        }
                    } catch { /* skip */ }
                }
            }
            const crossingSrc = map.getSource('crossings') as maplibregl.GeoJSONSource;
            if (crossingSrc) crossingSrc.setData({ type: 'FeatureCollection', features: crossingFeatures });
            if (crossingFeatures.length > 0) {
                callbacksRef.current.onCrossingsLog(`CROSSINGS: ${crossingFeatures.length} route intersection${crossingFeatures.length !== 1 ? 's' : ''} detected — high-value targets.`);
            }
        };
        doUpdate();
    }, [historicRoutes, mapReadyVersion]); // eslint-disable-line react-hooks/exhaustive-deps

    // ── Landscape context layer ─────────────────────────────────────────────────
    useEffect(() => {
        const map = mapRef.current;
        if (!map) return;
        const doUpdate = () => {
            const src = map.getSource('landscape-context') as maplibregl.GeoJSONSource | undefined;
            if (!src) return;

            const features: GeoJSON.Feature[] = [];

            for (const r of historicRoutes) {
                try {
                    const line = turf.lineString(r.geometry);
                    const buffered = turf.buffer(line, r.type === 'roman_road' ? 0.55 : 0.35, { units: 'kilometers' });
                    if (buffered) {
                        buffered.properties = {
                            kind: 'route_context',
                            label: routeLabel(
                                r.type,
                                r.name,
                                r.type === 'roman_road' ? 'Historic route corridor' : 'Historic movement corridor',
                            ),
                            routeId: r.id,
                            type: r.type,
                            name: r.name,
                            color: '#60a5fa',
                        };
                        features.push(buffered as GeoJSON.Feature);
                    }
                } catch { /* skip malformed geometry */ }
            }

            if (pasFinds.length >= 3) {
                try {
                    const points = turf.featureCollection(pasFinds.map(f => turf.point([f.lon, f.lat])));
                    const center = turf.center(points);
                    const buffered = turf.buffer(center, 0.5, { units: 'kilometers' });
                    if (buffered) {
                        buffered.properties = {
                            kind: 'historic_density',
                            label: 'Historic record density',
                            color: '#f59e0b',
                        };
                        features.push(buffered as GeoJSON.Feature);
                    }
                } catch { /* skip malformed density context */ }
            }

            src.setData({ type: 'FeatureCollection', features } as GeoJSON.FeatureCollection);
        };
        if (map.getSource('landscape-context')) doUpdate();
        else map.once('style.load', doUpdate);
    }, [historicRoutes, pasFinds, mapReadyVersion]); // eslint-disable-line react-hooks/exhaustive-deps

    // ── Config-driven layer visibility ────────────────────────────────────────
    useEffect(() => {
        const map = mapRef.current;
        if (!map) return;
        const layerState: LayerState = { historicMode, devMode, visibility: historicLayerVisibility };
        LAYER_VISIBILITY_CONFIG.forEach(({ id, visibleWhen }) => {
            if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visibleWhen(layerState) ? 'visible' : 'none');
        });
    }, [historicMode, devMode, historicLayerVisibility, mapReadyVersion]);

    // ── Overlay raster toggles ────────────────────────────────────────────────
    useEffect(() => {
        const map = mapRef.current;
        if (!map) return;
        if (map.getLayer('overlay-lidar')) {
            map.setLayoutProperty('overlay-lidar', 'visibility', historicLayerToggles.lidar ? 'visible' : 'none');
            map.setPaintProperty('overlay-lidar', 'raster-opacity', historicLayerOpacity.lidar);
        }
        if (map.getLayer('overlay-lidar-wales')) {
            map.setLayoutProperty('overlay-lidar-wales', 'visibility', historicLayerToggles['lidar-wales'] ? 'visible' : 'none');
            map.setPaintProperty('overlay-lidar-wales', 'raster-opacity', historicLayerOpacity['lidar-wales']);
        }
        if (map.getLayer('overlay-os1930')) {
            map.setLayoutProperty('overlay-os1930', 'visibility', historicLayerToggles.os1930 ? 'visible' : 'none');
            map.setPaintProperty('overlay-os1930', 'raster-opacity', historicLayerOpacity.os1930);
        }
        if (map.getLayer('overlay-os1880')) {
            map.setLayoutProperty('overlay-os1880', 'visibility', historicLayerToggles.os1880 ? 'visible' : 'none');
            map.setPaintProperty('overlay-os1880', 'raster-opacity', historicLayerOpacity.os1880);
        }
    }, [historicLayerToggles, historicLayerOpacity, mapReadyVersion]);

    // ── Field boundaries data ─────────────────────────────────────────────────
    useEffect(() => {
        const map = mapRef.current;
        if (!map) return;
        let canceled = false;
        const doUpdate = () => {
            if (canceled) return;
            const src = map.getSource('permission-fields') as maplibregl.GeoJSONSource | undefined;
            if (!src) return;
            const visible = showFields !== false
                ? fieldBoundaries.filter(f => {
                    if (!f.boundary) return false;
                    if (showFields === 'all') return true;
                    if (typeof showFields === 'string' && showFields.startsWith('field:')) return f.id === showFields.slice(6);
                    return f.permissionId === showFields;
                })
                : [];
            src.setData({
                type: 'FeatureCollection',
                features: visible.map(f => ({ type: 'Feature', geometry: f.boundary, properties: { id: f.id, name: f.name } }))
            } as any);

            fieldLabelMarkersRef.current.forEach(marker => marker.remove());
            fieldLabelMarkersRef.current = [];
            visible.forEach(field => {
                const center = getPolygonCenter(field.boundary);
                if (!center) return;
                const marker = new maplibregl.Marker({ element: makeFieldLabelElement(field.name), anchor: 'center' })
                    .setLngLat(center)
                    .addTo(map);
                fieldLabelMarkersRef.current.push(marker);
            });
        };
        if (map.getSource('permission-fields')) doUpdate();
        else map.once('style.load', doUpdate);
        return () => { canceled = true; };
    }, [fieldBoundaries, showFields]); // eslint-disable-line react-hooks/exhaustive-deps

    // ── Field boundaries visibility ───────────────────────────────────────────
    useEffect(() => {
        const map = mapRef.current;
        if (!map) return;
        const vis = showFields !== false ? 'visible' : 'none';
        ['permission-fields-fill', 'permission-fields-outline'].forEach(id => {
            if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', vis);
        });
    }, [showFields]); // eslint-disable-line react-hooks/exhaustive-deps

    // ── User finds data ───────────────────────────────────────────────────────
    useEffect(() => {
        const geoJSON: GeoJSON.FeatureCollection = {
            type: 'FeatureCollection',
            features: userFinds
                .filter(f => f.lat !== null && f.lon !== null)
                .map(f => ({
                    type: 'Feature' as const,
                    geometry: { type: 'Point' as const, coordinates: [f.lon!, f.lat!] },
                    properties: { id: f.id, objectType: f.objectType, period: f.period },
                })),
        };
        let canceled = false;
        const updateSource = () => {
            if (canceled) return;
            const src = mapRef.current?.getSource('user-finds') as maplibregl.GeoJSONSource | undefined;
            if (src) { src.setData(geoJSON); }
            else if (!mapRef.current?.loaded()) { setTimeout(updateSource, 500); }
        };
        updateSource();
        return () => { canceled = true; };
    }, [userFinds]); // eslint-disable-line react-hooks/exhaustive-deps

    // ── User finds visibility ─────────────────────────────────────────────────
    useEffect(() => {
        let canceled = false;
        const vis = historicLayerVisibility.userFinds ? 'visible' : 'none';
        const applyVisibility = () => {
            if (canceled) return;
            const map = mapRef.current;
            if (!map) return;
            const hasCircle = !!map.getLayer('user-finds-circles');
            const hasHitbox = !!map.getLayer('user-finds-hitbox');
            if (!hasCircle || !hasHitbox) {
                setTimeout(applyVisibility, 250);
                return;
            }
            map.setLayoutProperty('user-finds-circles', 'visibility', vis);
            map.setLayoutProperty('user-finds-hitbox',  'visibility', vis);
        };
        applyVisibility();
        return () => { canceled = true; };
    }, [historicLayerVisibility.userFinds]); // eslint-disable-line react-hooks/exhaustive-deps

    // ── Annotation mode cursor ────────────────────────────────────────────────
    useEffect(() => {
        const canvas = mapRef.current?.getCanvas();
        if (!canvas) return;
        canvas.style.cursor = annotationMode ? 'crosshair' : '';
    }, [annotationMode]);

    // ── Dev annotation pins ───────────────────────────────────────────────────
    useEffect(() => {
        const map = mapRef.current;
        if (!map) return;
        let canceled = false;
        const doUpdate = () => {
            if (canceled) return;
            const src = map.getSource('dev-annotations') as maplibregl.GeoJSONSource | undefined;
            if (!src) return;
            src.setData({
                type: 'FeatureCollection',
                features: devAnnotations.map((a, i) => ({
                    type: 'Feature' as const,
                    geometry: { type: 'Point' as const, coordinates: [a.lon, a.lat] },
                    properties: { id: a.id, index: i + 1, annotationType: a.annotationType },
                })),
            } as GeoJSON.FeatureCollection);

            devAnnotationMarkersRef.current.forEach(marker => marker.remove());
            devAnnotationMarkersRef.current = [];
            devAnnotations.forEach((annotation, index) => {
                const marker = new maplibregl.Marker({ element: makeAnnotationLabelElement(index + 1), anchor: 'bottom', offset: [0, -14] })
                    .setLngLat([annotation.lon, annotation.lat])
                    .addTo(map);
                devAnnotationMarkersRef.current.push(marker);
            });
        };
        if (map.getSource('dev-annotations')) doUpdate();
        else map.once('style.load', doUpdate);
        return () => { canceled = true; };
    }, [devAnnotations, mapReadyVersion]);

    // ── Saved point markers ───────────────────────────────────────────────────
    useEffect(() => {
        savedPointMarkersRef.current.forEach(m => m.remove());
        savedPointMarkersRef.current = [];
        const map = mapRef.current;
        if (!map || !showSavedPoints || savedPoints.length === 0) return;

        const doAdd = () => {
            savedPointMarkersRef.current.forEach(m => m.remove());
            savedPointMarkersRef.current = [];
            for (const sp of savedPoints) {
                // Marker element — bookmark icon, all static SVG (no user data)
                const el = document.createElement('div');
                el.style.cursor = 'pointer';
                el.style.lineHeight = '0';
                el.innerHTML = `<svg width="22" height="22" viewBox="0 0 24 24" fill="#10b981" stroke="#34d399" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="filter:drop-shadow(0 2px 4px rgba(0,0,0,0.5))"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>`;

                // Relative date (computed from ISO string — not user input)
                const diff = Date.now() - new Date(sp.createdAt).getTime();
                const days = Math.floor(diff / 86400000);
                const dateStr = days === 0 ? 'Today' : days === 1 ? 'Yesterday' : days < 7 ? `${days} days ago` : new Date(sp.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

                // Build popup with DOM nodes — never inject user data via innerHTML
                const popupEl = document.createElement('div');
                popupEl.style.cssText = 'background:#0f172a;border:1px solid rgba(255,255,255,0.1);border-radius:12px;padding:10px 12px;min-width:160px;box-shadow:0 8px 24px rgba(0,0,0,0.4);';

                const labelEl = document.createElement('p');
                labelEl.style.cssText = 'font-size:13px;font-weight:900;color:#fff;margin:0 0 2px;line-height:1.2;';
                labelEl.textContent = sp.label;
                popupEl.appendChild(labelEl);

                const dateEl = document.createElement('p');
                dateEl.style.cssText = 'font-size:9px;color:rgba(255,255,255,0.4);margin:0;';
                dateEl.textContent = dateStr;
                popupEl.appendChild(dateEl);

                if (sp.scanSnapshot) {
                    const snapEl = document.createElement('p');
                    snapEl.style.cssText = 'font-size:9px;color:rgba(52,211,153,0.7);margin:2px 0 0;';
                    snapEl.textContent = `${sp.scanSnapshot.hotspotCount} hotspot${sp.scanSnapshot.hotspotCount !== 1 ? 's' : ''} · ${sp.scanSnapshot.topHotspotTitle}`;
                    popupEl.appendChild(snapEl);
                }

                const btnRow = document.createElement('div');
                btnRow.style.cssText = 'display:flex;gap:6px;margin-top:8px;';

                const flyBtn = document.createElement('button');
                flyBtn.style.cssText = 'flex:1;padding:5px 8px;border-radius:8px;background:#059669;color:#fff;font-size:9px;font-weight:900;text-transform:uppercase;letter-spacing:0.1em;border:none;cursor:pointer;';
                flyBtn.textContent = 'Fly here';
                flyBtn.addEventListener('click', () => {
                    map.flyTo({ center: [sp.lon, sp.lat], zoom: sp.zoom });
                });

                // Two-tap confirm — consistent with the sheet list delete behaviour
                let deleteConfirmPending = false;
                let deleteConfirmTimer: ReturnType<typeof setTimeout> | null = null;
                const deleteBtn = document.createElement('button');
                deleteBtn.style.cssText = 'padding:5px 8px;border-radius:8px;background:rgba(255,255,255,0.06);color:rgba(255,255,255,0.35);font-size:9px;border:1px solid rgba(255,255,255,0.1);cursor:pointer;';
                deleteBtn.title = 'Delete';
                deleteBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
                deleteBtn.addEventListener('click', async () => {
                    if (deleteConfirmPending) {
                        if (deleteConfirmTimer) clearTimeout(deleteConfirmTimer);
                        await deletePack({ ownerType: 'savedPoint', ownerId: sp.id }).catch(() => {});
                        await db.savedPoints.delete(sp.id);
                    } else {
                        deleteConfirmPending = true;
                        deleteBtn.style.background = 'rgba(239,68,68,0.15)';
                        deleteBtn.style.color = '#f87171';
                        deleteBtn.style.borderColor = 'rgba(239,68,68,0.4)';
                        deleteBtn.title = 'Tap again to confirm';
                        deleteConfirmTimer = setTimeout(() => {
                            deleteConfirmPending = false;
                            deleteBtn.style.background = 'rgba(255,255,255,0.06)';
                            deleteBtn.style.color = 'rgba(255,255,255,0.35)';
                            deleteBtn.style.borderColor = 'rgba(255,255,255,0.1)';
                            deleteBtn.title = 'Delete';
                        }, 3000);
                    }
                });

                btnRow.appendChild(flyBtn);
                btnRow.appendChild(deleteBtn);
                popupEl.appendChild(btnRow);

                const popup = new maplibregl.Popup({ closeButton: true, closeOnClick: false, offset: 12 })
                    .setDOMContent(popupEl);

                const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
                    .setLngLat([sp.lon, sp.lat])
                    .setPopup(popup)
                    .addTo(map);

                el.addEventListener('click', () => {
                    map.flyTo({ center: [sp.lon, sp.lat], zoom: sp.zoom });
                    callbacksRef.current.onSavedPointClick();
                });

                savedPointMarkersRef.current.push(marker);
            }
        };

        doAdd();
    }, [savedPoints, showSavedPoints]); // eslint-disable-line react-hooks/exhaustive-deps

    // ── Exposed helpers ───────────────────────────────────────────────────────

    /** Clear all GeoJSON sources back to empty — call on scan clear */
    const clearMapSources = () => {
        const map = mapRef.current;
        if (!map) return;
        const sources = ['monuments', 'monument-buffers', 'trace-targets', 'targets', 'cluster-links', 'historic-routes', 'aim-monuments', 'corridors', 'landscape-context', 'crossings'];
        sources.forEach(id => {
            const src = map.getSource(id) as maplibregl.GeoJSONSource | undefined;
            if (src) src.setData({ type: 'FeatureCollection', features: [] });
        });
    };

    return { mapContainerRef, mapRef, clearMapSources };
}
