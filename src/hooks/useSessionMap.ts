import { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import type { GeoJSONPolygon, Track } from '../db';
import type { CoverageResult } from '../services/coverage';

const DEFAULT_CENTER: [number, number] = [-2, 54.5];

/** Owns the session map lifecycle and renders boundary, tracks, and coverage. */
export function useSessionMap(params: {
    boundary: GeoJSONPolygon | undefined;
    tracks: Track[] | undefined;
    isTracking: boolean;
    isFinished: boolean;
    showCoverage: boolean;
    coverageResult: CoverageResult | null;
}) {
    const { boundary, tracks, isTracking, isFinished, showCoverage, coverageResult } = params;
    const mapDivRef = useRef<HTMLDivElement | null>(null);
    const mapRef = useRef<maplibregl.Map | null>(null);

    useEffect(() => () => {
        mapRef.current?.remove();
        mapRef.current = null;
    }, []);

    useEffect(() => {
        if (!mapDivRef.current || (!boundary && !tracks?.length && !isTracking)) return;

        const updateMapData = (map: maplibregl.Map) => {
            const trackSource = map.getSource('tracks') as maplibregl.GeoJSONSource | undefined;
            trackSource?.setData({
                type: 'FeatureCollection',
                features: (tracks ?? []).filter(track => track.points?.length >= 2).map(track => ({
                    type: 'Feature',
                    geometry: { type: 'LineString', coordinates: track.points.map(point => [point.lon, point.lat]) },
                    properties: { color: track.color },
                })),
            });
            const boundarySource = map.getSource('boundary') as maplibregl.GeoJSONSource | undefined;
            if (boundarySource && boundary) boundarySource.setData(boundary);

            const bounds = new maplibregl.LngLatBounds();
            let hasBounds = false;
            for (const point of boundary?.coordinates?.[0] ?? []) {
                if (point.length >= 2) { bounds.extend(point as [number, number]); hasBounds = true; }
            }
            for (const point of (tracks ?? []).flatMap(track => track.points ?? [])) {
                bounds.extend([point.lon, point.lat]);
                hasBounds = true;
            }
            if (hasBounds && !bounds.isEmpty()) {
                map.fitBounds(bounds, { padding: 40, duration: isFinished ? 0 : 1000, animate: !isFinished, maxZoom: 18 });
            }
        };

        if (!mapRef.current) {
            let map: maplibregl.Map;
            try {
                map = new maplibregl.Map({
                    container: mapDivRef.current,
                    style: {
                        version: 8,
                        sources: {
                            'raster-tiles': {
                                type: 'raster',
                                tiles: ['https://a.tile.openstreetmap.org/{z}/{x}/{y}.png'],
                                tileSize: 256,
                                attribution: '© OpenStreetMap',
                            },
                        },
                        layers: [{ id: 'simple-tiles', type: 'raster', source: 'raster-tiles', minzoom: 0, maxzoom: 22 }],
                    },
                    center: DEFAULT_CENTER,
                    zoom: 13,
                });
            } catch (error) {
                console.error('Map init failed:', error);
                return;
            }
            map.on('load', () => {
                map.addSource('boundary', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
                map.addLayer({
                    id: 'boundary-outline', type: 'line', source: 'boundary',
                    paint: { 'line-color': '#10b981', 'line-width': 2, 'line-dasharray': [2, 1] },
                });
                map.addSource('tracks', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
                map.addSource('coverage', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
                map.addLayer({
                    id: 'undetected-fill', type: 'fill', source: 'coverage', layout: { visibility: 'none' },
                    paint: { 'fill-color': '#ea580c', 'fill-opacity': 0.68, 'fill-outline-color': '#ea580c' },
                });
                map.addLayer({
                    id: 'undetected-outline', type: 'line', source: 'coverage', layout: { visibility: 'none' },
                    paint: { 'line-color': '#ea580c', 'line-width': 2, 'line-opacity': 0.8 },
                });
                map.addLayer({
                    id: 'tracks-line', type: 'line', source: 'tracks',
                    layout: { 'line-join': 'round', 'line-cap': 'round' },
                    paint: { 'line-color': ['get', 'color'], 'line-width': 4, 'line-opacity': 0.8 },
                });
                updateMapData(map);
            });
            mapRef.current = map;
        } else if (mapRef.current.isStyleLoaded()) {
            updateMapData(mapRef.current);
        }
    }, [boundary, isFinished, isTracking, tracks]);

    useEffect(() => {
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
    }, [coverageResult, showCoverage]);

    return mapDivRef;
}
