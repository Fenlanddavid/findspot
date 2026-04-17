// ─── Historic scan hook ───────────────────────────────────────────────────────
// Fetches heritage context (location, etymology, OSM sites, NHLE, AIM, routes)
// and enriches terrain clusters into enhanced hotspots.
//
// When existingNhleData / existingAimData / existingRoutes are provided (i.e.
// from a preceding terrain scan), those fetches are skipped to avoid redundancy.
// When running standalone (Intel drawer, Historic button without terrain), all
// data is fetched fresh.

import { useRef, useState, useCallback, useEffect } from 'react';
import maplibregl from 'maplibre-gl';

import { Cluster, Hotspot, HistoricFind, PlaceSignal, HistoricRoute, ETYMOLOGY_SIGNALS } from '../pages/fieldGuideTypes';
import {
    NHLEResponse, AIMResponse, OverpassElement,
    fetchLocationLabel, fetchEtymologySignals, fetchHeritageFeatures,
    fetchScheduledMonuments, fetchAIMData, fetchHistoricRoutes,
    parseOverpassRoutes,
} from '../services/historicScanService';
import { getDistanceKm, getDriftMetres } from '../utils/fieldGuideAnalysis';
import { enhanceHotspotsWithHistoric, buildTerrainHotspots } from '../utils/hotspotEngine';
import { ScanContext } from './useTerrainScan';
import { toOSGridRef } from '../services/gps';
import { SCAN_CONFIG } from '../utils/scanConfig';
import { LogSource, LogLevel } from '../utils/scanLogger';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface HistoricScanOptions extends ScanContext {
    mapRef:       React.RefObject<maplibregl.Map | null>;
    permissions:  unknown[];
    fields:       unknown[];
    targetPeriod: string;
}

export interface HistoricScanResult {
    pasFinds:        HistoricFind[];
    placeSignals:    PlaceSignal[];
    monumentPoints:  [number, number][];
    heritageCount:   number;
    enhancedHotspots: Hotspot[];
    routes:          HistoricRoute[];
    nhleData:        NHLEResponse | null;  // non-null only if freshly fetched
    aimData:         AIMResponse  | null;  // non-null only if freshly fetched
    drifted:         boolean;
    center:          { lat: number; lng: number };
}

