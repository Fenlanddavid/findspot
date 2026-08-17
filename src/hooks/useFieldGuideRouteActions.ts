import { useEffect, useRef, type MutableRefObject, type RefObject } from 'react';
import type maplibregl from 'maplibre-gl';
import type { Permission } from '../db';
import type { BoundaryBounds } from '../services/session/sessionFieldPosition';
import { useActiveSessionGuideAutoScan } from './useActiveSessionGuideAutoScan';

export interface FieldGuideRouteContext {
    lat: number;
    lng: number;
    fieldId?: string;
    pinLabel?: string;
    openSavedPoints: boolean;
    scan: string | null;
    permissionId?: string;
    boundaryBounds: BoundaryBounds | null;
}

type SetSearchParams = (params: URLSearchParams, options: { replace: boolean }) => void;

export function useInitialFieldGuideRouteContext(searchParams: URLSearchParams): FieldGuideRouteContext {
    const contextRef = useRef<FieldGuideRouteContext | null>(null);
    contextRef.current ??= {
        lat: parseFloat(searchParams.get('lat') ?? ''),
        lng: parseFloat(searchParams.get('lng') ?? ''),
        fieldId: searchParams.get('fieldId') ?? undefined,
        pinLabel: searchParams.get('pin') === 'signal' ? 'Un-dug signal' : undefined,
        openSavedPoints: searchParams.get('savedPoints') === '1',
        scan: searchParams.get('scan'),
        permissionId: searchParams.get('permissionId') ?? undefined,
        boundaryBounds: readBoundaryBounds(searchParams),
    };
    return contextRef.current;
}

function readBoundaryBounds(searchParams: URLSearchParams): BoundaryBounds | null {
    const values = ['west', 'south', 'east', 'north'].map(key => searchParams.get(key));
    if (values.some(value => value === null)) return null;
    const [west, south, east, north] = values.map(Number);
    return [west, south, east, north].every(Number.isFinite) && east > west && north > south
        ? { west, south, east, north }
        : null;
}

interface FieldGuideAutoScanOptions {
    route: FieldGuideRouteContext;
    mapRef: RefObject<maplibregl.Map | null>;
    permissions: readonly Permission[];
    isBusy: boolean;
    questionScanAutoStartedRef: MutableRefObject<boolean>;
    setSearchParams: SetSearchParams;
    setShowFields: (value: false | 'all' | string) => void;
    executeScan: (requestedQuestionPermissionId?: string) => Promise<void>;
}

export function useFieldGuideAutoScan({
    route,
    mapRef,
    permissions,
    isBusy,
    questionScanAutoStartedRef,
    setSearchParams,
    setShowFields,
    executeScan,
}: FieldGuideAutoScanOptions): void {
    const questionScanRequested = route.scan === 'questions';
    useActiveSessionGuideAutoScan({ route, mapRef, permissions, isBusy, setSearchParams, setShowFields, executeScan });

    useEffect(() => {
        if (!questionScanRequested || questionScanAutoStartedRef.current) return;
        let cancelled = false;
        let attempts = 0;
        let timer: number | undefined;
        const tryStart = () => {
            if (cancelled || questionScanAutoStartedRef.current) return;
            if (mapRef.current && permissions.length > 0 && !isBusy) {
                questionScanAutoStartedRef.current = true;
                const nextParams = new URLSearchParams(window.location.search);
                nextParams.delete('scan');
                nextParams.delete('permissionId');
                setSearchParams(nextParams, { replace: true });
                void executeScan(route.permissionId);
                return;
            }
            attempts += 1;
            if (attempts < 40) timer = window.setTimeout(tryStart, 250);
        };
        timer = window.setTimeout(tryStart, 300);
        return () => {
            cancelled = true;
            if (timer !== undefined) window.clearTimeout(timer);
        };
    }, [questionScanRequested, route.permissionId, permissions.length]); // eslint-disable-line react-hooks/exhaustive-deps

}
