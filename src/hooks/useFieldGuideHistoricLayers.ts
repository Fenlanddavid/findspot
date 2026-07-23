import { useEffect, type MutableRefObject, type RefObject } from 'react';
import maplibregl from 'maplibre-gl';
import * as turf from '@turf/turf';
import type { HistoricFind, HistoricRoute } from '../pages/fieldGuideTypes';
import { getPASDensityGeoJSON } from '../services/pasDensityService';
import { reportNonFatal } from '../services/diagLog';
import {
    routeLabel,
    type FieldGuideMapCallbacks,
} from '../services/fieldguide/mapInteractions';

type Options = {
    mapRef: RefObject<maplibregl.Map | null>;
    mapReadyVersion: number;
    pasFinds: HistoricFind[];
    historicRoutes: HistoricRoute[];
    callbacksRef: MutableRefObject<FieldGuideMapCallbacks>;
};

export function useFieldGuideHistoricLayers({
    mapRef,
    mapReadyVersion,
    pasFinds,
    historicRoutes,
    callbacksRef,
}: Options): void {
    useEffect(() => {
        const coordGroups: Record<string, number> = {};
        const pasGeoJSON: GeoJSON.FeatureCollection = {
            type: 'FeatureCollection',
            features: pasFinds.map(find => {
                const key = `${find.lat.toFixed(4)},${find.lon.toFixed(4)}`;
                const count = coordGroups[key] || 0;
                coordGroups[key] = count + 1;
                return {
                    type: 'Feature' as const,
                    geometry: {
                        type: 'Point' as const,
                        coordinates: [find.lon + count * 0.0001, find.lat + count * 0.0001],
                    },
                    properties: { ...find },
                };
            }),
        };
        let canceled = false;
        const updateSource = () => {
            if (canceled) return;
            const source = mapRef.current?.getSource('pas-finds') as maplibregl.GeoJSONSource;
            if (source) source.setData(pasGeoJSON);
            else if (!mapRef.current?.loaded()) setTimeout(updateSource, 500);
        };
        updateSource();
        return () => { canceled = true; };
    }, [pasFinds]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        if (!mapReadyVersion) return;
        let canceled = false;
        getPASDensityGeoJSON().then(geojson => {
            if (canceled) return;
            const source = mapRef.current?.getSource('pas-density') as maplibregl.GeoJSONSource;
            if (source) source.setData(geojson);
        }).catch(error => {
            reportNonFatal('field-guide-map', 'PAS density layer load failed', error);
        });
        return () => { canceled = true; };
    }, [mapReadyVersion]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        const map = mapRef.current;
        if (!map) return;
        const routeSource = map.getSource('historic-routes') as maplibregl.GeoJSONSource;
        routeSource?.setData({
            type: 'FeatureCollection',
            features: historicRoutes.map(route => ({
                type: 'Feature' as const,
                geometry: { type: 'LineString' as const, coordinates: route.geometry },
                properties: {
                    type: route.type,
                    id: route.id,
                    ...(route.name ? { name: route.name } : {}),
                },
            })),
        });

        const corridorSource = map.getSource('corridors') as maplibregl.GeoJSONSource;
        const crossingSource = map.getSource('crossings') as maplibregl.GeoJSONSource;
        if (historicRoutes.length === 0) {
            corridorSource?.setData({ type: 'FeatureCollection', features: [] });
            crossingSource?.setData({ type: 'FeatureCollection', features: [] });
            return;
        }

        const corridorFeatures: GeoJSON.Feature[] = [];
        for (const route of historicRoutes) {
            try {
                const line = turf.lineString(route.geometry);
                const bufferKm = route.type === 'roman_road' ? 0.3 : 0.15;
                const color = route.type === 'roman_road' ? '#3b82f6' : '#93c5fd';
                const buffered = turf.buffer(line, bufferKm, { units: 'kilometers' });
                if (buffered) {
                    buffered.properties = {
                        routeId: route.id,
                        type: route.type,
                        name: route.name,
                        color,
                    };
                    corridorFeatures.push(buffered as GeoJSON.Feature);
                }
            } catch (error) {
                reportNonFatal('field-guide-map', 'Malformed route corridor skipped', error);
            }
        }
        corridorSource?.setData({ type: 'FeatureCollection', features: corridorFeatures });

        const crossingFeatures: GeoJSON.Feature[] = [];
        const seen = new Set<string>();
        for (let i = 0; i < historicRoutes.length; i++) {
            for (let j = i + 1; j < historicRoutes.length; j++) {
                if (
                    historicRoutes[i].source === 'itinere'
                    && historicRoutes[j].source === 'itinere'
                    && historicRoutes[i].name
                    && historicRoutes[i].name === historicRoutes[j].name
                ) continue;
                try {
                    const a = turf.lineString(historicRoutes[i].geometry);
                    const b = turf.lineString(historicRoutes[j].geometry);
                    const intersects = turf.lineIntersect(a, b);
                    for (const point of intersects.features) {
                        const key = point.geometry.coordinates
                            .map(coordinate => coordinate.toFixed(5))
                            .join(',');
                        if (seen.has(key)) continue;
                        seen.add(key);
                        crossingFeatures.push({
                            ...point,
                            properties: {
                                typeA: historicRoutes[i].type,
                                typeB: historicRoutes[j].type,
                                nameA: historicRoutes[i].name,
                                nameB: historicRoutes[j].name,
                                label: `${historicRoutes[i].type === 'roman_road' ? 'Roman road' : 'Trackway'} × ${historicRoutes[j].type === 'roman_road' ? 'Roman road' : 'Trackway'}`,
                            },
                        });
                    }
                } catch (error) {
                    reportNonFatal('field-guide-map', 'Malformed route crossing skipped', error);
                }
            }
        }
        crossingSource?.setData({ type: 'FeatureCollection', features: crossingFeatures });
        if (crossingFeatures.length > 0) {
            callbacksRef.current.onCrossingsLog(
                `CROSSINGS: ${crossingFeatures.length} route intersection${crossingFeatures.length !== 1 ? 's' : ''} detected — high-value targets.`,
            );
        }
    }, [historicRoutes, mapReadyVersion]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        const map = mapRef.current;
        if (!map) return;
        const updateSource = () => {
            const source = map.getSource('landscape-context') as maplibregl.GeoJSONSource | undefined;
            if (!source) return;
            const features: GeoJSON.Feature[] = [];
            for (const route of historicRoutes) {
                try {
                    const line = turf.lineString(route.geometry);
                    const buffered = turf.buffer(
                        line,
                        route.type === 'roman_road' ? 0.55 : 0.35,
                        { units: 'kilometers' },
                    );
                    if (buffered) {
                        buffered.properties = {
                            kind: 'route_context',
                            label: routeLabel(
                                route.type,
                                route.name,
                                route.type === 'roman_road'
                                    ? 'Historic route corridor'
                                    : 'Historic movement corridor',
                            ),
                            routeId: route.id,
                            type: route.type,
                            name: route.name,
                            color: '#60a5fa',
                        };
                        features.push(buffered as GeoJSON.Feature);
                    }
                } catch (error) {
                    reportNonFatal('field-guide-map', 'Malformed route geometry skipped', error);
                }
            }
            source.setData({ type: 'FeatureCollection', features } as GeoJSON.FeatureCollection);
        };
        if (map.getSource('landscape-context')) updateSource();
        else map.once('style.load', updateSource);
    }, [historicRoutes, mapReadyVersion]); // eslint-disable-line react-hooks/exhaustive-deps
}
