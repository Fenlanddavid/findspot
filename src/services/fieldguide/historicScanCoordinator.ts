// ─── Historic scan coordinator ────────────────────────────────────────────────
// Fetches heritage context (location, etymology, OSM sites, NHLE, AIM, routes)
// and enriches terrain clusters into enhanced hotspots.
//
// When existingNhleData / existingAimData / existingRoutes are provided (i.e.
// from a preceding terrain scan), those fetches are skipped to avoid redundancy.
// When running standalone (context panel, Historic Layers button without terrain), all
// data is fetched fresh.

import { Hotspot, HistoricRoute } from '../../pages/fieldGuideTypes';
import { db } from '../../db';
import {
    fetchLocationLabel, fetchHistoricContextFeatures,
    fetchScheduledMonuments, fetchAIMData, fetchHistoricRoutes,
    parseOverpassRoutes,
} from '../historicScanService';
import { getDriftMetres, getHotspotInput } from '../../utils/fieldGuideAnalysis';
import { enhanceHotspotsWithHistoric, buildTerrainHotspots } from '../../engines/hotspot/hotspotEngine';
import { toOSGridRef } from '../gps';
import { SCAN_CONFIG } from '../../utils/scanConfig';
import { fetchRomanRoadsResult, prefetchRomanRoads } from '../romanRoadService';
import { prefetchPASDensity, getPASDensityNear, pasPeriodLabels } from '../pasDensityService';
import { applyPASDensityModifiers } from '../../engines/hotspot/hotspotEngine';
import type { QuestionSourceAvailability } from '../../outstandingQuestions/types';
import {
    safeParseFieldGuideScanCache,
    type HistoricLookupCache,
} from '../persistenceValidation';
import { discardFieldGuideScanCache, saveHistoricScanCache } from '../fieldGuideMutations';
import { reportNonFatal } from '../diagLog';
import {
    HISTORIC_CACHE_TTL_MS,
    HISTORIC_CACHE_VERSION,
    attemptSummary,
    getHistoricCacheKey,
    getHistoricQueryBounds,
    seconds,
    timedRecord,
    type HistoricScanCoordinatorOptions,
    type HistoricScanOptions,
    type HistoricScanResult,
} from './historicScanSupport';

export type {
    HistoricScanOptions,
    HistoricScanResult,
} from './historicScanSupport';
import {
    buildAimFeatures,
    buildNhleHistoricFinds,
    buildOsmHistoricFinds,
    buildPlaceSignals,
    extractMonumentPoints,
    mergeHistoricFinds,
} from './historicScanRecords';

