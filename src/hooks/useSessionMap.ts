import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import type { GeoJSONPolygon, Track } from '../db';
import type { CoverageResult } from '../services/coverage';
import { splitTrackPointsAtGaps } from '../shared/trackSegments';
import { locationAccuracyCircle, locationHeadingLine, type FieldLocation } from '../services/session/sessionFieldPosition';
import { useSessionMapLayers } from './useSessionMapLayers';

const DEFAULT_CENTER: [number, number] = [-2, 54.5];

export type SessionMapMarker = {
    id: string;
    kind: 'find' | 'signal' | 'point' | 'observation';
    lat: number;
    lon: number;
};

/** Owns the session map lifecycle and renders boundary, tracks, and coverage. */
export function useSessionMap(params: {
    enabled?: boolean;
    center?: { lat: number; lon: number } | null;
    markers?: SessionMapMarker[];
    liveLocation?: FieldLocation | null;
    boundary: GeoJSONPolygon | undefined;
    tracks: Track[] | undefined;
    isTracking: boolean;
    isFinished: boolean;
    showCoverage: boolean;
    coverageResult: CoverageResult | null;
    onMarkerSelect?: (marker: SessionMapMarker) => void;
}) {
    const { enabled = true, center, markers, liveLocation, boundary, tracks, isTracking, isFinished, showCoverage, coverageResult, onMarkerSelect } = params;
    const mapDivRef = useRef<HTMLDivElement | null>(null);
    const mapRef = useRef<maplibregl.Map | null>(null);
    const initialFitCompleteRef = useRef(false);
    const viewportRef = useRef<{ center: [number, number]; zoom: number } | null>(null);
    const markerSelectRef = useRef(onMarkerSelect);
    markerSelectRef.current = onMarkerSelect;
    const markersRef = useRef(markers);
    markersRef.current = markers;
    const [isFollowing, setIsFollowing] = useState(true);
    const [mapReadyVersion, setMapReadyVersion] = useState(0);
    const mapLayers = useSessionMapLayers(mapRef, mapReadyVersion);

    useEffect(() => () => {
        const map = mapRef.current;
        if (map) viewportRef.current = { center: [map.getCenter().lng, map.getCenter().lat], zoom: map.getZoom() };
        mapRef.current?.remove();
        mapRef.current = null;
    }, []);

    useEffect(() => {
        if (!enabled) {
            if (mapRef.current) viewportRef.current = { center: [mapRef.current.getCenter().lng, mapRef.current.getCenter().lat], zoom: mapRef.current.getZoom() };
            mapRef.current?.remove();
            mapRef.current = null;
            initialFitCompleteRef.current = false;
            return;
        }
        if (!mapLayers.mapPreferenceReady || !mapDivRef.current || (!boundary && !tracks?.length && !isTracking && !center && !markers?.length && !liveLocation)) return;

        const updateMapData = (map: maplibregl.Map) => {
            const trackSource = map.getSource('tracks') as maplibregl.GeoJSONSource | undefined;
            trackSource?.setData({
                type: 'FeatureCollection',
                features: (tracks ?? []).flatMap(track =>
                    splitTrackPointsAtGaps(track.points ?? [], track.gaps)
                        .filter(segment => segment.length >= 2)
                        .map(segment => ({
                            type: 'Feature' as const,
                            geometry: { type: 'LineString' as const, coordinates: segment.map(point => [point.lon, point.lat]) },
                            properties: { color: track.color },
                        }))
                ),
            });
            const boundarySource = map.getSource('boundary') as maplibregl.GeoJSONSource | undefined;
            if (boundarySource && boundary) boundarySource.setData(boundary);
            const markerSource = map.getSource('session-markers') as maplibregl.GeoJSONSource | undefined;
            markerSource?.setData({
                type: 'FeatureCollection',
                features: (markers ?? []).map(marker => ({
                    type: 'Feature' as const,
                    geometry: { type: 'Point' as const, coordinates: [marker.lon, marker.lat] },
                    properties: { id: marker.id, kind: marker.kind },
                })),
            });
            const locationSource = map.getSource('session-location') as maplibregl.GeoJSONSource | undefined;
            locationSource?.setData({
                type: 'FeatureCollection',
                features: liveLocation ? [{
                    type: 'Feature' as const,
                    geometry: { type: 'Point' as const, coordinates: [liveLocation.lon, liveLocation.lat] },
                    properties: {},
                }] : [],
            });
            const accuracySource = map.getSource('session-location-accuracy') as maplibregl.GeoJSONSource | undefined;
            accuracySource?.setData(locationAccuracyCircle(liveLocation ?? null));
            const headingSource = map.getSource('session-location-heading') as maplibregl.GeoJSONSource | undefined;
            headingSource?.setData(locationHeadingLine(liveLocation ?? null));

            const bounds = new maplibregl.LngLatBounds();
            let hasBounds = false;
            for (const point of boundary?.coordinates?.[0] ?? []) {
                if (point.length >= 2) { bounds.extend(point as [number, number]); hasBounds = true; }
            }
            for (const point of (tracks ?? []).flatMap(track => track.points ?? [])) {
                bounds.extend([point.lon, point.lat]);
                hasBounds = true;
            }
            if (center) { bounds.extend([center.lon, center.lat]); hasBounds = true; }
            if (liveLocation) { bounds.extend([liveLocation.lon, liveLocation.lat]); hasBounds = true; }
            for (const marker of markers ?? []) { bounds.extend([marker.lon, marker.lat]); hasBounds = true; }
            if (!initialFitCompleteRef.current && !viewportRef.current && hasBounds && !bounds.isEmpty()) {
                map.fitBounds(bounds, { padding: 40, duration: isFinished ? 0 : 1000, animate: !isFinished, maxZoom: 18 });
                initialFitCompleteRef.current = true;
            }
        };

        if (!mapRef.current) {
            let cancelled = false;
            void import('../services/fieldguide/mapLayerRegistry').then(({ createFieldGuideMapStyle, ensureFieldGuideMapProtocolsRegistered, registerRomanStandaloneLayers }) => {
                if (cancelled || mapRef.current || !mapDivRef.current) return;
                let map: maplibregl.Map;
                try {
                    ensureFieldGuideMapProtocolsRegistered();
                    map = new maplibregl.Map({
                        container: mapDivRef.current,
                        style: createFieldGuideMapStyle(mapLayers.control.isSatellite),
                        center: viewportRef.current?.center ?? (center ? [center.lon, center.lat] : DEFAULT_CENTER),
                        zoom: viewportRef.current?.zoom ?? 13,
                    });
                } catch (error) {
                    console.error('Map init failed:', error);
                    return;
                }
                map.on('load', () => {
                    registerRomanStandaloneLayers(map);
                    map.addSource('boundary', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
                    map.addLayer({ id: 'boundary-outline', type: 'line', source: 'boundary', paint: { 'line-color': '#10b981', 'line-width': 2, 'line-dasharray': [2, 1] } });
                    map.addSource('tracks', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
                    map.addSource('session-markers', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
                    map.addLayer({
                        id: 'session-markers', type: 'circle', source: 'session-markers',
                        paint: {
                            'circle-radius': 7,
                            'circle-color': ['match', ['get', 'kind'], 'signal', '#38bdf8', 'point', '#a78bfa', 'observation', '#34d399', '#fbbf24'],
                            'circle-stroke-width': 2, 'circle-stroke-color': '#111827',
                        },
                    });
                    map.addSource('session-location-accuracy', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
                    map.addLayer({ id: 'session-location-accuracy', type: 'fill', source: 'session-location-accuracy', paint: { 'fill-color': '#2dd4bf', 'fill-opacity': 0.13, 'fill-outline-color': '#5eead4' } });
                    map.addSource('session-location', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
                    map.addLayer({ id: 'session-location', type: 'circle', source: 'session-location', paint: { 'circle-radius': 7, 'circle-color': '#2dd4bf', 'circle-stroke-width': 3, 'circle-stroke-color': '#ffffff' } });
                    map.addSource('session-location-heading', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
                    map.addLayer({ id: 'session-location-heading', type: 'line', source: 'session-location-heading', paint: { 'line-color': '#ffffff', 'line-width': 3, 'line-opacity': 0.9 } });
                    map.addSource('coverage', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
                    map.addLayer({ id: 'undetected-fill', type: 'fill', source: 'coverage', layout: { visibility: 'none' }, paint: { 'fill-color': '#ea580c', 'fill-opacity': 0.68, 'fill-outline-color': '#ea580c' } });
                    map.addLayer({ id: 'undetected-outline', type: 'line', source: 'coverage', layout: { visibility: 'none' }, paint: { 'line-color': '#ea580c', 'line-width': 2, 'line-opacity': 0.8 } });
                    map.addLayer({ id: 'tracks-line', type: 'line', source: 'tracks', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': 4, 'line-opacity': 0.8 } });
                    map.on('mouseenter', 'session-markers', () => { map.getCanvas().style.cursor = 'pointer'; });
                    map.on('mouseleave', 'session-markers', () => { map.getCanvas().style.cursor = ''; });
                    map.on('click', 'session-markers', event => {
                        const properties = event.features?.[0]?.properties as { id?: string; kind?: SessionMapMarker['kind'] } | undefined;
                        const marker = (markersRef.current ?? []).find(candidate => candidate.id === properties?.id && candidate.kind === properties?.kind);
                        if (marker) markerSelectRef.current?.(marker);
                    });
                    updateMapData(map);
                    setMapReadyVersion(version => version + 1);
                });
                map.on('dragstart', () => setIsFollowing(false));
                map.on('zoomstart', event => { if ((event.originalEvent as Event | undefined)?.isTrusted) setIsFollowing(false); });
                map.on('moveend', () => { viewportRef.current = { center: [map.getCenter().lng, map.getCenter().lat], zoom: map.getZoom() }; });
                mapRef.current = map;
            }).catch(error => console.error('Map layers failed to load:', error));
            return () => { cancelled = true; };
        } else if (mapRef.current.isStyleLoaded()) {
            updateMapData(mapRef.current);
        }
    }, [boundary, center, enabled, isFinished, isTracking, liveLocation, mapLayers.mapPreferenceReady, markers, tracks]);

    useEffect(() => {
        const map = mapRef.current;
        if (!enabled || !map || !liveLocation || !isFollowing || !map.isStyleLoaded()) return;
        map.easeTo({ center: [liveLocation.lon, liveLocation.lat], duration: 450, essential: true });
    }, [enabled, isFollowing, liveLocation, mapReadyVersion]);

    useEffect(() => {
        if (!enabled) return;
        const map = mapRef.current;
        if (!map) return;
        const syncCoverage = () => {
            const source = map.getSource('coverage') as maplibregl.GeoJSONSource | undefined;
            if (!source) return;
            source.setData(showCoverage && coverageResult
                ? coverageResult.undetectionsGeoJSON
                : { type: 'FeatureCollection', features: [] });
            for (const layer of ['undetected-fill', 'undetected-outline']) {
                if (map.getLayer(layer)) {
                    map.setLayoutProperty(layer, 'visibility', showCoverage ? 'visible' : 'none');
                    if (showCoverage) map.moveLayer(layer);
                }
            }
            if (map.getLayer('tracks-line')) map.setPaintProperty('tracks-line', 'line-opacity', showCoverage ? 0.35 : 0.8);
            if (map.getLayer('boundary-outline') && showCoverage) map.moveLayer('boundary-outline');
        };
        if (map.getSource('coverage')) syncCoverage();
        else {
            map.once('idle', syncCoverage);
            return () => { map.off('idle', syncCoverage); };
        }
    }, [coverageResult, enabled, showCoverage]);

    return { mapDivRef, layerControl: mapLayers.control };
}
