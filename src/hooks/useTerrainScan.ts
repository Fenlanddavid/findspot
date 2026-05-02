// ─── Terrain scan hook ────────────────────────────────────────────────────────
// Runs the terrain scan pipeline: tile processing → NHLE/AIM/route fetching →
// cluster merging → hotspot generation. Returns a stable runTerrainScan()
// function that resolves with the full scan result, or null if cancelled.

import { useRef, useState, useCallback, useEffect } from 'react';
import maplibregl from 'maplibre-gl';

import { Cluster, Hotspot, HistoricRoute } from '../pages/fieldGuideTypes';
import { db } from '../db';
import {
    NHLEResponse, AIMResponse, OverpassElement,
    parseOverpassRoutes, fetchScanRoutes, fetchModernWays,
} from '../services/historicScanService';
import { scanDataSource } from '../utils/terrainEngine';
import {
    findConsensus, analyzeContext, suppressDisturbance,
    applyNHLEProtection, applyAIMEnrichment, getDistance,
    applyRouteArtefactSuppression,
} from '../utils/fieldGuideAnalysis';
import { buildTerrainHotspots } from '../utils/hotspotEngine';
import { SCAN_CONFIG } from '../utils/scanConfig';
import { resolveWaybackIds } from '../utils/waybackService';
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
    terrainClusters:    Cluster[];
    detectedFeatures:   Cluster[];
    hotspots:           Hotspot[];
    nhleData:           NHLEResponse;
    aimData:            AIMResponse;
    routes:             HistoricRoute[];
    monumentPoints:     [number, number][];
    heritageCount:      number;
    sourceAvailability: Record<string, boolean>;
    fromCache:          boolean;
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
    const tokenRef     = useRef<string | null>(null);
    const abortRef     = useRef<AbortController | null>(null);
    const mountedRef   = useRef(true);
    const workersRef   = useRef<Worker[]>([]);

    useEffect(() => {
        mountedRef.current = true;
        return () => { mountedRef.current = false; };
    }, []);

    const cancelScan = useCallback(() => {
        tokenRef.current = null;
        abortRef.current?.abort();
        // Terminate any in-flight scan workers immediately
        workersRef.current.forEach(w => w.terminate());
        workersRef.current = [];
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

        // Fresh worker registry for this scan run
        const workerReg: Worker[] = [];
        workersRef.current = workerReg;

        if (mountedRef.current) setIsScanning(true);
        const scanStart = Date.now();

        const CACHE_TTL_MS  = 24 * 60 * 60 * 1000;
        // Bump this string whenever scoring weights, thresholds, or gates change
        // so existing caches are discarded rather than silently serving stale results.
        const ENGINE_VERSION = 'FG-2026.05.02b';

        const zoom   = SCAN_CONFIG.TERRAIN_ZOOM;
        const bounds = map.getBounds();
        const center = map.getCenter();
        const n      = Math.pow(2, zoom);
        const cX     = (center.lng + 180) / 360 * n;
        const cY     = (1 - Math.log(Math.tan(center.lat * Math.PI / 180) + 1 / Math.cos(center.lat * Math.PI / 180)) / Math.PI) / 2 * n;
        const tX_start = Math.floor(cX) - 1;
        const tY_start = Math.floor(cY) - 1;

        // Tile-based cache key — deterministic for this exact viewport at Z16.
        const tileKey = `${zoom}-${tX_start}-${tY_start}`;

        const qWest  = bounds.getWest();
        const qSouth = bounds.getSouth();
        const qEast  = bounds.getEast();
        const qNorth = bounds.getNorth();

        // ── Cache check ───────────────────────────────────────────────────────
        // If the same viewport was scanned within the last 24 hours, skip the
        // expensive tile processing and return the cached raw clusters.
        try {
            const cached = await db.fieldGuideCache.get(tileKey);
            if (cached && (Date.now() - cached.createdAt) < CACHE_TTL_MS && cached.engineVersion === ENGINE_VERSION) {
                const ageMin = Math.round((Date.now() - cached.createdAt) / 60000);
                onLog(`> Cache hit — tile processing skipped (scan ${ageMin}m ago).`, 'terrain');
                // Still run NHLE/AIM/routes so the historic phase has fresh data.
                const nhleUrl = `https://services-eu1.arcgis.com/ZOdPfBS3aqqDYPUQ/arcgis/rest/services/National_Heritage_List_for_England_NHLE_v02_VIEW/FeatureServer/6/query?where=1%3D1&geometry=${bounds.getWest()},${bounds.getSouth()},${bounds.getEast()},${bounds.getNorth()}&geometryType=esriGeometryEnvelope&spatialRel=esriSpatialRelIntersects&inSR=4326&outSR=4326&f=geojson&outFields=Name,ListEntry`;
                const aimUrl  = `https://services-eu1.arcgis.com/ZOdPfBS3aqqDYPUQ/arcgis/rest/services/HE_AIM_data/FeatureServer/1/query?where=1%3D1&geometry=${bounds.getWest()},${bounds.getSouth()},${bounds.getEast()},${bounds.getNorth()}&geometryType=esriGeometryEnvelope&spatialRel=esriSpatialRelIntersects&inSR=4326&outSR=4326&f=geojson&outFields=MONUMENT_TYPE,PERIOD,EVIDENCE_1`;
                const [nhleData, aimData] = await Promise.all([
                    fetch(nhleUrl, { signal }).then(r => r.json() as Promise<NHLEResponse>).catch(() => ({ features: [] }) as NHLEResponse),
                    fetch(aimUrl,  { signal }).then(r => r.json() as Promise<AIMResponse>).catch(() => ({ features: [] }) as AIMResponse),
                ]);
                if (tokenRef.current !== token || signal.aborted || !mountedRef.current) { setIsScanning(false); return null; }

                const rawCombined = cached.rawClusters as Cluster[];
                const monumentPoints: [number, number][] = (nhleData.features || []).flatMap((f: any) => {
                    if (f.geometry.type === 'Point')   return [f.geometry.coordinates as [number, number]];
                    if (f.geometry.type === 'Polygon') return [(f.geometry.coordinates as number[][][])?.[0]?.[0] as [number, number]].filter(Boolean);
                    return [(f.geometry.coordinates as number[][][][])?.[0]?.[0]?.[0] as [number, number]].filter(Boolean);
                });
                const merged      = findConsensus(rawCombined);
                const aimEnriched = applyAIMEnrichment(merged, aimData);
                const updatedFeatures: Cluster[] = [];
                aimEnriched.forEach(newHit => {
                    let anchored = false;
                    for (const existing of updatedFeatures) {
                        if (getDistance(newHit.center, existing.center) < 15) {
                            newHit.sources.forEach(s => { if (!existing.sources.includes(s)) existing.sources.push(s); });
                            if (newHit.confidence === 'High') existing.confidence = 'High';
                            anchored = true; break;
                        }
                    }
                    if (!anchored) updatedFeatures.push(newHit);
                });
                applyNHLEProtection(updatedFeatures, nhleData);
                const suppressed     = suppressDisturbance(updatedFeatures);
                let routes: HistoricRoute[] = [];
                try {
                    const routeRaw = await Promise.race([fetchScanRoutes(center.lat, center.lng, signal), new Promise<null>((_, r) => setTimeout(() => r(new Error('timeout')), SCAN_CONFIG.ROUTE_FETCH_TIMEOUT_MS))]);
                    if (routeRaw?.elements) routes = parseOverpassRoutes(routeRaw.elements as OverpassElement[]);
                } catch { /* routes unavailable */ }
                const contextualized = analyzeContext(suppressed, routes)
                    .sort((a, b) => b.findPotential - a.findPotential)
                    .map((c, i) => ({ ...c, number: i + 1 }));
                // Suppress targets that sit on roads/paths and lack independent evidence
                try {
                    const modernWays = await fetchModernWays(center.lat, center.lng, signal);
                    applyRouteArtefactSuppression(contextualized, modernWays, routes);
                } catch { /* non-critical */ }
                const hotspots = buildTerrainHotspots(contextualized, routes, monumentPoints);
                if (mountedRef.current) setIsScanning(false);
                return {
                    terrainClusters: contextualized, detectedFeatures: contextualized, hotspots,
                    nhleData, aimData, routes, monumentPoints, heritageCount: nhleData.features?.length ?? 0,
                    sourceAvailability: cached.sourceAvailability, fromCache: true,
                };
            }
        } catch {
            // Cache miss or error — proceed with full scan
        }

        // ── Fire all network requests in parallel ─────────────────────────────
        // Wayback IDs are resolved once here so satellite workers receive them
        // directly — avoids each worker independently fetching the catalog.
        const waybackPromise = resolveWaybackIds();

        const nhleUrl = `https://services-eu1.arcgis.com/ZOdPfBS3aqqDYPUQ/arcgis/rest/services/National_Heritage_List_for_England_NHLE_v02_VIEW/FeatureServer/6/query?where=1%3D1&geometry=${qWest},${qSouth},${qEast},${qNorth}&geometryType=esriGeometryEnvelope&spatialRel=esriSpatialRelIntersects&inSR=4326&outSR=4326&f=geojson&outFields=Name,ListEntry`;
        const aimUrl  = `https://services-eu1.arcgis.com/ZOdPfBS3aqqDYPUQ/arcgis/rest/services/HE_AIM_data/FeatureServer/1/query?where=1%3D1&geometry=${qWest},${qSouth},${qEast},${qNorth}&geometryType=esriGeometryEnvelope&spatialRel=esriSpatialRelIntersects&inSR=4326&outSR=4326&f=geojson&outFields=MONUMENT_TYPE,PERIOD,EVIDENCE_1`;

        const nhlePromise       = fetch(nhleUrl, { signal }).then(r => r.json() as Promise<NHLEResponse>).catch(() => ({ features: [] }) as NHLEResponse);
        const aimPromise        = fetch(aimUrl,  { signal }).then(r => r.json() as Promise<AIMResponse>).catch(() => ({ features: [] }) as AIMResponse);
        const routePromise      = fetchScanRoutes(center.lat, center.lng, signal);
        const modernWaysPromise = fetchModernWays(center.lat, center.lng, signal).catch(() => []);

        onStatusChange('Scanning Terrain...');

        // Non-satellite workers start immediately — no wayback dependency
        const terrainTask       = scanDataSource('terrain',       zoom, tX_start, tY_start, bounds, n, { features: [] }, null, workerReg);
        const terrainGlobalTask = scanDataSource('terrain_global', zoom, tX_start, tY_start, bounds, n, { features: [] }, null, workerReg);
        const slopeTask         = scanDataSource('slope',         zoom, tX_start, tY_start, bounds, n, { features: [] }, null, workerReg);

        onStatusChange('Scanning Hydrology...');
        const hydroTask = scanDataSource('hydrology', zoom, tX_start, tY_start, bounds, n, { features: [] }, null, workerReg);

        onStatusChange('Spectral Sampling...');
        // Satellite workers need waybackIds — await the (already in-flight) promise
        const waybackIds = await waybackPromise;
        if (tokenRef.current !== token || signal.aborted || !mountedRef.current) {
            setIsScanning(false);
            return null;
        }
        const springTask   = scanDataSource('satellite_spring', zoom, tX_start, tY_start, bounds, n, { features: [] }, waybackIds, workerReg);
        const summerTask   = scanDataSource('satellite_summer', zoom, tX_start, tY_start, bounds, n, { features: [] }, waybackIds, workerReg);

        try {
            // NHLE, AIM, and all six tile workers resolve in parallel
            const [nhleData, aimData, terrainHits, terrainGlobalHits, slopeHits, hydroHits, springHits, summerHits] = await Promise.all([
                nhlePromise, aimPromise,
                terrainTask, terrainGlobalTask, slopeTask, hydroTask, springTask, summerTask,
            ]);

            if (tokenRef.current !== token || signal.aborted || !mountedRef.current) {
                setIsScanning(false);
                return null;
            }

            const monumentPoints: [number, number][] = (nhleData.features || []).flatMap(f => {
                if (f.geometry.type === 'Point')   return [f.geometry.coordinates as [number, number]];
                if (f.geometry.type === 'Polygon') return [(f.geometry.coordinates as number[][][])?.[0]?.[0] as [number, number]].filter(Boolean);
                return [(f.geometry.coordinates as number[][][][])?.[0]?.[0]?.[0] as [number, number]].filter(Boolean);
            });
            const heritageCount = nhleData.features?.length ?? 0;
            if (heritageCount > 0) onLog(`> NHLE: ${heritageCount} scheduled monument${heritageCount !== 1 ? 's' : ''} in scan area.`, 'terrain');
            const aerialHitCount = springHits.length + summerHits.length;
            if (aerialHitCount > 0) onLog(`> Aerial: ${aerialHitCount} spectral signal${aerialHitCount !== 1 ? 's' : ''} detected.`, 'terrain');
            else onLog('> Aerial: no spectral signals detected (Wayback tiles may not cover this area).', 'terrain', 'warn');
            if (aimData.features?.length > 0) onLog(`> AIM: ${aimData.features.length} aerial monument${aimData.features.length !== 1 ? 's' : ''} mapped.`, 'terrain');

            // Routes — started in parallel, should already be done
            onStatusChange('Syncing Routes...');
            let routes: HistoricRoute[] = [];
            try {
                const timeout  = new Promise<null>((_, reject) => setTimeout(() => reject(new Error('timeout')), SCAN_CONFIG.ROUTE_FETCH_TIMEOUT_MS));
                const routeRaw = await Promise.race([routePromise, timeout]);
                if (routeRaw?.elements) routes = parseOverpassRoutes(routeRaw.elements as OverpassElement[]);
            } catch {
                onLog('> Routes: service unavailable, continuing without.', 'terrain', 'warn');
            }

            if (tokenRef.current !== token || signal.aborted || !mountedRef.current) {
                setIsScanning(false);
                return null;
            }

            // ── Cluster processing pipeline ───────────────────────────────────
            onStatusChange('Locking Coordinates...');

            const rawCombined = [...terrainHits, ...terrainGlobalHits, ...slopeHits, ...hydroHits, ...springHits, ...summerHits];

            // ── Source availability & cache save ─────────────────────────────
            const sourceAvailability: Record<string, boolean> = {
                terrain:          terrainHits.length > 0,
                terrain_global:   terrainGlobalHits.length > 0,
                slope:            slopeHits.length > 0,
                hydrology:        hydroHits.length > 0,
                satellite_spring: springHits.length > 0,
                satellite_summer: summerHits.length > 0,
            };
            try {
                const expiredCutoff = Date.now() - CACHE_TTL_MS;
                await db.fieldGuideCache.where('createdAt').below(expiredCutoff).delete();
                await db.fieldGuideCache.put({ id: tileKey, createdAt: Date.now(), rawClusters: rawCombined, sourceAvailability, engineVersion: ENGINE_VERSION });
            } catch { /* cache failure is non-fatal */ }

            const merged      = findConsensus(rawCombined);
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

            applyNHLEProtection(updatedFeatures, nhleData);

            const suppressed     = suppressDisturbance(updatedFeatures);
            const contextualized = analyzeContext(suppressed, routes)
                .sort((a, b) => b.findPotential - a.findPotential)
                .map((c, i) => ({ ...c, number: i + 1 }));

            // Suppress targets that sit on roads/paths and lack independent evidence.
            // modernWaysPromise was started in parallel with other fetches.
            const modernWays = await modernWaysPromise;
            applyRouteArtefactSuppression(contextualized, modernWays, routes);

            const hotspots = buildTerrainHotspots(contextualized, routes, monumentPoints);

            const duration = ((Date.now() - scanStart) / 1000).toFixed(1);
            onLog(`> Terrain scan complete in ${duration}s — ${contextualized.length} signal${contextualized.length !== 1 ? 's' : ''} detected, ${hotspots.length} target${hotspots.length !== 1 ? 's' : ''} identified.`, 'terrain');

            if (mountedRef.current) setIsScanning(false);
            return { terrainClusters: contextualized, detectedFeatures: contextualized, hotspots, nhleData, aimData, routes, monumentPoints, heritageCount, sourceAvailability, fromCache: false };

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
