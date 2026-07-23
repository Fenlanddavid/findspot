import type { RefObject } from 'react';
import type maplibregl from 'maplibre-gl';
import type {
    HistoricFind,
    HistoricRoute,
    Hotspot,
    PlaceSignal,
} from '../../pages/fieldGuideTypes';
import type {
    AIMResponse,
    NHLEResponse,
    OverpassAttemptTiming,
    OverpassElement,
} from '../historicScanService';
import type { PASCellLookup } from '../pasDensityService';
import type { QuestionSourceAvailability } from '../../outstandingQuestions/types';
import type { LogLevel, LogSource } from '../../utils/scanLogger';
import type { ScanContext } from './terrainScanSupport';
import { SCAN_CONFIG } from '../../utils/scanConfig';
import { CACHE_POLICIES } from '../../shared/cachePolicy';

export interface HistoricScanOptions extends ScanContext {
    mapRef: RefObject<maplibregl.Map | null>;
    permissions: unknown[];
    fields: unknown[];
    targetPeriod: string;
}

export interface HistoricScanResult {
    pasFinds: HistoricFind[];
    placeSignals: PlaceSignal[];
    monumentPoints: [number, number][];
    heritageCount: number;
    enhancedHotspots: Hotspot[];
    routes: HistoricRoute[];
    nhleData: NHLEResponse | null;
    scheduledMonuments: NHLEResponse;
    aimData: AIMResponse | null;
    drifted: boolean;
    center: { lat: number; lng: number };
    pasCell: PASCellLookup | null;
    questionSourceAvailability: QuestionSourceAvailability;
}

export interface HistoricScanCoordinatorOptions {
    onLog: (msg: string, source?: LogSource, level?: LogLevel) => void;
    onStatusChange: (status: string) => void;
    signal: AbortSignal;
    isActive: () => boolean;
}

export const HISTORIC_CACHE_VERSION = 'HISTORIC-2026.06.15a';
export const HISTORIC_CACHE_TTL_MS =
    CACHE_POLICIES.fieldGuideHistoric.expiry.durationMs;

export function seconds(start: number): string {
    return ((performance.now() - start) / 1000).toFixed(1);
}

export function attemptSummary(timing: OverpassAttemptTiming): string {
    const status = timing.status === 'http-error'
        ? `HTTP ${timing.httpStatus ?? '?'}`
        : timing.status;
    return `${timing.endpoint} ${(timing.elapsedMs / 1000).toFixed(1)}s ${status}`;
}

export async function timedRecord<T>(
    promise: Promise<T>,
): Promise<{ value: T; elapsed: string }> {
    const start = performance.now();
    const value = await promise;
    return { value, elapsed: seconds(start) };
}

function coordKey(value: number): string {
    return value.toFixed(3);
}

export function getHistoricCacheKey(
    center: { lat: number; lng: number },
    bounds: { west: number; south: number; east: number; north: number },
): string {
    return [
        'historic',
        HISTORIC_CACHE_VERSION,
        coordKey(center.lat),
        coordKey(center.lng),
        coordKey(bounds.west),
        coordKey(bounds.south),
        coordKey(bounds.east),
        coordKey(bounds.north),
    ].join(':');
}

export function isHeritageElement(element: OverpassElement): boolean {
    return !!(
        element.tags?.historic
        || element.tags?.heritage
        || element.tags?.archaeological_site
        || element.tags?.standing_remains
        || element.tags?.site_type
    );
}

export function getHistoricQueryBounds(
    bounds: maplibregl.LngLatBounds,
    center: maplibregl.LngLat,
    zoom: number,
): { west: number; south: number; east: number; north: number } {
    const queryZoom = Math.min(zoom, SCAN_CONFIG.HISTORIC_QUERY_MAX_ZOOM);
    const scale = Math.pow(2, Math.max(0, zoom - queryZoom));
    return {
        west: center.lng - ((center.lng - bounds.getWest()) * scale),
        south: center.lat - ((center.lat - bounds.getSouth()) * scale),
        east: center.lng + ((bounds.getEast() - center.lng) * scale),
        north: center.lat + ((bounds.getNorth() - center.lat) * scale),
    };
}