export async function runHistoricScanPipeline(
        opts: HistoricScanOptions,
        {
            onLog,
            onStatusChange,
            signal,
            isActive,
        }: HistoricScanCoordinatorOptions,
    ): Promise<HistoricScanResult | null> {
        const map = opts.mapRef.current;
        if (!map) return null;

        const zoom = map.getZoom();
        if (zoom < SCAN_CONFIG.MIN_HISTORIC_ZOOM) {
            onLog(`> ZOOM IN: Historic scan works best at zoom ${SCAN_CONFIG.MIN_HISTORIC_ZOOM}+.`, 'historic', 'warn');
            return null;
        }

        const perfStart = performance.now();
        onStatusChange('Reading historic layers...');
        prefetchRomanRoads();   // prime GeoJSON cache in parallel with NHLE/AIM/Overpass
        prefetchPASDensity();   // prime PAS density cache in parallel

        const center = map.getCenter();
        const bounds = map.getBounds();
        const queryBounds = getHistoricQueryBounds(bounds, center, zoom);

        // Build a capped bbox for historic lookups. At high rendered zooms, use
        // a wider virtual footprint without moving the map or changing the UI.
        const maxDelta  = SCAN_CONFIG.MAX_BBOX_DELTA;
        const latBuffer = SCAN_CONFIG.LAT_BUFFER;
        const lonBuffer = SCAN_CONFIG.LON_BUFFER;
        const west  = Number(Math.max(center.lng - maxDelta, Math.min(queryBounds.west,  center.lng - lonBuffer)).toFixed(6));
        const south = Number(Math.max(center.lat - maxDelta, Math.min(queryBounds.south, center.lat - latBuffer)).toFixed(6));
        const east  = Number(Math.min(center.lng + maxDelta, Math.max(queryBounds.east,  center.lng + lonBuffer)).toFixed(6));
        const north = Number(Math.min(center.lat + maxDelta, Math.max(queryBounds.north, center.lat + latBuffer)).toFixed(6));
        const lookupBounds = { west, south, east, north };
        const historicCacheKey = getHistoricCacheKey({ lat: center.lat, lng: center.lng }, lookupBounds);

        onLog(`> LANDSCAPE CONTEXT SCAN @ ${center.lat.toFixed(4)}, ${center.lng.toFixed(4)}`, 'historic');
        onLog('> STAGE: Reading location, heritage records, monuments and routes...', 'historic');

        try {
            let cachedLookup: HistoricLookupCache | null = null;
            try {
                const persisted = await db.fieldGuideCache.get(historicCacheKey);
                const cached = safeParseFieldGuideScanCache(persisted);
                if (persisted && !cached) await discardFieldGuideScanCache(historicCacheKey);
                const lookup = cached?.historicLookup;
                if (
                    cached &&
                    lookup &&
                    cached.engineVersion === HISTORIC_CACHE_VERSION &&
                    (Date.now() - cached.createdAt) < HISTORIC_CACHE_TTL_MS
                ) {
                    cachedLookup = lookup;
                    const ageMin = Math.max(1, Math.round((Date.now() - cached.createdAt) / 60000));
                    onLog(`> Historic cache hit — source records reused (${ageMin}m old).`, 'historic');
                }
            } catch (error) {
                reportNonFatal('historic-scan', 'Scan cache read failed', error);
            }

            // Always fetch: location label and combined OSM context
            // Conditionally fetch: NHLE, AIM, routes (skip if provided from terrain scan)
            onStatusChange('Reading historic records...');
            const hasTerrainRouteAttempt = !!opts.nhleData || !!opts.aimData;
            const recordsStart = performance.now();
            const geoMode = cachedLookup?.geoData ? 'cached' : 'fetch';
            const contextMode = cachedLookup?.contextData ? 'cached' : 'fetch';
            const nhleMode = opts.nhleData
                ? 'provided'
                : cachedLookup?.nhleData
                    ? cachedLookup.nhleData.available === false ? 'retry' : 'cached'
                    : 'fetch';
            const aimMode = opts.aimData ? 'provided' : cachedLookup?.aimData ? 'cached' : 'fetch';
            const routeMode = opts.routes.length === 0 && !hasTerrainRouteAttempt
                ? cachedLookup?.routeRaw ? 'cached' : 'fetch'
                : 'provided';
            const contextAttempts: string[] = [];
            const routeAttempts: string[] = [];

            const [geoTimed, contextTimed, nhleTimed, aimTimed, routeTimed] = await Promise.all([
                timedRecord(cachedLookup?.geoData
                    ? Promise.resolve(cachedLookup.geoData)
                    : fetchLocationLabel(center.lat, center.lng, signal)),
                timedRecord(cachedLookup?.contextData
                    ? Promise.resolve(cachedLookup.contextData)
                    : fetchHistoricContextFeatures(center.lat, center.lng, signal, {
                        onAttempt: timing => contextAttempts.push(attemptSummary(timing)),
                    })),
                timedRecord(opts.nhleData
                    ? Promise.resolve(null)
                    : cachedLookup?.nhleData
                        ? cachedLookup.nhleData.available === false
                            ? fetchScheduledMonuments(west, south, east, north, signal)
                            : Promise.resolve(cachedLookup.nhleData)
                    : fetchScheduledMonuments(west, south, east, north, signal)),
                timedRecord(opts.aimData
                    ? Promise.resolve(null)
                    : cachedLookup?.aimData
                        ? Promise.resolve(cachedLookup.aimData)
                    : fetchAIMData(west, south, east, north, signal)),
                timedRecord(opts.routes.length === 0 && !hasTerrainRouteAttempt
                    ? cachedLookup?.routeRaw
                        ? Promise.resolve(cachedLookup.routeRaw)
                        : fetchHistoricRoutes(center.lat, center.lng, signal, {
                            endpointTimeoutMs: 3500,
                            totalTimeoutMs:    5000,
                            onAttempt:         timing => routeAttempts.push(attemptSummary(timing)),
                        })
                    : Promise.resolve(null)),
            ]);
            const geoData = geoTimed.value;
            const contextData = contextTimed.value;
            const nhleRaw = nhleTimed.value;
            const aimRaw = aimTimed.value;
            const routeRaw = routeTimed.value;
            const recordsSeconds = seconds(recordsStart);
            onLog(`> TIMING historic records detail: location ${geoTimed.elapsed}s (${geoMode}), OSM context ${contextTimed.elapsed}s (${contextMode}), NHLE ${nhleTimed.elapsed}s (${nhleMode}), AIM ${aimTimed.elapsed}s (${aimMode}), routes ${routeTimed.elapsed}s (${routeMode}).`, 'historic');
            if (contextAttempts.length > 0) {
                onLog(`> TIMING historic OSM context detail: ${contextAttempts.join('; ')}.`, 'historic');
            }
            if (routeAttempts.length > 0) {
                onLog(`> TIMING historic route detail: ${routeAttempts.join('; ')}.`, 'historic');
            }
            const etymData = contextData;
            const osmData  = contextData;

            if (!isActive()) return null;

            if (!geoData)  onLog('> LOCATION: Service unavailable.', 'historic', 'warn');
            if (!etymData) onLog('> ETYMOLOGY: Service unavailable.', 'historic', 'warn');
            if (!osmData)  onLog('> HERITAGE: Service unavailable.', 'historic', 'warn');

            onStatusChange('Interpreting place-name signals...');

            // 1. Location label
            if (geoData?.address) {
                const parish   = geoData.address.parish || geoData.address.village || geoData.address.town || 'Unknown Parish';
                const county   = geoData.address.county || geoData.address.state_district || 'Unknown County';
                const fullGrid = toOSGridRef(center.lat, center.lng);
                const parts    = fullGrid.split(' ');
                const fourFigure = parts.length === 3 ? `${parts[0]} ${parts[1].substring(0, 2)}${parts[2].substring(0, 2)}` : fullGrid;
                onLog(`> LOCATION: ${parish}, ${county} [${fourFigure}]`, 'historic');
            }

            const { placeSignals, overpassSignalCount } = buildPlaceSignals(
                etymData,
                geoData,
                { lat: center.lat, lng: center.lng },
            );
            if (overpassSignalCount > 0) {
                onLog(
                    `> ETYMOLOGY: ${overpassSignalCount} place-name signal${overpassSignalCount !== 1 ? 's' : ''} detected.`,
                    'historic',
                );
            }

            onStatusChange('Checking recorded archaeology...');

            let pasFinds = buildOsmHistoricFinds(
                osmData,
                { lat: center.lat, lng: center.lng },
            );

            onStatusChange('Checking protected archaeology...');

            // 4. NHLE (fresh fetch or pass-through from terrain scan)
            const nhleData = opts.nhleData ?? nhleRaw ?? { features: [] };
            let monumentPoints = opts.monumentPoints;
            let heritageCount  = monumentPoints.length;

            if (nhleData.available === false) {
                onLog('> NHLE: Scheduled monument service unavailable — landscape interpretation cannot confirm protected archaeology for this area.', 'historic', 'warn');
                monumentPoints = [];
                heritageCount = 0;
            } else if (nhleRaw) {
                // Freshly fetched — extract points and log
                monumentPoints = extractMonumentPoints(nhleData);
                heritageCount = nhleData.features?.length ?? 0;
                if (heritageCount > 0) onLog(`> NHLE: ${heritageCount} scheduled monument${heritageCount !== 1 ? 's' : ''} found.`, 'historic');
                else                   onLog('> NHLE: No scheduled monuments in this area.', 'historic');
            }

            // Add NHLE scheduled monuments into the feature list so they appear
            // in the Historic panel alongside OSM features. They are shown on the
            // map as boundary overlays but were not listed before.
            const nhleFinds = buildNhleHistoricFinds(nhleData);

            // Merge NHLE scheduled monuments into pasFinds, deduplicating against
            // any OSM features that are very close (same site listed in both sources).
            pasFinds = mergeHistoricFinds(pasFinds, nhleFinds);

            // Log after merge so the count reflects all sources
            const osmCount  = pasFinds.filter(f => f.id.startsWith('OSM-')).length;
            const nhleCount = pasFinds.filter(f => f.id.startsWith('NHLE-')).length;
            if (osmCount > 0 || nhleCount > 0) {
                const parts = [
                    osmCount  > 0 ? `${osmCount} OSM feature${osmCount !== 1 ? 's' : ''}` : '',
                    nhleCount > 0 ? `${nhleCount} scheduled monument${nhleCount !== 1 ? 's' : ''}` : '',
                ].filter(Boolean).join(', ');
                onLog(`> HERITAGE: ${parts} integrated.`, 'historic');
            }

            // heritageCount = total heritage features across all sources
            heritageCount = pasFinds.length;

            onStatusChange('Reading aerial monument data...');

            // 5. AIM (fresh fetch or pass-through from terrain scan)
            const aimData = opts.aimData ?? aimRaw ?? { features: [] };
            if (aimRaw && aimRaw.features?.length > 0) {
                onLog(`> AIM: ${aimRaw.features.length} aerial monument${aimRaw.features.length !== 1 ? 's' : ''} mapped.`, 'historic');
            }

            onStatusChange('Comparing route context...');

            // 6. Routes (fresh fetch or pass-through from terrain scan)
            let routes = opts.routes;
            let osmRoutesAvailable = opts.historicRoutesAvailable;
            if (!opts.routes.length && routeRaw?.elements?.length) {
                routes = parseOverpassRoutes(routeRaw.elements);
            }
            if (!opts.routes.length && !hasTerrainRouteAttempt) {
                osmRoutesAvailable = routeRaw !== null;
            }

            // 6b. Itiner-e Roman roads — serve from cache when available
            let freshRomanRoads: HistoricRoute[] = [];
            const hasRomanRoads = routes.some(r => r.source === 'itinere');
            let romanRoadsAvailable = opts.historicRoutesAvailable && hasRomanRoads;
            const romanStart = performance.now();
            if (!hasRomanRoads) {
                if (cachedLookup?.romanRoads?.length) {
                    routes = [...routes, ...cachedLookup.romanRoads];
                    romanRoadsAvailable = true;
                } else {
                    const romanRoadResult = await fetchRomanRoadsResult(west, south, east, north);
                    romanRoadsAvailable = romanRoadResult.available;
                    freshRomanRoads = romanRoadResult.routes;
                    if (freshRomanRoads.length > 0) {
                        routes = [...routes, ...freshRomanRoads];
                        onLog(`> ROUTES: ${freshRomanRoads.length} Roman road alignment${freshRomanRoads.length !== 1 ? 's' : ''} detected.`, 'historic');
                    } else if (!romanRoadResult.available) {
                        onLog('> ROUTES: Roman road asset unavailable, continuing without Itiner-e context.', 'historic', 'warn');
                    }
                }
            }
            const romanSeconds = seconds(romanStart);
            const historicRoutesAvailable = osmRoutesAvailable && romanRoadsAvailable;

            // Cache write — after Roman roads so they can be included
            try {
                const expiredCutoff = Date.now() - HISTORIC_CACHE_TTL_MS;
                await saveHistoricScanCache({
                    id: historicCacheKey,
                    createdAt: Date.now(),
                    rawClusters: [],
                    sourceAvailability: {},
                    engineVersion: HISTORIC_CACHE_VERSION,
                    historicLookup: {
                        geoData,
                        contextData,
                        nhleData,
                        aimData,
                        routeRaw:   routeRaw ?? null,
                        romanRoads: freshRomanRoads.length > 0 ? freshRomanRoads : null,
                    } satisfies HistoricLookupCache,
                }, expiredCutoff);
            } catch (error) {
                reportNonFatal('historic-scan', 'Scan cache write failed', error);
            }

            // ── Drift guard (uses shared utility) ────────────────────────────
            const driftM  = getDriftMetres(opts.scanCenter, { lat: center.lat, lng: center.lng });
            const drifted = driftM > SCAN_CONFIG.DRIFT_THRESHOLD_M;

            // ── Hotspot enhancement ───────────────────────────────────────────
            let enhancedHotspots: Hotspot[] = [];
            let pasCellResult: import('../pasDensityService').PASCellLookup | null = null;
            const enhanceStart = performance.now();
            if (!drifted) {
                onLog('> Historic layers integrated — refining hotspots...', 'historic');
                onStatusChange('Building hotspot model...');

                // Stage 1: re-run terrain scoring with historic routes + monument suppression
                const terrainHotspots = buildTerrainHotspots(getHotspotInput(opts.terrainClusters), routes, monumentPoints);

                // Stage 2: additive historic enrichment (finds, monuments, place signals, AIM proximity)
                onStatusChange('Comparing landscape signals...');
                const aimFeatures = buildAimFeatures(aimData);
                enhancedHotspots = enhanceHotspotsWithHistoric(
                    terrainHotspots, pasFinds, monumentPoints, placeSignals, opts.targetPeriod, aimFeatures,
                );

                // PAS density modifier — supporting evidence only, never creates hotspots
                const mapCenter = map.getCenter();
                pasCellResult = await getPASDensityNear(mapCenter.lat, mapCenter.lng);
                const pasCell = pasCellResult;
                if (pasCell !== null) {
                    enhancedHotspots = applyPASDensityModifiers(enhancedHotspots, pasCell, opts.targetPeriod);
                    const topPeriods = pasPeriodLabels(pasCell).slice(0, 3).join(', ');
                    onLog(`> PAS density: ${pasCell.c} public records in cell (res 6). ${pasCell.c > 0 ? `Top periods: ${topPeriods}` : 'No records in this cell.'}`, 'historic');
                } else {
                    onLog('> PAS density: index unavailable (will apply no modifier).', 'historic', 'warn');
                }

                const sourceCount = pasFinds.length + placeSignals.length + monumentPoints.length;
                onLog(`> Historic scan complete — ${sourceCount} source${sourceCount !== 1 ? 's' : ''} integrated.`, 'historic');
            } else {
                onLog('> HISTORIC: Map moved during scan — hotspot update skipped.', 'historic', 'warn');
            }
            const enhanceSeconds = seconds(enhanceStart);
            onLog(`> TIMING historic: records ${recordsSeconds}s, roman roads ${romanSeconds}s, enrichment ${enhanceSeconds}s, total ${seconds(perfStart)}s.`, 'historic');

            const questionSourceAvailability: QuestionSourceAvailability = {
                terrain:          opts.questionTerrainAvailability.terrain === true,
                terrain_global:   opts.questionTerrainAvailability.terrain_global === true,
                slope:            opts.questionTerrainAvailability.slope === true,
                hydrology:        opts.questionTerrainAvailability.hydrology === true,
                satellite_spring: opts.questionTerrainAvailability.satellite_spring === true,
                satellite_summer: opts.questionTerrainAvailability.satellite_summer === true,
                scheduled_monuments: nhleData.available !== false,
                aim:              aimData.available === true,
                historic_context: contextData !== null,
                historic_routes:  historicRoutesAvailable,
                pas_density:      pasCellResult !== null,
            };
            return {
                pasFinds, placeSignals, monumentPoints, heritageCount,
                enhancedHotspots, routes,
                nhleData: nhleRaw ?? null,  // non-null only if freshly fetched
                scheduledMonuments: nhleData,
                aimData:  aimRaw  ?? null,
                drifted,
                center: { lat: center.lat, lng: center.lng },
                pasCell: pasCellResult,
                questionSourceAvailability,
            };

        } catch (e) {
            if (isActive()) {
                onLog('> LANDSCAPE CONTEXT SCAN FAILED.', 'historic', 'error');
                console.error(e);
            }
            return null;
        }
}
