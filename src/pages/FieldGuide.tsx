import React, { useState, useReducer, useRef, useEffect, useLayoutEffect } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { toOSGridRef } from '../services/gps';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { useFieldGuideMap } from '../hooks/useFieldGuideMap';

import {
    Cluster, PASFind, PlaceSignal, HistoricRoute, Hotspot,
    ETYMOLOGY_SIGNALS, HOTSPOT_INTERPRETATION
} from './fieldGuideTypes';
import {
    fetchLocationLabel, fetchEtymologySignals, fetchHeritageFeatures,
    fetchScheduledMonuments, fetchAIMData, fetchHistoricRoutes, fetchScanRoutes,
    OverpassElement
} from '../services/historicScanService';
import { scanDataSource } from '../utils/terrainEngine';
import { findConsensus, analyzeContext, suppressDisturbance, generateHotspots, getDistance } from '../utils/fieldGuideAnalysis';
import { usePotentialScore } from '../hooks/usePotentialScore';

// ─── Scan state managed by reducer ───────────────────────────────────────────

interface ScanState {
    analyzing: boolean;
    detectedFeatures: Cluster[];
    hotspots: Hotspot[];
    selectedId: string | null;
    selectedHotspotId: string | null;
    hasScanned: boolean;
    showSuggestion: boolean;
    scanStatus: string;
    systemLog: string[];
    heritageCount: number;
    monumentPoints: [number, number][];
    historicRoutes: HistoricRoute[];
}

type ScanAction =
    | { type: 'SCAN_START' }
    | { type: 'SCAN_SUCCESS'; features: Cluster[]; hotspots: Hotspot[] }
    | { type: 'SCAN_FAIL' }
    | { type: 'CLEAR_SCAN' }
    | { type: 'SET_SELECTED_FEATURE'; id: string | null }
    | { type: 'SET_SELECTED_HOTSPOT'; id: string | null }
    | { type: 'SET_SCAN_STATUS'; status: string }
    | { type: 'ADD_LOG'; msg: string }
    | { type: 'SET_HAS_SCANNED' }
    | { type: 'SET_SHOW_SUGGESTION'; value: boolean }
    | { type: 'SET_HERITAGE_COUNT'; count: number }
    | { type: 'SET_MONUMENT_POINTS'; points: [number, number][] }
    | { type: 'SET_HISTORIC_ROUTES'; routes: HistoricRoute[] };

const initialScanState: ScanState = {
    analyzing: false,
    detectedFeatures: [],
    hotspots: [],
    selectedId: null,
    selectedHotspotId: null,
    hasScanned: false,
    showSuggestion: false,
    scanStatus: "",
    systemLog: ["SYSTEM READY. Execute Scan."],
    heritageCount: 0,
    monumentPoints: [],
    historicRoutes: [],
};

function scanReducer(state: ScanState, action: ScanAction): ScanState {
    switch (action.type) {
        case 'SCAN_START':
            return { ...state, analyzing: true, scanStatus: "Engine Initiating..." };
        case 'SCAN_SUCCESS':
            return { ...state, analyzing: false, scanStatus: "", detectedFeatures: action.features, hotspots: action.hotspots };
        case 'SCAN_FAIL':
            return { ...state, analyzing: false, scanStatus: "" };
        case 'CLEAR_SCAN':
            return {
                ...initialScanState,
                systemLog: ["SYSTEM CLEARED. Ready for new scan."],
            };
        case 'SET_SELECTED_FEATURE':
            return { ...state, selectedId: action.id };
        case 'SET_SELECTED_HOTSPOT':
            return { ...state, selectedHotspotId: action.id };
        case 'SET_SCAN_STATUS':
            return { ...state, scanStatus: action.status };
        case 'ADD_LOG':
            return { ...state, systemLog: [...state.systemLog, `> ${action.msg}`] };
        case 'SET_HAS_SCANNED':
            return { ...state, hasScanned: true };
        case 'SET_SHOW_SUGGESTION':
            return { ...state, showSuggestion: action.value };
        case 'SET_HERITAGE_COUNT':
            return { ...state, heritageCount: action.count };
        case 'SET_MONUMENT_POINTS':
            return { ...state, monumentPoints: action.points };
        case 'SET_HISTORIC_ROUTES':
            return { ...state, historicRoutes: action.routes };
        default:
            return state;
    }
}


// ─── Component ────────────────────────────────────────────────────────────────

