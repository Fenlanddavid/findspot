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
    parseOverpassRoutes, fetchScanRoutes, fetchModernWaysForBoundsResult,
    fetchScheduledMonuments, fetchAIMData,
} from '../services/historicScanService';
import { scanDataSource } from '../utils/terrainEngine';
import {
    findConsensus, analyzeContext, suppressDisturbance,
    applyNHLEProtection, applyAIMEnrichment, getDistance,
    applyRouteAssessments, applyRouteUnavailableFallback, getHotspotInput, MONUMENT_BOUNDARY_BUFFER_M,
} from '../utils/fieldGuideAnalysis';
import { buildTerrainHotspots } from '../utils/hotspotEngine';
import { SCAN_CONFIG } from '../utils/scanConfig';
import { resolveWaybackIds } from '../utils/waybackService';
import { LogSource, LogLevel } from '../utils/scanLogger';
import { fetchRomanRoads } from '../services/romanRoadService';

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
    rawClusters:        Cluster[];   // pre-consensus — used by Trace Signal engine
    hotspots:           Hotspot[];
    nhleData:           NHLEResponse;
    aimData:            AIMResponse;
    routes:             HistoricRoute[];
    modernWays:         import('../pages/fieldGuideTypes').ModernWay[];
    monumentPoints:     [number, number][];
    heritageCount:      number;
    sourceAvailability: Record<string, boolean>;
    fromCache:          boolean;
    noSignal:           boolean;
    scanStartCenter:    { lat: number; lng: number };
    scanStartBounds:     { west: number; south: number; east: number; north: number };
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

