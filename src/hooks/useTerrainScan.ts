// ─── Terrain scan hook ────────────────────────────────────────────────────────
// Runs the terrain scan pipeline: tile processing → NHLE/AIM/route fetching →
// cluster merging → hotspot generation. Returns a stable runTerrainScan()
// function that resolves with the full scan result, or null if cancelled.

import { useRef, useState, useCallback } from 'react';
import maplibregl from 'maplibre-gl';

import { Cluster, Hotspot, HistoricRoute } from '../pages/fieldGuideTypes';
import {
    NHLEResponse, AIMResponse, OverpassElement,
    parseOverpassRoutes, fetchScanRoutes,
} from '../services/historicScanService';
import { scanDataSource } from '../utils/terrainEngine';
import {
    findConsensus, analyzeContext, suppressDisturbance,
    applyNHLEProtection, applyAIMEnrichment, getDistance,
} from '../utils/fieldGuideAnalysis';
import { buildTerrainHotspots } from '../utils/hotspotEngine';
import { SCAN_CONFIG } from '../utils/scanConfig';
import { LogSource, LogLevel } from '../utils/scanLogger';

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * The formalised handoff from terrain scan to historic phase.
 * nhleData / aimData are null when running historic standalone (trigger re-fetch).
 */
export interface ScanContext {
    terrainClusters:  Cluster[];
    monumentPoints:   [number, number][];
    routes:           HistoricRoute[];
    nhleData:         NHLEResponse | null;
    aimData:          AIMResponse  | null;
    scanCenter:       { lat: number; lng: number } | null;
}

export interface TerrainScanResult {
    terrainClusters:  Cluster[];
    detectedFeatures: Cluster[];
    hotspots:         Hotspot[];
    nhleData:         NHLEResponse;
    aimData:          AIMResponse;
    routes:           HistoricRoute[];
    monumentPoints:   [number, number][];
    heritageCount:    number;
}

interface TerrainScanParams {
    mapRef:       React.RefObject<maplibregl.Map | null>;
    permissions:  unknown[];
    fields:       unknown[];
    targetPeriod: string;
}

