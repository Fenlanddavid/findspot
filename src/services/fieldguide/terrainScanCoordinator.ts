// ─── Terrain scan coordinator ─────────────────────────────────────────────────
// Runs the terrain scan pipeline: tile processing → NHLE/AIM/route fetching →
// cluster merging → hotspot generation.

import { HistoricRoute } from '../../pages/fieldGuideTypes';
import { db } from '../../db';
import {
    OverpassElement,
    parseOverpassRoutes, fetchScanRoutes, fetchModernWaysForBoundsResult,
    fetchScheduledMonuments, fetchAIMData,
} from '../historicScanService';
import { scanDataSource } from '../../engines/landscape/terrainEngine';
import {
    findConsensus, analyzeContext, suppressDisturbance,
    applyNHLEProtection, applyAIMEnrichment,
    applyRouteAssessments, applyRouteUnavailableFallback, getHotspotInput, MONUMENT_BOUNDARY_BUFFER_M,
} from '../../utils/fieldGuideAnalysis';
import { buildTerrainHotspots, HOTSPOT_ENGINE_VERSION } from '../../engines/hotspot/hotspotEngine';
import { SCAN_CONFIG } from '../../utils/scanConfig';
import { resolveWaybackIds } from '../../utils/waybackService';
import { fetchRomanRoadsResult } from '../romanRoadService';
import { findPackMatchForBbox } from '../offlinePack';
import { safeParseFieldGuideScanCache } from '../persistenceValidation';
import {
    discardFieldGuideScanCache,
    refreshCachedModernWays,
    saveTerrainScanCache,
} from '../fieldGuideMutations';
import { reportNonFatal } from '../diagLog';
import {
    applyOfflinePackAvailability,
    collapseByProximity,
    extractMonumentPoints,
    padBoundsByMetres,
    seconds,
    type TerrainScanCoordinatorOptions,
    type TerrainScanParams,
    type TerrainScanResult,
} from './terrainScanSupport';

export type {
    ScanContext,
    TerrainScanParams,
    TerrainScanResult,
} from './terrainScanSupport';

