import React, { useState, useReducer, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { useFieldGuideMap } from '../hooks/useFieldGuideMap';
import { useTerrainScan, ScanContext } from '../hooks/useTerrainScan';
import { useHistoricScan } from '../hooks/useHistoricScan';
import { useTilePrewarm } from '../hooks/useTilePrewarm';

import {
    Cluster, HistoricFind, PlaceSignal, HistoricRoute, Hotspot,
    HotspotClassification, HOTSPOT_INTERPRETATION,
} from './fieldGuideTypes';
import { usePotentialScore } from '../hooks/usePotentialScore';
import { SCAN_CONFIG } from '../utils/scanConfig';
import { LogEntry, LogSource, LogLevel, makeLog } from '../utils/scanLogger';
import { buildInterpretation, getInterpretationLabel, getHotspotSignalStrength, getHotspotHook, HotspotSignalStrength } from '../utils/hotspotInterpreter';
import { buildTargetInterpretation, TargetSignalStrength } from '../utils/targetInterpreter';

// ─── Hotspot display helpers ──────────────────────────────────────────────────

// Potential tier: externally-visible label replacing raw numeric score.
// Keeps the internal 0–96 range intact; only the presentation changes.
function getPotentialTier(score: number): string {
    if (score > 80) return 'High Potential';
    if (score > 60) return 'Strong Potential';
    if (score > 35) return 'Moderate Potential';
    return 'Low Potential';
}

// Short form for space-constrained elements (tray buttons etc.)
function getPotentialTierShort(score: number): string {
    if (score > 80) return 'HIGH';
    if (score > 60) return 'STRG';
    if (score > 35) return 'MOD';
    return 'LOW';
}

// Human-readable titles that replace engine classification labels in the UI.
// The underlying classification value is preserved for all logic — only the
// display string changes, so nothing breaks if we adjust these later.
const HOTSPOT_TITLES: Record<HotspotClassification, string> = {
    'Crossing Point Candidate':    'Crossing Point',
    'Junction / Convergence Zone': 'Route Junction',
    'Settlement Edge Candidate':   'Settlement Edge',
    'Wetland Margin Activity Zone':'Wetland Margin',
    'Route-Side Activity Zone':    'Movement Corridor',
    'Terrain Structure Candidate': 'Structural Feature',
    'Spectral Activity Candidate': 'Cropmark Signal',
    'Lowland Activity Zone':       'Lowland Activity Zone',
    'Raised Activity Area':        'Raised Activity Area',
    'Route-Influenced Area':       'Route-Influenced Area',
    'Cropmark Activity Zone':      'Cropmark Activity Zone',
    'Multi-Signal Activity Zone':  'Multi-Signal Activity Zone',
    'General Activity Zone':       'Supporting Activity Zone',
};

// ─── Engine state (reducer) ───────────────────────────────────────────────────

type ScanPhase    = 'idle' | 'terrain' | 'historic' | 'complete';
type HotspotVersion = 'terrain' | 'enhanced' | null;

interface EngineState {
    analyzing:        boolean;
    scanPhase:        ScanPhase;
    hotspotVersion:   HotspotVersion;
    terrainClusters:  Cluster[];
    detectedFeatures: Cluster[];
    hotspots:         Hotspot[];
    hasScanned:       boolean;
    heritageCount:    number;
    monumentPoints:   [number, number][];
    historicRoutes:   HistoricRoute[];
}

type EngineAction =
    | { type: 'SCAN_START' }
    | { type: 'SCAN_SUCCESS'; features: Cluster[]; hotspots: Hotspot[]; monumentPoints: [number, number][]; routes: HistoricRoute[]; heritageCount: number }
    | { type: 'SCAN_FAIL' }
    | { type: 'HISTORIC_ENHANCE'; hotspots: Hotspot[] }
    | { type: 'SET_HAS_SCANNED' }
    | { type: 'CLEAR_SCAN' };

const initialEngineState: EngineState = {
    analyzing:        false,
    scanPhase:        'idle',
    hotspotVersion:   null,
    terrainClusters:  [],
    detectedFeatures: [],
    hotspots:         [],
    hasScanned:       false,
    heritageCount:    0,
    monumentPoints:   [],
    historicRoutes:   [],
};

function engineReducer(state: EngineState, action: EngineAction): EngineState {
    switch (action.type) {
        case 'SCAN_START':
            return { ...state, analyzing: true, scanPhase: 'terrain', hotspotVersion: null, terrainClusters: [] };
        case 'SCAN_SUCCESS':
            return {
                ...state, analyzing: false, scanPhase: 'terrain', hotspotVersion: 'terrain',
                terrainClusters: action.features, detectedFeatures: action.features, hotspots: action.hotspots,
                monumentPoints: action.monumentPoints, historicRoutes: action.routes, heritageCount: action.heritageCount,
            };
        case 'SCAN_FAIL':
            return { ...state, analyzing: false, scanPhase: 'idle' };
        case 'HISTORIC_ENHANCE':
            return { ...state, scanPhase: 'complete', hotspotVersion: 'enhanced', hotspots: action.hotspots };
        case 'SET_HAS_SCANNED':
            return { ...state, hasScanned: true };
        case 'CLEAR_SCAN':
            return { ...initialEngineState };
        default:
            return state;
    }
}

// ─── Hotspot display helpers ──────────────────────────────────────────────────

// Returns a short signal descriptor shown beneath "General Activity Zone" so
// the fallback classification still communicates something meaningful.
function getSupportingSignal(explanation: string[]): string | null {
    if (explanation.some(e => e.includes('Hydrology') && e.includes('LiDAR'))) return 'Terrain + Hydrology';
    if (explanation.some(e => e.includes('Hydrology'))) return 'Hydrology Signal';
    if (explanation.some(e => e.includes('LiDAR'))) return 'Terrain Signal';
    if (explanation.some(e => e.includes('Spectral'))) return 'Spectral Signal';
    return null;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function FieldGuide({ projectId }: { projectId: string }) {
    // Engine state
    const [engineState, dispatch] = useReducer(engineReducer, initialEngineState);
    const {
        analyzing, hotspotVersion, terrainClusters,
        detectedFeatures, hotspots, hasScanned,
        heritageCount, monumentPoints, historicRoutes,
    } = engineState;

    // UI state
    const [selectedId,             setSelectedId]             = useState<string | null>(null);
    const [selectedHotspotId,      setSelectedHotspotId]      = useState<string | null>(null);
    const [showSuggestion,         setShowSuggestion]         = useState(false);
    const [scanStatus,             setScanStatus]             = useState('');
    const [systemLog,              setSystemLog]              = useState<LogEntry[]>([makeLog('SYSTEM READY. Execute Scan.')]);
    const [zoomWarning,            setZoomWarning]            = useState(false);
    const [isSatellite,            setIsSatellite]            = useState(false);
    const [searchQuery,            setSearchQuery]            = useState('');
    const [isSearchOpen,           setIsSearchOpen]           = useState(false);
    const [isIntelOpen,            setIsIntelOpen]            = useState(false);
    const [targetPeriod,           setTargetPeriod]           = useState<'All' | 'Bronze Age' | 'Roman' | 'Medieval'>('All');
    const [isLocating,             setIsLocating]             = useState(false);
    const [historicMode,           setHistoricMode]           = useState(false);
    const [historicStripExpanded,  setHistoricStripExpanded]  = useState(false);
    const [historicLayerToggles,   setHistoricLayerToggles]   = useState({ lidar: false, os1930: false, os1880: false });
    const [historicLayerVisibility, setHistoricLayerVisibility] = useState({ routes: true, corridors: true, crossings: true, monuments: true, aim: true });
    const [mapClickLabel,          setMapClickLabel]          = useState<string | null>(null);
    const [expandedInterpretationId, setExpandedInterpretationId] = useState<string | null>(null);
    const [expandedTargetId,         setExpandedTargetId]         = useState<string | null>(null);
    const [showPermissionPicker,   setShowPermissionPicker]   = useState(false);

    // PAS / intel state
    const [pasFinds,        setPasFinds]        = useState<HistoricFind[]>([]);
    const [selectedPASFind, setSelectedPASFind] = useState<HistoricFind | null>(null);
    const [placeSignals,    setPlaceSignals]    = useState<PlaceSignal[]>([]);

    // Terrain scan centre — for drift guard in historic phase
    const terrainScanCenterRef = useRef<{ lat: number; lng: number } | null>(null);

    // User location marker (shown after GPS button press, persists for session)
    const userLocationMarkerRef = useRef<maplibregl.Marker | null>(null);

    // Scoring hook
    const { potentialScore, scanConfidence, setPotentialScore, setScanConfidence, calculatePotentialScore } = usePotentialScore();

    const nav = useNavigate();

    const permissions = useLiveQuery(() => db.permissions.where('projectId').equals(projectId).toArray()) || [];
    const realPermissions = permissions.filter(p => !p.isDefault);
    const fields      = useLiveQuery(() => db.fields.where('projectId').equals(projectId).toArray()) || [];
    const activeSession = useLiveQuery(async () => {
        const sessions = await db.sessions.where('projectId').equals(projectId).filter(s => !s.isFinished).toArray();
        return sessions.length > 0 ? sessions.sort((a, b) => b.date.localeCompare(a.date))[0] : null;
    }, [projectId]);

    function handleStartSession() {
        if (activeSession) { nav(`/session/${activeSession.id}`); return; }
        if (realPermissions.length === 0) { nav('/permission'); return; }
        if (realPermissions.length === 1) { nav(`/session/new?permissionId=${realPermissions[0].id}`); return; }
        setShowPermissionPicker(p => !p);
    }

    const [searchParams, setSearchParams] = useSearchParams();
    const initLat = parseFloat(searchParams.get('lat') ?? '');
    const initLng = parseFloat(searchParams.get('lng') ?? '');

    // Clear lat/lng from the URL after the map uses them
    useEffect(() => {
        if (!isNaN(initLat) && !isNaN(initLng)) setSearchParams({}, { replace: true });
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // ─── Logging ─────────────────────────────────────────────────────────────

    const addLog = useCallback((msg: string, source?: LogSource, level?: LogLevel) => {
        setSystemLog(prev => [...prev, makeLog(msg, source, level)]);
    }, []);

    const logContainerRef = useRef<HTMLDivElement>(null);
    const scrollRef       = useRef<HTMLDivElement>(null);

    useLayoutEffect(() => {
        if (logContainerRef.current) logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }, [systemLog]);

    // ─── Scan hooks ───────────────────────────────────────────────────────────

    const { runTerrainScan, cancelTerrain, isTerrainScanning } = useTerrainScan({
        onLog:          addLog,
        onStatusChange: setScanStatus,
    });

    const { runHistoricScan, cancelHistoric, isHistoricScanning } = useHistoricScan({
        onLog:          addLog,
        onStatusChange: setScanStatus,
    });

    // ─── Map ─────────────────────────────────────────────────────────────────

    const { mapContainerRef, mapRef, clearMapSources } = useFieldGuideMap({
        hotspots, selectedHotspotId, detectedFeatures, pasFinds, historicRoutes,
        isSatellite, historicMode, historicLayerVisibility, historicLayerToggles,
        initLat, initLng,
        callbacks: {
            onFeatureClick:  (id)  => { setSelectedHotspotId(null); setSelectedId(id); },
            onHotspotClick:  (id)  => { setShowSuggestion(false); setSelectedHotspotId(id); },
            onDeselect:      ()    => { setShowSuggestion(false); setSelectedHotspotId(null); setSelectedId(null); },
            onDragStart:     ()    => setShowSuggestion(false),
            onZoomChange:    (z)   => setZoomWarning(z > SCAN_CONFIG.ZOOM_WARNING),
            onSetClickLabel: (l)   => setMapClickLabel(l),
            onPASFindLog:    (msg) => addLog(msg, 'historic'),
            onPASFindSelect: (f)   => setSelectedPASFind(f),
            onCrossingsLog:  (msg) => addLog(msg, 'historic'),
        },
    });

    useTilePrewarm(mapRef);

    // ─── Clear / Reset ────────────────────────────────────────────────────────

    const clearScan = useCallback(() => {
        cancelTerrain();
        cancelHistoric();
        dispatch({ type: 'CLEAR_SCAN' });
        setSelectedId(null);
        setSelectedHotspotId(null);
        setShowSuggestion(false);
        setShowPermissionPicker(false);
        setScanStatus('');
        setSystemLog([makeLog('SYSTEM CLEARED. Ready for new scan.')]);
        setPasFinds([]);
        setPlaceSignals([]);
        setPotentialScore(null);
        setScanConfidence(null);
        setHistoricMode(false);
        setHistoricStripExpanded(false);
        setHistoricLayerToggles({ lidar: false, os1930: false, os1880: false });
        setHistoricLayerVisibility({ routes: true, corridors: true, crossings: true, monuments: true, aim: true });
        setMapClickLabel(null);
        terrainScanCenterRef.current = null;
        clearMapSources();
    }, [cancelTerrain, cancelHistoric, clearMapSources, setPotentialScore, setScanConfidence]);

    // ─── Map source helpers ───────────────────────────────────────────────────

    const applyNhleToMap = (data: { features: unknown[] }) => {
        const src = mapRef.current?.getSource('monuments') as maplibregl.GeoJSONSource | undefined;
        if (src) src.setData(data as unknown as GeoJSON.FeatureCollection);
    };

    const applyAimToMap = (data: { features: unknown[] }) => {
        if (!data.features?.length) return;
        const src = mapRef.current?.getSource('aim-monuments') as maplibregl.GeoJSONSource | undefined;
        if (src) src.setData(data as unknown as GeoJSON.FeatureCollection);
    };

    // ─── Historic phase (shared by auto-trigger and standalone) ──────────────

    const runHistoricPhase = useCallback(async (context: ScanContext) => {
        const result = await runHistoricScan({
            mapRef,
            ...context,
            permissions,
            fields,
            targetPeriod,
        });

        if (!result) return;

        // If fresh NHLE/AIM data was fetched (standalone mode), push to map
        if (result.nhleData) applyNhleToMap(result.nhleData);
        if (result.aimData)  applyAimToMap(result.aimData);

        setPasFinds(result.pasFinds);
        setPlaceSignals(result.placeSignals);
        calculatePotentialScore(result.pasFinds, result.monumentPoints, result.placeSignals, result.center.lat, result.center.lng);

        if (!result.drifted && result.enhancedHotspots.length > 0) {
            setSelectedHotspotId(null);   // dismiss the terrain-phase selection; user chooses from enhanced list
            setShowSuggestion(false);
            dispatch({ type: 'HISTORIC_ENHANCE', hotspots: result.enhancedHotspots });
        }
    }, [runHistoricScan, permissions, fields, targetPeriod, calculatePotentialScore]); // eslint-disable-line react-hooks/exhaustive-deps

    // ─── Main terrain scan ────────────────────────────────────────────────────

    const executeScan = async () => {
        if (!mapRef.current || analyzing) return;

        clearScan();
        dispatch({ type: 'SCAN_START' });
        addLog('> Engine Initiating (Fixed Z16)...', 'terrain');

        const result = await runTerrainScan({ mapRef, permissions, fields, targetPeriod });

        if (!result) {
            dispatch({ type: 'SCAN_FAIL' });
            return;
        }

        // Push NHLE and AIM data to map sources
        applyNhleToMap(result.nhleData);
        applyAimToMap(result.aimData);

        dispatch({
            type: 'SCAN_SUCCESS',
            features:       result.detectedFeatures,
            hotspots:       result.hotspots,
            monumentPoints: result.monumentPoints,
            routes:         result.routes,
            heritageCount:  result.heritageCount,
        });

        // First-scan auto-zoom to top hotspot
        if (!hasScanned && result.hotspots.length > 0) {
            setShowSuggestion(true);
            setSelectedHotspotId(result.hotspots[0].id);
            mapRef.current?.fitBounds(result.hotspots[0].bounds as maplibregl.LngLatBoundsLike, { padding: 40 });
            dispatch({ type: 'SET_HAS_SCANNED' });
        }

        const scanCenter = {
            lat: mapRef.current!.getCenter().lat,
            lng: mapRef.current!.getCenter().lng,
        };
        terrainScanCenterRef.current = scanCenter;

        // Auto-trigger historic phase — passes ScanContext to skip NHLE/AIM re-fetch
        const context: ScanContext = {
            terrainClusters: result.terrainClusters,
            monumentPoints:  result.monumentPoints,
            routes:          result.routes,
            nhleData:        result.nhleData,
            aimData:         result.aimData,
            scanCenter,
        };
        await runHistoricPhase(context);
    };

    // ─── Standalone historic scan (Intel drawer / Historic button) ────────────

    const loadStandaloneHistoric = useCallback(async () => {
        if (!mapRef.current || isHistoricScanning) return;
        // Standalone: re-fetch NHLE/AIM, reuse any routes already loaded
        await runHistoricPhase({
            terrainClusters,
            monumentPoints,
            routes:     historicRoutes,
            nhleData:   null,
            aimData:    null,
            scanCenter: terrainScanCenterRef.current,
        });
    }, [isHistoricScanning, terrainClusters, monumentPoints, historicRoutes, runHistoricPhase]);

    // ─── Auto-trigger effects ─────────────────────────────────────────────────

    useEffect(() => {
        if (isIntelOpen && !isHistoricScanning) loadStandaloneHistoric();
    }, [isIntelOpen]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        if (historicMode && !isHistoricScanning) loadStandaloneHistoric();
    }, [historicMode]); // eslint-disable-line react-hooks/exhaustive-deps

    // ─── Scroll on feature select ─────────────────────────────────────────────

    useEffect(() => {
        if (selectedId) {
            const el = document.getElementById(`card-${selectedId}`);
            if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'start' });
        }
    }, [selectedId]);

    useEffect(() => {
        setShowPermissionPicker(false);
    }, [selectedHotspotId]);

    // ─── GPS / search ─────────────────────────────────────────────────────────

    const findMe = () => {
        if (isLocating) return;
        setIsLocating(true);
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                setIsLocating(false);
                const { longitude, latitude } = pos.coords;
                const map = mapRef.current;
                if (!map) return;
                map.flyTo({ center: [longitude, latitude], zoom: 16 });

                // Build or reposition the "you are here" target marker
                if (!userLocationMarkerRef.current) {
                    const el = document.createElement('div');
                    el.style.cssText = [
                        'width:28px', 'height:28px', 'position:relative',
                        'display:flex', 'align-items:center', 'justify-content:center',
                    ].join(';');
                    // Outer red circle
                    el.innerHTML = `
                        <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28">
                            <circle cx="14" cy="14" r="12" fill="rgba(220,38,38,0.2)" stroke="#dc2626" stroke-width="2"/>
                            <line x1="14" y1="2"  x2="14" y2="8"  stroke="#dc2626" stroke-width="2" stroke-linecap="round"/>
                            <line x1="14" y1="20" x2="14" y2="26" stroke="#dc2626" stroke-width="2" stroke-linecap="round"/>
                            <line x1="2"  y1="14" x2="8"  y2="14" stroke="#dc2626" stroke-width="2" stroke-linecap="round"/>
                            <line x1="20" y1="14" x2="26" y2="14" stroke="#dc2626" stroke-width="2" stroke-linecap="round"/>
                            <circle cx="14" cy="14" r="2.5" fill="#dc2626"/>
                        </svg>`;
                    userLocationMarkerRef.current = new maplibregl.Marker({ element: el, anchor: 'center' })
                        .setLngLat([longitude, latitude])
                        .addTo(map);
                } else {
                    userLocationMarkerRef.current.setLngLat([longitude, latitude]);
                }
            },
            (err) => { setIsLocating(false); console.error('GPS Error:', err); },
            { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 },
        );
    };

    const searchLocation = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!searchQuery) return;
        try {
            const res  = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(searchQuery)}`);
            const data = await res.json();
            if (data[0]) { mapRef.current?.flyTo({ center: [parseFloat(data[0].lon), parseFloat(data[0].lat)], zoom: 16 }); setIsSearchOpen(false); }
        } catch { addLog('> Search failed.', 'system', 'warn'); }
    };

    // ─── Derived convenience aliases ──────────────────────────────────────────

    // loadingPAS used in JSX — maps to historic scan in-progress flag
    const loadingPAS = isHistoricScanning;

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
                        <button onClick={executeScan} disabled={analyzing || isTerrainScanning} title="Scan area locked to Z16 for precision" className="bg-emerald-500 text-white px-4 py-1.5 rounded-lg text-[9px] font-black tracking-widest uppercase hover:bg-emerald-400 transition-all shadow-[0_0_15px_rgba(16,185,129,0.3)] disabled:opacity-50 disabled:animate-pulse">
                            {analyzing || isTerrainScanning ? '...' : 'Scan'}
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
                        {(analyzing || isTerrainScanning) && (
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
                                {hotspotVersion === 'enhanced' ? 'Enhanced Target' : 'Terrain Target'}
                            </div>
                            <div className="flex flex-col gap-2 pointer-events-auto max-h-[40vh] overflow-y-auto scrollbar-hide pb-4">
                                {hotspots.slice(0, 3).map(h => (
                                    <button
                                        key={h.id}
                                        onClick={() => {
                                            setShowSuggestion(false);
                                            setSelectedHotspotId(h.id === selectedHotspotId ? null : h.id);
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
                        <div className="absolute bottom-6 left-4 right-4 z-[100] lg:hidden animate-in slide-in-from-bottom-4 fade-in duration-200">
                            {hotspots.filter(h => h.id === selectedHotspotId).map(h => {
                                const hStrength = getHotspotSignalStrength(h.score);
                                const hHook = getHotspotHook(hStrength);
                                const hBorder = hStrength === 'Strong Zone' ? 'bg-slate-900 border-amber-500/50 shadow-[0_0_40px_rgba(245,158,11,0.2)]' : hStrength === 'Moderate Zone' ? 'bg-slate-900 border-emerald-500/50' : 'bg-slate-900 border-white/20';
                                const hStrengthColour = hStrength === 'Strong Zone' ? 'text-amber-400' : hStrength === 'Moderate Zone' ? 'text-emerald-400' : 'text-white/35';
                                return (
                                <div key={h.id} className={`p-5 rounded-3xl border-2 shadow-2xl transition-all ${hBorder}`}>
                                    <p className="text-[9px] font-black text-white uppercase tracking-[0.2em] text-center mb-3">Hotspot {h.number}</p>
                                    <div className="flex justify-between items-start mb-4">
                                        <div className="flex-1 min-w-0 pr-3">
                                            {/* 1. Title */}
                                            <h3 className="text-base font-black text-white tracking-tight leading-tight mb-1">{HOTSPOT_TITLES[h.classification]}</h3>
                                            {/* 2. Signal strength */}
                                            <p className={`text-[11px] font-black mb-1 ${hStrengthColour}`}>{hStrength}</p>
                                            {/* 3. Hook */}
                                            <p className="text-[11px] font-bold text-white/70 leading-snug mb-2">{hHook}</p>
                                            {/* 4. classificationReason — muted, below hook */}
                                            {h.classificationReason && <p className="text-[9px] text-white/35 leading-tight mb-1.5">{h.classificationReason}</p>}
                                            {/* 5. Meta badges */}
                                            {(h.secondaryTag || h.isOnCorridor || (h.linkedCount ?? 0) > 0) && (
                                                <div className="flex items-center gap-2.5 flex-wrap mt-1">
                                                    {h.secondaryTag && <span className="text-[8px] font-bold text-amber-300/50 uppercase tracking-widest">{h.secondaryTag}</span>}
                                                    {h.isOnCorridor && <span className="text-[8px] font-bold text-emerald-500/50 uppercase tracking-widest">On corridor</span>}
                                                    {(h.linkedCount ?? 0) > 0 && <span className="text-[8px] font-bold text-white/30 uppercase tracking-widest">Linked to {h.linkedCount} nearby</span>}
                                                </div>
                                            )}
                                            {showSuggestion && <span className="text-emerald-400 text-[9px] font-black animate-pulse tracking-widest mt-1.5 block">DETECT HERE</span>}
                                        </div>
                                        <button onClick={() => setSelectedHotspotId(null)} className="bg-black/20 hover:bg-black/40 text-white rounded-full p-2 transition-colors border border-white/10 flex-shrink-0">
                                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                                        </button>
                                    </div>
                                    {h.isHighConfidenceCrossing && (
                                        <div className="bg-blue-600/40 p-2 rounded-2xl border border-blue-400 mb-4 animate-pulse">
                                            <p className="m-0 text-xs font-black uppercase text-white text-center tracking-[0.2em]">🌊 Likely historic crossing point</p>
                                        </div>
                                    )}
                                    <div className="border-t border-white/8 pt-3 mb-3">
                                        <p className="text-[8px] font-medium text-white/65 mb-2.5">Why this matters</p>
                                        <div className="space-y-2">
                                            {h.explanation.slice(0, 3).map((reason, idx) => (
                                                <div key={idx} className="flex items-start gap-3">
                                                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 mt-1 shadow-[0_0_8px_rgba(52,211,153,0.8)]" />
                                                    <p className="text-xs font-bold text-white leading-tight flex-1">{reason}</p>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                    {h.suggestedFocus && (
                                        <div className="mt-3 pt-3 border-t border-emerald-500/15">
                                            <p className="text-[8px] font-black text-emerald-500/60 uppercase tracking-[0.12em] mb-1">Focus area</p>
                                            <p className="text-[11px] font-bold text-emerald-300 leading-snug">{h.suggestedFocus}</p>
                                        </div>
                                    )}
                                    <div className="mt-3 pt-3 border-t border-white/8">
                                        <span
                                            onClick={() => setExpandedInterpretationId(expandedInterpretationId === h.id ? null : h.id)}
                                            className="text-[11px] font-black text-amber-400 hover:text-amber-300 transition-colors duration-150 cursor-pointer flex items-center gap-1"
                                        >
                                            {expandedInterpretationId === h.id ? '▲ Hide reasoning' : '▼ See full reasoning'}
                                        </span>
                                        {expandedInterpretationId === h.id && (() => {
                                            const interp = buildInterpretation(h);
                                            return (
                                                <div className="mt-4 space-y-4 animate-in fade-in duration-200">
                                                    <p className="text-[8px] font-black text-white/25 uppercase tracking-[0.2em]">{getInterpretationLabel(h.confidence)}</p>
                                                    <div>
                                                        <p className="text-[8px] font-black text-white/55 uppercase tracking-[0.15em] mb-1.5">Summary</p>
                                                        <p className="text-[11px] text-white/85 leading-relaxed">{interp.summary}</p>
                                                    </div>
                                                    <div>
                                                        <p className="text-[8px] font-black text-white/55 uppercase tracking-[0.15em] mb-1.5">Why it stands out</p>
                                                        <p className="text-[11px] text-white/85 leading-relaxed">{interp.reasoning}</p>
                                                    </div>
                                                    <div>
                                                        <p className="text-[8px] font-black text-white/55 uppercase tracking-[0.15em] mb-1.5">How to approach it</p>
                                                        <p className="text-[11px] text-white/85 leading-relaxed">{interp.strategy}</p>
                                                    </div>
                                                </div>
                                            );
                                        })()}
                                    </div>
                                    <div className="mt-3 pt-3 border-t border-white/10">
                                        {!activeSession && realPermissions.length === 0 ? (
                                            <div className="text-center">
                                                <button
                                                    onClick={() => nav('/permission')}
                                                    className="w-full border border-emerald-500/40 hover:border-emerald-400 hover:bg-emerald-500/10 active:scale-[0.98] text-emerald-400 hover:text-emerald-300 font-bold py-2 rounded-xl text-[10px] uppercase tracking-widest transition-all"
                                                >
                                                    Add a permission to start a session
                                                </button>
                                                <p className="text-[8px] text-white/30 mt-1.5">Sessions track your visit and field coverage</p>
                                            </div>
                                        ) : (
                                            <>
                                                <button
                                                    onClick={handleStartSession}
                                                    className="w-full border border-emerald-500/40 hover:border-emerald-400 hover:bg-emerald-500/10 active:scale-[0.98] text-emerald-400 hover:text-emerald-300 font-bold py-2 rounded-xl text-[10px] uppercase tracking-widest transition-all"
                                                >
                                                    {activeSession ? 'Continue Session' : 'Start Session Here'}
                                                </button>
                                                {activeSession && (() => {
                                                    const sessionPermission = permissions.find(p => p.id === activeSession.permissionId);
                                                    const sessionDate = new Date(activeSession.date);
                                                    const today = new Date();
                                                    const isToday = sessionDate.toDateString() === today.toDateString();
                                                    const dateLabel = isToday ? 'Today' : sessionDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
                                                    return (
                                                        <p className="text-[9px] text-white/35 text-center mt-1.5">
                                                            {sessionPermission?.name || 'Unknown permission'} · {dateLabel}
                                                        </p>
                                                    );
                                                })()}
                                                {showPermissionPicker && !activeSession && realPermissions.length > 1 && (
                                                    <div className="mt-2 flex flex-col gap-1.5 animate-in fade-in slide-in-from-top-2 duration-150">
                                                        <p className="text-[8px] font-black text-white/30 uppercase tracking-widest px-1">Select permission</p>
                                                        {realPermissions.map(p => (
                                                            <button
                                                                key={p.id}
                                                                onClick={() => { setShowPermissionPicker(false); nav(`/session/new?permissionId=${p.id}`); }}
                                                                className="w-full text-left px-3 py-2 rounded-xl bg-white/5 hover:bg-emerald-500/15 border border-white/10 hover:border-emerald-500/40 text-white/70 hover:text-white text-[11px] font-bold transition-all truncate"
                                                            >
                                                                {p.name || '(Unnamed)'}
                                                            </button>
                                                        ))}
                                                    </div>
                                                )}
                                            </>
                                        )}
                                    </div>
                                    <p className="text-center text-[7px] text-white/55 italic mt-3">Highlights historic activity — not guaranteed finds.</p>
                                </div>
                                );
                            })}
                        </div>
                    )}

                    {/* Mobile Target Card Popup */}
                    {selectedId && !selectedHotspotId && (
                        <div className="absolute bottom-6 left-4 right-4 z-[100] lg:hidden animate-in slide-in-from-bottom-4 fade-in duration-200">
                            {detectedFeatures.filter(f => f.id === selectedId).map(f => {
                                const tInterp = buildTargetInterpretation(f);
                                const strengthColour: Record<TargetSignalStrength, string> = {
                                    'Strong Signal':     'text-amber-400',
                                    'Moderate Signal':   'text-emerald-400',
                                    'Supporting Signal': 'text-white/40',
                                };
                                const borderColour: Record<TargetSignalStrength, string> = {
                                    'Strong Signal':     'border-amber-500/50 shadow-[0_0_40px_rgba(245,158,11,0.2)]',
                                    'Moderate Signal':   'border-emerald-500/50',
                                    'Supporting Signal': 'border-white/20',
                                };
                                return (
                                    <div key={f.id} className={`p-5 rounded-3xl border-2 bg-slate-900 shadow-2xl transition-all ${f.isProtected ? 'border-red-500/50 shadow-[0_0_40px_rgba(239,68,68,0.15)]' : borderColour[tInterp.signalStrength]}`}>
                                        {/* Centred target label */}
                                        <p className="text-[9px] font-black text-white uppercase tracking-[0.2em] text-center mb-3">Target {f.number}</p>
                                        {/* Header */}
                                        <div className="flex justify-between items-start mb-4">
                                            <div className="flex-1 min-w-0 pr-3">
                                                <h3 className="text-base font-black text-white tracking-tight leading-tight mb-1">{f.type}</h3>
                                                {!f.isProtected && <p className={`text-[11px] font-black ${strengthColour[tInterp.signalStrength]}`}>{tInterp.signalStrength}</p>}
                                            </div>
                                            <button onClick={(e) => { e.stopPropagation(); setSelectedId(null); }} className="bg-black/20 hover:bg-black/40 text-white rounded-full p-2 transition-colors border border-white/10 flex-shrink-0">
                                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                                            </button>
                                        </div>
                                        {f.isProtected ? (
                                            /* Protected monument — no detecting guidance shown */
                                            <div className="border-t border-red-500/20 pt-3 space-y-3">
                                                <div className="p-3 bg-red-600/20 rounded-2xl border border-red-500/50 text-center">
                                                    <p className="text-[11px] font-black uppercase tracking-widest text-red-300 mb-1">⚠️ Scheduled Monument</p>
                                                    <p className="text-[10px] text-red-200/70 leading-snug">Detecting on or near this site is illegal. Do not disturb.</p>
                                                </div>
                                                {f.aimInfo && (
                                                    <div className="p-2 rounded-xl border bg-white/5 border-white/10">
                                                        <p className="text-[9px] font-black uppercase text-white/40 leading-tight mb-0.5">Site type</p>
                                                        <p className="text-[10px] font-bold text-white/70 leading-tight">{f.aimInfo.type} · {f.aimInfo.period}</p>
                                                    </div>
                                                )}
                                            </div>
                                        ) : (
                                            <>
                                                {/* Hook */}
                                                <p className="text-[12px] font-bold text-white/80 leading-snug mb-3">{tInterp.hook}</p>
                                                {/* Crossing badge */}
                                                {f.isHighConfidenceCrossing && (
                                                    <div className="bg-blue-600/40 p-2 rounded-2xl border border-blue-400 mb-3 animate-pulse">
                                                        <p className="m-0 text-xs font-black uppercase text-white text-center tracking-[0.2em]">🌊 Likely historic crossing point</p>
                                                    </div>
                                                )}
                                                {/* Why this matters */}
                                                <div className="border-t border-white/8 pt-3 mb-3">
                                                    <p className="text-[8px] font-medium text-white/65 mb-2.5">Why this matters</p>
                                                    {f.explanationLines && f.explanationLines.length > 0 ? (
                                                        <div className="space-y-2">
                                                            {f.explanationLines.slice(0, 3).map((line, idx) => (
                                                                <div key={idx} className="flex items-start gap-3">
                                                                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 mt-1 shadow-[0_0_8px_rgba(52,211,153,0.8)]" />
                                                                    <p className="text-xs font-bold text-white leading-tight flex-1">{line}</p>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    ) : (
                                                        <p className="text-xs text-white/50 leading-tight">Signal detected across available scan sources.</p>
                                                    )}
                                                    {f.disturbanceRisk && f.disturbanceRisk !== 'Low' && (
                                                        <div className={`mt-3 p-2 rounded-xl border ${f.disturbanceRisk === 'High' ? 'bg-red-500/20 border-red-400/50' : 'bg-amber-500/20 border-amber-400/50'}`}>
                                                            <p className={`text-[9px] font-black uppercase leading-tight mb-0.5 ${f.disturbanceRisk === 'High' ? 'text-red-300' : 'text-amber-300'}`}>Disturbance risk: {f.disturbanceRisk}</p>
                                                            <p className="text-[10px] font-bold text-white/80 leading-tight">{f.disturbanceReason}</p>
                                                        </div>
                                                    )}
                                                    {f.aimInfo && (
                                                        <div className="mt-2 p-2 rounded-xl border bg-amber-500/10 border-amber-400/30">
                                                            <p className="text-[9px] font-black uppercase text-amber-300 leading-tight mb-0.5">Historic verification</p>
                                                            <p className="text-[10px] font-bold text-white/80 leading-tight">{f.aimInfo.type} ({f.aimInfo.period})</p>
                                                        </div>
                                                    )}
                                                </div>
                                                {/* Focus area */}
                                                <div className="mt-3 pt-3 border-t border-emerald-500/15">
                                                    <p className="text-[8px] font-black text-emerald-500/60 uppercase tracking-[0.12em] mb-1">Focus area</p>
                                                    <p className="text-[11px] font-bold text-emerald-300 leading-snug">{tInterp.focus}</p>
                                                </div>
                                                {/* Expand toggle */}
                                                <div className="mt-3 pt-3 border-t border-white/8">
                                                    <span
                                                        onClick={() => setExpandedTargetId(expandedTargetId === f.id ? null : f.id)}
                                                        className="text-[11px] font-black text-amber-400 hover:text-amber-300 transition-colors duration-150 cursor-pointer flex items-center gap-1"
                                                    >
                                                        {expandedTargetId === f.id ? '▲ Hide reasoning' : '▼ See full reasoning'}
                                                    </span>
                                                    {expandedTargetId === f.id && (
                                                        <div className="mt-4 space-y-4 animate-in fade-in duration-200">
                                                            <div>
                                                                <p className="text-[8px] font-black text-white/55 uppercase tracking-[0.15em] mb-1.5">Summary</p>
                                                                <p className="text-[11px] text-white/85 leading-relaxed">{tInterp.summary}</p>
                                                            </div>
                                                            <div>
                                                                <p className="text-[8px] font-black text-white/55 uppercase tracking-[0.15em] mb-1.5">Why it stands out</p>
                                                                <p className="text-[11px] text-white/85 leading-relaxed">{tInterp.whyItStandsOut}</p>
                                                            </div>
                                                            <div>
                                                                <p className="text-[8px] font-black text-white/55 uppercase tracking-[0.15em] mb-1.5">How to approach it</p>
                                                                <p className="text-[11px] text-white/85 leading-relaxed">{tInterp.howToApproach}</p>
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            </>
                                        )}
                                        <p className="text-center text-[7px] text-white/55 italic mt-3">Highlights historic activity — not guaranteed finds.</p>
                                    </div>
                                );
                            })}
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
                                            {Object.entries(pasFinds.reduce((acc, f) => { const p = f.broadperiod || 'Unknown'; acc[p] = (acc[p] || 0) + 1; return acc; }, {} as Record<string, number>)).sort((a, b) => b[1] - a[1]).map(([period, count]) => (
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
                            <div className="flex items-center gap-2">
                                <h2 className="text-sm font-black text-white uppercase tracking-tighter">Strategic Hotspots</h2>
                                {hotspotVersion && (
                                    <span className={`text-[8px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded border ${hotspotVersion === 'enhanced' ? 'text-amber-400 border-amber-500/40 bg-amber-500/10' : 'text-slate-400 border-slate-500/40 bg-slate-500/10'}`}>
                                        {hotspotVersion === 'enhanced' ? 'Enhanced' : 'Terrain Only'}
                                    </span>
                                )}
                            </div>
                            {selectedHotspotId && <button onClick={() => setSelectedHotspotId(null)} className="text-[9px] font-black text-emerald-500 hover:underline tracking-widest uppercase">Clear View</button>}
                        </div>
                        <div className="flex flex-col gap-4">
                            {hotspots.length > 0 ? hotspots.map(h => {
                                const hStrength = getHotspotSignalStrength(h.score);
                                const hHook = getHotspotHook(hStrength);
                                const hStrengthColour = hStrength === 'Strong Zone' ? 'text-amber-400' : hStrength === 'Moderate Zone' ? 'text-emerald-400' : 'text-white/35';
                                const hBorderIdle = hStrength === 'Strong Zone' ? 'bg-slate-900/40 border-amber-500/30 hover:border-amber-500/60 shadow-[0_0_15px_rgba(245,158,11,0.05)]' : hStrength === 'Moderate Zone' ? 'bg-slate-900/40 border-emerald-500/30 hover:border-emerald-500/60' : 'bg-slate-900/40 border-white/10 hover:border-white/20';
                                return (
                                <div
                                    key={h.id}
                                    onClick={() => {
                                        setShowSuggestion(false);
                                        setSelectedHotspotId(h.id);
                                        mapRef.current?.fitBounds(h.bounds as maplibregl.LngLatBoundsLike, { padding: 40 });
                                    }}
                                    className={`p-4 rounded-2xl border-2 cursor-pointer transition-all active:scale-[0.98] ${selectedHotspotId === h.id ? 'bg-white/10 border-white ring-4 ring-white/10' : hBorderIdle}`}
                                >
                                    <div className="mb-3">
                                        {/* 1. Title */}
                                        <div className="flex justify-between items-start mb-1">
                                            <h3 className={`text-[10px] font-black tracking-tight leading-tight flex-1 pr-2 ${selectedHotspotId === h.id ? 'text-white' : 'text-slate-200'}`}>{HOTSPOT_TITLES[h.classification]}</h3>
                                            {showSuggestion && h.number === 1 && <span className="text-[7px] font-black text-emerald-400 animate-pulse tracking-widest flex-shrink-0">DETECT HERE</span>}
                                        </div>
                                        {/* 2. Signal strength */}
                                        <p className={`text-[9px] font-black mb-0.5 ${hStrengthColour}`}>{hStrength}</p>
                                        {/* 3. Hook */}
                                        <p className="text-[9px] font-bold text-white/60 leading-snug mb-1.5">{hHook}</p>
                                        {/* 4. classificationReason — muted, below hook */}
                                        {h.classificationReason && <p className="text-[8px] text-white/30 leading-tight mb-1">{h.classificationReason}</p>}
                                        {/* 5. Meta badges */}
                                        {(h.secondaryTag || h.isOnCorridor || (h.linkedCount ?? 0) > 0) && (
                                            <div className="flex items-center gap-2 flex-wrap mt-1 mb-1">
                                                {h.secondaryTag && <span className="text-[7px] font-bold text-amber-300/45 uppercase tracking-widest">{h.secondaryTag}</span>}
                                                {h.isOnCorridor && <span className="text-[7px] font-bold text-emerald-500/45 uppercase tracking-widest">On corridor</span>}
                                                {(h.linkedCount ?? 0) > 0 && <span className="text-[7px] font-bold text-white/25 uppercase tracking-widest">Linked to {h.linkedCount} nearby</span>}
                                            </div>
                                        )}
                                    </div>
                                    {h.isHighConfidenceCrossing && (
                                        <div className="bg-blue-600/40 p-1.5 rounded-xl border border-blue-400 mb-3 animate-pulse">
                                            <p className="m-0 text-[9px] font-black uppercase text-white text-center tracking-widest">🌊 Likely historic crossing point</p>
                                        </div>
                                    )}
                                    <div className="space-y-1.5 mt-3">
                                        <p className="text-[7px] font-medium text-white/25 mb-1.5">Why this matters</p>
                                        {h.explanation.slice(0, 3).map((reason, idx) => (
                                            <div key={idx} className="flex items-center gap-2">
                                                <div className="w-1 h-1 rounded-full bg-emerald-500 shrink-0" />
                                                <p className="text-[10px] font-bold text-slate-300 leading-tight">{reason}</p>
                                            </div>
                                        ))}
                                    </div>
                                    {h.suggestedFocus && (
                                        <div className="flex items-center gap-1.5 mt-2.5 pt-2.5 border-t border-white/5">
                                            <div className="w-1 h-1 rounded-full bg-emerald-500 flex-shrink-0" />
                                            <p className="text-[9px] leading-tight">
                                                <span className="font-black text-emerald-500/50 uppercase tracking-widest">Focus: </span>
                                                <span className="font-bold text-emerald-300/80">{h.suggestedFocus}</span>
                                            </p>
                                        </div>
                                    )}
                                    <div className="mt-2.5 pt-2.5 border-t border-white/5">
                                        <span
                                            onClick={() => setExpandedInterpretationId(expandedInterpretationId === h.id ? null : h.id)}
                                            className="text-[10px] font-black text-amber-400 hover:text-amber-300 transition-colors duration-150 cursor-pointer"
                                        >
                                            {expandedInterpretationId === h.id ? '▲ Hide reasoning' : '▼ See full reasoning'}
                                        </span>
                                        {expandedInterpretationId === h.id && (() => {
                                            const interp = buildInterpretation(h);
                                            return (
                                                <div className="mt-3 space-y-3.5 animate-in fade-in duration-200">
                                                    <p className="text-[7px] font-black text-white/20 uppercase tracking-[0.2em]">{getInterpretationLabel(h.confidence)}</p>
                                                    <div>
                                                        <p className="text-[7px] font-black text-white/45 uppercase tracking-[0.15em] mb-1">Summary</p>
                                                        <p className="text-[10px] text-white/80 leading-relaxed">{interp.summary}</p>
                                                    </div>
                                                    <div>
                                                        <p className="text-[7px] font-black text-white/45 uppercase tracking-[0.15em] mb-1">Why it stands out</p>
                                                        <p className="text-[10px] text-white/80 leading-relaxed">{interp.reasoning}</p>
                                                    </div>
                                                    <div>
                                                        <p className="text-[7px] font-black text-white/45 uppercase tracking-[0.15em] mb-1">How to approach it</p>
                                                        <p className="text-[10px] text-white/80 leading-relaxed">{interp.strategy}</p>
                                                    </div>
                                                </div>
                                            );
                                        })()}
                                    </div>
                                    <div className="mt-2.5 pt-2.5 border-t border-white/8">
                                        {!activeSession && realPermissions.length === 0 ? (
                                            <div className="text-center">
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); nav('/permission'); }}
                                                    className="w-full border border-emerald-500/30 hover:border-emerald-400/60 hover:bg-emerald-500/10 active:scale-[0.98] text-emerald-500/70 hover:text-emerald-400 font-bold py-1.5 rounded-xl text-[9px] uppercase tracking-widest transition-all"
                                                >
                                                    Add a permission to start a session
                                                </button>
                                                <p className="text-[7px] text-white/25 mt-1">Sessions track your visit and field coverage</p>
                                            </div>
                                        ) : (
                                            <>
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); handleStartSession(); }}
                                                    className="w-full border border-emerald-500/30 hover:border-emerald-400/60 hover:bg-emerald-500/10 active:scale-[0.98] text-emerald-500/70 hover:text-emerald-400 font-bold py-1.5 rounded-xl text-[9px] uppercase tracking-widest transition-all"
                                                >
                                                    {activeSession ? 'Continue Session' : 'Start Session Here'}
                                                </button>
                                                {activeSession && (() => {
                                                    const sessionPermission = permissions.find(p => p.id === activeSession.permissionId);
                                                    const sessionDate = new Date(activeSession.date);
                                                    const today = new Date();
                                                    const isToday = sessionDate.toDateString() === today.toDateString();
                                                    const dateLabel = isToday ? 'Today' : sessionDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
                                                    return (
                                                        <p className="text-[8px] text-white/30 text-center mt-1">
                                                            {sessionPermission?.name || 'Unknown permission'} · {dateLabel}
                                                        </p>
                                                    );
                                                })()}
                                                {showPermissionPicker && !activeSession && realPermissions.length > 1 && (
                                                    <div className="mt-2 flex flex-col gap-1 animate-in fade-in slide-in-from-top-2 duration-150">
                                                        <p className="text-[7px] font-black text-white/30 uppercase tracking-widest px-1">Select permission</p>
                                                        {realPermissions.map(p => (
                                                            <button
                                                                key={p.id}
                                                                onClick={(e) => { e.stopPropagation(); setShowPermissionPicker(false); nav(`/session/new?permissionId=${p.id}`); }}
                                                                className="w-full text-left px-2.5 py-1.5 rounded-lg bg-white/5 hover:bg-emerald-500/15 border border-white/10 hover:border-emerald-500/40 text-white/70 hover:text-white text-[9px] font-bold transition-all truncate"
                                                            >
                                                                {p.name || '(Unnamed)'}
                                                            </button>
                                                        ))}
                                                    </div>
                                                )}
                                            </>
                                        )}
                                    </div>
                                    <p className="text-center text-[7px] text-white/30 italic mt-2">Highlights historic activity — not guaranteed finds.</p>
                                </div>
                                );
                            }) : (
                                <p className="text-[10px] text-slate-500 font-bold uppercase italic text-center py-4">No tactical hotspots defined.</p>
                            )}
                        </div>
                    </div>

                    <div className="p-6 border-b border-white/5 flex justify-between items-center shrink-0">
                        <div>
                            <h2 className="text-sm font-black text-white uppercase tracking-tighter">Site Report</h2>
                            <p className="text-[10px] text-slate-500 font-bold uppercase">{detectedFeatures.length} Signals Locked</p>
                        </div>
                        {selectedId && <button onClick={() => setSelectedId(null)} className="text-[10px] font-black text-emerald-500 hover:underline tracking-widest uppercase">Reset</button>}
                    </div>

                    <div ref={scrollRef} className="flex-1 overflow-y-auto p-5 scrollbar-hide space-y-4">
                        {detectedFeatures.map((f) => {
                            const tInterp = buildTargetInterpretation(f);
                            const isSelected = selectedId === f.id;
                            const strengthColour: Record<TargetSignalStrength, string> = {
                                'Strong Signal':     'text-amber-400',
                                'Moderate Signal':   'text-emerald-400',
                                'Supporting Signal': 'text-white/40',
                            };
                            return (
                                <div
                                    key={f.id}
                                    id={`card-${f.id}`}
                                    onClick={() => { setSelectedId(f.id); mapRef.current?.flyTo({ center: f.center, zoom: 17 }); }}
                                    className={`p-4 rounded-2xl cursor-pointer transition-all border-2 active:scale-[0.98] ${isSelected ? 'bg-white/10 border-white ring-4 ring-white/10' : f.isProtected ? 'bg-slate-900/40 border-red-500/40 hover:border-red-500/70' : tInterp.signalStrength === 'Strong Signal' ? 'bg-slate-900/40 border-amber-500/30 hover:border-amber-500/60 shadow-[0_0_15px_rgba(245,158,11,0.05)]' : tInterp.signalStrength === 'Moderate Signal' ? 'bg-slate-900/40 border-emerald-500/30 hover:border-emerald-500/60' : 'bg-slate-900/40 border-white/10 hover:border-white/20'}`}
                                >
                                    {/* Centred target label */}
                                    <p className="text-[9px] font-black text-white uppercase tracking-[0.2em] text-center mb-2">Target {f.number}</p>
                                    {/* Header row: type + source dots */}
                                    <div className="flex justify-between items-start mb-2">
                                        <div className="flex-1 min-w-0 pr-2">
                                            <h3 className={`text-[10px] font-black tracking-tight leading-tight mb-0.5 ${isSelected ? 'text-white' : 'text-slate-200'}`}>{f.type}</h3>
                                            {!f.isProtected && <p className={`text-[9px] font-black ${strengthColour[tInterp.signalStrength]}`}>{tInterp.signalStrength}</p>}
                                        </div>
                                        <div className="flex flex-col gap-0.5 items-end flex-shrink-0">
                                            {[{ ids: ['terrain', 'terrain_global'], label: 'Lidar' }, { ids: ['slope'], label: 'Slope' }, { ids: ['hydrology'], label: 'Hydro' }, { ids: ['satellite', 'satellite_spring', 'satellite_summer'], label: 'Aerial' }, { ids: ['historic'], label: 'Historic' }].map(s => (
                                                <div key={s.label} className="flex items-center gap-1">
                                                    <span className={`text-[6px] font-black uppercase tracking-tighter ${s.ids.some(id => f.sources.includes(id as Cluster['source'])) ? 'text-white/60' : 'text-white/15'}`}>{s.label}</span>
                                                    <div className={`w-1 h-1 rounded-full ${s.ids.some(id => f.sources.includes(id as Cluster['source'])) ? 'bg-emerald-400 shadow-[0_0_4px_rgba(52,211,153,0.5)]' : 'bg-black/40'}`} />
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                    {f.isProtected ? (
                                        /* Protected monument — no detecting guidance shown */
                                        <div className="border-t border-red-500/20 pt-2 space-y-2">
                                            <div className="p-2 bg-red-600/20 rounded-xl border border-red-500/40 text-center">
                                                <p className="text-[9px] font-black uppercase tracking-widest text-red-300 mb-0.5">⚠️ Scheduled Monument</p>
                                                <p className="text-[9px] text-red-200/70 leading-snug">Detecting here is illegal. Do not disturb.</p>
                                            </div>
                                            {f.aimInfo && (
                                                <div className="px-2 py-1 bg-white/5 border border-white/10 rounded-lg">
                                                    <p className="text-[8px] font-black uppercase text-white/40">{f.aimInfo.type} · {f.aimInfo.period}</p>
                                                </div>
                                            )}
                                        </div>
                                    ) : (
                                        <>
                                            {/* Hook */}
                                            <p className="text-[10px] font-bold text-white/70 leading-snug mb-2">{tInterp.hook}</p>
                                            {/* Crossing badge */}
                                            {f.isHighConfidenceCrossing && (<div className="bg-blue-600/40 p-1.5 rounded-xl border border-blue-400 mb-2 animate-pulse"><p className="m-0 text-[9px] font-black uppercase text-white text-center tracking-widest">🌊 Likely historic crossing point</p></div>)}
                                            {/* Why this matters */}
                                            <div className="space-y-1.5 mt-2 border-t border-white/8 pt-2">
                                                <p className="text-[7px] font-medium text-white/25 mb-1.5">Why this matters</p>
                                                {f.explanationLines && f.explanationLines.length > 0 ? (
                                                    f.explanationLines.slice(0, 3).map((line, idx) => (
                                                        <div key={idx} className="flex items-center gap-2">
                                                            <div className="w-1 h-1 rounded-full bg-emerald-500 shrink-0" />
                                                            <p className="text-[10px] font-bold text-slate-300 leading-tight">{line}</p>
                                                        </div>
                                                    ))
                                                ) : (
                                                    <p className="text-[10px] text-white/40 leading-tight">Signal detected across available scan sources.</p>
                                                )}
                                            </div>
                                            {/* Disturbance + AIM */}
                                            {f.disturbanceRisk && f.disturbanceRisk !== 'Low' && (
                                                <div className={`mt-2 px-2 py-1 rounded-lg border ${f.disturbanceRisk === 'High' ? 'bg-red-500/10 border-red-500/20' : 'bg-amber-500/10 border-amber-500/20'}`}>
                                                    <p className={`m-0 text-[8px] font-black uppercase ${f.disturbanceRisk === 'High' ? 'text-red-400' : 'text-amber-400'}`}>Risk: {f.disturbanceRisk} ({f.disturbanceReason})</p>
                                                </div>
                                            )}
                                            {f.aimInfo && (<div className="mt-1 px-2 py-1 bg-amber-500/10 border border-amber-500/20 rounded-lg"><p className="m-0 text-[8px] font-black uppercase text-amber-400">Verified: {f.aimInfo.type} · {f.aimInfo.period}</p></div>)}
                                            {/* Focus area */}
                                            <div className="flex items-center gap-1.5 mt-2.5 pt-2.5 border-t border-white/5">
                                                <div className="w-1 h-1 rounded-full bg-emerald-500 flex-shrink-0" />
                                                <p className="text-[9px] leading-tight">
                                                    <span className="font-black text-emerald-500/50 uppercase tracking-widest">Focus: </span>
                                                    <span className="font-bold text-emerald-300/80">{tInterp.focus}</span>
                                                </p>
                                            </div>
                                            {/* Expand toggle */}
                                            <div className="mt-2.5 pt-2.5 border-t border-white/5">
                                                <span
                                                    onClick={(e) => { e.stopPropagation(); setExpandedTargetId(expandedTargetId === f.id ? null : f.id); }}
                                                    className="text-[10px] font-black text-amber-400 hover:text-amber-300 transition-colors duration-150 cursor-pointer"
                                                >
                                                    {expandedTargetId === f.id ? '▲ Hide reasoning' : '▼ See full reasoning'}
                                                </span>
                                                {expandedTargetId === f.id && (
                                                    <div className="mt-3 space-y-3.5 animate-in fade-in duration-200">
                                                        <div>
                                                            <p className="text-[7px] font-black text-white/45 uppercase tracking-[0.15em] mb-1">Summary</p>
                                                            <p className="text-[10px] text-white/80 leading-relaxed">{tInterp.summary}</p>
                                                        </div>
                                                        <div>
                                                            <p className="text-[7px] font-black text-white/45 uppercase tracking-[0.15em] mb-1">Why it stands out</p>
                                                            <p className="text-[10px] text-white/80 leading-relaxed">{tInterp.whyItStandsOut}</p>
                                                        </div>
                                                        <div>
                                                            <p className="text-[7px] font-black text-white/45 uppercase tracking-[0.15em] mb-1">How to approach it</p>
                                                            <p className="text-[10px] text-white/80 leading-relaxed">{tInterp.howToApproach}</p>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        </>
                                    )}
                                    <p className="text-center text-[7px] text-white/30 italic mt-2">Highlights historic activity — not guaranteed finds.</p>
                                </div>
                            );
                        })}
                    </div>

                    {/* System Log */}
                    <div className="h-24 bg-black/40 border-t border-white/5 p-4 overflow-y-auto shrink-0" ref={logContainerRef}>
                        <div className="font-mono text-[9px] leading-relaxed uppercase tracking-tighter">
                            {systemLog.map((l, i) => (
                                <div
                                    key={i}
                                    className={`mb-1 ${l.level === 'error' ? 'text-red-400/80' : l.level === 'warn' ? 'text-amber-400/80' : l.source === 'historic' ? 'text-blue-400/70' : 'text-emerald-500/70'}`}
                                >
                                    {l.message}
                                </div>
                            ))}
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
