import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import type { GeoJSONPolygon, Track } from '../db';
import type { CoverageResult } from '../services/coverage';
import { splitTrackPointsAtGaps } from '../shared/trackSegments';
import { locationAccuracyCircle, locationHeadingLine, type FieldLocation } from '../services/session/sessionFieldPosition';
import { initialSessionMapCoordinates } from '../services/session/sessionMapViewport';
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
    boundaryReady?: boolean;
    tracks: Track[] | undefined;
    fieldTracks?: Track[];
    fieldFindMarkers?: SessionMapMarker[];
    isTracking: boolean;
    isFinished: boolean;
    showFieldTrails?: boolean;
    showPastFinds?: boolean;
    showCoverage: boolean;
    coverageResult: CoverageResult | null;
    onMarkerSelect?: (marker: SessionMapMarker) => void;
}) {
    const { enabled = true, center, markers, liveLocation, boundary, boundaryReady = true, tracks, fieldTracks, fieldFindMarkers, isTracking, isFinished, showFieldTrails = false, showPastFinds = false, showCoverage, coverageResult, onMarkerSelect } = params;
    const mapDivRef = useRef<HTMLDivElement | null>(null);
    const mapRef = useRef<maplibregl.Map | null>(null);
    const initialFitCompleteRef = useRef(false);
    const viewportRef = useRef<{ center: [number, number]; zoom: number } | null>(null);
    const markerSelectRef = useRef(onMarkerSelect);
    markerSelectRef.current = onMarkerSelect;
    const markersRef = useRef(markers);
    markersRef.current = markers;
    const fieldFindMarkersRef = useRef(fieldFindMarkers);
    fieldFindMarkersRef.current = fieldFindMarkers;
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
        if (!boundaryReady || !mapLayers.mapPreferenceReady || !mapDivRef.current || (!boundary && !tracks?.length && !isTracking && !center && !markers?.length && !liveLocation)) return;

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
            const currentTrackIds = new Set((tracks ?? []).map(track => track.id));
            const fieldTrackSource = map.getSource('field-tracks') as maplibregl.GeoJSONSource | undefined;
            fieldTrackSource?.setData({
                type: 'FeatureCollection',
                features: (fieldTracks ?? []).filter(track => !currentTrackIds.has(track.id)).flatMap(track =>
                    splitTrackPointsAtGaps(track.points ?? [], track.gaps)
                        .filter(segment => segment.length >= 2)
                        .map(segment => ({
                            type: 'Feature' as const,
                            geometry: { type: 'LineString' as const, coordinates: segment.map(point => [point.lon, point.lat]) },
                            properties: {},
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
            const fieldFindSource = map.getSource('field-finds') as maplibregl.GeoJSONSource | undefined;
            fieldFindSource?.setData({
                type: 'FeatureCollection',
                features: (fieldFindMarkers ?? []).map(marker => ({
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

            const initialCoordinates = initialSessionMapCoordinates({ boundary, tracks, center, liveLocation, markers });
            const initialBounds = new maplibregl.LngLatBounds();
            for (const coordinate of initialCoordinates) initialBounds.extend(coordinate);
            if (!initialFitCompleteRef.current && !viewportRef.current && initialCoordinates.length > 0 && !initialBounds.isEmpty()) {
                map.fitBounds(initialBounds, { padding: 40, duration: isFinished ? 0 : 1000, animate: !isFinished, maxZoom: 18 });
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
                    map.addSource('field-tracks', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
                    map.addLayer({ id: 'field-tracks-line', type: 'line', source: 'field-tracks', layout: { visibility: 'none', 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#67e8f9', 'line-width': 3, 'line-opacity': 0.55 } });
                    map.addSource('tracks', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
                    map.addSource('field-finds', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
                    map.addLayer({ id: 'field-finds', type: 'circle', source: 'field-finds', layout: { visibility: 'none' }, paint: { 'circle-radius': 5, 'circle-color': '#fbbf24', 'circle-opacity': 0.72, 'circle-stroke-width': 1.5, 'circle-stroke-color': '#111827' } });
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
                    map.on('mouseenter', 'field-finds', () => { map.getCanvas().style.cursor = 'pointer'; });
                    map.on('mouseleave', 'field-finds', () => { map.getCanvas().style.cursor = ''; });
                    map.on('click', 'session-markers', event => {
                        const properties = event.features?.[0]?.properties as { id?: string; kind?: SessionMapMarker['kind'] } | undefined;
                        const marker = (markersRef.current ?? []).find(candidate => candidate.id === properties?.id && candidate.kind === properties?.kind);
                        if (marker) markerSelectRef.current?.(marker);
                    });
                    map.on('click', 'field-finds', event => {
                        const id = event.features?.[0]?.properties?.id as string | undefined;
                        const marker = (fieldFindMarkersRef.current ?? []).find(candidate => candidate.id === id);
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
    }, [boundary, boundaryReady, center, enabled, fieldFindMarkers, fieldTracks, isFinished, isTracking, liveLocation, mapLayers.mapPreferenceReady, markers, tracks]);

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
            if (map.getLayer('field-tracks-line')) map.setLayoutProperty('field-tracks-line', 'visibility', showFieldTrails ? 'visible' : 'none');
            if (map.getLayer('field-finds')) map.setLayoutProperty('field-finds', 'visibility', showPastFinds ? 'visible' : 'none');
            if (map.getLayer('tracks-line')) map.setPaintProperty('tracks-line', 'line-opacity', showCoverage ? 0.9 : 0.8);
            if (showCoverage || showFieldTrails || showPastFinds) {
                for (const layer of ['field-tracks-line', 'field-finds', 'tracks-line', 'session-markers', 'session-location-accuracy', 'session-location', 'session-location-heading', 'boundary-outline']) {
                    if (map.getLayer(layer)) map.moveLayer(layer);
                }
            }
        };
        if (map.getSource('coverage')) syncCoverage();
        else {
            map.once('idle', syncCoverage);
            return () => { map.off('idle', syncCoverage); };
        }
    }, [coverageResult, enabled, mapReadyVersion, showCoverage, showFieldTrails, showPastFinds]);

    return { mapDivRef, layerControl: mapLayers.control };
}
