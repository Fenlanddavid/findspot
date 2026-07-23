import { useEffect, type MutableRefObject, type RefObject } from 'react';
import maplibregl from 'maplibre-gl';
import type { Cluster, Hotspot, TraceTarget } from '../pages/fieldGuideTypes';

type Options = {
    mapRef: RefObject<maplibregl.Map | null>;
    mapReadyVersion: number;
    hotspots: Hotspot[];
    selectedHotspotId: string | null;
    detectedFeatures: Cluster[];
    selectedTargetId: string | null;
    traceTargets: TraceTarget[];
    selectedTraceId: string | null;
    primaryTargetId: string | null;
    targetLabelMarkersRef: MutableRefObject<maplibregl.Marker[]>;
};

function makeTargetLabelElement(label: string, primary: boolean): HTMLDivElement {
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
    } else {
        el.textContent = label.padStart(2, '0');
    }
    return el;
}

export function useFieldGuideScanLayers({
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
}: Options): void {
    useEffect(() => {
        const source = mapRef.current?.getSource('hotspots-overlay') as maplibregl.GeoJSONSource | undefined;
        if (!source) return;
        source.setData({
            type: 'FeatureCollection',
            features: hotspots
                .filter(hotspot => hotspot.id === selectedHotspotId)
                .map(hotspot => ({
                    type: 'Feature' as const,
                    geometry: {
                        type: 'Polygon' as const,
                        coordinates: [[
                            [hotspot.bounds[0][0], hotspot.bounds[0][1]],
                            [hotspot.bounds[1][0], hotspot.bounds[0][1]],
                            [hotspot.bounds[1][0], hotspot.bounds[1][1]],
                            [hotspot.bounds[0][0], hotspot.bounds[1][1]],
                            [hotspot.bounds[0][0], hotspot.bounds[0][1]],
                        ]],
                    },
                    properties: { id: hotspot.id, type: hotspot.type, score: hotspot.score },
                })),
        } as GeoJSON.FeatureCollection);
    }, [hotspots, selectedHotspotId, mapReadyVersion]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        const source = mapRef.current?.getSource('targets') as maplibregl.GeoJSONSource | undefined;
        if (!source) return;
        source.setData({
            type: 'FeatureCollection',
            features: detectedFeatures.filter(feature => !feature.isRouteArtefactRisk).map(feature => ({
                type: 'Feature' as const,
                geometry: { type: 'Point' as const, coordinates: feature.center },
                properties: {
                    id: feature.id,
                    number: feature.number.toString(),
                    isProtected: feature.isProtected,
                    source: feature.sources[0],
                    consensus: feature.sources.length,
                    isPrimary: feature.id === primaryTargetId,
                },
            })),
        } as GeoJSON.FeatureCollection);
    }, [detectedFeatures, primaryTargetId, mapReadyVersion]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        const map = mapRef.current;
        if (!map?.getLayer('targets-selected')) return;
        map.setFilter('targets-selected', ['==', ['get', 'id'], selectedTargetId ?? '']);
    }, [selectedTargetId, mapReadyVersion]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        targetLabelMarkersRef.current.forEach(marker => marker.remove());
        targetLabelMarkersRef.current = [];
        const map = mapRef.current;
        if (!map) return;
        detectedFeatures
            .filter(feature => !feature.isRouteArtefactRisk && !feature.isProtected)
            .forEach(feature => {
                const marker = new maplibregl.Marker({
                    element: makeTargetLabelElement(
                        feature.number.toString(),
                        feature.id === primaryTargetId,
                    ),
                    anchor: 'center',
                }).setLngLat(feature.center).addTo(map);
                targetLabelMarkersRef.current.push(marker);
            });
    }, [detectedFeatures, primaryTargetId, mapReadyVersion]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        const source = mapRef.current?.getSource('trace-targets') as maplibregl.GeoJSONSource | undefined;
        if (!source) return;
        source.setData({
            type: 'FeatureCollection',
            features: traceTargets.map(target => ({
                type: 'Feature' as const,
                geometry: { type: 'Point' as const, coordinates: target.center },
                properties: {
                    id: target.id,
                    traceLabel: target.traceLabel,
                    traceScore: target.traceScore,
                },
            })),
        } as GeoJSON.FeatureCollection);
    }, [traceTargets, mapReadyVersion]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        const map = mapRef.current;
        if (!map?.getLayer('trace-targets-selected')) return;
        map.setFilter('trace-targets-selected', ['==', ['get', 'id'], selectedTraceId ?? '']);
    }, [selectedTraceId, mapReadyVersion]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        const source = mapRef.current?.getSource('cluster-links') as maplibregl.GeoJSONSource | undefined;
        if (!source) return;
        const validFeatures = detectedFeatures.filter(feature => !feature.isRouteArtefactRisk);
        const idToCenter = new Map(validFeatures.map(feature => [feature.id, feature.center]));
        const seen = new Set<string>();
        const features: GeoJSON.Feature[] = [];
        for (const feature of validFeatures) {
            for (const linkedId of feature.linkedClusterIds ?? []) {
                const key = [feature.id, linkedId].sort().join('|');
                if (seen.has(key)) continue;
                seen.add(key);
                const target = idToCenter.get(linkedId);
                if (!target) continue;
                features.push({
                    type: 'Feature',
                    geometry: { type: 'LineString', coordinates: [feature.center, target] },
                    properties: {},
                });
            }
        }
        source.setData({ type: 'FeatureCollection', features } as GeoJSON.FeatureCollection);
    }, [detectedFeatures, mapReadyVersion]); // eslint-disable-line react-hooks/exhaustive-deps
}
