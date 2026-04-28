import { useEffect, useLayoutEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import * as turf from '@turf/turf';
import { Cluster, Hotspot, HistoricFind, HistoricRoute } from '../pages/fieldGuideTypes';
import { Find } from '../db';

// ─── Types ────────────────────────────────────────────────────────────────────

interface LayerState {
    historicMode: boolean;
    visibility: { routes: boolean; corridors: boolean; crossings: boolean; monuments: boolean; aim: boolean };
}

const LAYER_VISIBILITY_CONFIG: Array<{ id: string; visibleWhen: (s: LayerState) => boolean }> = [
    { id: 'pas-circles',                     visibleWhen: s => s.historicMode && s.visibility.monuments },
    { id: 'historic-routes-roman-casing',    visibleWhen: s => s.historicMode && s.visibility.routes },
    { id: 'historic-routes-roman',           visibleWhen: s => s.historicMode && s.visibility.routes },
    { id: 'historic-routes-trackway-casing', visibleWhen: s => s.historicMode && s.visibility.routes },
    { id: 'historic-routes-trackway',        visibleWhen: s => s.historicMode && s.visibility.routes },
    { id: 'aim-fill',                        visibleWhen: s => s.historicMode && s.visibility.aim },
    { id: 'aim-outline',                     visibleWhen: s => s.historicMode && s.visibility.aim },
    { id: 'corridors-fill',                  visibleWhen: s => s.historicMode && s.visibility.corridors },
    { id: 'corridors-outline',               visibleWhen: s => s.historicMode && s.visibility.corridors },
    { id: 'crossings-halo',                  visibleWhen: s => s.historicMode && s.visibility.crossings },
    { id: 'crossings-circle',                visibleWhen: s => s.historicMode && s.visibility.crossings },
    { id: 'cluster-links-line',              visibleWhen: s => !s.historicMode },
    { id: 'targets-circle',                  visibleWhen: s => !s.historicMode },
    { id: 'hotspots-outline',                visibleWhen: s => !s.historicMode },
    { id: 'hotspots-fill',                   visibleWhen: s => !s.historicMode },
];

// Callbacks are stored in a ref so map event handlers never go stale
// without needing to be in the map-init effect's dependency array.
type MapCallbacks = {
    onFeatureClick: (id: string) => void;
    onHotspotClick: (id: string) => void;
    onDeselect: () => void;
    onDragStart: () => void;
    onZoomChange: (z: number) => void;
    onSetClickLabel: (label: string | null) => void;
    onPASFindLog: (msg: string) => void;
    onPASFindSelect: (find: HistoricFind) => void;
    onCrossingsLog: (msg: string) => void;
    onMonumentClick: (name: string | null) => void;
};

export type UseFieldGuideMapOptions = {
    // Data that drives source updates
    hotspots: Hotspot[];
    selectedHotspotId: string | null;
    detectedFeatures: Cluster[];
    pasFinds: HistoricFind[];
    historicRoutes: HistoricRoute[];
    fieldBoundaries: Array<{ id: string; name: string; permissionId: string; boundary: any }>;
    // Layer visibility drivers
    isSatellite: boolean;
    historicMode: boolean;
    showFields: false | 'all' | string;
    historicLayerVisibility: { routes: boolean; corridors: boolean; crossings: boolean; monuments: boolean; aim: boolean; userFinds: boolean };
    userFinds: Find[];
    historicLayerToggles: { lidar: boolean; os1930: boolean; os1880: boolean };
    // Initial fly-to coordinates
    initLat?: number;
    initLng?: number;
    // Event handler callbacks
    callbacks: MapCallbacks;
};

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useFieldGuideMap({
    hotspots, selectedHotspotId, detectedFeatures, pasFinds, historicRoutes, fieldBoundaries,
    isSatellite, historicMode, showFields, historicLayerVisibility, historicLayerToggles, userFinds,
    initLat, initLng, callbacks,
}: UseFieldGuideMapOptions) {
    const mapContainerRef = useRef<HTMLDivElement>(null);
    const mapRef          = useRef<maplibregl.Map | null>(null);
    const clickLabelTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const callbacksRef    = useRef<MapCallbacks>(callbacks);

    // Keep callbacks ref current on every render — no effect needed, refs are synchronous
    useLayoutEffect(() => { callbacksRef.current = callbacks; });

    // ── Map initialisation (runs once) ────────────────────────────────────────
    useEffect(() => {
        if (mapRef.current || !mapContainerRef.current) return;

        const showLabel = (label: string) => {
            if (clickLabelTimer.current) clearTimeout(clickLabelTimer.current);
            callbacksRef.current.onSetClickLabel(label);
            clickLabelTimer.current = setTimeout(() => callbacksRef.current.onSetClickLabel(null), 3000);
        };

        const map = new maplibregl.Map({
            container: mapContainerRef.current,
            style: {
                version: 8,
                sources: {
                    'osm':          { type: 'raster', tiles: ['https://a.tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, attribution: '&copy; OSM' },
                    'satellite':    { type: 'raster', tiles: ['https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'], tileSize: 256, attribution: 'Esri' },
                    'overlay-lidar':  { type: 'raster', tiles: ['https://environment.data.gov.uk/spatialdata/lidar-composite-digital-terrain-model-dtm-1m-2022/wms?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&FORMAT=image%2Fpng&TRANSPARENT=true&LAYERS=Lidar_Composite_Hillshade_DTM_1m&CRS=EPSG%3A3857&WIDTH=256&HEIGHT=256&BBOX={bbox-epsg-3857}'], tileSize: 256, attribution: 'Environment Agency (OGL)' },
                    'overlay-os1930': { type: 'raster', tiles: ['https://mapseries-tilesets.s3.amazonaws.com/os/6inchsecond/{z}/{x}/{y}.png'], tileSize: 256, minzoom: 6, maxzoom: 16, attribution: '&copy; National Library of Scotland' },
                    'overlay-os1880': { type: 'raster', tiles: ['https://mapseries-tilesets.s3.amazonaws.com/1inch_2nd_ed/{z}/{x}/{y}.png'], tileSize: 256, minzoom: 6, maxzoom: 15, attribution: '&copy; National Library of Scotland' },
                },
                layers: [
                    { id: 'osm',      type: 'raster', source: 'osm',      minzoom: 0, maxzoom: 19 },
                    { id: 'satellite',type: 'raster', source: 'satellite', minzoom: 0, maxzoom: 19, layout: { visibility: 'none' } },
                    { id: 'overlay-lidar',  type: 'raster', source: 'overlay-lidar',  layout: { visibility: 'none' }, paint: { 'raster-opacity': 0.8, 'raster-contrast': 0.3, 'raster-brightness-max': 0.9, 'raster-fade-duration': 0 } },
                    { id: 'overlay-os1880', type: 'raster', source: 'overlay-os1880', layout: { visibility: 'none' }, paint: { 'raster-opacity': 0.85, 'raster-fade-duration': 0 } },
                    { id: 'overlay-os1930', type: 'raster', source: 'overlay-os1930', layout: { visibility: 'none' }, paint: { 'raster-opacity': 0.85, 'raster-fade-duration': 0 } },
                ],
            } as maplibregl.StyleSpecification,
            center: [-2.0, 54.5],
            zoom: 5.5,
            clickTolerance: 40,
        });

        map.on('load', () => {
            map.addSource('monuments', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
            map.addLayer({ id: 'monuments-fill',    type: 'fill', source: 'monuments', paint: { 'fill-color': '#ef4444', 'fill-opacity': 0.25 } });
            map.addLayer({ id: 'monuments-outline', type: 'line', source: 'monuments', paint: { 'line-color': '#ef4444', 'line-width': 3 } });

            map.addSource('aim-monuments', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
            map.addLayer({ id: 'aim-fill',    type: 'fill', source: 'aim-monuments', layout: { visibility: 'none' }, paint: { 'fill-color': '#f97316', 'fill-opacity': 0.2 } });
            map.addLayer({ id: 'aim-outline', type: 'line', source: 'aim-monuments', layout: { visibility: 'none' }, paint: { 'line-color': '#f97316', 'line-width': 2, 'line-opacity': 0.8 } });

            map.addSource('hotspots-overlay', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
            map.addLayer({
                id: 'hotspots-outline', type: 'line', source: 'hotspots-overlay',
                paint: { 'line-color': ['case', ['>=', ['get', 'score'], 80], '#f59e0b', ['>=', ['get', 'score'], 45], '#10b981', '#3b82f6'], 'line-width': 4, 'line-opacity': 1.0 },
            });
            map.addLayer({
                id: 'hotspots-fill', type: 'fill', source: 'hotspots-overlay',
                paint: { 'fill-color': ['case', ['>=', ['get', 'score'], 80], '#f59e0b', ['>=', ['get', 'score'], 45], '#10b981', '#3b82f6'], 'fill-opacity': 0.15 },
            });

            map.addSource('cluster-links', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
            map.addLayer({
                id: 'cluster-links-line', type: 'line', source: 'cluster-links',
                layout: { 'line-join': 'round', 'line-cap': 'round' },
                paint: { 'line-color': '#34d399', 'line-width': 1, 'line-opacity': 0.3, 'line-dasharray': [3, 4] },
            });

            map.addSource('targets', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
            map.addLayer({
                id: 'targets-circle', type: 'circle', source: 'targets',
                paint: {
                    'circle-radius': ['interpolate', ['linear'], ['get', 'consensus'], 1, 18, 2, 22, 3, 26],
                    'circle-color':  ['case', ['get', 'isProtected'], '#ef4444', ['>=', ['get', 'consensus'], 2], '#f59e0b', ['==', ['get', 'source'], 'terrain'], '#10b981', ['==', ['get', 'source'], 'historic'], '#f59e0b', '#3b82f6'],
                    'circle-stroke-width': 2, 'circle-stroke-color': '#fff',
                },
            });

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

            map.addSource('crossings', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
            map.addLayer({ id: 'crossings-halo',   type: 'circle', source: 'crossings', layout: { visibility: 'none' }, paint: { 'circle-radius': 14, 'circle-color': '#f59e0b', 'circle-opacity': 0.25, 'circle-stroke-width': 0 } });
            map.addLayer({ id: 'crossings-circle', type: 'circle', source: 'crossings', layout: { visibility: 'none' }, paint: { 'circle-radius': 6, 'circle-color': '#f59e0b', 'circle-opacity': 0.95, 'circle-stroke-width': 2, 'circle-stroke-color': '#fff' } });

            // ── Permission field boundaries overlay ───────────────────────────
            map.addSource('permission-fields', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
            map.addLayer({ id: 'permission-fields-fill',    type: 'fill',   source: 'permission-fields', layout: { visibility: 'none' }, paint: { 'fill-color': '#0d9488', 'fill-opacity': 0.08 } });
            map.addLayer({ id: 'permission-fields-outline', type: 'line',   source: 'permission-fields', layout: { visibility: 'none' }, paint: { 'line-color': '#0d9488', 'line-width': 2, 'line-opacity': 0.9, 'line-dasharray': [4, 2] } });
            map.addLayer({ id: 'permission-fields-labels',  type: 'symbol', source: 'permission-fields', layout: { visibility: 'none', 'text-field': ['get', 'name'], 'text-size': 11, 'text-font': ['Open Sans Bold'], 'text-anchor': 'center', 'text-max-width': 8 }, paint: { 'text-color': '#5eead4', 'text-halo-color': '#000', 'text-halo-width': 1.5 } });


            // ── User recorded finds overlay ───────────────────────────────────
            map.addSource('user-finds', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
            map.addLayer({ id: 'user-finds-circles', type: 'circle', source: 'user-finds', layout: { visibility: 'none' }, paint: { 'circle-radius': 4, 'circle-color': '#34d399', 'circle-opacity': 0.5, 'circle-stroke-width': 1, 'circle-stroke-color': '#000', 'circle-stroke-opacity': 0.3 } });

            // ── Event handlers — all use callbacksRef so they never go stale ──
            map.on('click', 'targets-circle', (e) => {
                if (e.features?.[0]) callbacksRef.current.onFeatureClick(e.features[0].properties?.id);
            });
            map.on('click', 'pas-circles', (e) => {
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
                if (e.features?.[0]) callbacksRef.current.onHotspotClick(e.features[0].properties?.id);
            });
            map.on('click', 'user-finds-circles', (e) => {
                const props = e.features?.[0]?.properties as Record<string, unknown> | undefined;
                if (props) showLabel(`${props.objectType || 'Find'} · ${props.period || 'Unknown'}`);
            });
            map.on('click', (e) => {
                const hits = map.queryRenderedFeatures(e.point, { layers: ['targets-circle', 'pas-circles', 'hotspots-fill', 'user-finds-circles', 'monuments-fill'] });
                if (hits.length > 0) return;
                callbacksRef.current.onMonumentClick(null);
                callbacksRef.current.onDeselect();
            });
            map.on('dragstart', () => callbacksRef.current.onDragStart());
            map.on('move',      () => callbacksRef.current.onZoomChange(map.getZoom()));

            map.on('click', 'historic-routes-roman',    () => showLabel('Roman Road'));
            map.on('click', 'historic-routes-trackway', () => showLabel('Historic Trackway'));
            map.on('click', 'corridors-fill', (e) => {
                const type = e.features?.[0]?.properties?.type;
                showLabel(type === 'roman_road' ? 'Roman Road Corridor' : 'Historic Trackway Corridor');
            });
            map.on('click', 'crossings-circle', (e) => {
                const p = e.features?.[0]?.properties as Record<string, unknown> | undefined;
                const a = p?.typeA === 'roman_road' ? 'Roman Road' : 'Trackway';
                const b = p?.typeB === 'roman_road' ? 'Roman Road' : 'Trackway';
                showLabel(`Route Crossing: ${a} × ${b}`);
            });
            map.on('click', 'monuments-fill', (e) => {
                const name = e.features?.[0]?.properties?.Name as string | undefined;
                callbacksRef.current.onMonumentClick(name ?? '');
            });
            map.on('click', 'aim-fill', (e) => {
                const p = e.features?.[0]?.properties as Record<string, unknown> | undefined;
                const type   = String(p?.MONUMENT_TYPE || 'Aerial Monument');
                const period = p?.PERIOD ? ` · ${p.PERIOD}` : '';
                showLabel(`${type}${period}`);
            });

            if (initLat !== undefined && initLng !== undefined && !isNaN(initLat) && !isNaN(initLng)) {
                map.flyTo({ center: [initLng, initLat], zoom: 14 });
            }
            setTimeout(() => map.resize(), 300);
        });

        mapRef.current = map;
        return () => {
            if (clickLabelTimer.current) clearTimeout(clickLabelTimer.current);
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
    }, [hotspots, selectedHotspotId]);

    // ── Hotspot outline filter ────────────────────────────────────────────────
    useEffect(() => {
        const map = mapRef.current;
        if (!map || !map.getLayer('hotspots-outline')) return;
        map.setFilter('hotspots-outline', selectedHotspotId
            ? ['==', ['get', 'id'], selectedHotspotId]
            : ['==', ['get', 'id'], '']);
    }, [selectedHotspotId]);

    // ── Detected features (targets) source ───────────────────────────────────
    useEffect(() => {
        const map = mapRef.current;
        if (!map) return;
        const source = map.getSource('targets') as maplibregl.GeoJSONSource;
        if (!source) return;
        source.setData({
            type: 'FeatureCollection',
            features: detectedFeatures.map(f => ({
                type: 'Feature' as const,
                geometry: { type: 'Point' as const, coordinates: f.center },
                properties: { id: f.id, number: f.number.toString(), isProtected: f.isProtected, source: f.sources[0], consensus: f.sources.length },
            })),
        } as GeoJSON.FeatureCollection);
    }, [detectedFeatures]);

    // ── Cluster link lines ────────────────────────────────────────────────────
    useEffect(() => {
        const map = mapRef.current;
        if (!map) return;
        const source = map.getSource('cluster-links') as maplibregl.GeoJSONSource;
        if (!source) return;
        const idToCenter = new Map(detectedFeatures.map(f => [f.id, f.center]));
        const seen = new Set<string>();
        const features: GeoJSON.Feature[] = [];
        for (const f of detectedFeatures) {
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
    }, [detectedFeatures]);

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
                        properties: { type: r.type, id: r.id },
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
                    if (buffered) { buffered.properties = { routeId: r.id, type: r.type, color }; corridorFeatures.push(buffered as GeoJSON.Feature); }
                } catch { /* skip malformed geometry */ }
            }
            const corridorSrc = map.getSource('corridors') as maplibregl.GeoJSONSource;
            if (corridorSrc) corridorSrc.setData({ type: 'FeatureCollection', features: corridorFeatures });

            const crossingFeatures: GeoJSON.Feature[] = [];
            const seen = new Set<string>();
            for (let i = 0; i < historicRoutes.length; i++) {
                for (let j = i + 1; j < historicRoutes.length; j++) {
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
        if (map.loaded()) doUpdate();
        else map.once('load', doUpdate);
    }, [historicRoutes]); // eslint-disable-line react-hooks/exhaustive-deps

    // ── Config-driven layer visibility ────────────────────────────────────────
    useEffect(() => {
        const map = mapRef.current;
        if (!map) return;
        const layerState: LayerState = { historicMode, visibility: historicLayerVisibility };
        LAYER_VISIBILITY_CONFIG.forEach(({ id, visibleWhen }) => {
            if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visibleWhen(layerState) ? 'visible' : 'none');
        });
    }, [historicMode, historicLayerVisibility]);

    // ── Overlay raster toggles ────────────────────────────────────────────────
    useEffect(() => {
        const map = mapRef.current;
        if (!map) return;
        if (map.getLayer('overlay-lidar'))  map.setLayoutProperty('overlay-lidar',  'visibility', historicLayerToggles.lidar  ? 'visible' : 'none');
        if (map.getLayer('overlay-os1930')) map.setLayoutProperty('overlay-os1930', 'visibility', historicLayerToggles.os1930 ? 'visible' : 'none');
        if (map.getLayer('overlay-os1880')) map.setLayoutProperty('overlay-os1880', 'visibility', historicLayerToggles.os1880 ? 'visible' : 'none');
    }, [historicLayerToggles]);

    // ── Field boundaries data ─────────────────────────────────────────────────
    useEffect(() => {
        const map = mapRef.current;
        if (!map) return;
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
    }, [fieldBoundaries, showFields]); // eslint-disable-line react-hooks/exhaustive-deps

    // ── Field boundaries visibility ───────────────────────────────────────────
    useEffect(() => {
        const map = mapRef.current;
        if (!map) return;
        const vis = showFields !== false ? 'visible' : 'none';
        ['permission-fields-fill', 'permission-fields-outline', 'permission-fields-labels'].forEach(id => {
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
        const map = mapRef.current;
        if (!map) return;
        const vis = historicMode && historicLayerVisibility.userFinds ? 'visible' : 'none';
        if (map.getLayer('user-finds-circles')) map.setLayoutProperty('user-finds-circles', 'visibility', vis);
    }, [historicLayerVisibility.userFinds, historicMode]); // eslint-disable-line react-hooks/exhaustive-deps

    // ── Exposed helpers ───────────────────────────────────────────────────────

    /** Clear all GeoJSON sources back to empty — call on scan clear */
    const clearMapSources = () => {
        const map = mapRef.current;
        if (!map) return;
        const sources = ['monuments', 'targets', 'cluster-links', 'historic-routes', 'aim-monuments', 'corridors', 'crossings'];
        sources.forEach(id => {
            const src = map.getSource(id) as maplibregl.GeoJSONSource | undefined;
            if (src) src.setData({ type: 'FeatureCollection', features: [] });
        });
    };

    return { mapContainerRef, mapRef, clearMapSources };
}