function padBoundsByMetres(
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
        west:  west  - lonPad,
        south: south - latPad,
        east:  east  + lonPad,
        north: north + latPad,
    };
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
        const ENGINE_VERSION = 'FG-2026.06.15a';

        const zoom   = SCAN_CONFIG.TERRAIN_ZOOM;
        const bounds = map.getBounds();
        const center = map.getCenter();
        const scanStartCenter = { lat: center.lat, lng: center.lng };
        const n      = Math.pow(2, zoom);
        const cX     = (center.lng + 180) / 360 * n;
        const cY     = (1 - Math.log(Math.tan(center.lat * Math.PI / 180) + 1 / Math.cos(center.lat * Math.PI / 180)) / Math.PI) / 2 * n;
        const tX_start = Math.floor(cX) - 1;
        const tY_start = Math.floor(cY) - 1;
        const tileLon = (x: number) => x / n * 360 - 180;
        const tileLat = (y: number) => (180 / Math.PI) * (2 * Math.atan(Math.exp(Math.PI * (1 - 2 * y / n))) - Math.PI / 2);
        const scanWest  = tileLon(tX_start);
        const scanEast  = tileLon(tX_start + 3);
        const scanNorth = tileLat(tY_start);
        const scanSouth = tileLat(tY_start + 3);

        // Tile-based cache key — deterministic for this exact viewport at Z16.
        const tileKey = `${zoom}-${tX_start}-${tY_start}`;

        const qWest  = bounds.getWest();
        const qSouth = bounds.getSouth();
        const qEast  = bounds.getEast();
        const qNorth = bounds.getNorth();
        const scanStartBounds = { west: qWest, south: qSouth, east: qEast, north: qNorth };
        const monumentQueryBounds = padBoundsByMetres(
            qWest, qSouth, qEast, qNorth, center.lat, MONUMENT_BOUNDARY_BUFFER_M + 5,
        );

        // ── Fire route + ways fetches before cache check ──────────────────────
        // Both requests are fired here so they run in parallel with the DB cache
        // lookup and NHLE/AIM fetches. On a cache hit the routes fetch will have
        // had several seconds to resolve before the Promise.race timeout is tested,
        // matching the behaviour of a fresh scan (where tile processing gives routes
        // the same head-start). On a cache miss, the fresh scan path reuses these
        // same promises — no duplicate requests are made.
        const routePromise      = fetchScanRoutes(center.lat, center.lng, signal);
        const modernWaysPromise = fetchModernWaysForBoundsResult(scanWest, scanSouth, scanEast, scanNorth, signal)
            .catch(() => ({ ways: [], available: false }));

        // ── Cache check ───────────────────────────────────────────────────────
        // If the same viewport was scanned within the last 24 hours, skip the
        // expensive tile processing and return the cached raw clusters.
        // Ways data has a longer TTL — roads rarely change, so stale ways from an
        // expired tile record are rescued here and reused if a fresh Overpass fetch fails.
        const MODERN_WAYS_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
        let rescuedModernWays: import('../pages/fieldGuideTypes').ModernWay[] | null = null;
        try {
            const stale = await db.fieldGuideCache.get(tileKey);
            if (stale && Array.isArray(stale.modernWays) && stale.modernWays.length > 0 &&
                typeof stale.modernWaysFetchedAt === 'number' &&
                (Date.now() - stale.modernWaysFetchedAt) < MODERN_WAYS_TTL_MS) {
                rescuedModernWays = stale.modernWays as import('../pages/fieldGuideTypes').ModernWay[];
            }
        } catch { /* non-fatal */ }
        try {
            const cached = await db.fieldGuideCache.get(tileKey);
            if (cached && (Date.now() - cached.createdAt) < CACHE_TTL_MS && cached.engineVersion === ENGINE_VERSION) {
                const ageMin = Math.round((Date.now() - cached.createdAt) / 60000);
                onLog(`> Cache hit — tile processing skipped (scan ${ageMin}m ago).`, 'terrain');
                onStatusChange('Checking protected archaeology...');
                // Still run NHLE/AIM/routes so the historic phase has fresh data.
                const [nhleData, aimData] = await Promise.all([
                    fetchScheduledMonuments(monumentQueryBounds.west, monumentQueryBounds.south, monumentQueryBounds.east, monumentQueryBounds.north, signal),
                    fetchAIMData(bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth(), signal),
                ]);
                if (tokenRef.current !== token || signal.aborted || !mountedRef.current) { setIsScanning(false); return null; }

                const rawCombined = cached.rawClusters as Cluster[];
                const monumentPoints: [number, number][] = (nhleData.features || []).flatMap((f: any) => {
                    if (f.geometry.type === 'Point')   return [f.geometry.coordinates as [number, number]];
                    if (f.geometry.type === 'Polygon') return [(f.geometry.coordinates as number[][][])?.[0]?.[0] as [number, number]].filter(Boolean);
                    return [(f.geometry.coordinates as number[][][][])?.[0]?.[0]?.[0] as [number, number]].filter(Boolean);
                });
                const heritageCount = nhleData.features?.length ?? 0;
                if (nhleData.available === false) {
                    onLog('> NHLE: Scheduled monument service unavailable — protected archaeology could not be checked for this terrain scan.', 'terrain', 'warn');
                } else if (heritageCount > 0) {
                    onLog(`> NHLE: ${heritageCount} scheduled monument${heritageCount !== 1 ? 's' : ''} in scan area.`, 'terrain');
                }
                onStatusChange('Comparing landscape signals...');
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
                onStatusChange('Filtering disturbance patterns...');
                const suppressed     = suppressDisturbance(updatedFeatures);
                let routes: HistoricRoute[] = [];
                try {
                    onStatusChange('Reading route context...');
                    // routePromise was fired before the cache check — it has had
                    // time to resolve during the DB lookup and NHLE/AIM fetches.
                    const routeRaw = await Promise.race([routePromise, new Promise<null>((_, r) => setTimeout(() => r(new Error('timeout')), SCAN_CONFIG.ROUTE_FETCH_TIMEOUT_MS))]);
                    if (routeRaw?.elements) routes = parseOverpassRoutes(routeRaw.elements as OverpassElement[]);
                } catch { /* routes unavailable */ }
                // Itiner-e Roman roads — static asset, always available; must be
                // included here as it is in the fresh scan path, otherwise cached
                // scans miss Roman road context and produce no corridor link lines.
                try {
                    const romanRoads = await fetchRomanRoads(qWest, qSouth, qEast, qNorth);
                    if (romanRoads.length > 0) routes = [...routes, ...romanRoads];
                } catch { /* asset unavailable */ }
                onStatusChange('Building hotspot model...');
                const contextualized = analyzeContext(suppressed, routes)
                    .sort((a, b) => b.findPotential - a.findPotential)
                    .map((c, i) => ({ ...c, number: i + 1 }));
                // Assess route relationships for all clusters before hotspot generation.
                // Attaches routeAssessment to each cluster; sets isRouteArtefactRisk on artefacts.
                let cachedModernWays = (Array.isArray(cached.modernWays)
                    ? cached.modernWays
                    : []) as import('../pages/fieldGuideTypes').ModernWay[];
                const hadStoredModernWayResult = Array.isArray(cached.modernWays) &&
                    (cachedModernWays.length > 0 || typeof cached.modernWaysFetchedAt === 'number');
                let modernWaysAvailable = hadStoredModernWayResult;
                try {
                    if (!hadStoredModernWayResult) {
                        const modernWayResult = await fetchModernWaysForBoundsResult(
                            scanWest, scanSouth, scanEast, scanNorth, signal,
                        );
                        cachedModernWays = modernWayResult.ways;
                        modernWaysAvailable = modernWayResult.available;
                        if (modernWaysAvailable) {
                            try {
                                await db.fieldGuideCache.update(tileKey, { modernWays: cachedModernWays, modernWaysFetchedAt: Date.now() });
                            } catch { /* cache update failure is non-fatal */ }
                        }
                    }
                    if (cachedModernWays.length > 0) {
                        applyRouteAssessments(contextualized, cachedModernWays);
                        const routeSuppressed = contextualized.filter(c => c.isRouteArtefactRisk).length;
                        onLog(`> Route suppression: cached scan - ${cachedModernWays.length} mapped way${cachedModernWays.length !== 1 ? 's' : ''} checked${hadStoredModernWayResult ? ' from route cache' : ''}, ${routeSuppressed} road-aligned signal${routeSuppressed !== 1 ? 's' : ''} hidden.`, 'terrain');
                    } else if (modernWaysAvailable) {
                        onLog(`> Route suppression: cached scan - no mapped ways found${hadStoredModernWayResult ? ' from route cache' : ''}; 0 road-aligned signals hidden.`, 'terrain');
                    } else {
                        const fallbackHidden = applyRouteUnavailableFallback(contextualized);
                        onLog(`> Route suppression: modern road data unavailable; fallback hid ${fallbackHidden} high-risk linear signal${fallbackHidden !== 1 ? 's' : ''}.`, 'terrain', 'warn');
                    }
                } catch {
                    const fallbackHidden = applyRouteUnavailableFallback(contextualized);
                    onLog(`> Route suppression: modern road data failed; fallback hid ${fallbackHidden} high-risk linear signal${fallbackHidden !== 1 ? 's' : ''}.`, 'terrain', 'warn');
                }
                const hotspots = buildTerrainHotspots(getHotspotInput(contextualized), routes, monumentPoints);
                if (mountedRef.current) setIsScanning(false);
                return {
                    terrainClusters: contextualized, detectedFeatures: contextualized, rawClusters: rawCombined, hotspots,
                    nhleData, aimData, routes, modernWays: cachedModernWays, monumentPoints, heritageCount,
                    sourceAvailability: cached.sourceAvailability, fromCache: true, noSignal: false, scanStartCenter, scanStartBounds,
                };
            }
        } catch {
            // Cache miss or error — proceed with full scan
        }

        // ── Fire remaining parallel requests for fresh scan ───────────────────
        // routePromise and modernWaysPromise were already fired before the cache
        // check — reuse them here. Fire remaining requests now.
        const waybackPromise = resolveWaybackIds();

        const nhlePromise = fetchScheduledMonuments(monumentQueryBounds.west, monumentQueryBounds.south, monumentQueryBounds.east, monumentQueryBounds.north, signal);
        const aimPromise  = fetchAIMData(qWest, qSouth, qEast, qNorth, signal);

        onStatusChange('Reading terrain...');

        // Non-satellite workers start immediately — no wayback dependency
        const terrainTask       = scanDataSource('terrain',       zoom, tX_start, tY_start, bounds, n, { features: [] }, null, workerReg);
        const terrainGlobalTask = scanDataSource('terrain_global', zoom, tX_start, tY_start, bounds, n, { features: [] }, null, workerReg);
        const slopeTask         = scanDataSource('slope',         zoom, tX_start, tY_start, bounds, n, { features: [] }, null, workerReg);

        onStatusChange('Reading hydrology...');
        const hydroTask = scanDataSource('hydrology', zoom, tX_start, tY_start, bounds, n, { features: [] }, null, workerReg);

        onStatusChange('Comparing spectral layers...');
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
            const [nhleData, aimData, terrainResult, terrainGlobalResult, slopeResult, hydroResult, springResult, summerResult] = await Promise.all([
                nhlePromise, aimPromise,
                terrainTask, terrainGlobalTask, slopeTask, hydroTask, springTask, summerTask,
            ]);

            if (tokenRef.current !== token || signal.aborted || !mountedRef.current) {
                setIsScanning(false);
                return null;
            }

            const terrainHits       = terrainResult.clusters;
            const terrainGlobalHits = terrainGlobalResult.clusters;
            const slopeHits         = slopeResult.clusters;
            const hydroHits         = hydroResult.clusters;
            const springHits        = springResult.clusters;
            const summerHits        = summerResult.clusters;

            onLog(
                `> Terrain relief: ${terrainHits.length} local signal${terrainHits.length !== 1 ? 's' : ''}, ${terrainGlobalHits.length} broad signal${terrainGlobalHits.length !== 1 ? 's' : ''} detected.`,
                'terrain',
            );

            const monumentPoints: [number, number][] = (nhleData.features || []).flatMap(f => {
                if (f.geometry.type === 'Point')   return [f.geometry.coordinates as [number, number]];
                if (f.geometry.type === 'Polygon') return [(f.geometry.coordinates as number[][][])?.[0]?.[0] as [number, number]].filter(Boolean);
                return [(f.geometry.coordinates as number[][][][])?.[0]?.[0]?.[0] as [number, number]].filter(Boolean);
            });
            const heritageCount = nhleData.features?.length ?? 0;
            if (nhleData.available === false) {
                onLog('> NHLE: Scheduled monument service unavailable — protected archaeology could not be checked for this terrain scan.', 'terrain', 'warn');
            } else if (heritageCount > 0) {
                onLog(`> NHLE: ${heritageCount} scheduled monument${heritageCount !== 1 ? 's' : ''} in scan area.`, 'terrain');
            }
            const aerialHitCount = springHits.length + summerHits.length;
            if (aerialHitCount > 0) onLog(`> Aerial: ${aerialHitCount} spectral signal${aerialHitCount !== 1 ? 's' : ''} detected.`, 'terrain');
            else onLog('> Aerial: no spectral signals detected (Wayback tiles may not cover this area).', 'terrain', 'warn');
            if (aimData.features?.length > 0) onLog(`> AIM: ${aimData.features.length} aerial monument${aimData.features.length !== 1 ? 's' : ''} mapped.`, 'terrain');

            // Routes — started in parallel, should already be done
            onStatusChange('Reading route context...');
            let routes: HistoricRoute[] = [];
            try {
                const timeout  = new Promise<null>((_, reject) => setTimeout(() => reject(new Error('timeout')), SCAN_CONFIG.ROUTE_FETCH_TIMEOUT_MS));
                const routeRaw = await Promise.race([routePromise, timeout]);
                if (routeRaw?.elements) routes = parseOverpassRoutes(routeRaw.elements as OverpassElement[]);
            } catch {
                onLog('> Routes: service unavailable, continuing without.', 'terrain', 'warn');
            }

            // Itiner-e Roman roads — independent of OSM timeout; loads from static GeoJSON asset
            try {
                const romanRoads = await fetchRomanRoads(qWest, qSouth, qEast, qNorth);
                if (romanRoads.length > 0) {
                    routes = [...routes, ...romanRoads];
                    onLog(`> Routes: ${romanRoads.length} Roman road alignment${romanRoads.length !== 1 ? 's' : ''} detected.`, 'terrain');
                }
            } catch { /* Itiner-e asset unavailable */ }

            if (tokenRef.current !== token || signal.aborted || !mountedRef.current) {
                setIsScanning(false);
                return null;
            }

            // ── Cluster processing pipeline ───────────────────────────────────
            onStatusChange('Comparing landscape signals...');

            const rawCombined = [...terrainHits, ...terrainGlobalHits, ...slopeHits, ...hydroHits, ...springHits, ...summerHits];

            // ── Source availability ──────────────────────────────────────────
            const sourceAvailability: Record<string, boolean> = {
                terrain:          terrainResult.tilesLoaded > 0,
                terrain_global:   terrainGlobalResult.tilesLoaded > 0,
                slope:            slopeResult.tilesLoaded > 0,
                hydrology:        hydroResult.tilesLoaded > 0,
                satellite_spring: springResult.tilesLoaded > 0,
                satellite_summer: summerResult.tilesLoaded > 0,
            };

            // If every tile source failed to load, the device has no signal.
            // Don't cache this result — it will resolve correctly once connectivity returns.
            const noSignal = Object.values(sourceAvailability).every(v => !v);

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

            onStatusChange('Checking protected archaeology...');
            applyNHLEProtection(updatedFeatures, nhleData);

            onStatusChange('Filtering disturbance patterns...');
            const suppressed     = suppressDisturbance(updatedFeatures);
            const contextualized = analyzeContext(suppressed, routes)
                .sort((a, b) => b.findPotential - a.findPotential)
                .map((c, i) => ({ ...c, number: i + 1 }));

            const palaeoCount = contextualized.filter(c => c.type.includes('Palaeochannel')).length;
            if (palaeoCount > 0) {
                onLog(
                    `> Hydrology: ${palaeoCount} palaeochannel signal${palaeoCount !== 1 ? 's' : ''} detected — ancient watercourse trace.`,
                    'terrain',
                );
            }

            // Assess route relationships for all clusters — attaches routeAssessment,
            // sets isRouteArtefactRisk on confirmed artefacts. Runs after AIM/NHLE
            // enrichment and analyzeContext so full archaeological context is available.
            onStatusChange('Interpreting route signals...');
            const modernWayResult = await modernWaysPromise;
            let modernWays = modernWayResult.ways;
            let modernWaysFetchedAt: number | undefined = modernWayResult.available ? Date.now() : undefined;
            if (modernWays.length > 0) {
                applyRouteAssessments(contextualized, modernWays);
                const routeSuppressed = contextualized.filter(c => c.isRouteArtefactRisk).length;
                onLog(`> Route suppression: fresh scan - ${modernWays.length} mapped way${modernWays.length !== 1 ? 's' : ''} checked, ${routeSuppressed} road-aligned signal${routeSuppressed !== 1 ? 's' : ''} hidden.`, 'terrain');
            } else if (modernWayResult.available) {
                onLog('> Route suppression: fresh scan - no mapped ways found; 0 road-aligned signals hidden.', 'terrain');
            } else if (rescuedModernWays && rescuedModernWays.length > 0) {
                // Overpass unavailable — use ways rescued from the previous cache record.
                modernWays = rescuedModernWays;
                modernWaysFetchedAt = undefined; // keep original fetchedAt from the rescued record
                applyRouteAssessments(contextualized, modernWays);
                const routeSuppressed = contextualized.filter(c => c.isRouteArtefactRisk).length;
                onLog(`> Route suppression: fresh scan - ${modernWays.length} rescued cached way${modernWays.length !== 1 ? 's' : ''} used (Overpass unavailable), ${routeSuppressed} road-aligned signal${routeSuppressed !== 1 ? 's' : ''} hidden.`, 'terrain', 'warn');
            } else {
                const fallbackHidden = applyRouteUnavailableFallback(contextualized);
                onLog(`> Route suppression: modern road data unavailable; fallback hid ${fallbackHidden} high-risk linear signal${fallbackHidden !== 1 ? 's' : ''}.`, 'terrain', 'warn');
            }
            if (!noSignal) {
                try {
                    const expiredCutoff = Date.now() - CACHE_TTL_MS;
                    await db.fieldGuideCache.where('createdAt').below(expiredCutoff).delete();
                    await db.fieldGuideCache.put({
                        id: tileKey, createdAt: Date.now(), rawClusters: rawCombined,
                        sourceAvailability, engineVersion: ENGINE_VERSION,
                        ...(modernWays.length > 0 ? { modernWays, modernWaysFetchedAt: modernWaysFetchedAt ?? (rescuedModernWays ? Date.now() : undefined) } : {}),
                    });
                } catch { /* cache failure is non-fatal */ }
            }

            onStatusChange('Building hotspot model...');
            const hotspots = buildTerrainHotspots(getHotspotInput(contextualized), routes, monumentPoints);

            const duration = ((Date.now() - scanStart) / 1000).toFixed(1);
            onLog(`> Terrain scan complete in ${duration}s — ${contextualized.length} landscape signal${contextualized.length !== 1 ? 's' : ''} detected, ${hotspots.length} hotspot${hotspots.length !== 1 ? 's' : ''} identified.`, 'terrain');

            if (mountedRef.current) setIsScanning(false);
            return {
                terrainClusters: contextualized, detectedFeatures: contextualized, rawClusters: rawCombined, hotspots,
                nhleData, aimData, routes, modernWays, monumentPoints, heritageCount, sourceAvailability,
                fromCache: false, noSignal, scanStartCenter, scanStartBounds,
            };

        } catch (e) {
            if (tokenRef.current === token) {
                onLog('> Scan error — landscape signals could not be read.', 'terrain', 'error');
                console.error(e);
            }
            if (mountedRef.current) setIsScanning(false);
            return null;
        }
    }, [onLog, onStatusChange]);

    return { runTerrainScan, cancelTerrain: cancelScan, isTerrainScanning: isScanning };
}
