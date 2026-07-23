import { useEffect, type MutableRefObject, type RefObject } from 'react';
import maplibregl from 'maplibre-gl';
import * as turf from '@turf/turf';
import type { Find } from '../db';
import type { DevAnnotation } from '../utils/devAnnotation';

type FieldBoundary = {
    id: string;
    name: string;
    permissionId: string;
    boundary: any;
};

type Options = {
    mapRef: RefObject<maplibregl.Map | null>;
    mapReadyVersion: number;
    fieldBoundaries: FieldBoundary[];
    showFields: false | 'all' | string;
    fieldLabelMarkersRef: MutableRefObject<maplibregl.Marker[]>;
    userFinds: Find[];
    showUserFinds: boolean;
    annotationMode: boolean;
    devAnnotations: DevAnnotation[];
    devAnnotationMarkersRef: MutableRefObject<maplibregl.Marker[]>;
};

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

function makeFieldLabelElement(label: string): HTMLDivElement {
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

function makeAnnotationLabelElement(index: number): HTMLDivElement {
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

export function useFieldGuideUserLayers({
    mapRef,
    mapReadyVersion,
    fieldBoundaries,
    showFields,
    fieldLabelMarkersRef,
    userFinds,
    showUserFinds,
    annotationMode,
    devAnnotations,
    devAnnotationMarkersRef,
}: Options): void {
    useEffect(() => {
        const map = mapRef.current;
        if (!map) return;
        let canceled = false;
        const doUpdate = () => {
            if (canceled) return;
            const src = map.getSource('permission-fields') as maplibregl.GeoJSONSource | undefined;
            if (!src) return;
            const visible = showFields !== false
                ? fieldBoundaries.filter(field => {
                    if (!field.boundary) return false;
                    if (showFields === 'all') return true;
                    if (typeof showFields === 'string' && showFields.startsWith('field:')) {
                        return field.id === showFields.slice(6);
                    }
                    return field.permissionId === showFields;
                })
                : [];
            src.setData({
                type: 'FeatureCollection',
                features: visible.map(field => ({
                    type: 'Feature',
                    geometry: field.boundary,
                    properties: { id: field.id, name: field.name },
                })),
            } as GeoJSON.FeatureCollection);

            fieldLabelMarkersRef.current.forEach(marker => marker.remove());
            fieldLabelMarkersRef.current = [];
            visible.forEach(field => {
                const center = getPolygonCenter(field.boundary);
                if (!center) return;
                const marker = new maplibregl.Marker({
                    element: makeFieldLabelElement(field.name),
                    anchor: 'center',
                }).setLngLat(center).addTo(map);
                fieldLabelMarkersRef.current.push(marker);
            });
        };
        if (map.getSource('permission-fields')) doUpdate();
        else map.once('style.load', doUpdate);
        return () => { canceled = true; };
    }, [fieldBoundaries, showFields]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        const map = mapRef.current;
        if (!map) return;
        const visibility = showFields !== false ? 'visible' : 'none';
        ['permission-fields-fill', 'permission-fields-outline'].forEach(id => {
            if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visibility);
        });
    }, [showFields]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        const geoJSON: GeoJSON.FeatureCollection = {
            type: 'FeatureCollection',
            features: userFinds
                .filter(find => find.lat !== null && find.lon !== null)
                .map(find => ({
                    type: 'Feature' as const,
                    geometry: { type: 'Point' as const, coordinates: [find.lon!, find.lat!] },
                    properties: { id: find.id, objectType: find.objectType, period: find.period },
                })),
        };
        let canceled = false;
        const updateSource = () => {
            if (canceled) return;
            const source = mapRef.current?.getSource('user-finds') as maplibregl.GeoJSONSource | undefined;
            if (source) source.setData(geoJSON);
            else if (!mapRef.current?.loaded()) setTimeout(updateSource, 500);
        };
        updateSource();
        return () => { canceled = true; };
    }, [userFinds]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        let canceled = false;
        const visibility = showUserFinds ? 'visible' : 'none';
        const applyVisibility = () => {
            if (canceled) return;
            const map = mapRef.current;
            if (!map) return;
            if (!map.getLayer('user-finds-circles') || !map.getLayer('user-finds-hitbox')) {
                setTimeout(applyVisibility, 250);
                return;
            }
            map.setLayoutProperty('user-finds-circles', 'visibility', visibility);
            map.setLayoutProperty('user-finds-hitbox', 'visibility', visibility);
        };
        applyVisibility();
        return () => { canceled = true; };
    }, [showUserFinds]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        const canvas = mapRef.current?.getCanvas();
        if (canvas) canvas.style.cursor = annotationMode ? 'crosshair' : '';
    }, [annotationMode]);

    useEffect(() => {
        const map = mapRef.current;
        if (!map) return;
        let canceled = false;
        const doUpdate = () => {
            if (canceled) return;
            const source = map.getSource('dev-annotations') as maplibregl.GeoJSONSource | undefined;
            if (!source) return;
            source.setData({
                type: 'FeatureCollection',
                features: devAnnotations.map((annotation, index) => ({
                    type: 'Feature' as const,
                    geometry: { type: 'Point' as const, coordinates: [annotation.lon, annotation.lat] },
                    properties: { id: annotation.id, index: index + 1, annotationType: annotation.annotationType },
                })),
            } as GeoJSON.FeatureCollection);

            devAnnotationMarkersRef.current.forEach(marker => marker.remove());
            devAnnotationMarkersRef.current = [];
            devAnnotations.forEach((annotation, index) => {
                const marker = new maplibregl.Marker({
                    element: makeAnnotationLabelElement(index + 1),
                    anchor: 'bottom',
                    offset: [0, -14],
                }).setLngLat([annotation.lon, annotation.lat]).addTo(map);
                devAnnotationMarkersRef.current.push(marker);
            });
        };
        if (map.getSource('dev-annotations')) doUpdate();
        else map.once('style.load', doUpdate);
        return () => { canceled = true; };
    }, [devAnnotations, mapReadyVersion]);
}