interface UseTerrainScanOptions {
    onLog:          (msg: string, source?: LogSource, level?: LogLevel) => void;
    onStatusChange: (status: string) => void;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useTerrainScan({ onLog, onStatusChange }: UseTerrainScanOptions) {
    const [isScanning, setIsScanning] = useState(false);
    const tokenRef = useRef<string | null>(null);
    const abortRef = useRef<AbortController | null>(null);
    const mountedRef = useRef(true);

    // Track mount state for safe setState calls
    useState(() => { mountedRef.current = true; });

    const cancelScan = useCallback(() => {
        tokenRef.current = null;
        abortRef.current?.abort();
        if (mountedRef.current) setIsScanning(false);
    }, []);

    const runTerrainScan = useCallback(async (
        params: TerrainScanParams,
    ): Promise<TerrainScanResult | null> => {
        const map = params.mapRef.current;
        if (!map) return null;

        abortRef.current?.abort();
        const abort = new AbortController();
        abortRef.current = abort;
        const token = crypto.randomUUID();
        tokenRef.current = token;
        const { signal } = abort;

        if (mountedRef.current) setIsScanning(true);
        const scanStart = Date.now();

        const zoom    = SCAN_CONFIG.TERRAIN_ZOOM;
        const bounds  = map.getBounds();
        const center  = map.getCenter();
        const n       = Math.pow(2, zoom);
        const cX      = (center.lng + 180) / 360 * n;
        const cY      = (1 - Math.log(Math.tan(center.lat * Math.PI / 180) + 1 / Math.cos(center.lat * Math.PI / 180)) / Math.PI) / 2 * n;
        const tX_start = Math.floor(cX) - 1;
        const tY_start = Math.floor(cY) - 1;

        const qWest  = bounds.getWest();
        const qSouth = bounds.getSouth();
        const qEast  = bounds.getEast();
        const qNorth = bounds.getNorth();

        // Start NHLE and route fetches in parallel with tile scanning
        const nhleUrl = `https://services-eu1.arcgis.com/ZOdPfBS3aqqDYPUQ/arcgis/rest/services/National_Heritage_List_for_England_NHLE_v02_VIEW/FeatureServer/6/query?where=1%3D1&geometry=${qWest},${qSouth},${qEast},${qNorth}&geometryType=esriGeometryEnvelope&spatialRel=esriSpatialRelIntersects&inSR=4326&outSR=4326&f=geojson&outFields=Name,ListEntry`;
        const nhlePromise  = fetch(nhleUrl, { signal }).then(r => r.json() as Promise<NHLEResponse>).catch(() => ({ features: [] }) as NHLEResponse);
        const routePromise = fetchScanRoutes(center.lat, center.lng, signal);

        onStatusChange("Scanning Terrain...");

        const terrainTask      = scanDataSource('terrain',          zoom, tX_start, tY_start, bounds, n, { features: [] });
        const terrainGlobalTask = scanDataSource('terrain_global',  zoom, tX_start, tY_start, bounds, n, { features: [] });
        const slopeTask        = scanDataSource('slope',            zoom, tX_start, tY_start, bounds, n, { features: [] });
        onStatusChange("Scanning Hydrology...");
        const hydroTask        = scanDataSource('hydrology',        zoom, tX_start, tY_start, bounds, n, { features: [] });
        onStatusChange("Spectral Sampling...");
        const springTask       = scanDataSource('satellite_spring', zoom, tX_start, tY_start, bounds, n, { features: [] });
        const summerTask       = scanDataSource('satellite_summer', zoom, tX_start, tY_start, bounds, n, { features: [] });

        try {
            const [nhleData, terrainHits, terrainGlobalHits, slopeHits, hydroHits, springHits, summerHits] = await Promise.all([
                nhlePromise, terrainTask, terrainGlobalTask, slopeTask, hydroTask, springTask, summerTask,
            ]);

            if (tokenRef.current !== token || signal.aborted || !mountedRef.current) {
                setIsScanning(false);
                return null;
            }

            // Monument points for later use
            const monumentPoints: [number, number][] = (nhleData.features || []).map(f => {
                if (f.geometry.type === 'Point')        return f.geometry.coordinates as [number, number];
                if (f.geometry.type === 'Polygon')      return (f.geometry.coordinates as number[][][])[0][0] as [number, number];
                return (f.geometry.coordinates as number[][][][])[0][0][0] as [number, number];
            });
            const heritageCount = nhleData.features?.length ?? 0;
            if (heritageCount > 0) onLog(`> NHLE: ${heritageCount} scheduled monument${heritageCount !== 1 ? 's' : ''} in scan area.`, 'terrain');

            // Routes (with timeout)
            onStatusChange("Syncing Routes...");
            let routes: HistoricRoute[] = [];
            try {
                const timeout  = new Promise<null>((_, reject) => setTimeout(() => reject(new Error('timeout')), SCAN_CONFIG.ROUTE_FETCH_TIMEOUT_MS));
                const routeRaw = await Promise.race([routePromise, timeout]);
                if (routeRaw?.elements) routes = parseOverpassRoutes(routeRaw.elements);
            } catch {
                onLog('> Routes: service unavailable, continuing without.', 'terrain', 'warn');
            }

            if (tokenRef.current !== token || signal.aborted || !mountedRef.current) {
                setIsScanning(false);
                return null;
            }

            // AIM data (sequential — needs NHLE first for map ordering)
            onStatusChange("Deep Signal Audit...");
            const aimUrl = `https://services-eu1.arcgis.com/ZOdPfBS3aqqDYPUQ/arcgis/rest/services/HE_AIM_data/FeatureServer/1/query?where=1%3D1&geometry=${qWest},${qSouth},${qEast},${qNorth}&geometryType=esriGeometryEnvelope&spatialRel=esriSpatialRelIntersects&inSR=4326&outSR=4326&f=geojson&outFields=MONUMENT_TYPE,PERIOD,EVIDENCE_1`;
            let aimData: AIMResponse = { features: [] };
            try {
                const aRes = await fetch(aimUrl, { signal });
                aimData    = await aRes.json() as AIMResponse;
                if (aimData.features?.length > 0) onLog(`> AIM: ${aimData.features.length} aerial monument${aimData.features.length !== 1 ? 's' : ''} mapped.`, 'terrain');
            } catch {
                onLog('> AIM: service unavailable, continuing without.', 'terrain', 'warn');
            }

            if (tokenRef.current !== token || signal.aborted || !mountedRef.current) {
                setIsScanning(false);
                return null;
            }

            // ── Cluster processing pipeline ────────────────────────────────────
            onStatusChange("Locking Coordinates...");

            const rawCombined = [...terrainHits, ...terrainGlobalHits, ...slopeHits, ...hydroHits, ...springHits, ...summerHits];
            const merged      = findConsensus(rawCombined);

            // AIM enrichment: tag clusters inside aerial monument polygons
            const aimEnriched = applyAIMEnrichment(merged, aimData);

            // Proximity-collapse features within 15 m
            const updatedFeatures: Cluster[] = [];
            aimEnriched.forEach(newHit => {
                let anchored = false;
                for (const existing of updatedFeatures) {
                    if (getDistance(newHit.center, existing.center) < 15) {
                        newHit.sources.forEach(s => { if (!existing.sources.includes(s)) existing.sources.push(s); });
                        if (newHit.confidence === 'High') existing.confidence = 'High';
                        anchored = true;
                        break;
                    }
                }
                if (!anchored) updatedFeatures.push(newHit);
            });

            // NHLE protection: mark clusters inside scheduled monument boundaries
            applyNHLEProtection(updatedFeatures, nhleData);

            const suppressed    = suppressDisturbance(updatedFeatures);
            const contextualized = analyzeContext(suppressed, routes)
                .sort((a, b) => b.findPotential - a.findPotential)
                .map((c, i) => ({ ...c, number: i + 1 }));

            // Initial (terrain-only) hotspots — historic enrichment follows in the historic phase
            const hotspots = buildTerrainHotspots(contextualized, routes, monumentPoints);

            const duration = ((Date.now() - scanStart) / 1000).toFixed(1);
            onLog(`> Terrain scan complete in ${duration}s — ${contextualized.length} signal${contextualized.length !== 1 ? 's' : ''} detected, ${hotspots.length} target${hotspots.length !== 1 ? 's' : ''} identified.`, 'terrain');

            if (mountedRef.current) setIsScanning(false);
            return { terrainClusters: contextualized, detectedFeatures: contextualized, hotspots, nhleData, aimData, routes, monumentPoints, heritageCount };

        } catch (e) {
            if (tokenRef.current === token) {
                onLog('> Engine error — scan could not complete.', 'terrain', 'error');
                console.error(e);
            }
            if (mountedRef.current) setIsScanning(false);
            return null;
        }
    }, [onLog, onStatusChange]);

    return { runTerrainScan, cancelTerrain: cancelScan, isTerrainScanning: isScanning };
}
