import { useEffect, type RefObject } from 'react';
import type * as maplibregl from 'maplibre-gl';
import type { HillfortContext } from '../types/hillforts';

export function useFieldGuideHillfortLayer(mapRef: RefObject<maplibregl.Map | null>, ready: number, context: HillfortContext | null | undefined, visible: boolean, onSelect: (id: string) => void, annotationMode: boolean): void {
    useEffect(() => {
        const map = mapRef.current;
        if (!map || !ready) return;
        const source = map.getSource('hillforts') as maplibregl.GeoJSONSource | undefined;
        source?.setData({ type: 'FeatureCollection', features: (context?.results ?? []).map(item => ({
            type: 'Feature', geometry: { type: 'Point', coordinates: item.record.position },
            properties: { id: item.record.id, name: item.record.name },
        })) });
        for (const layer of ['hillfort-points', 'hillfort-clusters']) if (map.getLayer(layer)) map.setLayoutProperty(layer, 'visibility', visible ? 'visible' : 'none');
    }, [mapRef, ready, context, visible]);

    useEffect(() => {
        const map = mapRef.current;
        if (!map || !ready) return;
        const click = async (event: maplibregl.MapLayerMouseEvent) => {
            if (annotationMode) return;
            // Existing protection and target interactions retain priority.
            const layers = ['monuments-fill', 'monument-buffer-fill', 'targets-hitbox', 'trace-targets-circle', 'user-finds-hitbox', 'pas-circles'].filter(id => map.getLayer(id));
            if (map.queryRenderedFeatures(event.point, { layers }).length) return;
            const feature = event.features?.[0];
            if (!feature) return;
            if (feature.properties.cluster) {
                const source = map.getSource('hillforts') as maplibregl.GeoJSONSource;
                const zoom = await source.getClusterExpansionZoom(Number(feature.properties.cluster_id));
                if (feature.geometry.type === 'Point') map.easeTo({ center: feature.geometry.coordinates as [number, number], zoom });
            } else onSelect(String(feature.properties.id));
        };
        const enter = () => { if (!annotationMode) map.getCanvas().style.cursor = 'pointer'; };
        const leave = () => { map.getCanvas().style.cursor = ''; };
        for (const layer of ['hillfort-points', 'hillfort-clusters']) { map.on('click', layer, click); map.on('mouseenter', layer, enter); map.on('mouseleave', layer, leave); }
        return () => {
            for (const layer of ['hillfort-points', 'hillfort-clusters']) { map.off('click', layer, click); map.off('mouseenter', layer, enter); map.off('mouseleave', layer, leave); }
        };
    }, [mapRef, ready, onSelect, annotationMode]);
}