interface UseHistoricScanOptions {
    onLog:          (msg: string, source?: LogSource, level?: LogLevel) => void;
    onStatusChange: (status: string) => void;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useHistoricScan({ onLog, onStatusChange }: UseHistoricScanOptions) {
    const [isScanning, setIsScanning] = useState(false);
    const tokenRef  = useRef<string | null>(null);
    const abortRef  = useRef<AbortController | null>(null);
    const mountedRef = useRef(true);

    useEffect(() => {
        mountedRef.current = true;
        return () => { mountedRef.current = false; };
    }, []);

    const cancelScan = useCallback(() => {
        tokenRef.current = null;
        abortRef.current?.abort();
        if (mountedRef.current) setIsScanning(false);
    }, []);

    const runHistoricScan = useCallback(async (
        opts: HistoricScanOptions,
    ): Promise<HistoricScanResult | null> => {
        const map = opts.mapRef.current;
        if (!map) return null;

        const zoom = map.getZoom();
        if (zoom < SCAN_CONFIG.MIN_HISTORIC_ZOOM) {
            onLog(`> ZOOM IN: Historic scan works best at zoom ${SCAN_CONFIG.MIN_HISTORIC_ZOOM}+.`, 'historic', 'warn');
            return null;
        }

        abortRef.current?.abort();
        const abort = new AbortController();
        abortRef.current = abort;
        const token = crypto.randomUUID();
        tokenRef.current = token;
        const { signal } = abort;

        if (mountedRef.current) setIsScanning(true);
        onStatusChange("Loading Historic Data...");

        const center = map.getCenter();
        const bounds = map.getBounds();

        // Build a capped bounding box for Overpass queries
        const maxDelta  = SCAN_CONFIG.MAX_BBOX_DELTA;
        const latBuffer = SCAN_CONFIG.LAT_BUFFER;
        const lonBuffer = SCAN_CONFIG.LON_BUFFER;
        const west  = Number(Math.max(center.lng - maxDelta, Math.min(bounds.getWest(),  center.lng - lonBuffer)).toFixed(6));
        const south = Number(Math.max(center.lat - maxDelta, Math.min(bounds.getSouth(), center.lat - latBuffer)).toFixed(6));
        const east  = Number(Math.min(center.lng + maxDelta, Math.max(bounds.getEast(),  center.lng + lonBuffer)).toFixed(6));
        const north = Number(Math.min(center.lat + maxDelta, Math.max(bounds.getNorth(), center.lat + latBuffer)).toFixed(6));

        onLog(`> INITIALIZING HERITAGE SCAN @ ${center.lat.toFixed(4)}, ${center.lng.toFixed(4)}`, 'historic');
        onLog('> STAGE: Fetching location, heritage, monuments and routes...', 'historic');

        try {
            // Always fetch: location label, etymology signals, OSM heritage features
            // Conditionally fetch: NHLE, AIM, routes (skip if provided from terrain scan)
            const [geoData, etymData, osmData, nhleRaw, aimRaw, routeRaw] = await Promise.all([
                fetchLocationLabel(center.lat, center.lng, signal),
                fetchEtymologySignals(center.lat, center.lng, signal),
                fetchHeritageFeatures(center.lat, center.lng, signal),
                opts.nhleData
                    ? Promise.resolve(null)
                    : fetchScheduledMonuments(west, south, east, north, signal),
                opts.aimData
                    ? Promise.resolve(null)
                    : fetchAIMData(west, south, east, north, signal),
                opts.routes.length === 0
                    ? fetchHistoricRoutes(center.lat, center.lng, signal)
                    : Promise.resolve(null),
            ]);

            if (tokenRef.current !== token || signal.aborted || !mountedRef.current) {
                setIsScanning(false);
                return null;
            }

            if (!geoData)  onLog('> LOCATION: Service unavailable.', 'historic', 'warn');
            if (!etymData) onLog('> ETYMOLOGY: Service unavailable.', 'historic', 'warn');
            if (!osmData)  onLog('> HERITAGE: Service unavailable.', 'historic', 'warn');

            // 1. Location label
            if (geoData?.address) {
                const parish   = geoData.address.parish || geoData.address.village || geoData.address.town || 'Unknown Parish';
                const county   = geoData.address.county || geoData.address.state_district || 'Unknown County';
                const fullGrid = toOSGridRef(center.lat, center.lng);
                const parts    = fullGrid.split(' ');
                const fourFigure = parts.length === 3 ? `${parts[0]} ${parts[1].substring(0, 2)}${parts[2].substring(0, 2)}` : fullGrid;
                onLog(`> LOCATION: ${parish}, ${county} [${fourFigure}]`, 'historic');
            }

            // 2. Etymology signals
            let placeSignals: PlaceSignal[] = [];
            if (etymData?.elements) {
                const signals: PlaceSignal[] = [];
                etymData.elements.forEach((el: OverpassElement) => {
                    const name = el.tags?.name || '';
                    if (!name) return;
                    const lat = el.lat || el.center?.lat;
                    const lon = el.lon || el.center?.lon;
                    if (!lat || !lon) return;
                    ETYMOLOGY_SIGNALS.forEach(sig => {
                        if (name.toLowerCase().includes(sig.pattern.toLowerCase())) {
                            const typeValue = el.tags?.historic || el.tags?.heritage || el.tags?.place || el.tags?.natural || el.tags?.landuse || el.tags?.standing_remains || 'Location';
                            signals.push({
                                name,
                                meaning:    sig.meaning,
                                distance:   getDistanceKm(center.lat, center.lng, lat, lon),
                                period:     sig.period,
                                confidence: sig.confidence,
                                type:       String(typeValue),
                            });
                        }
                    });
                });
                placeSignals = signals.sort((a, b) => b.confidence - a.confidence);
                if (placeSignals.length > 0) onLog(`> ETYMOLOGY: ${placeSignals.length} place-name signal${placeSignals.length !== 1 ? 's' : ''} detected.`, 'historic');
            }

            // 3. OSM heritage features
            let pasFinds: HistoricFind[] = [];
            if (osmData?.elements) {
                pasFinds = osmData.elements.map((el: OverpassElement) => {
                    const lat = el.lat || el.center?.lat;
                    const lon = el.lon || el.center?.lon;
                    if (!lat || !lon) return null;
                    const type         = el.tags?.historic || el.tags?.archaeological_site || el.tags?.heritage || el.tags?.standing_remains || el.tags?.site_type || 'Heritage Site';
                    const name         = el.tags?.name;
                    const dist         = getDistanceKm(center.lat, center.lng, lat, lon);
                    const inViewport   = lat >= south && lat <= north && lon >= west && lon <= east;
                    if (!inViewport && dist > 2) return null;
                    const descriptiveType = name ? `${name} (${type})` : type;
                    return {
                        id:          `OSM-${el.id}`,
                        internalId:  String(el.id),
                        objectType:  String(descriptiveType).charAt(0).toUpperCase() + String(descriptiveType).slice(1),
                        broadperiod: el.tags?.period || 'Unknown',
                        county:      'Local Area',
                        workflow:    'PAS' as const,
                        lat, lon,
                        isApprox:   false,
                        osmType:    el.type,
                    };
                }).filter(Boolean) as HistoricFind[];
                onLog(`> HERITAGE: ${pasFinds.length} OSM feature${pasFinds.length !== 1 ? 's' : ''} found within 2km.`, 'historic');
            }

            // 4. NHLE (fresh fetch or pass-through from terrain scan)
            const nhleData = opts.nhleData ?? nhleRaw ?? { features: [] };
            let monumentPoints = opts.monumentPoints;
            let heritageCount  = monumentPoints.length;

            if (nhleRaw) {
                // Freshly fetched — extract points and log
                monumentPoints = (nhleData.features || []).map(f => {
                    if (f.geometry?.type === 'Point')        return f.geometry.coordinates as [number, number];
                    if (f.geometry?.type === 'Polygon')      return (f.geometry.coordinates as number[][][])[0][0] as [number, number];
                    if (f.geometry?.type === 'MultiPolygon') return (f.geometry.coordinates as number[][][][])[0][0][0] as [number, number];
                    return [0, 0] as [number, number];
                });
                heritageCount = nhleData.features?.length ?? 0;
                if (heritageCount > 0) onLog(`> NHLE: ${heritageCount} scheduled monument${heritageCount !== 1 ? 's' : ''} found.`, 'historic');
                else                   onLog('> NHLE: No scheduled monuments in this area.', 'historic');
            }

            // Add NHLE scheduled monuments into the feature list so they appear
            // in the Historic panel alongside OSM features. They are shown on the
            // map as boundary overlays but were not listed before.
            const nhleFinds: HistoricFind[] = (nhleData.features || []).map((f, i) => {
                let lat = 0, lon = 0;
                if (f.geometry?.type === 'Point') {
                    [lon, lat] = f.geometry.coordinates as number[];
                } else if (f.geometry?.type === 'Polygon') {
                    [lon, lat] = (f.geometry.coordinates as number[][][])[0][0];
                } else if (f.geometry?.type === 'MultiPolygon') {
                    [lon, lat] = (f.geometry.coordinates as number[][][][])[0][0][0];
                }
                if (!lat || !lon) return null;
                const name = f.properties?.Name || 'Scheduled Monument';
                return {
                    id:         `NHLE-${f.properties?.ListEntry ?? i}`,
                    internalId: String(f.properties?.ListEntry ?? i),
                    objectType: `${name} (Scheduled Monument)`,
                    broadperiod: 'Prehistoric–Medieval',
                    county:     'Local Area',
                    workflow:   'PAS' as const,
                    lat, lon,
                    isApprox:   false,
                    osmType:    'way' as const,
                };
            }).filter(Boolean) as HistoricFind[];

            // Merge NHLE scheduled monuments into pasFinds, deduplicating against
            // any OSM features that are very close (same site listed in both sources).
            const osmCoords = pasFinds.map(f => ({ lat: f.lat, lon: f.lon }));
            const dedupedNhle = nhleFinds.filter(nf =>
                !osmCoords.some(o => Math.abs(o.lat - nf.lat) < 0.0005 && Math.abs(o.lon - nf.lon) < 0.0005)
            );
            pasFinds = [...dedupedNhle, ...pasFinds];

            // 5. AIM (fresh fetch or pass-through from terrain scan)
            const aimData = opts.aimData ?? aimRaw ?? { features: [] };
            if (aimRaw && aimRaw.features?.length > 0) {
                onLog(`> AIM: ${aimRaw.features.length} aerial monument${aimRaw.features.length !== 1 ? 's' : ''} mapped.`, 'historic');
            }

            // 6. Routes (fresh fetch or pass-through from terrain scan)
            let routes = opts.routes;
            if (!opts.routes.length && routeRaw?.elements?.length) {
                routes = parseOverpassRoutes(routeRaw.elements);
            }

            // ── Drift guard (uses shared utility) ────────────────────────────
            const driftM  = getDriftMetres(opts.scanCenter, { lat: center.lat, lng: center.lng });
            const drifted = driftM > SCAN_CONFIG.DRIFT_THRESHOLD_M;

            // ── Hotspot enhancement ───────────────────────────────────────────
            let enhancedHotspots: Hotspot[] = [];
            if (!drifted) {
                onLog('> Historic data integrated — refining targets...', 'historic');

                // Stage 1: re-run terrain scoring with historic routes + monument suppression
                const terrainHotspots = buildTerrainHotspots(opts.terrainClusters, routes, monumentPoints);

                // Stage 2: additive historic enrichment (finds, monuments, place signals)
                enhancedHotspots = enhanceHotspotsWithHistoric(
                    terrainHotspots, pasFinds, monumentPoints, placeSignals, opts.targetPeriod,
                );

                const sourceCount = pasFinds.length + placeSignals.length + monumentPoints.length;
                onLog(`> Historic scan complete — ${sourceCount} source${sourceCount !== 1 ? 's' : ''} integrated.`, 'historic');
            } else {
                onLog('> HISTORIC: Map moved during scan — hotspot update skipped.', 'historic', 'warn');
            }

            if (mountedRef.current) setIsScanning(false);
            return {
                pasFinds, placeSignals, monumentPoints, heritageCount,
                enhancedHotspots, routes,
                nhleData: nhleRaw ?? null,  // non-null only if freshly fetched
                aimData:  aimRaw  ?? null,
                drifted,
                center: { lat: center.lat, lng: center.lng },
            };

        } catch (e) {
            if (tokenRef.current === token) {
                onLog('> HERITAGE SCAN FAILED.', 'historic', 'error');
                console.error(e);
            }
            if (mountedRef.current) setIsScanning(false);
            return null;
        } finally {
            if (mountedRef.current) onStatusChange('');
        }
    }, [onLog, onStatusChange]);

    return { runHistoricScan, cancelHistoric: cancelScan, isHistoricScanning: isScanning };
}