export default function FieldGuide({ projectId }: { projectId: string }) {
    // Reducer-managed scan state
    const [scanState, dispatch] = useReducer(scanReducer, initialScanState);
    const {
        analyzing, detectedFeatures, hotspots, selectedId, selectedHotspotId,
        hasScanned, showSuggestion, scanStatus, systemLog,
        heritageCount, monumentPoints, historicRoutes,
    } = scanState;

    // Independent UI toggles (not scan-related)
    const [isSatellite, setIsSatellite] = useState(false);
    const [zoomWarning, setZoomWarning] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");
    const [isSearchOpen, setIsSearchOpen] = useState(false);
    const [isIntelOpen, setIsIntelOpen] = useState(false);
    const [targetPeriod, setTargetPeriod] = useState<'All' | 'Bronze Age' | 'Roman' | 'Medieval'>('All');
    const [isLocating, setIsLocating] = useState(false);
    const [historicMode, setHistoricMode] = useState(false);
    const [historicStripExpanded, setHistoricStripExpanded] = useState(false);
    const [historicLayerToggles, setHistoricLayerToggles] = useState({ lidar: false, os1930: false, os1880: false });
    const [historicLayerVisibility, setHistoricLayerVisibility] = useState({ routes: true, corridors: true, crossings: true, monuments: true, aim: true });
    const [mapClickLabel, setMapClickLabel] = useState<string | null>(null);

    // PAS & intel state
    const [pasFinds, setPasFinds] = useState<PASFind[]>([]);
    const [selectedPASFind, setSelectedPASFind] = useState<PASFind | null>(null);
    const [loadingPAS, setLoadingPAS] = useState(false);
    const [placeSignals, setPlaceSignals] = useState<PlaceSignal[]>([]);

    // Scoring hook
    const { potentialScore, scanConfidence, setPotentialScore, setScanConfidence, calculatePotentialScore } = usePotentialScore();

    const permissions = useLiveQuery(() => db.permissions.where("projectId").equals(projectId).toArray()) || [];
    const fields = useLiveQuery(() => db.fields.where("projectId").equals(projectId).toArray()) || [];

    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const initLat = parseFloat(searchParams.get('lat') ?? '');
    const initLng = parseFloat(searchParams.get('lng') ?? '');
    void navigate;

    const addLog = (msg: string) => dispatch({ type: 'ADD_LOG', msg });

    const logContainerRef = useRef<HTMLDivElement>(null);
    const scrollRef = useRef<HTMLDivElement>(null);
    const isMountedRef = useRef(true);
    const pasAbortRef = useRef<AbortController | null>(null);
    const scanAbortRef = useRef<AbortController | null>(null);

    const { mapContainerRef, mapRef, clearMapSources } = useFieldGuideMap({
        hotspots, selectedHotspotId, detectedFeatures, pasFinds, historicRoutes,
        isSatellite, historicMode, historicLayerVisibility, historicLayerToggles,
        initLat, initLng,
        callbacks: {
            onFeatureClick:  (id) => dispatch({ type: 'SET_SELECTED_FEATURE', id }),
            onHotspotClick:  (id) => { dispatch({ type: 'SET_SHOW_SUGGESTION', value: false }); dispatch({ type: 'SET_SELECTED_HOTSPOT', id }); },
            onDeselect:      ()   => { dispatch({ type: 'SET_SHOW_SUGGESTION', value: false }); dispatch({ type: 'SET_SELECTED_HOTSPOT', id: null }); dispatch({ type: 'SET_SELECTED_FEATURE', id: null }); },
            onDragStart:     ()   => dispatch({ type: 'SET_SHOW_SUGGESTION', value: false }),
            onZoomChange:    (z)  => setZoomWarning(z > 16.5),
            onSetClickLabel: (l)  => setMapClickLabel(l),
            onPASFindLog:    (msg) => addLog(msg),
            onPASFindSelect: (f)  => setSelectedPASFind(f),
            onCrossingsLog:  (msg) => addLog(msg),
        },
    });

    // Simple Haversine distance in km
    const getDistancePAS = (lat1: number, lon1: number, lat2: number, lon2: number) => {
        const R = 6371;
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                  Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                  Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    };

    useEffect(() => {
        isMountedRef.current = true;
        return () => { isMountedRef.current = false; };
    }, []);

    // ─── Clear / Reset ────────────────────────────────────────────────────────

    const clearScan = () => {
        pasAbortRef.current?.abort();
        scanAbortRef.current?.abort();
        dispatch({ type: 'CLEAR_SCAN' });
        setPasFinds([]);
        setPlaceSignals([]);
        setPotentialScore(null);
        setScanConfidence(null);
        setHistoricMode(false);
        setHistoricStripExpanded(false);
        setHistoricLayerToggles({ lidar: false, os1930: false, os1880: false });
        setHistoricLayerVisibility({ routes: true, corridors: true, crossings: true, monuments: true, aim: true });
        setMapClickLabel(null);
        clearMapSources();
    };

    // ─── Heritage / PAS scan ──────────────────────────────────────────────────

    const loadPASFinds = async () => {
        if (!mapRef.current) { addLog("ERROR: Map engine not initialized."); return; }
        const map = mapRef.current;
        const center = map.getCenter();
        const zoom = map.getZoom();

        if (zoom < 10) { addLog("ZOOM IN: Historic scan works best at zoom 10+. Pan to your target area."); return; }

        const bounds = map.getBounds();
        setLoadingPAS(true);
        addLog(`INITIALIZING HERITAGE SCAN @ ${center.lat.toFixed(4)}, ${center.lng.toFixed(4)}`);

        const maxDelta = 0.045;
        const latBuffer = 0.009;
        const lonBuffer = 0.015;
        const west  = Number(Math.max(center.lng - maxDelta, Math.min(bounds.getWest(),  center.lng - lonBuffer)).toFixed(6));
        const south = Number(Math.max(center.lat - maxDelta, Math.min(bounds.getSouth(), center.lat - latBuffer)).toFixed(6));
        const east  = Number(Math.min(center.lng + maxDelta, Math.max(bounds.getEast(),  center.lng + lonBuffer)).toFixed(6));
        const north = Number(Math.min(center.lat + maxDelta, Math.max(bounds.getNorth(), center.lat + latBuffer)).toFixed(6));

        try {
            pasAbortRef.current?.abort();
            const pasAbort = new AbortController();
            pasAbortRef.current = pasAbort;
            const { signal: pasSignal } = pasAbort;

            addLog("STAGE: Running parallel data fetch...");

            const [geoData, etymData, osmData, nhleData, aimData, routeData] = await Promise.all([
                fetchLocationLabel(center.lat, center.lng, pasSignal),
                fetchEtymologySignals(south, west, north, east, pasSignal),
                fetchHeritageFeatures(center.lat, center.lng, pasSignal),
                fetchScheduledMonuments(west, south, east, north, pasSignal),
                fetchAIMData(west, south, east, north, pasSignal),
                historicRoutes.length === 0
                    ? fetchHistoricRoutes(center.lat, center.lng, pasSignal)
                    : Promise.resolve(null),
            ]);

            if (pasSignal.aborted || !isMountedRef.current) return;

            // 1. Location
            if (geoData?.address) {
                const parish = geoData.address.parish || geoData.address.village || geoData.address.town || "Unknown Parish";
                const county = geoData.address.county || geoData.address.state_district || "Unknown County";
                const fullGrid = toOSGridRef(center.lat, center.lng);
                const parts = fullGrid.split(' ');
                const fourFigure = parts.length === 3 ? `${parts[0]} ${parts[1].substring(0, 2)}${parts[2].substring(0, 2)}` : fullGrid;
                addLog(`LOCATION: ${parish}, ${county} [${fourFigure}]`);
            }

            // 2. Etymology signals
            let discoveredSignals: PlaceSignal[] = [];
            if (etymData?.elements) {
                const signals: PlaceSignal[] = [];
                etymData.elements.forEach((el: OverpassElement) => {
                    const name = el.tags?.name || "";
                    if (!name) return;
                    const lat = el.lat || el.center?.lat;
                    const lon = el.lon || el.center?.lon;
                    if (!lat || !lon) return;
                    ETYMOLOGY_SIGNALS.forEach(sig => {
                        if (name.toLowerCase().includes(sig.pattern.toLowerCase())) {
                            const typeValue = el.tags?.historic || el.tags?.heritage || el.tags?.place || el.tags?.natural || el.tags?.landuse || el.tags?.standing_remains || "Location";
                            signals.push({ name, meaning: sig.meaning, distance: getDistancePAS(center.lat, center.lng, lat, lon), period: sig.period, confidence: sig.confidence, type: String(typeValue) });
                        }
                    });
                });
                discoveredSignals = signals.sort((a, b) => b.confidence - a.confidence);
                setPlaceSignals(discoveredSignals);
                if (discoveredSignals.length > 0) addLog(`ETYMOLOGY: ${discoveredSignals.length} place-name signal${discoveredSignals.length !== 1 ? 's' : ''} detected.`);
            }

            // 3. OSM Heritage features
            let mappedFinds: PASFind[] = [];
            if (osmData?.elements) {
                mappedFinds = osmData.elements.map((el: OverpassElement) => {
                    const lat = el.lat || el.center?.lat;
                    const lon = el.lon || el.center?.lon;
                    if (!lat || !lon) return null;
                    const type = el.tags?.historic || el.tags?.archaeological_site || el.tags?.heritage || el.tags?.standing_remains || el.tags?.site_type || "Heritage Site";
                    const name = el.tags?.name;
                    const dist = getDistancePAS(center.lat, center.lng, lat, lon);
                    const inViewport = lat >= south && lat <= north && lon >= west && lon <= east;
                    if (!inViewport && dist > 2) return null;
                    const descriptiveType = name ? `${name} (${type})` : type;
                    return { id: `OSM-${el.id}`, internalId: String(el.id), objectType: String(descriptiveType).charAt(0).toUpperCase() + String(descriptiveType).slice(1), broadperiod: el.tags?.period || "Unknown", county: "Local Area", workflow: "PAS" as const, lat, lon, isApprox: false, osmType: el.type };
                }).filter((f: PASFind | null) => f !== null) as PASFind[];
                setPasFinds(mappedFinds);
                addLog(`HERITAGE: ${mappedFinds.length} OSM feature${mappedFinds.length !== 1 ? 's' : ''} found within 2km.`);
            }

            // 4. NHLE scheduled monuments
            let mPoints: [number, number][] = [];
            if (nhleData?.features?.length > 0) {
                mPoints = nhleData.features.map(f => {
                    if (f.geometry?.type === 'Point') return f.geometry.coordinates as [number, number];
                    if (f.geometry?.type === 'Polygon') return (f.geometry.coordinates as number[][][])[0][0] as [number, number];
                    if (f.geometry?.type === 'MultiPolygon') return (f.geometry.coordinates as number[][][][])[0][0][0] as [number, number];
                    return [0, 0] as [number, number];
                });
                dispatch({ type: 'SET_MONUMENT_POINTS', points: mPoints });
                dispatch({ type: 'SET_HERITAGE_COUNT', count: nhleData.features.length });
                const mSrc = map.getSource('monuments') as maplibregl.GeoJSONSource | undefined;
                if (mSrc) mSrc.setData(nhleData as unknown as GeoJSON.FeatureCollection);
                addLog(`NHLE: ${nhleData.features.length} scheduled monument${nhleData.features.length !== 1 ? 's' : ''} found.`);
            } else {
                addLog("NHLE: No scheduled monuments in this area.");
            }

            calculatePotentialScore(mappedFinds, mPoints, discoveredSignals, center.lat, center.lng);

            // 5. AIM aerial archaeology
            if (aimData?.features?.length > 0) {
                const aimSrc = map.getSource('aim-monuments') as maplibregl.GeoJSONSource | undefined;
                if (aimSrc) aimSrc.setData(aimData as unknown as GeoJSON.FeatureCollection);
                addLog(`AIM: ${aimData.features.length} aerial monument${aimData.features.length !== 1 ? 's' : ''} mapped.`);
            }

            // 6. Historic routes (only if not already loaded)
            if (routeData && routeData.elements && routeData.elements.length > 0) {
                const fetchedRoutes: HistoricRoute[] = routeData.elements
                    .filter((el: OverpassElement) => el.geometry && el.geometry.length >= 2)
                    .map((el: OverpassElement) => {
                        const geom: [number, number][] = (el.geometry || []).map(g => [g.lon, g.lat] as [number, number]);
                        const lons = geom.map(g => g[0]);
                        const lats = geom.map(g => g[1]);
                        return {
                            id: `route-${el.id}`,
                            type: (el.tags?.historic === 'roman_road' || el.tags?.roman_road === 'yes') ? 'roman_road' as const : 'historic_trackway' as const,
                            source: 'osm' as const,
                            confidenceClass: 'B' as const,
                            certaintyScore: 70,
                            geometry: geom,
                            bbox: [[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]] as [[number,number],[number,number]],
                            period: el.tags?.historic === 'roman_road' ? 'roman' as const : 'unknown' as const
                        };
                    });
                dispatch({ type: 'SET_HISTORIC_ROUTES', routes: fetchedRoutes });
                if (fetchedRoutes.length > 0) addLog(`ROUTES: ${fetchedRoutes.length} historic route segment${fetchedRoutes.length !== 1 ? 's' : ''} found.`);
            } else if (historicRoutes.length === 0) {
                addLog("ROUTES: No historic routes found nearby.");
            }

        } catch (e) {
            addLog("HERITAGE SCAN FAILED.");
            console.error(e);
        } finally {
            setLoadingPAS(false);
        }
    };

    // ─── Scroll, intel, card-scroll effects ──────────────────────────────────

    useEffect(() => {
        if (selectedId) {
            const el = document.getElementById(`card-${selectedId}`);
            if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'start' });
        }
    }, [selectedId]);

    useEffect(() => {
        if (isIntelOpen && pasFinds.length === 0 && !loadingPAS) loadPASFinds();
    }, [isIntelOpen]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        if (historicMode && pasFinds.length === 0 && !loadingPAS) loadPASFinds();
    }, [historicMode]); // eslint-disable-line react-hooks/exhaustive-deps

    useLayoutEffect(() => {
        if (logContainerRef.current) logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }, [systemLog]);

    // ─── GPS / search ─────────────────────────────────────────────────────────

    const findMe = () => {
        if (isLocating) return;
        setIsLocating(true);
        navigator.geolocation.getCurrentPosition(
            (pos) => { setIsLocating(false); mapRef.current?.flyTo({ center: [pos.coords.longitude, pos.coords.latitude], zoom: 16 }); },
            (err) => { setIsLocating(false); console.error("GPS Error:", err); },
            { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
        );
    };

    const searchLocation = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!searchQuery) return;
        try {
            const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(searchQuery)}`);
            const data = await res.json();
            if (data[0]) { mapRef.current?.flyTo({ center: [parseFloat(data[0].lon), parseFloat(data[0].lat)], zoom: 16 }); setIsSearchOpen(false); }
        } catch { addLog("Search failed."); }
    };

    // ─── Main terrain scan ────────────────────────────────────────────────────

    const executeScan = async () => {
        if (!mapRef.current || analyzing) return;

        const scanZoom = 16;
        const bounds = mapRef.current.getBounds();
        const n = Math.pow(2, scanZoom);
        const center = mapRef.current.getCenter();
        const cX = (center.lng + 180) / 360 * n;
        const cY = (1 - Math.log(Math.tan(center.lat * Math.PI / 180) + 1 / Math.cos(center.lat * Math.PI / 180)) / Math.PI) / 2 * n;
        const tX_start = Math.floor(cX) - 1;
        const tY_start = Math.floor(cY) - 1;

        clearScan();
        scanAbortRef.current?.abort();
        const scanAbort = new AbortController();
        scanAbortRef.current = scanAbort;
        const { signal: scanSignal } = scanAbort;

        dispatch({ type: 'SCAN_START' });
        addLog(`Engine Initiating (Fixed Z${scanZoom})...`);

        const qWest = bounds.getWest();
        const qSouth = bounds.getSouth();
        const qEast = bounds.getEast();
        const qNorth = bounds.getNorth();

        const herUrl = `https://services-eu1.arcgis.com/ZOdPfBS3aqqDYPUQ/arcgis/rest/services/National_Heritage_List_for_England_NHLE_v02_VIEW/FeatureServer/6/query?where=1%3D1&geometry=${qWest},${qSouth},${qEast},${qNorth}&geometryType=esriGeometryEnvelope&spatialRel=esriSpatialRelIntersects&inSR=4326&outSR=4326&f=geojson&outFields=Name,ListEntry`;

        const herPromise = fetch(herUrl, { signal: scanSignal }).then(r => r.json()).catch(() => ({ features: [] }));
        const routePromise = fetchScanRoutes(center.lat, center.lng, scanSignal);

        dispatch({ type: 'SET_SCAN_STATUS', status: "Scanning Terrain..." });
        const terrainTask = scanDataSource('terrain', scanZoom, tX_start, tY_start, bounds, n, { features: [] });
        const terrainGlobalTask = scanDataSource('terrain_global', scanZoom, tX_start, tY_start, bounds, n, { features: [] });
        const slopeTask = scanDataSource('slope', scanZoom, tX_start, tY_start, bounds, n, { features: [] });

        dispatch({ type: 'SET_SCAN_STATUS', status: "Scanning Hydrology..." });
        const hydroTask = scanDataSource('hydrology', scanZoom, tX_start, tY_start, bounds, n, { features: [] });

        dispatch({ type: 'SET_SCAN_STATUS', status: "Spectral Sampling..." });
        const springTask = scanDataSource('satellite_spring', scanZoom, tX_start, tY_start, bounds, n, { features: [] });
        const summerTask = scanDataSource('satellite_summer', scanZoom, tX_start, tY_start, bounds, n, { features: [] });

        try {
            const [assetsGeoJSON, terrainHits, terrainGlobalHits, slopeHits, hydroHits, springHits, summerHits] = await Promise.all([herPromise, terrainTask, terrainGlobalTask, slopeTask, hydroTask, springTask, summerTask]);

            if (scanSignal.aborted || !isMountedRef.current) return;

            dispatch({ type: 'SET_SCAN_STATUS', status: "Locking Coordinates..." });
            dispatch({ type: 'SET_HERITAGE_COUNT', count: assetsGeoJSON.features?.length || 0 });
            const mPoints: [number, number][] = (assetsGeoJSON.features || []).map((f: { geometry: { type: string; coordinates: number[] | number[][][] | number[][][][] } }) => {
                if (f.geometry.type === 'Point') return f.geometry.coordinates as [number, number];
                if (f.geometry.type === 'Polygon') return (f.geometry.coordinates as number[][][])[0][0] as [number, number];
                if (f.geometry.type === 'MultiPolygon') return (f.geometry.coordinates as number[][][][])[0][0][0] as [number, number];
                return [0, 0] as [number, number];
            });
            dispatch({ type: 'SET_MONUMENT_POINTS', points: mPoints });
            if (mapRef.current?.getSource('monuments')) {
                (mapRef.current.getSource('monuments') as maplibregl.GeoJSONSource).setData(assetsGeoJSON as GeoJSON.FeatureCollection);
            }

            dispatch({ type: 'SET_SCAN_STATUS', status: "Syncing Routes..." });
            let routes: HistoricRoute[] = [];
            try {
                const timeoutPromise = new Promise<null>((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000));
                const rData = await Promise.race([routePromise, timeoutPromise]);

                if (rData && rData.elements) {
                    routes = rData.elements
                        .filter((el: OverpassElement) => el.geometry && el.geometry.length >= 2)
                        .map((el: OverpassElement) => {
                            const geom = (el.geometry || []).map(g => [g.lon, g.lat] as [number, number]);
                            const lons = geom.map(g => g[0]);
                            const lats = geom.map(g => g[1]);
                            return {
                                id: `route-${el.id}`,
                                type: (el.tags?.historic === 'roman_road' || el.tags?.roman_road === 'yes' || (el.tags?.name && el.tags.name.toLowerCase().includes('roman road'))) ? 'roman_road' as const :
                                      el.tags?.holloway === 'yes' ? 'holloway' as const : 'historic_trackway' as const,
                                source: 'osm' as const,
                                confidenceClass: 'B' as const,
                                certaintyScore: 70,
                                geometry: geom,
                                bbox: [[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]] as [[number,number],[number,number]],
                                period: (el.tags?.historic === 'roman_road' || el.tags?.roman_road === 'yes') ? 'roman' as const : 'unknown' as const
                            };
                        });
                    dispatch({ type: 'SET_HISTORIC_ROUTES', routes });
                } else { routes = historicRoutes; }
            } catch { routes = historicRoutes; }

            dispatch({ type: 'SET_SCAN_STATUS', status: "Deep Signal Audit..." });
            const aimUrl = `https://services-eu1.arcgis.com/ZOdPfBS3aqqDYPUQ/arcgis/rest/services/HE_AIM_data/FeatureServer/1/query?where=1%3D1&geometry=${qWest},${qSouth},${qEast},${qNorth}&geometryType=esriGeometryEnvelope&spatialRel=esriSpatialRelIntersects&inSR=4326&outSR=4326&f=geojson&outFields=MONUMENT_TYPE,PERIOD,EVIDENCE_1`;
            let aimGeoJSON: { type: string; features: Array<{ geometry: { type: string; coordinates: unknown }; properties: { MONUMENT_TYPE?: string; PERIOD?: string; EVIDENCE_1?: string } }> } = { type: 'FeatureCollection', features: [] };
            try {
                const aRes = await fetch(aimUrl, { signal: scanSignal });
                aimGeoJSON = await aRes.json();
                const aimSrc = mapRef.current?.getSource('aim-monuments') as maplibregl.GeoJSONSource | undefined;
                if (aimSrc && aimGeoJSON.features?.length > 0) {
                    aimSrc.setData(aimGeoJSON as unknown as GeoJSON.FeatureCollection);
                    addLog(`AIM: ${aimGeoJSON.features.length} aerial monument${aimGeoJSON.features.length !== 1 ? 's' : ''} mapped in this area.`);
                }
            } catch { /* ignore AIM failure */ }

            const rawCombined = [...terrainHits, ...terrainGlobalHits, ...slopeHits, ...hydroHits, ...springHits, ...summerHits];
            const merged = findConsensus(rawCombined);

            const newScanResults = merged.map(c => {
                for (const aim of aimGeoJSON.features) {
                    const aimProps = aim.properties;
                    const coords = aim.geometry?.coordinates;
                    if (!coords) continue;
                    let isMatch = false;
                    if (aim.geometry.type === 'Polygon' || aim.geometry.type === 'MultiPolygon') {
                        const rings = aim.geometry.type === 'Polygon' ? [coords as number[][][]] : coords as number[][][][];
                        for (const ring of rings) {
                            if (isPointInPolygon(c.center[1], c.center[0], ring as number[][][])) { isMatch = true; break; }
                        }
                    } else if (aim.geometry.type === 'Point' && getDistance(c.center, coords as [number, number]) < 50) isMatch = true;

                    if (isMatch) {
                        if (!c.sources.includes('historic')) c.sources.push('historic');
                        c.aimInfo = { type: String(aimProps.MONUMENT_TYPE || ''), period: String(aimProps.PERIOD || ''), evidence: String(aimProps.EVIDENCE_1 || '') };
                        c.confidence = 'High';
                        c.findPotential = 96;
                        break;
                    }
                }
                return c;
            });

            const updatedFeatures: Cluster[] = [];
            newScanResults.forEach(newHit => {
                let anchored = false;
                for (let i = 0; i < updatedFeatures.length; i++) {
                    if (getDistance(newHit.center, updatedFeatures[i].center) < 15) {
                        newHit.sources.forEach(s => { if (!updatedFeatures[i].sources.includes(s)) updatedFeatures[i].sources.push(s); });
                        updatedFeatures[i].confidence = newHit.confidence === 'High' ? 'High' : updatedFeatures[i].confidence;
                        anchored = true;
                        break;
                    }
                }
                if (!anchored) updatedFeatures.push(newHit);
            });

            // Mark clusters that fall inside scheduled monument (NHLE) boundaries.
            // assetsGeoJSON was fetched in parallel so couldn't be passed to scanDataSource —
            // apply the protection flag here instead.
            for (const cluster of updatedFeatures) {
                const [lon, lat] = cluster.center;
                for (const asset of (assetsGeoJSON as { features: Array<{ geometry?: { type: string; coordinates: unknown }; properties?: { Name?: string } }> }).features) {
                    if (!asset.geometry) continue;
                    if (asset.geometry.type === 'Polygon') {
                        if (isPointInPolygon(lat, lon, asset.geometry.coordinates as number[][][])) {
                            cluster.isProtected = true;
                            cluster.monumentName = asset.properties?.Name;
                            break;
                        }
                    } else if (asset.geometry.type === 'MultiPolygon') {
                        for (const poly of asset.geometry.coordinates as number[][][][]) {
                            if (isPointInPolygon(lat, lon, poly)) {
                                cluster.isProtected = true;
                                cluster.monumentName = asset.properties?.Name;
                                break;
                            }
                        }
                        if (cluster.isProtected) break;
                    }
                }
            }

            const suppressed = suppressDisturbance(updatedFeatures);
            const contextualized = analyzeContext(suppressed, routes)
                .sort((a, b) => b.findPotential - a.findPotential)
                .map((c, i) => ({ ...c, number: i + 1 }));

            const tacticalHotspots = generateHotspots(contextualized, pasFinds, mPoints, targetPeriod, permissions, fields, routes);
            dispatch({ type: 'SCAN_SUCCESS', features: contextualized, hotspots: tacticalHotspots });

            if (!hasScanned && tacticalHotspots.length > 0) {
                dispatch({ type: 'SET_HAS_SCANNED' });
                dispatch({ type: 'SET_SHOW_SUGGESTION', value: true });
                dispatch({ type: 'SET_SELECTED_HOTSPOT', id: tacticalHotspots[0].id });
                mapRef.current?.fitBounds(tacticalHotspots[0].bounds as maplibregl.LngLatBoundsLike, { padding: 40 });
            }
            addLog(`Scan Complete. ${tacticalHotspots.length} Hotspots identified.`);
        } catch (e) {
            addLog("Engine Error."); console.error(e);
            if (isMountedRef.current) dispatch({ type: 'SCAN_FAIL' });
        }
    };

    // ─── Inline helper (used in executeScan) ─────────────────────────────────

    function isPointInPolygon(lat: number, lon: number, rings: number[][][]): boolean {
        let inside = false;
        for (const ring of rings) {
            for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
                const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
                if (((yi > lat) !== (yj > lat)) && (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi)) inside = !inside;
            }
        }
        return inside;
    }

    // ─── Render ───────────────────────────────────────────────────────────────

    return (
        <div className="flex flex-col h-[calc(100vh-140px)] landscape:h-[calc(100vh-100px)] sm:h-[calc(100vh-220px)] bg-slate-950 rounded-3xl overflow-hidden border border-slate-800 shadow-2xl relative">
            <header className="bg-slate-900/80 border-b border-white/5 shrink-0 z-50 backdrop-blur-md">
                {/* Top Row: Overlay Toggles & Search Toggle */}
                <div className="flex justify-between items-center px-4 py-2 pb-3 border-b border-white/5">
                    {!isSearchOpen ? (
                        <div className="flex items-center gap-2">
                            <button
                                onClick={() => { if (!historicMode) setHistoricMode(true); setHistoricLayerToggles(p => ({ ...p, lidar: !p.lidar })); }}
                                className={`flex items-center gap-1 px-2 py-1 rounded-lg border text-[8px] font-black uppercase tracking-wider transition-all active:scale-95 ${historicLayerToggles.lidar ? 'bg-emerald-500 border-emerald-300 text-white shadow-[0_0_8px_rgba(16,185,129,0.4)]' : 'bg-white/5 border-white/10 text-slate-400'}`}
                            >
                                <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M3 17l9-14 9 14H3z"/></svg>
                                LiDAR
                            </button>
                            <button
                                onClick={() => { if (!historicMode) setHistoricMode(true); setHistoricLayerToggles(p => ({ ...p, os1880: !p.os1880 })); }}
                                className={`flex items-center gap-1 px-2 py-1 rounded-lg border text-[8px] font-black uppercase tracking-wider transition-all active:scale-95 ${historicLayerToggles.os1880 ? 'bg-amber-500 border-amber-300 text-black shadow-[0_0_8px_rgba(245,158,11,0.4)]' : 'bg-white/5 border-white/10 text-slate-400'}`}
                            >
                                <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg>
                                1880 OS
                            </button>
                            <button
                                onClick={() => { if (!historicMode) setHistoricMode(true); setHistoricLayerToggles(p => ({ ...p, os1930: !p.os1930 })); }}
                                className={`flex items-center gap-1 px-2 py-1 rounded-lg border text-[8px] font-black uppercase tracking-wider transition-all active:scale-95 ${historicLayerToggles.os1930 ? 'bg-orange-500 border-orange-300 text-black shadow-[0_0_8px_rgba(249,115,22,0.4)]' : 'bg-white/5 border-white/10 text-slate-400'}`}
                            >
                                <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg>
                                1888 OS
                            </button>
                        </div>
                    ) : (
                        <form onSubmit={searchLocation} className="flex gap-2 flex-1 mr-2">
                            <input autoFocus value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search place..." className="bg-black/40 border border-white/10 text-white px-3 py-1 rounded-lg flex-1 text-xs outline-none focus:ring-1 focus:ring-emerald-500" />
                        </form>
                    )}
                    <button onClick={() => setIsSearchOpen(!isSearchOpen)} className="text-slate-400 hover:text-white p-1">
                        {isSearchOpen ? (
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                <line x1="18" y1="6" x2="6" y2="18"></line>
                                <line x1="6" y1="6" x2="18" y2="18"></line>
                            </svg>
                        ) : '🔍'}
                    </button>
                </div>

                {/* Bottom Row: Dual Actions */}
                <div className="flex justify-between items-center px-4 py-2 bg-black/20 relative">
                    <div className="flex gap-2 items-center relative">
                        {!historicMode && pasFinds.length === 0 && !loadingPAS && !potentialScore && (
                            <div className="absolute bottom-full left-1 mb-1 pointer-events-none animate-pulse">
                                <span className="text-[7px] font-black text-blue-400/80 uppercase tracking-[0.2em] whitespace-nowrap bg-slate-900/80 px-1.5 py-0.5 rounded border border-blue-500/20">Historic</span>
                            </div>
                        )}
                        <button
                            onClick={() => {
                                if (!historicMode) { clearScan(); setHistoricMode(true); }
                                else { setHistoricMode(false); setHistoricStripExpanded(false); setHistoricLayerToggles({ lidar: false, os1930: false, os1880: false }); }
                            }}
                            className={`px-4 py-1.5 rounded-lg text-[9px] font-black tracking-widest uppercase border transition-all shadow-lg ${historicMode ? 'bg-blue-500 text-white border-blue-300 shadow-[0_0_18px_rgba(59,130,246,0.6)] ring-2 ring-blue-400/40' : 'bg-blue-600 text-white border-blue-400/50 shadow-[0_0_15px_rgba(37,99,235,0.3)]'} ${loadingPAS ? 'animate-pulse opacity-80' : ''}`}
                        >
                            {loadingPAS ? 'Scanning...' : 'Historic'}
                        </button>
                        <button onClick={clearScan} className="text-[9px] font-black text-slate-400 hover:text-white transition-colors tracking-widest uppercase px-2 py-1.5">Clear</button>
                    </div>

                    <div className="flex gap-2 items-center relative">
                        {!analyzing && detectedFeatures.length === 0 && (
                            <div className="absolute bottom-full right-1 mb-1 pointer-events-none animate-pulse text-right">
                                <span className="text-[7px] font-black text-emerald-500/80 uppercase tracking-[0.2em] whitespace-nowrap bg-slate-900/80 px-1.5 py-0.5 rounded border border-emerald-500/20">Terrain Scan</span>
                            </div>
                        )}
                        <button onClick={findMe} disabled={isLocating} className="bg-slate-800 text-white px-4 py-1.5 rounded-lg text-[9px] font-black tracking-widest uppercase hover:bg-slate-700 transition-colors disabled:opacity-50">
                            {isLocating ? '...' : 'GPS'}
                        </button>
                        <button onClick={executeScan} disabled={analyzing} title="Scan area locked to Z16 for precision" className="bg-emerald-500 text-white px-4 py-1.5 rounded-lg text-[9px] font-black tracking-widest uppercase hover:bg-emerald-400 transition-all shadow-[0_0_15px_rgba(16,185,129,0.3)] disabled:opacity-50 disabled:animate-pulse">
                            {analyzing ? '...' : 'Scan'}
                        </button>
                    </div>
                </div>
            </header>

            <div className="flex flex-1 overflow-hidden relative">
                <div className="flex-1 relative bg-slate-900">
                    <div ref={mapContainerRef} className="absolute inset-0" />

                    {/* Map Layer Toggle */}
                    <div className="absolute top-4 right-4 z-[60] flex flex-col gap-2">
                        <button
                            onClick={() => setIsSatellite(!isSatellite)}
                            className={`w-10 h-10 flex items-center justify-center rounded-xl border shadow-xl backdrop-blur-md transition-all active:scale-95 ${isSatellite ? 'bg-emerald-500 border-white text-white' : 'bg-slate-900/90 border-white/10 text-slate-300'}`}
                        >
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                <polygon points="12 2 2 7 12 12 22 7 12 2" />
                                <polyline points="2 17 12 22 22 17" />
                                <polyline points="2 12 12 17 22 12" />
                            </svg>
                        </button>
                    </div>

                    {/* Center Reticle */}
                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none z-20">
                        <div className="w-10 h-10 border-2 border-emerald-500/50 rounded-full flex items-center justify-center">
                            <div className="w-1 h-1 bg-emerald-500 rounded-full" />
                        </div>
                    </div>

                    {/* Floating Alerts */}
                    <div className="absolute top-12 left-1/2 -translate-x-1/2 z-[100] flex flex-col gap-2 items-center pointer-events-none w-[90%] max-w-sm">
                        {mapClickLabel && (
                            <div className="bg-slate-900/95 text-white px-4 py-1.5 rounded-full text-[9px] font-black tracking-widest uppercase shadow-2xl border border-blue-500/40">
                                {mapClickLabel}
                            </div>
                        )}
                        {heritageCount > 0 && !historicMode && (
                            <div className="bg-red-600 text-white px-4 py-1.5 rounded-full text-[8px] sm:text-[10px] font-black tracking-widest uppercase shadow-2xl border border-white/20 animate-bounce">
                                ⛔ Scheduled Monument
                            </div>
                        )}
                        {zoomWarning && !historicLayerToggles.lidar && (
                            <div className="bg-amber-500 text-black px-4 py-1.5 rounded-full text-[8px] sm:text-[10px] font-black tracking-widest uppercase shadow-2xl border border-white/20">
                                ⚠️ MAX SCAN ZOOM
                            </div>
                        )}
                        {analyzing && (
                            <div className="bg-slate-900/90 text-emerald-400 px-6 py-3 rounded-2xl text-[10px] font-black tracking-[0.2em] uppercase shadow-2xl border border-emerald-500/50 animate-pulse flex items-center gap-3 backdrop-blur-xl">
                                <div className="w-2 h-2 bg-emerald-500 rounded-full animate-ping" />
                                {scanStatus || 'Scanning Terrain...'}
                            </div>
                        )}
                    </div>

                    {/* Mobile Tactical Tray (Hotspot Selection) */}
                    {hotspots.length > 0 && !historicMode && (
                        <div className="absolute top-4 left-4 z-[100] lg:hidden pointer-events-none flex flex-col gap-2">
                            <div className="bg-slate-900/90 text-emerald-400 px-3 py-1.5 rounded-xl text-[10px] font-black tracking-widest uppercase shadow-2xl border border-emerald-500/30 backdrop-blur-md w-fit pointer-events-auto flex items-center gap-2">
                                <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
                                Hotspot detected
                            </div>
                            <div className="flex flex-col gap-2 pointer-events-auto max-h-[40vh] overflow-y-auto scrollbar-hide pb-4">
                                {hotspots.slice(0, 3).map(h => (
                                    <button
                                        key={h.id}
                                        onClick={() => {
                                            dispatch({ type: 'SET_SHOW_SUGGESTION', value: false });
                                            dispatch({ type: 'SET_SELECTED_HOTSPOT', id: h.id === selectedHotspotId ? null : h.id });
                                            if (h.id !== selectedHotspotId) mapRef.current?.fitBounds(h.bounds as maplibregl.LngLatBoundsLike, { padding: 40 });
                                        }}
                                        className={`w-14 h-10 flex items-center justify-center rounded-xl border shadow-xl backdrop-blur-md transition-all active:scale-95 flex-shrink-0 ${selectedHotspotId === h.id ? 'bg-emerald-500 border-white text-white shadow-[0_0_20px_rgba(16,185,129,0.5)]' : 'bg-slate-900/90 border-white/10 text-slate-300'}`}
                                    >
                                        <span className="text-[12px] font-black tracking-tight">{h.score}%</span>
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Mobile Hotspot Card Popup */}
                    {selectedHotspotId && !historicMode && (
                        <div className="absolute bottom-6 left-4 right-4 z-[100] lg:hidden animate-in slide-in-from-bottom-4 duration-300">
                            {hotspots.filter(h => h.id === selectedHotspotId).map(h => (
                                <div key={h.id} className={`p-5 rounded-3xl border-2 shadow-2xl backdrop-blur-xl transition-all ${h.score >= 80 ? 'bg-slate-900/95 border-amber-500/50 shadow-[0_0_40px_rgba(245,158,11,0.2)]' : h.score >= 45 ? 'bg-slate-900/95 border-emerald-500/50' : 'bg-slate-900/95 border-white/20'}`}>
                                    <div className="flex justify-between items-start mb-4">
                                        <div>
                                            <h3 className="text-lg font-black uppercase tracking-tight leading-none mb-1">Hotspot</h3>
                                            <p className="text-[10px] font-black text-emerald-400 uppercase tracking-wide mb-1">{h.type}</p>
                                            <p className="text-[9px] text-slate-400 italic mb-2 leading-tight">{HOTSPOT_INTERPRETATION[h.type]}</p>
                                            <div className="flex items-center gap-2">
                                                <div className={`px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-widest ${h.score >= 80 ? 'bg-amber-600 text-white shadow-[0_0_10px_rgba(217,119,6,0.3)]' : h.score >= 65 ? 'bg-orange-600 text-white' : h.score >= 45 ? 'bg-emerald-600 text-white' : 'bg-slate-700 text-slate-300'}`}>
                                                    {h.score >= 80 ? 'High Probability' : h.score >= 65 ? 'Strong Signal' : h.score >= 45 ? 'Developing Signal' : 'Possible Anomaly'}
                                                </div>
                                                <div className={`px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-widest ${h.confidence === 'High Probability' ? 'bg-white text-black' : 'bg-black/20 text-white/80'}`}>
                                                    {h.confidence}
                                                </div>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-4">
                                            {showSuggestion && <span className="text-emerald-400 text-[10px] font-black animate-pulse tracking-widest">DETECT HERE</span>}
                                            <span className="text-xl font-black text-white/90">{h.score}%</span>
                                            <button onClick={() => dispatch({ type: 'SET_SELECTED_HOTSPOT', id: null })} className="bg-black/20 hover:bg-black/40 text-white rounded-full p-2 transition-colors border border-white/10">
                                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                                            </button>
                                        </div>
                                    </div>
                                    {h.isHighConfidenceCrossing && (
                                        <div className="bg-blue-600/40 p-2 rounded-2xl border border-blue-400 mb-4 animate-pulse">
                                            <p className="m-0 text-xs font-black uppercase text-white text-center tracking-[0.2em]">🌊 Likely historic crossing point</p>
                                        </div>
                                    )}
                                    <div className="bg-black/20 rounded-2xl p-4 mb-4">
                                        <p className="text-[10px] font-black uppercase tracking-widest text-white/60 mb-3">Why this area stands out:</p>
                                        <div className="space-y-2">
                                            {h.explanation.map((reason, idx) => (
                                                <div key={idx} className="flex items-start gap-3">
                                                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 mt-1 shadow-[0_0_8px_rgba(52,211,153,0.8)]" />
                                                    <p className="text-xs font-bold text-white leading-tight flex-1">{reason}</p>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-3 gap-2">
                                        <div className="bg-white/10 p-2 rounded-xl text-center"><span className="block text-[7px] uppercase font-bold opacity-60 mb-0.5">Anomaly</span><span className="text-[10px] font-black">{h.metrics.anomaly}</span></div>
                                        <div className="bg-white/10 p-2 rounded-xl text-center"><span className="block text-[7px] uppercase font-bold opacity-60 mb-0.5">Context</span><span className="text-[10px] font-black">{h.metrics.context}</span></div>
                                        <div className="bg-white/10 p-2 rounded-xl text-center"><span className="block text-[7px] uppercase font-bold opacity-60 mb-0.5">Bonus</span><span className="text-[10px] font-black text-emerald-400">+{h.metrics.convergence + h.metrics.behaviour}</span></div>
                                    </div>
                                    <p className="text-center text-[7px] text-white italic mt-3">Highlights historic activity — not guaranteed finds.</p>
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Mobile Target Card Popup */}
                    {selectedId && !selectedHotspotId && (
                        <div className="absolute bottom-6 left-4 right-4 z-[100] lg:hidden animate-in slide-in-from-bottom-4 duration-300">
                            {detectedFeatures.filter(f => f.id === selectedId).map(f => (
                                <div key={f.id} className={`p-4 rounded-2xl border shadow-2xl transition-all ${f.sources.length >= 3 ? 'bg-amber-600 border-yellow-300 text-white shadow-[0_0_30px_rgba(217,119,6,0.5)]' : f.sources.includes('hydrology') ? 'bg-blue-600 border-white text-white' : f.source === 'terrain' ? 'bg-emerald-500 border-white text-white' : f.source === 'historic' ? 'bg-slate-700 border-white text-white' : 'bg-sky-500 border-white text-white'}`}>
                                    <div className="flex justify-between items-center mb-2">
                                        <div className="flex items-center gap-2">
                                            <div className="w-6 h-6 bg-black/20 rounded-lg flex items-center justify-center text-[10px] font-black">{f.number}</div>
                                            <h3 className="text-xs font-black uppercase tracking-tight">{f.type}</h3>
                                        </div>
                                        <button onClick={(e) => { e.stopPropagation(); dispatch({ type: 'SET_SELECTED_FEATURE', id: null }); }} className="bg-black/20 hover:bg-black/40 text-white rounded-full p-1.5 transition-colors border border-white/10 shadow-lg">
                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                                        </button>
                                    </div>
                                    <div className="grid grid-cols-2 gap-3 mb-4">
                                        <div className="bg-black/20 p-2 rounded-xl flex flex-col items-center justify-center">
                                            <span className="block text-[8px] uppercase font-bold opacity-70 mb-2">Signal Sources</span>
                                            <div className="flex flex-col gap-1 w-full px-1">
                                                {[
                                                    { ids: ['terrain', 'terrain_global'], label: 'Lidar' },
                                                    { ids: ['slope'], label: 'Slope / LRM' },
                                                    { ids: ['hydrology'], label: 'Hydrology' },
                                                    { ids: ['satellite', 'satellite_spring', 'satellite_summer'], label: 'Aerial' },
                                                    { ids: ['historic'], label: 'Historic' }
                                                ].map(s => (
                                                    <div key={s.label} className="flex items-center justify-between w-full">
                                                        <span className="text-[8px] font-black uppercase tracking-tighter">{s.label}</span>
                                                        <div className={`w-2 h-2 rounded-full border border-white/10 ${s.ids.some(id => f.sources.includes(id as Cluster['source'])) ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]' : 'bg-black/40'}`} />
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                        <div className="flex flex-col gap-2">
                                            <div className="bg-black/20 p-2 rounded-xl">
                                                <span className="block text-[8px] uppercase font-bold opacity-70">Confidence</span>
                                                <span className="text-[10px] font-black uppercase tracking-widest">Confidence: {f.confidence}</span>
                                            </div>
                                            <div className={`p-2 rounded-xl border ${(f.persistenceScore || 0) > 70 ? 'bg-emerald-500/20 border-emerald-400' : (f.persistenceScore || 0) > 40 ? 'bg-amber-500/20 border-amber-400' : 'bg-slate-500/20 border-slate-400'}`}>
                                                <span className="block text-[8px] uppercase font-bold opacity-70">Persistence</span>
                                                <span className={`text-[10px] font-black uppercase tracking-widest ${(f.persistenceScore || 0) > 70 ? 'text-emerald-400' : (f.persistenceScore || 0) > 40 ? 'text-amber-400' : 'text-slate-400'}`}>
                                                    {(f.persistenceScore || 0) > 70 ? 'High' : (f.persistenceScore || 0) > 40 ? 'Medium' : 'Low'}
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="space-y-2 px-1">
                                        {f.disturbanceRisk && f.disturbanceRisk !== 'Low' && (
                                            <div className={`p-2 rounded-xl border mb-2 ${f.disturbanceRisk === 'High' ? 'bg-red-500/20 border-red-400' : 'bg-amber-500/20 border-amber-400'}`}>
                                                <p className="m-0 text-[9px] font-black uppercase text-red-300 leading-tight">Modern Disturbance Risk: {f.disturbanceRisk}</p>
                                                <p className="m-0 text-[10px] font-bold text-white tracking-tight">{f.disturbanceReason}</p>
                                            </div>
                                        )}
                                        {f.contextLabel && (
                                            <div className="bg-emerald-400/20 p-2 rounded-xl border border-emerald-400/30 mb-2">
                                                <p className="m-0 text-[9px] font-black uppercase text-emerald-300 leading-tight">Settlement Context:</p>
                                                <p className="m-0 text-[10px] font-bold text-white tracking-tight">{f.contextLabel}</p>
                                            </div>
                                        )}
                                        {f.aimInfo && (
                                            <div className="bg-amber-400/20 p-2 rounded-xl border border-amber-400/30 mb-2">
                                                <p className="m-0 text-[9px] font-black uppercase text-amber-200 leading-tight">Historic Verification:</p>
                                                <p className="m-0 text-[10px] font-bold text-white tracking-tight">{f.aimInfo.type} ({f.aimInfo.period})</p>
                                            </div>
                                        )}
                                        {f.isHighConfidenceCrossing && (
                                            <div className="bg-blue-600/40 p-2 rounded-xl border border-blue-400 mb-2 animate-pulse">
                                                <p className="m-0 text-[10px] font-black uppercase text-white text-center tracking-widest">🌊 Likely historic crossing point</p>
                                            </div>
                                        )}
                                        {f.explanationLines && f.explanationLines.length > 0 && (
                                            <div className="mt-2 mb-3 space-y-1 bg-black/20 p-2 rounded-xl border border-white/5">
                                                {f.explanationLines.map((line, idx) => (
                                                    <div key={idx} className="flex items-center gap-1.5">
                                                        <div className="w-1 h-1 rounded-full bg-emerald-400 shrink-0" />
                                                        <p className="text-[9px] font-bold text-emerald-100/80 leading-tight uppercase italic">{line}</p>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                        <p className="m-0 text-[10px] font-bold uppercase opacity-80 tracking-wide">
                                            Signal Profile: <span className="font-black">{f.polarity || 'Unknown'}</span>
                                        </p>
                                        <div className="flex items-center gap-3">
                                            <p className="m-0 text-[10px] font-bold uppercase opacity-80 tracking-wide whitespace-nowrap">Potential Index:</p>
                                            <div className="flex-1 h-1.5 bg-black/40 rounded-full overflow-hidden flex items-center">
                                                <div className="h-full bg-white shadow-[0_0_10px_rgba(255,255,255,0.5)] transition-all duration-1000" style={{ width: `${f.findPotential}%` }} />
                                            </div>
                                            <span className="text-[10px] font-black text-white">{Math.round(f.findPotential)}</span>
                                        </div>
                                        <p className="text-[7px] text-white/40 italic text-right">relative score</p>
                                    </div>
                                    {f.isProtected && <div className="mt-4 p-1.5 bg-red-600/40 rounded-lg text-[8px] font-black uppercase tracking-widest text-center border border-red-400">⚠️ Protected Monument</div>}
                                    <p className="text-center text-[7px] text-white italic mt-3">Highlights historic activity — not guaranteed finds.</p>
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Historic Field Intelligence Banner — top of map, mobile */}
                    {historicMode && !isIntelOpen && (
                        <div className="absolute top-3 left-3 right-3 z-[90] lg:hidden pointer-events-auto">
                            {historicStripExpanded ? (
                                <div className="bg-black rounded-2xl border border-blue-500/30 shadow-2xl overflow-hidden">
                                    <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
                                        <div className="flex items-center gap-2">
                                            <div className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
                                            <span className="text-[10px] font-black text-blue-400 uppercase tracking-[0.2em]">Field Intelligence</span>
                                        </div>
                                        <button onClick={() => setHistoricStripExpanded(false)} className="w-7 h-7 flex items-center justify-center bg-white/5 rounded-lg border border-white/10 text-white active:scale-90">
                                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="18 15 12 9 6 15"/></svg>
                                        </button>
                                    </div>
                                    <div className="p-4 space-y-4 max-h-[55vh] overflow-y-auto">
                                        <div>
                                            <p className="text-[8px] font-black text-slate-500 uppercase tracking-widest mb-2">Historic Layers</p>
                                            <div className="flex flex-wrap gap-2">
                                                {[{ key: 'routes', label: 'Routes' }, { key: 'corridors', label: 'Corridors' }, { key: 'crossings', label: 'Crossings' }, { key: 'monuments', label: 'Monuments' }, { key: 'aim', label: 'AIM' }].map(({ key, label }) => (
                                                    <button key={key} onClick={() => setHistoricLayerVisibility(p => ({ ...p, [key]: !p[key as keyof typeof p] }))} className={`px-3 py-1.5 rounded-xl border text-[9px] font-black uppercase tracking-wider transition-all active:scale-95 ${historicLayerVisibility[key as keyof typeof historicLayerVisibility] ? 'bg-blue-500/20 border-blue-500/50 text-blue-300' : 'bg-white/5 border-white/10 text-slate-500'}`}>
                                                        {label}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                        {historicRoutes.length > 0 && (
                                            <div>
                                                <p className="text-[8px] font-black text-slate-500 uppercase tracking-widest mb-2">Routes Detected</p>
                                                {historicRoutes.filter(r => r.type === 'roman_road').length > 0 && (
                                                    <div className="flex items-center gap-3 py-2 border-b border-white/5">
                                                        <div className="w-8 h-[3px] bg-blue-500 rounded-full shrink-0" />
                                                        <span className="text-[10px] font-black text-white uppercase flex-1">Roman road</span>
                                                        <span className="text-[9px] text-blue-400 font-black">{historicRoutes.filter(r => r.type === 'roman_road').length} seg.</span>
                                                    </div>
                                                )}
                                                {historicRoutes.filter(r => r.type !== 'roman_road').length > 0 && (
                                                    <div className="flex items-center gap-3 py-2">
                                                        <div className="w-8 border-t-2 border-dashed border-blue-300 shrink-0" />
                                                        <span className="text-[10px] font-black text-white uppercase flex-1">Historic trackway</span>
                                                        <span className="text-[9px] text-blue-300 font-black">{historicRoutes.filter(r => r.type !== 'roman_road').length} seg.</span>
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                        {pasFinds.length > 0 && (
                                            <div>
                                                <p className="text-[8px] font-black text-slate-500 uppercase tracking-widest mb-2">Heritage Sites ({pasFinds.length})</p>
                                                <div className="space-y-0">
                                                    {pasFinds.slice(0, 5).map(f => (
                                                        <div key={f.id} className="flex items-center gap-3 py-2 border-b border-white/5 active:bg-white/5" onClick={() => { mapRef.current?.flyTo({ center: [f.lon, f.lat], zoom: 17 }); setHistoricStripExpanded(false); }}>
                                                            <div className="w-2 h-2 rounded-full bg-blue-400 shrink-0" />
                                                            <span className="text-[10px] font-bold text-slate-200 truncate flex-1">{f.objectType}</span>
                                                            <span className="text-[8px] text-slate-500 shrink-0">{f.broadperiod}</span>
                                                        </div>
                                                    ))}
                                                    {pasFinds.length > 5 && <p className="text-[8px] text-slate-500 text-center font-bold uppercase tracking-widest py-1.5">+{pasFinds.length - 5} more</p>}
                                                </div>
                                            </div>
                                        )}
                                        {placeSignals.length > 0 && (
                                            <div>
                                                <p className="text-[8px] font-black text-emerald-500 uppercase tracking-widest mb-2">Place Signals</p>
                                                {placeSignals.slice(0, 2).map((s, i) => (
                                                    <div key={i} className="flex items-center gap-2 py-1.5 border-b border-white/5">
                                                        <div className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />
                                                        <span className="text-[9px] font-bold text-slate-300 flex-1">"{s.name}"</span>
                                                        <span className="text-[8px] text-slate-500">{s.meaning}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                        <button onClick={() => { setIsIntelOpen(true); setHistoricStripExpanded(false); }} className="w-full py-2.5 bg-blue-500/10 border border-blue-500/30 text-blue-400 text-[9px] font-black uppercase tracking-widest rounded-xl active:bg-blue-500/20">
                                            Full Intel View
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                <div className="w-full flex items-center gap-2 px-3 py-2.5 bg-slate-950/90 backdrop-blur-xl rounded-2xl border border-blue-500/25 shadow-xl active:scale-[0.98] cursor-pointer" onClick={() => setHistoricStripExpanded(true)}>
                                    <div className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse shrink-0" />
                                    <span className="text-[9px] font-black text-blue-400 uppercase tracking-[0.15em] shrink-0">Historic</span>
                                    <span className="text-[9px] text-slate-400 truncate text-left flex-1 min-w-0">
                                        {loadingPAS ? 'Scanning...' : ([historicRoutes.filter(r => r.type === 'roman_road').length > 0 ? 'Roman road' : null, historicRoutes.filter(r => r.type !== 'roman_road').length > 0 ? 'Trackway' : null, pasFinds.length > 0 ? `${pasFinds.length} site${pasFinds.length !== 1 ? 's' : ''}` : null, placeSignals.length > 0 ? `"${placeSignals[0]?.name}"` : null].filter(Boolean).join(' · ') || 'No features found nearby')}
                                    </span>
                                    <button
                                        onClick={e => {
                                            e.stopPropagation();
                                            const allOn = Object.values(historicLayerVisibility).every(v => v);
                                            const next = !allOn;
                                            setHistoricLayerVisibility({ routes: next, corridors: next, crossings: next, monuments: next, aim: next });
                                        }}
                                        className={`flex items-center gap-1 px-2 py-1 rounded-lg border text-[8px] font-black uppercase tracking-wider transition-all active:scale-95 shrink-0 ${Object.values(historicLayerVisibility).every(v => v) ? 'bg-blue-500 border-blue-300 text-white shadow-[0_0_8px_rgba(59,130,246,0.4)]' : 'bg-white/5 border-white/10 text-slate-400'}`}
                                    >
                                        Overlays
                                    </button>
                                    <svg className="shrink-0 text-slate-500" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Mobile Site Intel HUD Overlay */}
                    {isIntelOpen && (
                        <div className="absolute inset-0 z-[105] lg:hidden bg-slate-950/80 backdrop-blur-2xl animate-in fade-in duration-500 flex flex-col">
                            <div className="p-4 pt-6 border-b border-white/5 flex justify-between items-center">
                                <div>
                                    <h2 className="text-xl font-black text-white uppercase tracking-tighter italic leading-none">Site Intelligence</h2>
                                    <p className="text-[10px] text-emerald-500 font-black uppercase tracking-[0.2em]">Regional Scan Profile</p>
                                </div>
                                <button onClick={() => setIsIntelOpen(false)} className="w-12 h-12 flex items-center justify-center bg-white/5 hover:bg-white/10 rounded-2xl border border-white/10 text-white transition-all active:scale-90">
                                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
                                </button>
                            </div>
                            <div className="flex-1 overflow-y-auto p-6 space-y-8 pb-24">
                                <div className="relative flex flex-col items-center justify-center py-6">
                                    <div className="relative w-48 h-48 flex items-center justify-center">
                                        <svg className="absolute inset-0 w-full h-full -rotate-90">
                                            <circle cx="96" cy="96" r="80" fill="none" stroke="currentColor" strokeWidth="2" className="text-white/5" />
                                            <circle cx="96" cy="96" r="80" fill="none" stroke="currentColor" strokeWidth="8" className={`${pasFinds.length > 0 ? 'text-red-500' : 'text-emerald-500'} shadow-[0_0_20px_rgba(239,68,68,0.5)] transition-all duration-1000`} strokeDasharray="502" strokeDashoffset={502 - (502 * (potentialScore?.score || 0)) / 100} strokeLinecap="round" />
                                        </svg>
                                        <div className="text-center">
                                            <span className="block text-6xl font-black text-white tracking-tighter leading-none">{potentialScore?.score || '0'}</span>
                                            <span className={`text-xs font-black uppercase tracking-widest mt-1 ${pasFinds.length > 0 ? 'text-red-400' : 'text-emerald-500'}`}>Potential Index</span>
                                        </div>
                                    </div>
                                </div>
                                {pasFinds.length > 0 && (
                                    <div className="space-y-4">
                                        <h3 className="text-[10px] font-black text-blue-400 uppercase tracking-[0.2em] flex items-center gap-2">
                                            <div className="w-1 h-3 bg-blue-500" /> Historic Period Profile
                                        </h3>
                                        <div className="grid grid-cols-2 gap-2">
                                            {Object.entries(pasFinds.reduce((acc, f) => { const p = f.broadperiod || "Unknown"; acc[p] = (acc[p] || 0) + 1; return acc; }, {} as Record<string, number>)).sort((a, b) => b[1] - a[1]).map(([period, count]) => (
                                                <div key={period} className="bg-blue-500/5 border border-blue-500/10 p-3 rounded-2xl flex justify-between items-center">
                                                    <span className="text-[9px] font-black text-slate-300 uppercase truncate pr-2">{period}</span>
                                                    <span className="text-sm font-black text-blue-400">{count}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                                <div className="grid grid-cols-2 gap-3">
                                    <div className="bg-white/5 p-4 rounded-3xl border border-white/10 relative">
                                        {scanConfidence && (
                                            <span className={`absolute top-2 right-2 text-[6px] font-black px-1 rounded border ${scanConfidence === 'High Probability' ? 'text-emerald-400 border-emerald-400/30' : scanConfidence === 'Developing Signal' ? 'text-amber-400 border-amber-400/30' : 'text-red-400 border-red-400/30'}`}>{scanConfidence}</span>
                                        )}
                                        <span className="block text-[8px] font-black text-slate-500 uppercase tracking-widest mb-1">Terrain Relief</span>
                                        <div className="h-1 bg-slate-800 rounded-full overflow-hidden my-1.5"><div className="h-full bg-emerald-500" style={{ width: `${potentialScore?.breakdown?.terrain || 0}%` }} /></div>
                                        <span className="text-lg font-black text-emerald-500">{potentialScore?.breakdown?.terrain || '0'}<span className="text-[10px] text-emerald-500/50 italic">%</span></span>
                                    </div>
                                    <div className="bg-white/5 p-4 rounded-3xl border border-white/10">
                                        <span className="block text-[8px] font-black text-slate-500 uppercase tracking-widest mb-1">Hydro Context</span>
                                        <div className="h-1 bg-slate-800 rounded-full overflow-hidden my-1.5"><div className="h-full bg-blue-500" style={{ width: `${potentialScore?.breakdown?.hydro || 0}%` }} /></div>
                                        <span className="text-lg font-black text-blue-500">{potentialScore?.breakdown?.hydro || '0'}<span className="text-[10px] text-blue-500/50 italic">%</span></span>
                                    </div>
                                    <div className="bg-white/5 p-4 rounded-3xl border border-white/10">
                                        <span className="block text-[8px] font-black text-slate-500 uppercase tracking-widest mb-1">Historic Density</span>
                                        <div className="h-1 bg-slate-800 rounded-full overflow-hidden my-1.5"><div className="h-full bg-amber-500" style={{ width: `${potentialScore?.breakdown?.historic || 0}%` }} /></div>
                                        <span className="text-lg font-black text-amber-500">{potentialScore?.breakdown?.historic || '0'}<span className="text-[10px] text-amber-500/50 italic">%</span></span>
                                    </div>
                                    <div className="bg-white/5 p-4 rounded-3xl border border-white/10">
                                        <span className="block text-[8px] font-black text-slate-500 uppercase tracking-widest mb-1">Spectral Signals</span>
                                        <div className="h-1 bg-slate-800 rounded-full overflow-hidden my-1.5"><div className="h-full bg-purple-500" style={{ width: `${potentialScore?.breakdown?.signals || 0}%` }} /></div>
                                        <span className="text-lg font-black text-purple-500">{potentialScore?.breakdown?.signals || '0'}<span className="text-[10px] text-purple-500/50 italic">%</span></span>
                                    </div>
                                </div>
                                {pasFinds.length > 0 && (
                                    <div className="space-y-4">
                                        <h3 className="text-[10px] font-black text-white uppercase tracking-[0.2em] flex items-center gap-2"><div className="w-1 h-3 bg-blue-500" /> Historic Findings</h3>
                                        <div className="space-y-2">
                                            {pasFinds.map(f => (
                                                <div key={f.id} onClick={() => { setSelectedPASFind(f); setIsIntelOpen(false); mapRef.current?.flyTo({ center: [f.lon, f.lat], zoom: 17 }); }} className="bg-blue-500/5 p-4 rounded-2xl border border-blue-500/10 flex justify-between items-center active:bg-blue-500/20 transition-all">
                                                    <div className="flex-1 min-w-0 pr-4">
                                                        <p className="text-xs font-black text-white uppercase truncate">{f.objectType}</p>
                                                        <p className="text-[9px] font-bold text-blue-400 uppercase">{f.broadperiod}</p>
                                                    </div>
                                                    <div className="text-right shrink-0">
                                                        <p className="text-[9px] font-black text-slate-500 font-mono tracking-tighter mb-0.5">{f.id}</p>
                                                        <p className="text-[8px] font-bold text-slate-400 uppercase italic leading-none">{f.county}</p>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                                {placeSignals.length > 0 && (
                                    <div className="space-y-4">
                                        <h3 className="text-[10px] font-black text-emerald-500 uppercase tracking-[0.2em] flex items-center gap-2"><div className="w-1 h-3 bg-emerald-500" /> Etymological Signals</h3>
                                        <div className="space-y-2">
                                            {placeSignals.map((s, i) => (
                                                <div key={i} className="bg-emerald-500/5 border border-emerald-500/10 p-4 rounded-2xl relative overflow-hidden group">
                                                    <div className="absolute top-0 right-0 px-2 py-0.5 bg-emerald-500/10 border-b border-l border-emerald-500/20 text-[7px] font-black text-emerald-400 uppercase tracking-tighter">Signal Detected</div>
                                                    <div className="flex justify-between items-start mb-1">
                                                        <span className="text-sm font-black text-white uppercase italic tracking-tight">"{s.name}"</span>
                                                        <span className="text-[9px] font-bold text-emerald-500/60 uppercase">{s.distance.toFixed(1)} km</span>
                                                    </div>
                                                    <p className="text-[8px] font-black text-emerald-500/40 uppercase mb-2 tracking-widest">{s.type}</p>
                                                    <p className="text-[10px] font-bold text-slate-300 leading-tight"><span className="text-emerald-500/80 uppercase text-[9px]">Meaning:</span> {s.meaning}</p>
                                                    <div className="mt-2.5 flex items-center justify-between border-t border-white/5 pt-2">
                                                        <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest bg-white/5 px-1.5 py-0.5 rounded">{s.period}</span>
                                                        <div className="flex items-center gap-1.5">
                                                            <div className="w-10 h-1 bg-black/40 rounded-full overflow-hidden"><div className="h-full bg-emerald-500" style={{ width: `${s.confidence * 100}%` }} /></div>
                                                            <span className="text-[7px] font-black text-emerald-500/60">{(s.confidence * 100).toFixed(0)}%</span>
                                                        </div>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                            <div className="p-4 pb-8 bg-black/40 border-t border-white/5">
                                <p className="text-center text-[8px] font-black text-slate-500 uppercase tracking-[0.3em] italic animate-pulse">Scanning Spectral Data... [Consensus v12.8]</p>
                            </div>
                        </div>
                    )}
                </div>

                {/* Sidebar */}
                <div className="w-80 hidden lg:flex flex-col bg-slate-900/80 backdrop-blur-xl border-l border-white/5 shrink-0 relative z-50 overflow-y-auto scrollbar-hide">

                    {/* Archaeological Potential Section */}
                    <div className="p-6 border-b border-white/10 bg-emerald-500/5">
                        <div className="flex justify-between items-center mb-4">
                            <h2 className="text-[10px] font-black text-emerald-500 uppercase tracking-[0.2em]">Archaeological Potential</h2>
                            {potentialScore && (
                                <span className="text-[10px] font-black text-white bg-emerald-500 px-2 py-0.5 rounded-full shadow-[0_0_10px_rgba(16,185,129,0.4)]">{potentialScore.score}%</span>
                            )}
                        </div>
                        {potentialScore ? (
                            <div className="space-y-3">
                                <div className="relative h-2 bg-black/40 rounded-full overflow-hidden">
                                    <div className="absolute inset-y-0 left-0 bg-emerald-500 shadow-[0_0_15px_rgba(16,185,129,0.6)] transition-all duration-1000" style={{ width: `${potentialScore.score}%` }} />
                                </div>
                                <div className="space-y-1.5">
                                    {potentialScore.reasons.map((reason, i) => (
                                        <div key={i} className="flex items-start gap-2">
                                            <span className="text-emerald-500 mt-0.5 font-bold text-[10px]">✓</span>
                                            <p className="text-[10px] font-bold text-slate-300 leading-tight">{reason}</p>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ) : (
                            <p className="text-[10px] text-slate-500 font-bold uppercase italic leading-tight">Perform a scan to calculate site potential.</p>
                        )}
                    </div>

                    {/* Historic Site Intelligence Section - Desktop Only */}
                    <div className="hidden lg:block p-6 border-b border-white/10 bg-blue-500/5">
                        <div className="flex justify-between items-baseline mb-4">
                            <h2 className="text-[10px] font-black text-blue-400 uppercase tracking-[0.2em]">Historic Site Intelligence</h2>
                            <button
                                onClick={() => { clearScan(); setHistoricMode(true); }}
                                disabled={loadingPAS}
                                className={`text-[9px] font-black uppercase tracking-widest px-2 py-1 rounded border transition-all ${loadingPAS ? 'bg-slate-800 text-slate-500 border-white/5' : historicMode ? 'bg-amber-500 text-black border-amber-300' : 'bg-blue-500/10 text-blue-400 border-blue-500/30 hover:bg-blue-500 hover:text-white'}`}
                            >
                                {loadingPAS ? 'SYNCING...' : historicMode ? 'ACTIVE' : 'SCAN AREA'}
                            </button>
                        </div>
                        {pasFinds.length > 0 ? (
                            <div className="space-y-3">
                                <p className="text-[9px] font-black text-blue-400/60 uppercase tracking-widest mb-2">{pasFinds.length} Recorded Finds Nearby</p>
                                <div className="space-y-2 max-h-[400px] overflow-y-auto pr-2 scrollbar-hide">
                                    {pasFinds.map(f => (
                                        <div key={f.id} onClick={() => { setSelectedPASFind(f); mapRef.current?.flyTo({ center: [f.lon, f.lat], zoom: 17 }); }} className="bg-black/30 p-2.5 rounded-xl border border-blue-500/10 hover:border-blue-500/30 transition-all cursor-crosshair">
                                            <div className="flex justify-between items-start mb-1">
                                                <span className="text-[10px] font-black text-white truncate pr-2 uppercase">{f.objectType}</span>
                                                <span className="text-[8px] font-bold text-blue-400 shrink-0">{f.broadperiod}</span>
                                            </div>
                                            <div className="flex justify-between items-center">
                                                <span className="text-[8px] font-black text-slate-500 tracking-tighter font-mono">{f.id}</span>
                                                <span className="text-[8px] font-bold text-slate-400">{f.county}</span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ) : (
                            <p className="text-[10px] text-slate-500 font-bold uppercase italic leading-tight">No historic records loaded. Click scan to fetch data.</p>
                        )}
                    </div>

                    <div className="p-6 border-b border-white/5 shrink-0 overflow-y-auto max-h-[40%] scrollbar-hide">
                        <div className="flex justify-between items-baseline mb-4">
                            <h2 className="text-sm font-black text-white uppercase tracking-tighter">Strategic Hotspots</h2>
                            {selectedHotspotId && <button onClick={() => dispatch({ type: 'SET_SELECTED_HOTSPOT', id: null })} className="text-[9px] font-black text-emerald-500 hover:underline tracking-widest uppercase">Clear View</button>}
                        </div>
                        <div className="flex flex-col gap-4">
                            {hotspots.length > 0 ? hotspots.map(h => (
                                <div
                                    key={h.id}
                                    onClick={() => {
                                        dispatch({ type: 'SET_SHOW_SUGGESTION', value: false });
                                        dispatch({ type: 'SET_SELECTED_HOTSPOT', id: h.id });
                                        mapRef.current?.fitBounds(h.bounds as maplibregl.LngLatBoundsLike, { padding: 40 });
                                    }}
                                    className={`p-4 rounded-2xl border-2 cursor-pointer transition-all active:scale-[0.98] ${selectedHotspotId === h.id ? 'bg-white/10 border-white ring-4 ring-white/10' : h.score >= 80 ? 'bg-slate-900/40 border-amber-500/30 hover:border-amber-500/60 shadow-[0_0_15px_rgba(245,158,11,0.05)]' : h.score >= 45 ? 'bg-slate-900/40 border-emerald-500/30 hover:border-emerald-500/60' : 'bg-slate-900/40 border-white/10 hover:border-white/20'}`}
                                >
                                    <div className="flex justify-between items-start mb-3">
                                        <div>
                                            <h3 className={`text-xs font-black uppercase tracking-tight ${selectedHotspotId === h.id ? 'text-white' : 'text-slate-200'}`}>Hotspot</h3>
                                            <p className="text-[9px] font-black text-emerald-400 uppercase tracking-wide mt-0.5">{h.type}</p>
                                            <p className="text-[8px] text-slate-500 italic leading-tight mt-0.5">{HOTSPOT_INTERPRETATION[h.type]}</p>
                                        </div>
                                        <div className="flex flex-col items-end gap-1">
                                            <div className="flex items-center gap-2">
                                                {showSuggestion && h.number === 1 && <span className="text-[7px] font-black text-emerald-400 animate-pulse tracking-widest">DETECT HERE</span>}
                                                <span className="text-[10px] font-black text-emerald-500 tracking-tight">{h.score}%</span>
                                            </div>
                                            <div className={`px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-widest ${h.confidence === 'High Probability' ? 'bg-amber-500 text-black shadow-[0_0_10px_rgba(245,158,11,0.5)]' : h.confidence === 'Strong Signal' ? 'bg-emerald-600 text-white' : 'bg-slate-700 text-slate-300'}`}>{h.confidence}</div>
                                        </div>
                                    </div>
                                    {h.isHighConfidenceCrossing && (
                                        <div className="bg-blue-600/40 p-1.5 rounded-xl border border-blue-400 mb-3 animate-pulse">
                                            <p className="m-0 text-[9px] font-black uppercase text-white text-center tracking-widest">🌊 Likely historic crossing point</p>
                                        </div>
                                    )}
                                    <div className="space-y-1.5 mt-3">
                                        {h.explanation.map((reason, idx) => (
                                            <div key={idx} className="flex items-center gap-2">
                                                <div className="w-1 h-1 rounded-full bg-emerald-500 shrink-0" />
                                                <p className="text-[10px] font-bold text-slate-300 leading-tight">{reason}</p>
                                            </div>
                                        ))}
                                    </div>
                                    <p className="text-center text-[7px] text-white italic mt-3">Highlights historic activity — not guaranteed finds.</p>
                                </div>
                            )) : (
                                <p className="text-[10px] text-slate-500 font-bold uppercase italic text-center py-4">No tactical hotspots defined.</p>
                            )}
                        </div>
                    </div>

                    <div className="p-6 border-b border-white/5 flex justify-between items-center shrink-0">
                        <div>
                            <h2 className="text-sm font-black text-white uppercase tracking-tighter">Site Report</h2>
                            <p className="text-[10px] text-slate-500 font-bold uppercase">{detectedFeatures.length} Signals Locked</p>
                        </div>
                        {selectedId && <button onClick={() => dispatch({ type: 'SET_SELECTED_FEATURE', id: null })} className="text-[10px] font-black text-emerald-500 hover:underline tracking-widest uppercase">Reset</button>}
                    </div>

                    <div ref={scrollRef} className="flex-1 overflow-y-auto p-5 scrollbar-hide space-y-4">
                        {detectedFeatures.map((f) => (
                            <div
                                key={f.id}
                                id={`card-${f.id}`}
                                onClick={() => { dispatch({ type: 'SET_SELECTED_FEATURE', id: f.id }); mapRef.current?.flyTo({ center: f.center, zoom: 17 }); }}
                                className={`p-5 rounded-2xl cursor-pointer transition-all border ${selectedId === f.id ? (f.sources.length >= 3 ? 'bg-amber-600 border-white shadow-[0_0_25px_rgba(217,119,6,0.6)]' : f.sources.includes('hydrology') ? 'bg-blue-600 border-white shadow-[0_0_25px_rgba(37,99,235,0.5)]' : f.source === 'terrain' ? 'bg-emerald-500 border-white shadow-[0_0_25px_rgba(16,185,129,0.5)]' : f.source === 'historic' ? 'bg-slate-700 border-white shadow-[0_0_25px_rgba(255,255,255,0.2)]' : 'bg-sky-500 border-white shadow-[0_0_25px_rgba(59,130,246,0.5)]') : 'bg-white/5 border-white/5 hover:bg-white/10'}`}
                            >
                                <div className="flex justify-between items-center mb-3">
                                    <div className="w-8 h-8 bg-black/20 rounded-lg flex items-center justify-center text-xs font-black text-white">{f.number}</div>
                                    <div className="flex flex-col gap-0.5 items-end">
                                        {[{ ids: ['terrain', 'terrain_global'], label: 'Lidar' }, { ids: ['slope'], label: 'Slope / LRM' }, { ids: ['hydrology'], label: 'Hydrology' }, { ids: ['satellite', 'satellite_spring', 'satellite_summer'], label: 'Aerial' }, { ids: ['historic'], label: 'Historic' }].map(s => (
                                            <div key={s.label} className="flex items-center gap-1.5">
                                                <span className={`text-[7px] font-black uppercase tracking-tighter ${s.ids.some(id => f.sources.includes(id as Cluster['source'])) ? 'text-white' : 'text-white/20'}`}>{s.label}</span>
                                                <div className={`w-1.5 h-1.5 rounded-full ${s.ids.some(id => f.sources.includes(id as Cluster['source'])) ? 'bg-emerald-400 shadow-[0_0_5px_rgba(52,211,153,0.5)]' : 'bg-black/40'}`} />
                                            </div>
                                        ))}
                                    </div>
                                </div>
                                <h3 className={`text-sm font-black uppercase tracking-tight mb-1 ${selectedId === f.id ? 'text-white' : 'text-slate-200'}`}>{f.type}</h3>
                                {f.contextLabel && (<div className="mt-1 mb-2 px-2 py-1 bg-emerald-500/10 border border-emerald-500/20 rounded-lg"><p className="m-0 text-[8px] font-black uppercase text-emerald-400">Context: {f.contextLabel}</p></div>)}
                                {f.disturbanceRisk && f.disturbanceRisk !== 'Low' && (
                                    <div className={`mt-1 mb-2 px-2 py-1 rounded-lg border ${f.disturbanceRisk === 'High' ? 'bg-red-500/10 border-red-500/20' : 'bg-amber-500/10 border-amber-500/20'}`}>
                                        <p className={`m-0 text-[8px] font-black uppercase ${f.disturbanceRisk === 'High' ? 'text-red-400' : 'text-amber-400'}`}>Risk: {f.disturbanceRisk} ({f.disturbanceReason})</p>
                                    </div>
                                )}
                                {f.aimInfo && (<div className="mt-1 mb-2 px-2 py-1 bg-amber-500/10 border border-amber-500/20 rounded-lg"><p className="m-0 text-[8px] font-black uppercase text-amber-400">Verified: {f.aimInfo.type}</p><p className="m-0 text-[8px] font-bold text-amber-200/70">{f.aimInfo.period}</p></div>)}
                                {f.isHighConfidenceCrossing && (<div className="bg-blue-600/40 p-2 rounded-xl border border-blue-400 mb-2 animate-pulse"><p className="m-0 text-[9px] font-black uppercase text-white text-center tracking-widest">🌊 Likely historic crossing point</p></div>)}
                                {f.explanationLines && f.explanationLines.length > 0 && (
                                    <div className="mt-2 mb-3 space-y-1 bg-black/20 p-2 rounded-xl border border-white/5">
                                        {f.explanationLines.map((line, idx) => (<div key={idx} className="flex items-center gap-1.5"><div className="w-1 h-1 rounded-full bg-emerald-400 shrink-0" /><p className="text-[9px] font-bold text-emerald-100/80 leading-tight uppercase italic">{line}</p></div>))}
                                    </div>
                                )}
                                <div className="flex justify-between items-center mt-2">
                                    <span className={`text-[10px] font-bold uppercase ${selectedId === f.id ? 'text-white/80' : 'text-slate-500'}`}>Persistence:</span>
                                    <div className="flex items-center gap-1.5">
                                        {f.rescanCount && f.rescanCount > 1 && (<span className="text-[7px] font-black bg-emerald-500/20 text-emerald-400 px-1 rounded border border-emerald-500/30">LOCKED x{f.rescanCount}</span>)}
                                        <span className={`text-[10px] font-black ${(f.persistenceScore || 0) > 70 ? 'text-emerald-400' : (f.persistenceScore || 0) > 40 ? 'text-amber-400' : 'text-slate-400'}`}>
                                            {(f.persistenceScore || 0) > 70 ? 'High' : (f.persistenceScore || 0) > 40 ? 'Medium' : 'Low'}
                                        </span>
                                    </div>
                                </div>
                                <div className="flex justify-between items-center mt-0.5">
                                    <span className={`text-[10px] font-bold uppercase ${selectedId === f.id ? 'text-white/80' : 'text-slate-500'}`}>Confidence:</span>
                                    <span className={`text-[10px] font-black ${selectedId === f.id ? 'text-white' : (f.sources.length >= 3 ? 'text-amber-400' : f.source === 'terrain' ? 'text-emerald-400' : 'text-sky-400')}`}>Confidence: {f.confidence}</span>
                                </div>
                                {f.isProtected && <div className="mt-3 p-2 bg-white/20 rounded-lg text-[8px] font-black text-white uppercase tracking-widest text-center">⚠️ Protected Monument</div>}
                                <p className="text-center text-[7px] text-white italic mt-3">Highlights historic activity — not guaranteed finds.</p>
                            </div>
                        ))}
                    </div>

                    <div className="h-24 bg-black/40 border-t border-white/5 p-4 overflow-y-auto shrink-0" ref={logContainerRef}>
                        <div className="font-mono text-[9px] text-emerald-500/70 leading-relaxed uppercase tracking-tighter">
                            {systemLog.map((l, i) => <div key={i} className="mb-1">{l}</div>)}
                        </div>
                    </div>
                </div>
            </div>

            {/* Heritage Feature Card Modal */}
            {selectedPASFind && (
                <div className="absolute inset-0 z-[200] flex items-center justify-center p-4 bg-black/60 backdrop-blur-md animate-in fade-in duration-300">
                    <div className="bg-slate-900 border border-emerald-500/30 w-full max-w-sm rounded-3xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-300">
                        <div className="relative h-32 bg-emerald-600/20 flex items-center justify-center border-b border-white/5">
                            <div className="absolute top-4 right-4">
                                <button onClick={() => setSelectedPASFind(null)} className="p-2 bg-black/40 hover:bg-black/60 rounded-full text-white transition-all border border-white/10">
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="18" x2="18" y2="6"></line></svg>
                                </button>
                            </div>
                            <div className="flex flex-col items-center">
                                <div className="w-12 h-12 bg-emerald-500 rounded-2xl flex items-center justify-center shadow-[0_0_20px_rgba(16,185,129,0.5)] mb-2">
                                    <span className="text-xl font-black text-white italic">H</span>
                                </div>
                                <span className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-400">Heritage Feature</span>
                            </div>
                        </div>
                        <div className="p-6 space-y-6">
                            <div className="space-y-1">
                                <h3 className="text-xl font-black text-white uppercase tracking-tight">{selectedPASFind.objectType}</h3>
                                <div className="flex items-center gap-2">
                                    <span className="px-2 py-0.5 bg-emerald-500/10 border border-emerald-500/20 rounded text-[9px] font-black text-emerald-400 uppercase tracking-widest">{selectedPASFind.broadperiod}</span>
                                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest font-mono">{selectedPASFind.id}</span>
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div className="bg-black/40 p-3 rounded-2xl border border-white/5"><span className="block text-[8px] font-black text-slate-500 uppercase tracking-widest mb-1">Source</span><span className="text-[10px] font-black text-white uppercase italic">OSM Heritage</span></div>
                                <div className="bg-black/40 p-3 rounded-2xl border border-white/5"><span className="block text-[8px] font-black text-slate-500 uppercase tracking-widest mb-1">Status</span><span className="text-[10px] font-black text-white uppercase italic">Standing Remains</span></div>
                            </div>
                            <div className="bg-emerald-500/5 p-4 rounded-2xl border border-emerald-500/10 space-y-2">
                                <div className="flex items-center gap-2">
                                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                                    <p className="text-[11px] font-bold text-slate-300 leading-tight">High-precision coordinates from the OpenStreetMap community heritage dataset.</p>
                                </div>
                            </div>
                            <a
                                href={`https://www.openstreetmap.org/${selectedPASFind.osmType || 'node'}/${selectedPASFind.internalId}`}
                                target="_blank" rel="noreferrer"
                                className="flex items-center justify-center gap-2 w-full py-4 bg-emerald-600 hover:bg-emerald-500 text-white rounded-2xl text-xs font-black uppercase tracking-widest transition-all shadow-lg shadow-emerald-600/20 active:scale-[0.98]"
                            >
                                View on OpenStreetMap
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
                            </a>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
