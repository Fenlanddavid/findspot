import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import { Cluster, Hotspot, HistoricFind, HistoricRoute, TraceTarget } from '../pages/fieldGuideTypes';
import { Find, SavedPoint } from '../db';
import { DevAnnotation } from '../utils/devAnnotation';
import { useFieldGuideUserLayers } from './useFieldGuideUserLayers';
import { useSavedPointMarkers } from './useSavedPointMarkers';
import { useFieldGuideScanLayers } from './useFieldGuideScanLayers';
import { useFieldGuideHistoricLayers } from './useFieldGuideHistoricLayers';
import {
    createFieldGuideMapStyle,
    ensureFieldGuideMapProtocolsRegistered,
    registerFieldGuideMapLayers,
} from '../services/fieldguide/mapLayerRegistry';
import {
    bindFieldGuideMapInteractions,
    type FieldGuideMapCallbacks,
} from '../services/fieldguide/mapInteractions';

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

export type UseFieldGuideMapOptions = {
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
    isSatellite: boolean;
    historicMode: boolean;
    showFields: false | 'all' | string;
    historicLayerVisibility: { routes: boolean; corridors: boolean; crossings: boolean; monuments: boolean; aim: boolean; context: boolean; pasDensity: boolean; userFinds: boolean };
    userFinds: Find[];
    historicLayerToggles: { lidar: boolean; 'lidar-wales': boolean; os1930: boolean; os1880: boolean };
    historicLayerOpacity: { lidar: number; 'lidar-wales': number; os1930: number; os1880: number };
    savedPoints: SavedPoint[];
    showSavedPoints: boolean;
    initLat?: number;
    initLng?: number;
    initPinLabel?: string;
    devMode:        boolean;
    annotationMode: boolean;
    devAnnotations: DevAnnotation[];
    callbacks: FieldGuideMapCallbacks;
};

export function useFieldGuideMap({
    hotspots, selectedHotspotId, detectedFeatures, selectedTargetId, traceTargets, selectedTraceId, primaryTargetId, pasFinds, historicRoutes, fieldBoundaries,
    isSatellite, historicMode, showFields, historicLayerVisibility, historicLayerToggles, historicLayerOpacity, userFinds,
    savedPoints, showSavedPoints,
    initLat, initLng, initPinLabel, devMode, annotationMode, devAnnotations, callbacks,
}: UseFieldGuideMapOptions) {
    const mapContainerRef    = useRef<HTMLDivElement>(null);
    const mapRef             = useRef<maplibregl.Map | null>(null);
    const clickLabelTimer    = useRef<ReturnType<typeof setTimeout> | null>(null);
    const callbacksRef       = useRef<FieldGuideMapCallbacks>(callbacks);
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

        ensureFieldGuideMapProtocolsRegistered();

        const map = new maplibregl.Map({
            container: mapContainerRef.current,
            style: createFieldGuideMapStyle(),
            center: [-2.0, 54.5],
            zoom: 5.5,
            clickTolerance: 40,
        });

        const initialiseMapLayers = () => {
            if (!registerFieldGuideMapLayers(map)) return;
            setMapReadyVersion(v => v + 1);

            bindFieldGuideMapInteractions(map, {
                callbacks: () => callbacksRef.current,
                annotationMode: () => annotationModeRef.current,
                showLabel,
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

    useFieldGuideScanLayers({
        mapRef,
        mapReadyVersion,
        hotspots,
        selectedHotspotId,
        detectedFeatures,
        selectedTargetId,
        traceTargets,
        selectedTraceId,
        primaryTargetId,
        targetLabelMarkersRef,
    });

    useFieldGuideHistoricLayers({
        mapRef,
        mapReadyVersion,
        pasFinds,
        historicRoutes,
        callbacksRef,
    });

    useFieldGuideUserLayers({
        mapRef,
        mapReadyVersion,
        fieldBoundaries,
        showFields,
        fieldLabelMarkersRef,
        userFinds,
        showUserFinds: historicLayerVisibility.userFinds,
        annotationMode,
        devAnnotations,
        devAnnotationMarkersRef,
    });

    useSavedPointMarkers({
        mapRef,
        savedPoints,
        showSavedPoints,
        savedPointMarkersRef,
        callbacksRef,
    });

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
