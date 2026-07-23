import type maplibregl from 'maplibre-gl';
import type {
    Cluster,
    HistoricRoute,
    Hotspot,
    ModernWay,
    ScanBounds,
} from '../../pages/fieldGuideTypes';
import type { AIMResponse, NHLEFeature, NHLEResponse } from '../historicScanService';
import type { PackMeta } from '../offlinePack';
import type { LogLevel, LogSource } from '../../utils/scanLogger';
import { getDistance } from '../../utils/fieldGuideAnalysis';

export interface ScanContext {
    terrainClusters: Cluster[];
    monumentPoints: [number, number][];
    routes: HistoricRoute[];
    nhleData: NHLEResponse | null;
    aimData: AIMResponse | null;
    scanCenter: { lat: number; lng: number } | null;
    analysisBounds: ScanBounds | null;
    questionTerrainAvailability: Record<string, boolean>;
    historicRoutesAvailable: boolean;
}

export interface TerrainScanResult {
    terrainClusters: Cluster[];
    detectedFeatures: Cluster[];
    rawClusters: Cluster[];
    hotspots: Hotspot[];
    nhleData: NHLEResponse;
    aimData: AIMResponse;
    routes: HistoricRoute[];
    modernWays: ModernWay[];
    monumentPoints: [number, number][];
    heritageCount: number;
    sourceAvailability: Record<string, boolean>;
    questionTerrainAvailability: Record<string, boolean>;
    fromCache: boolean;
    noSignal: boolean;
    scanStartCenter: { lat: number; lng: number };
    scanStartBounds: { west: number; south: number; east: number; north: number };
    analysisBounds: ScanBounds;
    historicRoutesAvailable: boolean;
}

export interface TerrainScanParams {
    mapRef: React.RefObject<maplibregl.Map | null>;
    permissions: unknown[];
    fields: unknown[];
    targetPeriod: string;
}

export interface TerrainScanCoordinatorOptions {
    onLog: (msg: string, source?: LogSource, level?: LogLevel) => void;
    onStatusChange: (status: string) => void;
    signal: AbortSignal;
    workerRegistry: Worker[];
    isActive: () => boolean;
}

export function seconds(start: number): string {
    return ((performance.now() - start) / 1000).toFixed(1);
}

export function padBoundsByMetres(
    west: number,
    south: number,
    east: number,
    north: number,
    centerLat: number,
    metres: number,
): { west: number; south: number; east: number; north: number } {
    const latPad = metres / 111_320;
    const cosLat = Math.max(0.2, Math.abs(Math.cos(centerLat * Math.PI / 180)));
    const lonPad = metres / (111_320 * cosLat);
    return {
        west: west - lonPad,
        south: south - latPad,
        east: east + lonPad,
        north: north + latPad,
    };
}

export function extractMonumentPoints(features: NHLEFeature[]): [number, number][] {
    return features.flatMap(feature => {
        if (feature.geometry.type === 'Point') {
            return [feature.geometry.coordinates as [number, number]];
        }
        if (feature.geometry.type === 'Polygon') {
            return [
                (feature.geometry.coordinates as number[][][])?.[0]?.[0] as [number, number],
            ].filter(Boolean);
        }
        return [
            (feature.geometry.coordinates as number[][][][])?.[0]?.[0]?.[0] as [number, number],
        ].filter(Boolean);
    });
}

export function collapseByProximity(features: Cluster[]): Cluster[] {
    const result: Cluster[] = [];
    features.forEach(newHit => {
        let anchored = false;
        for (const existing of result) {
            if (getDistance(newHit.center, existing.center) < 15) {
                newHit.sources.forEach(source => {
                    if (!existing.sources.includes(source)) existing.sources.push(source);
                });
                if (newHit.confidence === 'High') existing.confidence = 'High';
                anchored = true;
                break;
            }
        }
        if (!anchored) result.push(newHit);
    });
    return result;
}

export function applyOfflinePackAvailability(
    availability: Record<string, boolean>,
    packMeta: PackMeta | null,
): Record<string, boolean> {
    if (!packMeta) return availability;
    const hasTerrainPack = (
        packMeta.layers.terrain === 'cached'
        || packMeta.layers.terrain === 'partial'
    );
    const hasSatellitePack = (
        packMeta.layers.satellite === 'cached'
        || packMeta.layers.satellite === 'partial'
    );
    return {
        ...availability,
        terrain: availability.terrain || hasTerrainPack,
        terrain_global: availability.terrain_global || hasTerrainPack,
        slope: availability.slope || hasTerrainPack,
        hydrology: availability.hydrology || hasTerrainPack,
        satellite_spring: availability.satellite_spring || hasSatellitePack,
        satellite_summer: availability.satellite_summer || hasSatellitePack,
    };
}