export async function runTerrainScanPipeline(
    params: TerrainScanParams,
    {
        onLog,
        onStatusChange,
        signal,
        workerRegistry,
        isActive,
    }: TerrainScanCoordinatorOptions,
): Promise<TerrainScanResult | null> {
        const map = params.mapRef.current;
        if (!map) return null;

        const scanStart = Date.now();
        const perfStart = performance.now();

        const CACHE_TTL_MS  = 24 * 60 * 60 * 1000;
        // Bump this string whenever scoring weights, thresholds, or gates change
        // so existing caches are discarded rather than silently serving stale results.
        const ENGINE_VERSION = HOTSPOT_ENGINE_VERSION;

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
        const analysisBounds = { west: scanWest, south: scanSouth, east: scanEast, north: scanNorth };

        // Tile-based cache key — deterministic for this exact viewport at Z16.
        const tileKey = `${zoom}-${tX_start}-${tY_start}`;

        const qWest  = bounds.getWest();
        const qSouth = bounds.getSouth();
        const qEast  = bounds.getEast();
        const qNorth = bounds.getNorth();
        const scanStartBounds = { west: qWest, south: qSouth, east: qEast, north: qNorth };
        // The terrain scanner always reads a fixed 3x3 tile footprint at Z16.
        // Keep historic/protection lookups aligned to that footprint; using the
        // visible viewport here makes zoomed-out scans pull thousands of records.
        const contextQueryBounds = padBoundsByMetres(
            scanWest, scanSouth, scanEast, scanNorth, center.lat, MONUMENT_BOUNDARY_BUFFER_M + 5,
        );

        // ── Cache check ───────────────────────────────────────────────────────
        // If the same viewport was scanned within the last 24 hours, skip the
        // expensive tile processing and return the cached raw clusters.
        // Ways data has a longer TTL — roads rarely change, so stale ways from an
        // expired tile record are rescued here and reused if a fresh Overpass fetch fails.
        const MODERN_WAYS_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
        let rescuedModernWays: import('../../pages/fieldGuideTypes').ModernWay[] | null = null;
        try {
            const persisted = await db.fieldGuideCache.get(tileKey);
            const stale = safeParseFieldGuideScanCache(persisted);
            if (persisted && !stale) await discardFieldGuideScanCache(tileKey);
            if (stale && stale.modernWays && stale.modernWays.length > 0 &&
                typeof stale.modernWaysFetchedAt === 'number' &&
                (Date.now() - stale.modernWaysFetchedAt) < MODERN_WAYS_TTL_MS) {
                rescuedModernWays = stale.modernWays;
            }
        } catch (error) {
            reportNonFatal('terrain-scan', 'Stale route cache recovery failed', error);
        }

        const packMatch = await findPackMatchForBbox([scanWest, scanSouth, scanEast, scanNorth], zoom).catch(() => null);
        const offlinePackMeta = packMatch?.coverage.full ? packMatch.meta : null;
        if (offlinePackMeta) {
            onLog('> Offline pack: downloaded terrain pack covers this scan; live route lookups skipped.', 'terrain');
        } else if (packMatch) {
            onLog(`> Offline pack: partial coverage (${packMatch.coverage.covered}/${packMatch.coverage.total} terrain tiles); live/cached hybrid scan used.`, 'terrain', 'warn');
        }

        // ── Fire route + ways fetches before cache check ──────────────────────
        // When a prepared pack covers the 3x3 tile footprint, avoid live Overpass
        // route/road requests. Those are not part of the pack and can dominate
        // online scan time; airplane mode merely made them fail fast.
        const routePromise = offlinePackMeta
            ? Promise.resolve(null)
            : fetchScanRoutes(center.lat, center.lng, signal);
        const modernWaysPromise = offlinePackMeta
            ? Promise.resolve({ ways: rescuedModernWays ?? [], available: false })
            : fetchModernWaysForBoundsResult(scanWest, scanSouth, scanEast, scanNorth, signal)
                .catch(() => ({ ways: [], available: false }));

        try {
            const persisted = await db.fieldGuideCache.get(tileKey);
            const cached = safeParseFieldGuideScanCache(persisted);
            if (persisted && !cached) await discardFieldGuideScanCache(tileKey);
            if (cached && (Date.now() - cached.createdAt) < CACHE_TTL_MS && cached.engineVersion === ENGINE_VERSION) {
                const ageMin = Math.round((Date.now() - cached.createdAt) / 60000);
                onLog(`> Cache hit — tile processing skipped (scan ${ageMin}m ago).`, 'terrain');
                onStatusChange('Checking protected archaeology...');
                // Still run NHLE/AIM/routes so the historic phase has fresh data.
                const designationOptions = { cacheOnly: !!offlinePackMeta };
                const [nhleData, aimData] = await Promise.all([
                    fetchScheduledMonuments(contextQueryBounds.west, contextQueryBounds.south, contextQueryBounds.east, contextQueryBounds.north, signal, designationOptions),
                    fetchAIMData(contextQueryBounds.west, contextQueryBounds.south, contextQueryBounds.east, contextQueryBounds.north, signal, designationOptions),
                ]);
                if (!isActive()) return null;

                const rawCombined = cached.rawClusters;
                const monumentPoints = extractMonumentPoints(nhleData.features || []);
                const heritageCount = nhleData.features?.length ?? 0;
                if (nhleData.available === false) {
                    onLog('> NHLE: Scheduled monument service unavailable — protected archaeology could not be checked for this terrain scan.', 'terrain', 'warn');
                } else if (heritageCount > 0) {
                    onLog(`> NHLE: ${heritageCount} scheduled monument${heritageCount !== 1 ? 's' : ''} in scan area.`, 'terrain');
                }
                onStatusChange('Comparing landscape signals...');
                const merged      = findConsensus(rawCombined);
                const aimEnriched = applyAIMEnrichment(merged, aimData);
                const updatedFeatures = collapseByProximity(aimEnriched);
                applyNHLEProtection(updatedFeatures, nhleData);
                onStatusChange('Filtering disturbance patterns...');
                const suppressed     = suppressDisturbance(updatedFeatures);
                let routes: HistoricRoute[] = [];
                let osmRoutesAvailable = false;
                try {
                    onStatusChange('Reading route context...');
                    // routePromise was fired before the cache check — it has had
                    // time to resolve during the DB lookup and NHLE/AIM fetches.
                    const routeRaw = await Promise.race([routePromise, new Promise<null>((_, r) => setTimeout(() => r(new Error('timeout')), SCAN_CONFIG.ROUTE_FETCH_TIMEOUT_MS))]);
                    osmRoutesAvailable = routeRaw !== null;
                    if (routeRaw?.elements) routes = parseOverpassRoutes(routeRaw.elements as OverpassElement[]);
                } catch (error) {
                    reportNonFatal('terrain-scan', 'Cached route refresh failed', error);
                }
                // Itiner-e Roman roads — static asset, always available; must be
                // included here as it is in the fresh scan path, otherwise cached
                // scans miss Roman road context and produce no corridor link lines.
                const romanRoadResult = await fetchRomanRoadsResult(scanWest, scanSouth, scanEast, scanNorth);
                if (romanRoadResult.routes.length > 0) {
                    routes = [...routes, ...romanRoadResult.routes];
                } else if (!romanRoadResult.available) {
                    onLog('> Routes: Roman road asset unavailable, continuing without Itiner-e context.', 'terrain', 'warn');
                }
                onStatusChange('Building hotspot model...');
                const contextualized = analyzeContext(suppressed, routes)
                    .sort((a, b) => b.findPotential - a.findPotential)
                    .map((c, i) => ({ ...c, number: i + 1 }));
                // Assess route relationships for all clusters before hotspot generation.
                // Attaches routeAssessment to each cluster; sets isRouteArtefactRisk on artefacts.
                let cachedModernWays = (Array.isArray(cached.modernWays)
                    ? cached.modernWays
                    : []) as import('../../pages/fieldGuideTypes').ModernWay[];
                const hadStoredModernWayResult = Array.isArray(cached.modernWays) &&
                    (cachedModernWays.length > 0 || typeof cached.modernWaysFetchedAt === 'number');
                let modernWaysAvailable = hadStoredModernWayResult;
                try {
                    if (!hadStoredModernWayResult) {
                        if (offlinePackMeta) {
                            cachedModernWays = rescuedModernWays ?? [];
                            modernWaysAvailable = false;
                        } else {
                            const modernWayResult = await fetchModernWaysForBoundsResult(
                                scanWest, scanSouth, scanEast, scanNorth, signal,
                            );
                            cachedModernWays = modernWayResult.ways;
                            modernWaysAvailable = modernWayResult.available;
                            if (modernWaysAvailable) {
                                try {
                                    await refreshCachedModernWays(tileKey, cachedModernWays, Date.now());
                                } catch (error) {
                                    reportNonFatal('terrain-scan', 'Modern ways cache refresh failed', error);
                                }
                            }
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
                const historicRoutesAvailable = osmRoutesAvailable && romanRoadResult.available;
                const questionTerrainAvailability = cached.sourceCompleteness ?? {
                    terrain: false, terrain_global: false, slope: false, hydrology: false,
                    satellite_spring: false, satellite_summer: false,
                };
                return {
                    terrainClusters: contextualized, detectedFeatures: contextualized, rawClusters: rawCombined, hotspots,
                    nhleData, aimData, routes, modernWays: cachedModernWays, monumentPoints, heritageCount,
                    sourceAvailability: applyOfflinePackAvailability(cached.sourceAvailability, offlinePackMeta),
                    questionTerrainAvailability,
                    fromCache: true, noSignal: false, scanStartCenter, scanStartBounds, analysisBounds,
                    historicRoutesAvailable,
                };
            }
        } catch (error) {
            reportNonFatal('terrain-scan', 'Terrain cache read failed', error);
        }

        // ── Fire remaining parallel requests for fresh scan ───────────────────
        // routePromise and modernWaysPromise were already fired before the cache
        // check — reuse them here. Fire remaining requests now.
        const waybackStart = performance.now();
        const waybackPromise = offlinePackMeta
            ? Promise.resolve(offlinePackMeta.waybackIds)
            : resolveWaybackIds();

        const nhleStart = performance.now();
        const designationOptions = { cacheOnly: !!offlinePackMeta };
        const nhlePromise = fetchScheduledMonuments(contextQueryBounds.west, contextQueryBounds.south, contextQueryBounds.east, contextQueryBounds.north, signal, designationOptions);
        const aimStart = performance.now();
        const aimPromise  = fetchAIMData(contextQueryBounds.west, contextQueryBounds.south, contextQueryBounds.east, contextQueryBounds.north, signal, designationOptions);

        onStatusChange('Reading terrain...');

        // Non-satellite workers start immediately — no wayback dependency
        const terrainStart = performance.now();
        const terrainTask       = scanDataSource('terrain',       zoom, tX_start, tY_start, bounds, n, { features: [] }, null, workerRegistry, signal);
        const terrainGlobalTask = scanDataSource('terrain_global', zoom, tX_start, tY_start, bounds, n, { features: [] }, null, workerRegistry, signal);
        const slopeTask         = scanDataSource('slope',         zoom, tX_start, tY_start, bounds, n, { features: [] }, null, workerRegistry, signal);

        onStatusChange('Reading hydrology...');
        const hydroStart = performance.now();
        const hydroTask = scanDataSource('hydrology', zoom, tX_start, tY_start, bounds, n, { features: [] }, null, workerRegistry, signal);

        onStatusChange('Comparing spectral layers...');
        // Satellite workers need waybackIds — await the (already in-flight) promise
        const waybackIds = await waybackPromise;
        const waybackSeconds = seconds(waybackStart);
        if (!isActive()) return null;
        const satelliteStart = performance.now();
        const springTask   = scanDataSource('satellite_spring', zoom, tX_start, tY_start, bounds, n, { features: [] }, waybackIds, workerRegistry, signal);
        const summerTask   = scanDataSource('satellite_summer', zoom, tX_start, tY_start, bounds, n, { features: [] }, waybackIds, workerRegistry, signal);

        try {
            // NHLE, AIM, and all six tile workers resolve in parallel
            const [nhleData, aimData, terrainResult, terrainGlobalResult, slopeResult, hydroResult, springResult, summerResult] = await Promise.all([
                nhlePromise, aimPromise,
                terrainTask, terrainGlobalTask, slopeTask, hydroTask, springTask, summerTask,
            ]);
            const sourceWaitSeconds = seconds(perfStart);
            const terrainSeconds = seconds(terrainStart);
            const hydroSeconds = seconds(hydroStart);
            const satelliteSeconds = seconds(satelliteStart);
            const nhleSeconds = seconds(nhleStart);
            const aimSeconds = seconds(aimStart);

            if (!isActive()) return null;

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

            const monumentPoints = extractMonumentPoints(nhleData.features || []);
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
            const routeStart = performance.now();
            let routes: HistoricRoute[] = [];
            let osmRoutesAvailable = false;
            try {
                const timeout  = new Promise<null>((_, reject) => setTimeout(() => reject(new Error('timeout')), SCAN_CONFIG.ROUTE_FETCH_TIMEOUT_MS));
                const routeRaw = await Promise.race([routePromise, timeout]);
                osmRoutesAvailable = routeRaw !== null;
                if (routeRaw?.elements) routes = parseOverpassRoutes(routeRaw.elements as OverpassElement[]);
            } catch {
                onLog('> Routes: service unavailable, continuing without.', 'terrain', 'warn');
            }

            // Itiner-e Roman roads — independent of OSM timeout; loads from static GeoJSON asset
            const romanRoadResult = await fetchRomanRoadsResult(scanWest, scanSouth, scanEast, scanNorth);
            if (romanRoadResult.routes.length > 0) {
                routes = [...routes, ...romanRoadResult.routes];
                onLog(`> Routes: ${romanRoadResult.routes.length} Roman road alignment${romanRoadResult.routes.length !== 1 ? 's' : ''} detected.`, 'terrain');
            } else if (!romanRoadResult.available) {
                onLog('> Routes: Roman road asset unavailable, continuing without Itiner-e context.', 'terrain', 'warn');
            }
            const routeSeconds = seconds(routeStart);

            if (!isActive()) return null;

            // ── Cluster processing pipeline ───────────────────────────────────
            onStatusChange('Comparing landscape signals...');
            const processStart = performance.now();

            const rawCombined = [...terrainHits, ...terrainGlobalHits, ...slopeHits, ...hydroHits, ...springHits, ...summerHits];

            // ── Source availability ──────────────────────────────────────────
            const sourceAvailability: Record<string, boolean> = applyOfflinePackAvailability({
                terrain:          terrainResult.tilesLoaded > 0,
                terrain_global:   terrainGlobalResult.tilesLoaded > 0,
                slope:            slopeResult.tilesLoaded > 0,
                hydrology:        hydroResult.tilesLoaded > 0,
                satellite_spring: springResult.tilesLoaded > 0,
                satellite_summer: summerResult.tilesLoaded > 0,
            }, offlinePackMeta);
            const questionTerrainAvailability: Record<string, boolean> = {
                terrain:          terrainResult.tilesLoaded === 9,
                terrain_global:   terrainGlobalResult.tilesLoaded === 9,
                slope:            slopeResult.tilesLoaded === 9,
                hydrology:        hydroResult.tilesLoaded === 9,
                satellite_spring: springResult.tilesLoaded === 9,
                satellite_summer: summerResult.tilesLoaded === 9,
            };

            // If every tile source failed to load, the device has no signal.
            // Don't cache this result — it will resolve correctly once connectivity returns.
            const noSignal = Object.values(sourceAvailability).every(v => !v);

            const merged      = findConsensus(rawCombined);
            const aimEnriched = applyAIMEnrichment(merged, aimData);

            // Proximity-collapse features within 15 m
            const updatedFeatures = collapseByProximity(aimEnriched);

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
            const modernWaysStart = performance.now();
            const modernWayResult = await modernWaysPromise;
            const modernWaysSeconds = seconds(modernWaysStart);
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
                    await saveTerrainScanCache({
                        id: tileKey, createdAt: Date.now(), rawClusters: rawCombined,
                        sourceAvailability, sourceCompleteness: questionTerrainAvailability,
                        engineVersion: ENGINE_VERSION,
                        ...(modernWays.length > 0 ? { modernWays, modernWaysFetchedAt: modernWaysFetchedAt ?? (rescuedModernWays ? Date.now() : undefined) } : {}),
                    }, expiredCutoff);
                } catch (error) {
                    reportNonFatal('terrain-scan', 'Terrain cache write failed', error);
                }
            }

            onStatusChange('Building hotspot model...');
            const hotspots = buildTerrainHotspots(getHotspotInput(contextualized), routes, monumentPoints);
            const processSeconds = seconds(processStart);
            const historicRoutesAvailable = osmRoutesAvailable && romanRoadResult.available;

            const duration = ((Date.now() - scanStart) / 1000).toFixed(1);
            onLog(`> Terrain scan complete in ${duration}s — ${contextualized.length} landscape signal${contextualized.length !== 1 ? 's' : ''} detected, ${hotspots.length} hotspot${hotspots.length !== 1 ? 's' : ''} identified.`, 'terrain');
            onLog(`> TIMING terrain: sources ${sourceWaitSeconds}s (terrain ${terrainSeconds}s, hydro ${hydroSeconds}s, wayback ${waybackSeconds}s, satellite ${satelliteSeconds}s, NHLE ${nhleSeconds}s, AIM ${aimSeconds}s), routes ${routeSeconds}s, modern ways ${modernWaysSeconds}s, processing ${processSeconds}s, total ${seconds(perfStart)}s.`, 'terrain');

            return {
                terrainClusters: contextualized, detectedFeatures: contextualized, rawClusters: rawCombined, hotspots,
                nhleData, aimData, routes, modernWays, monumentPoints, heritageCount, sourceAvailability,
                questionTerrainAvailability,
                fromCache: false, noSignal, scanStartCenter, scanStartBounds, analysisBounds,
                historicRoutesAvailable,
            };

        } catch (e) {
            if (isActive()) {
                onLog('> Scan error — landscape signals could not be read.', 'terrain', 'error');
                console.error(e);
            }
            return null;
        }
}
