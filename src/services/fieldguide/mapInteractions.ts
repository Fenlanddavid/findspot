import type maplibregl from 'maplibre-gl';
import type { HistoricFind } from '../../pages/fieldGuideTypes';

export type FieldGuideMapCallbacks = {
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

type InteractionOptions = {
    callbacks: () => FieldGuideMapCallbacks;
    annotationMode: () => boolean;
    showLabel: (label: string) => void;
};

export function routeLabel(type: unknown, nameValue: unknown, fallback?: string): string {
    const base = type === 'roman_road' ? 'Roman Road' : 'Historic Trackway';
    const name = typeof nameValue === 'string' ? nameValue.trim() : '';
    return name && name.toLowerCase() !== 'null' ? `${base} - ${name}` : fallback || base;
}

function romanRoadLabel(props: Record<string, unknown> | undefined): string {
    return routeLabel('roman_road', props?.name, 'Roman Road');
}

export function bindFieldGuideMapInteractions(
    map: maplibregl.Map,
    options: InteractionOptions,
): void {
    const callbacks = () => options.callbacks();
    const isAnnotating = () => options.annotationMode();

    map.on('click', 'targets-circle', (event) => {
        if (isAnnotating()) return;
        if (event.features?.[0]) callbacks().onFeatureClick(event.features[0].properties?.id);
    });
    map.on('click', 'trace-targets-circle', (event) => {
        if (isAnnotating()) return;
        if (event.features?.[0]) callbacks().onTraceTargetClick(event.features[0].properties?.id);
    });
    map.on('mouseenter', 'trace-targets-circle', () => {
        if (!isAnnotating()) map.getCanvas().style.cursor = 'pointer';
    });
    map.on('mouseleave', 'trace-targets-circle', () => {
        map.getCanvas().style.cursor = '';
    });
    map.on('click', 'pas-circles', (event) => {
        if (isAnnotating() || !event.features?.[0]) return;
        const props = event.features[0].properties as Record<string, unknown>;
        callbacks().onPASFindLog(`HERITAGE: ${props.objectType} - ${props.id}`);
        callbacks().onPASFindSelect({
            id: String(props.id),
            internalId: String(props.internalId || ''),
            objectType: String(props.objectType),
            broadperiod: String(props.broadperiod),
            county: String(props.county),
            workflow: 'PAS',
            lat: Number(props.lat),
            lon: Number(props.lon),
            isApprox: !!props.isApprox,
            osmType: String(props.osmType || ''),
        });
    });
    map.on('click', 'hotspots-fill', (event) => {
        if (isAnnotating()) return;
        const priority = map.queryRenderedFeatures(event.point, {
            layers: ['targets-circle', 'trace-targets-circle', 'user-finds-hitbox', 'pas-circles'],
        });
        if (priority.length > 0) return;
        if (event.features?.[0]) callbacks().onHotspotClick(event.features[0].properties?.id);
    });
    map.on('click', 'user-finds-hitbox', (event) => {
        if (isAnnotating()) return;
        const props = event.features?.[0]?.properties as Record<string, unknown> | undefined;
        if (props?.id) callbacks().onUserFindClick(String(props.id));
    });
    map.on('click', (event) => {
        if (isAnnotating()) {
            callbacks().onAnnotationDrop(event.lngLat.lat, event.lngLat.lng);
            return;
        }
        const hits = map.queryRenderedFeatures(event.point, {
            layers: ['targets-circle', 'trace-targets-circle', 'pas-circles', 'hotspots-fill', 'user-finds-hitbox', 'monuments-fill', 'monument-buffer-fill'],
        });
        if (hits.length > 0) return;
        callbacks().onMonumentClick(null);
        callbacks().onDeselect();
    });
    map.on('dragstart', () => callbacks().onDragStart());
    map.on('move', () => callbacks().onZoomChange(map.getZoom()));

    map.on('click', 'historic-routes-roman', (event) => {
        if (!isAnnotating()) options.showLabel(romanRoadLabel(event.features?.[0]?.properties as Record<string, unknown> | undefined));
    });
    map.on('click', 'historic-routes-trackway', () => {
        if (!isAnnotating()) options.showLabel('Historic Trackway');
    });
    map.on('click', 'corridors-fill', (event) => {
        if (isAnnotating()) return;
        const props = event.features?.[0]?.properties as Record<string, unknown> | undefined;
        options.showLabel(routeLabel(
            props?.type,
            props?.name,
            props?.type === 'roman_road' ? 'Roman Road Corridor' : 'Historic Trackway Corridor',
        ));
    });
    map.on('click', 'landscape-context-fill', (event) => {
        if (isAnnotating()) return;
        const props = event.features?.[0]?.properties;
        if (props?.kind === 'route_context') return;
        options.showLabel(String(props?.label || 'Landscape Context'));
    });
    map.on('click', 'crossings-circle', (event) => {
        if (isAnnotating()) return;
        const props = event.features?.[0]?.properties as Record<string, unknown> | undefined;
        const a = routeLabel(props?.typeA, props?.nameA, props?.typeA === 'roman_road' ? 'Roman Road' : 'Trackway');
        const b = routeLabel(props?.typeB, props?.nameB, props?.typeB === 'roman_road' ? 'Roman Road' : 'Trackway');
        options.showLabel(`Route Crossing: ${a} × ${b}`);
    });
    map.on('click', 'monuments-fill', (event) => {
        if (isAnnotating()) return;
        const name = event.features?.[0]?.properties?.Name as string | undefined;
        callbacks().onMonumentClick(name ?? '');
    });
    map.on('click', 'monument-buffer-fill', (event) => {
        if (isAnnotating()) return;
        const name = event.features?.[0]?.properties?.Name as string | undefined;
        callbacks().onMonumentClick(name ?? '');
    });
    map.on('click', 'aim-fill', (event) => {
        if (isAnnotating()) return;
        const props = event.features?.[0]?.properties as Record<string, unknown> | undefined;
        const type = String(props?.MONUMENT_TYPE || 'Aerial Monument');
        const period = props?.PERIOD ? ` · ${props.PERIOD}` : '';
        options.showLabel(`${type}${period}`);
    });
}
