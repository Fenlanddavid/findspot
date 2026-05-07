import React, { useState, useReducer, useRef, useEffect, useLayoutEffect, useCallback, useMemo } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, FieldGuideInvestigationStatus, Find, Media } from '../db';
import { ScaledImage } from '../components/ScaledImage';
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
import { buildInterpretation, getInterpretationLabel, getHotspotSignalStrength, getSignalTypeSummary, HotspotSignalStrength } from '../utils/hotspotInterpreter';
import { buildTargetInterpretation, getTargetVerdict, TargetSignalStrength } from '../utils/targetInterpreter';
import { getDistance } from '../utils/fieldGuideAnalysis';

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
    'Crossing Point Candidate':         'Crossing Point',
    'Junction / Convergence Zone':      'Route Junction',
    'Settlement Edge Candidate':        'Settlement Edge',
    'Burial / Barrow Candidate':        'Burial / Barrow',
    'Organised Field System Candidate': 'Field System',
    'Wetland Margin Activity Zone':     'Wetland Margin',
    'Route-Side Activity Zone':         'Movement Corridor',
    'Terrain Structure Candidate':      'Structural Feature',
    'Spectral Activity Candidate':      'Cropmark Signal',
    'Lowland Activity Zone':            'Lowland Activity Zone',
    'Raised Activity Area':             'Raised Activity Area',
    'Route-Influenced Area':            'Route-Influenced Area',
    'Cropmark Activity Zone':           'Cropmark Activity Zone',
    'Multi-Signal Activity Zone':       'Multi-Signal Activity Zone',
    'General Activity Zone':            'Supporting Activity Zone',
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
    | { type: 'SET_HERITAGE_COUNT'; count: number; monumentPoints: [number, number][] }
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
        case 'SET_HERITAGE_COUNT':
            return { ...state, heritageCount: action.count, monumentPoints: action.monumentPoints };
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

type HotspotResultHierarchy = {
    signalStrength: 'Developing Signal' | 'Strong Signal' | 'Corroborated Signal';
    whyItMatters: string;
    nextAction: string;
};

const INVESTIGATION_STATUSES: Array<{ value: FieldGuideInvestigationStatus; label: string }> = [
    { value: 'unreviewed',    label: 'Unreviewed' },
    { value: 'investigating', label: 'Investigating' },
    { value: 'visited',       label: 'Visited' },
    { value: 'productive',    label: 'Productive' },
    { value: 'archived',      label: 'Archived' },
];

function getHotspotResultHierarchy(h: Hotspot, strength: HotspotSignalStrength): HotspotResultHierarchy {
    const signalStrength =
        strength === 'Strong Zone' ? 'Corroborated Signal' :
        strength === 'Moderate Zone' ? 'Strong Signal' :
        'Developing Signal';

    const whyByClassification: Record<HotspotClassification, string> = {
        'Crossing Point Candidate':         'Movement compresses into a possible crossing point',
        'Junction / Convergence Zone':      'Multiple movement lines converge in one area',
        'Settlement Edge Candidate':        'Raised settlement-edge ground with supporting context',
        'Burial / Barrow Candidate':        'Compact raised form consistent with funerary landscape use',
        'Organised Field System Candidate': 'Structured linear pattern suggests managed land division',
        'Wetland Margin Activity Zone':     'Activity concentrates along a wetland or former water edge',
        'Route-Side Activity Zone':         'Landscape signals follow a historic movement corridor',
        'Terrain Structure Candidate':      'Terrain response suggests a defined structural feature',
        'Spectral Activity Candidate':      'Crop or spectral response suggests subsurface variation',
        'Lowland Activity Zone':            'Signals cluster across lower-lying activity ground',
        'Raised Activity Area':             'Slightly raised dry ground stands out from surroundings',
        'Route-Influenced Area':            'Nearby route context appears to shape activity',
        'Cropmark Activity Zone':           'Repeated cropmark response defines the activity zone',
        'Multi-Signal Activity Zone':       'Independent landscape signals agree in the same area',
        'General Activity Zone':            'Several weaker signals cluster into a supporting activity zone',
    };

    const nextAction = h.suggestedFocus
        ? h.suggestedFocus
        : h.isOnCorridor
            ? 'Compare historic layer and follow the corridor edge'
            : h.metrics.signalClassCount >= 3
                ? 'Compare historic layer before marking targets'
                : 'Review evidence breakdown and check field coverage';

    return {
        signalStrength,
        whyItMatters: h.classificationReason || whyByClassification[h.classification],
        nextAction,
    };
}

// ─── Target evidence gates ────────────────────────────────────────────────────
// Two independent checks are AND-ed together in displayTargets:
//
// hasTargetEvidence  — broad gate: at least one hard physical or archaeological signal.
//                      Route proximity, raised ground, and context alone do not qualify.
// hasLocalPhysicalEvidence — strict gate: the target must have its own physical sensor
//                      signal, not just inherited context from the surrounding hotspot.
//                      AIM-enrichment-only targets are excluded here — they are known
//                      sites, not fresh detections.

function hasTargetEvidence(f: Cluster): boolean {
    return (
        f.sources.includes('terrain') ||
        f.sources.includes('terrain_global') ||
        (f.sources.includes('satellite_summer') && f.sources.includes('satellite_spring')) ||
        f.aimInfo !== undefined
    );
}

function hasLocalPhysicalEvidence(f: Cluster): boolean {
    return (
        f.sources.includes('terrain') ||
        f.sources.includes('terrain_global') ||
        (f.sources.includes('satellite_spring') && f.sources.includes('satellite_summer')) ||
        f.multiScale === true
    );
}

// ─── Historic interpretation helpers ─────────────────────────────────────────

function getHistoricInterpretation(breakdown: { terrain: number; historic: number; spectral: number } | null): { title: string; subtitle: string } {
    if (!breakdown) return { title: 'No scan data yet', subtitle: 'Run a scan to read the historic landscape context for this area.' };
    const strong = [breakdown.terrain, breakdown.historic, breakdown.spectral].filter(v => v >= 50).length;
    if (strong === 3) return { title: 'Strong historic context across this area', subtitle: 'Signals from terrain, historic density, and spectral response all align.' };
    if (strong === 2) return { title: 'Solid historic alignment detected', subtitle: 'Two key signals suggest meaningful past activity in this area.' };
    if (strong === 1) return { title: 'Partial historic signal present', subtitle: 'One indicator points to potential historic activity — worth investigating.' };
    return { title: 'Limited historic alignment', subtitle: 'Signals are weak or below threshold for a confident read.' };
}

function getSignalSummary(breakdown: { terrain: number; hydro: number; historic: number; spectral: number } | null): string[] {
    if (!breakdown) return [];
    const lines: string[] = [];
    if (breakdown.terrain >= 70) lines.push('Strong terrain relief — elevated ground or natural features present.');
    else if (breakdown.terrain >= 40) lines.push('Moderate terrain relief detected in the scan area.');
    else lines.push('Limited terrain variation — other signals carry more weight here.');
    if (breakdown.hydro >= 60) lines.push('Significant hydrological context — proximity to water sources.');
    else if (breakdown.hydro >= 30) lines.push('Some hydrological proximity — minor water influence.');
    if (breakdown.historic >= 70) lines.push('High historic density — multiple recorded finds or sites nearby.');
    else if (breakdown.historic >= 40) lines.push('Moderate historic density — some recorded activity in the wider area.');
    else lines.push('Low historic density from available records.');
    if (breakdown.spectral >= 60) lines.push('Strong spectral response — possible subsurface disturbance.');
    else if (breakdown.spectral >= 30) lines.push('Moderate spectral signal detected.');
    return lines;
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
    const [systemLog,              setSystemLog]              = useState<LogEntry[]>([makeLog('READY. Run scan to read landscape signals.')]);
    const [zoomWarning,            setZoomWarning]            = useState(false);
    const [isSatellite,            setIsSatellite]            = useState(false);
    const [scanCount,              setScanCount]              = useState(() => {
        try { return parseInt(localStorage.getItem('fs_fg_scan_count') || '0', 10); } catch { return 0; }
    });
    const [searchQuery,            setSearchQuery]            = useState('');
    const [isSearchOpen,           setIsSearchOpen]           = useState(false);
    const [isIntelOpen,            setIsIntelOpen]            = useState(false);
    const [intelDetailsOpen,       setIntelDetailsOpen]       = useState(false);
    const [intelLayersOpen,        setIntelLayersOpen]        = useState(false);
    const [targetPeriod,           setTargetPeriod]           = useState<'All' | 'Bronze Age' | 'Roman' | 'Medieval'>('All');
    const [isLocating,             setIsLocating]             = useState(false);
    const [selectedMonument,       setSelectedMonument]       = useState<string | null | undefined>(undefined); // undefined = not clicked, null = no name, string = named
    const [historicMode,           setHistoricMode]           = useState(false);
    const [historicLayerToggles,   setHistoricLayerToggles]   = useState({ lidar: false, os1930: false, os1880: false });
    const [historicLayerVisibility, setHistoricLayerVisibility] = useState({ routes: true, corridors: true, crossings: true, monuments: true, aim: true, context: true, userFinds: true });
    const [showFields,             setShowFields]             = useState<false | 'all' | string>(false);
    const [showFieldsPicker,       setShowFieldsPicker]       = useState(false);
    const [showLayerPicker,        setShowLayerPicker]        = useState(false);
    const [fieldPickerStep,        setFieldPickerStep]        = useState<'top' | string>('top'); // string = permId drilling into its fields
    const [mapClickLabel,          setMapClickLabel]          = useState<string | null>(null);
    const [expandedInterpretationId, setExpandedInterpretationId] = useState<string | null>(null);
    const [expandedTargetId,         setExpandedTargetId]         = useState<string | null>(null);
    const [compareHotspotIds,        setCompareHotspotIds]        = useState<string[]>([]);
    const [sheetExpanded,          setSheetExpanded]          = useState(() => { try { return localStorage.getItem('fs_fg_sheet') === '1'; } catch { return false; } });
    const [focusMode,              setFocusMode]              = useState(false);
    const [mobileSheetMode,        setMobileSheetMode]        = useState<'hotspots' | 'targets'>('hotspots');
    const sheetDragStartY = useRef<number | null>(null);
    const [pendingNotes,           setPendingNotes]           = useState<Record<string, string>>({});
    const [showPermissionPicker,   setShowPermissionPicker]   = useState(false);
    const [sourceAvailability,     setSourceAvailability]     = useState<Record<string, boolean> | null>(null);
    const [scanFromCache,          setScanFromCache]          = useState(false);
    // PAS / intel state
    const [pasFinds,        setPasFinds]        = useState<HistoricFind[]>([]);
    const [selectedPASFind, setSelectedPASFind] = useState<HistoricFind | null>(null);
    const [selectedUserFind, setSelectedUserFind] = useState<Find | null>(null);
    const [placeSignals,    setPlaceSignals]    = useState<PlaceSignal[]>([]);

    // Terrain scan centre — for drift guard in historic phase
    const terrainScanCenterRef = useRef<{ lat: number; lng: number } | null>(null);

    // User location marker (shown after GPS button press, persists for session)
    const userLocationMarkerRef = useRef<maplibregl.Marker | null>(null);
    const [userGpsPos, setUserGpsPos] = useState<[number, number] | null>(null);

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

    // ─── Find context for hotspot annotation ─────────────────────────────────
    const projectFinds = useLiveQuery(
        () => db.finds.where('projectId').equals(projectId).toArray(),
        [projectId]
    ) ?? [];
    const investigations = useLiveQuery(
        () => db.fieldGuideInvestigations.where('projectId').equals(projectId).toArray(),
        [projectId]
    ) ?? [];

    const selectedUserFindMedia = useLiveQuery<Media | undefined>(
        () => selectedUserFind
            ? db.media.where('findId').equals(selectedUserFind.id).filter(m => m.type === 'photo').first()
            : Promise.resolve(undefined),
        [selectedUserFind?.id]
    );

    const hotspotFindContext = useMemo((): Map<string, { status: 'within' | 'nearby'; count: number }> => {
        const map = new Map<string, { status: 'within' | 'nearby'; count: number }>();
        const geoFinds = projectFinds.filter(f => f.lat !== null && f.lon !== null);
        if (!geoFinds.length || !hotspots.length) return map;
        for (const h of hotspots) {
            const [[minLon, minLat], [maxLon, maxLat]] = h.bounds;
            let withinCount = 0;
            let nearbyCount = 0;
            for (const f of geoFinds) {
                const lon = f.lon!;
                const lat = f.lat!;
                if (lon >= minLon && lon <= maxLon && lat >= minLat && lat <= maxLat) {
                    withinCount++;
                } else if (getDistance([lon, lat], h.center) <= 150) {
                    nearbyCount++;
                }
            }
            if (withinCount > 0) map.set(h.id, { status: 'within', count: withinCount });
            else if (nearbyCount > 0) map.set(h.id, { status: 'nearby', count: nearbyCount });
        }
        return map;
    }, [projectFinds, hotspots]);

    const sortedHotspots = useMemo(() => {
        const sorted = [...hotspots].sort((a, b) => b.score - a.score);
        // Suppress General Activity Zone below score 35 unless fewer than 3 stronger
        // hotspots exist — prevents weak fallback classifications from dominating the list.
        const strong = sorted.filter(h => !(h.classification === 'General Activity Zone' && h.score < 35));
        if (strong.length >= 3) return strong;
        const fallback = sorted.filter(h => h.classification === 'General Activity Zone' && h.score >= 25);
        return [...strong, ...fallback];
    }, [hotspots]);

    // Source usability: three-state model distinguishing data-present vs signal-useful.
    // Satellite is only usable when both seasons loaded (enables multi-season agreement).
    // All other sources are usable if they loaded AND produced hotspot results.
    const sourceUsability = useMemo((): Record<string, 'usable' | 'loaded' | 'none'> => {
        if (!sourceAvailability) return {};
        const hasResults = sortedHotspots.length > 0;
        const bothSat = sourceAvailability.satellite_spring && sourceAvailability.satellite_summer;
        const result: Record<string, 'usable' | 'loaded' | 'none'> = {};
        for (const key of ['terrain', 'terrain_global', 'slope', 'hydrology', 'satellite_spring', 'satellite_summer']) {
            if (!sourceAvailability[key]) { result[key] = 'none'; continue; }
            if (key === 'satellite_spring' || key === 'satellite_summer') {
                result[key] = bothSat ? 'usable' : 'loaded';
            } else {
                result[key] = hasResults ? 'usable' : 'loaded';
            }
        }
        return result;
    }, [sourceAvailability, sortedHotspots]);

    const investigationMap = useMemo(() => {
        return new Map(investigations.map(i => [i.hotspotId, i]));
    }, [investigations]);

    const persistSheetExpanded = useCallback((expanded: boolean) => {
        setSheetExpanded(expanded);
        try { localStorage.setItem('fs_fg_sheet', expanded ? '1' : '0'); } catch {}
    }, []);

    const updateHotspotInvestigation = useCallback(async (
        hotspotId: string,
        changes: { status?: FieldGuideInvestigationStatus; notes?: string },
    ) => {
        const id = `${projectId}:${hotspotId}`;
        const now = new Date().toISOString();
        await db.transaction('rw', db.fieldGuideInvestigations, async () => {
            const existing = await db.fieldGuideInvestigations.get(id);
            await db.fieldGuideInvestigations.put({
                id,
                projectId,
                hotspotId,
                status: changes.status ?? existing?.status ?? 'unreviewed',
                notes: changes.notes ?? existing?.notes,
                createdAt: existing?.createdAt ?? now,
                updatedAt: now,
            });
        });
    }, [projectId]);

    const setHotspotInvestigationStatus = useCallback(async (hotspotId: string, status: FieldGuideInvestigationStatus) => {
        await updateHotspotInvestigation(hotspotId, { status });
    }, [updateHotspotInvestigation]);

    const saveHotspotNote = useCallback(async (hotspotId: string, notes: string) => {
        await updateHotspotInvestigation(hotspotId, { notes });
    }, [updateHotspotInvestigation]);

    const handleSheetTouchStart = useCallback((e: React.TouchEvent) => {
        sheetDragStartY.current = e.touches[0].clientY;
    }, []);

    const handleSheetTouchEnd = useCallback((e: React.TouchEvent) => {
        if (sheetDragStartY.current === null) return;
        const delta = sheetDragStartY.current - e.changedTouches[0].clientY;
        sheetDragStartY.current = null;
        if (Math.abs(delta) < 20) return;
        persistSheetExpanded(delta > 0);
    }, [persistSheetExpanded]);

    const toggleCompareHotspot = useCallback((hotspotId: string) => {
        setCompareHotspotIds(prev => {
            if (prev.includes(hotspotId)) return prev.filter(id => id !== hotspotId);
            return [...prev.slice(-1), hotspotId];
        });
    }, []);

    const compareHotspots = useMemo(() => {
        return compareHotspotIds
            .map(id => sortedHotspots.find(h => h.id === id))
            .filter((h): h is Hotspot => Boolean(h));
    }, [compareHotspotIds, sortedHotspots]);

    const targetFindContext = useMemo((): Map<string, { status: 'within' | 'nearby'; count: number }> => {
        const map = new Map<string, { status: 'within' | 'nearby'; count: number }>();
        const geoFinds = projectFinds.filter(f => f.lat !== null && f.lon !== null);
        if (!geoFinds.length || !detectedFeatures.length) return map;
        for (const t of detectedFeatures) {
            let withinCount = 0;
            let nearbyCount = 0;
            for (const f of geoFinds) {
                const d = getDistance([f.lon!, f.lat!], t.center);
                if (d <= 35) withinCount++;
                else if (d <= 100) nearbyCount++;
            }
            if (withinCount > 0) map.set(t.id, { status: 'within', count: withinCount });
            else if (nearbyCount > 0) map.set(t.id, { status: 'nearby', count: nearbyCount });
        }
        return map;
    }, [projectFinds, detectedFeatures]);

    // Targets that pass both evidence gates — shown in sidebar and list.
    // Protected targets always show regardless of evidence (they carry their own warning).
    // Capped at 12 per scan to keep the list actionable.
    const displayTargets = useMemo(() => {
        return detectedFeatures
            .filter(f => f.isProtected || (
                hasTargetEvidence(f) &&
                hasLocalPhysicalEvidence(f) &&
                !f.isRouteArtefactRisk
            ))
            .sort((a, b) => b.findPotential - a.findPotential)
            .slice(0, 12);
    }, [detectedFeatures]);

    // ─── Primary target selection ─────────────────────────────────────────────
    // Exactly one non-protected target is promoted as "Start here".
    // Tie-break order: highest score → closest to GPS → closest to centroid → hash.
    const primaryTargetId = useMemo(() => {
        const candidates = displayTargets.filter(f => !f.isProtected);
        if (!candidates.length) return null;
        const dist = ([ax, ay]: [number, number], [bx, by]: [number, number]) =>
            Math.sqrt((ax - bx) ** 2 + (ay - by) ** 2);
        const cx = candidates.reduce((s, f) => s + f.center[0], 0) / candidates.length;
        const cy = candidates.reduce((s, f) => s + f.center[1], 0) / candidates.length;
        const ref: [number, number] = userGpsPos ?? [cx, cy];
        const sorted = [...candidates].sort((a, b) => {
            if (b.findPotential !== a.findPotential) return b.findPotential - a.findPotential;
            const dDist = dist(a.center, ref) - dist(b.center, ref);
            if (Math.abs(dDist) > 1e-9) return dDist;
            // Deterministic hash tie-break
            const hash = (s: string) => s.split('').reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 0);
            return hash(a.id) - hash(b.id);
        });
        return sorted[0].id;
    }, [displayTargets, userGpsPos]);

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

    const logContainerRef  = useRef<HTMLDivElement>(null);
    const scrollRef        = useRef<HTMLDivElement>(null);
    const sheetScrollRef   = useRef<HTMLDivElement>(null);

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
        hotspots, selectedHotspotId, detectedFeatures, primaryTargetId, pasFinds, historicRoutes,
        fieldBoundaries: [
            ...fields.filter(f => f.boundary).map(f => ({ id: f.id, name: f.name, permissionId: f.permissionId, boundary: f.boundary })),
            // Fall back to the permission's own boundary when no fields have been drawn
            ...permissions.filter(p => p.boundary && !fields.some(f => f.permissionId === p.id)).map(p => ({ id: p.id, name: p.name, permissionId: p.id, boundary: p.boundary! })),
        ],
        isSatellite, historicMode, showFields, historicLayerVisibility, historicLayerToggles,
        userFinds: projectFinds,
        initLat, initLng,
        callbacks: {
            onFeatureClick:  (id)  => { setMobileSheetMode('targets'); setSelectedHotspotId(null); setSelectedId(id); persistSheetExpanded(true); },
            onHotspotClick:  (id)  => {
                setMobileSheetMode('hotspots');
                setShowSuggestion(false);
                setSelectedHotspotId(id);
                persistSheetExpanded(true);
                const h = hotspots.find(h => h.id === id);
                if (h) mapRef.current?.fitBounds(h.bounds as maplibregl.LngLatBoundsLike, { padding: 40 });
            },
            onDeselect:      ()    => { setShowSuggestion(false); setSelectedHotspotId(null); setSelectedId(null); setShowFieldsPicker(false); setFieldPickerStep('top'); setSelectedMonument(undefined); setSelectedUserFind(null); setSelectedPASFind(null); persistSheetExpanded(false); },
            onDragStart:     ()    => { setShowSuggestion(false); setShowFieldsPicker(false); setFieldPickerStep('top'); persistSheetExpanded(false); },
            onZoomChange:    (z)   => setZoomWarning(z > SCAN_CONFIG.ZOOM_WARNING),
            onSetClickLabel: (l)   => setMapClickLabel(l),
            onPASFindLog:    (msg) => addLog(msg, 'historic'),
            onPASFindSelect: (f)   => { setSelectedPASFind(f); persistSheetExpanded(true); },
            onCrossingsLog:  (msg) => addLog(msg, 'historic'),
            onMonumentClick: (name) => { setSelectedMonument(name === null ? undefined : (name || null)); if (name !== null) persistSheetExpanded(true); },
            onUserFindClick: (id)   => { setSelectedUserFind(projectFinds.find(f => f.id === id) ?? null); persistSheetExpanded(true); },
        },
    });

    useTilePrewarm(mapRef);

    useEffect(() => {
        const map = mapRef.current;
        if (!map) return;
        const timer = window.setTimeout(() => map.resize(), 320);
        map.resize();
        return () => window.clearTimeout(timer);
    }, [focusMode, sheetExpanded]); // eslint-disable-line react-hooks/exhaustive-deps

    // ─── Clear / Reset ────────────────────────────────────────────────────────

    const clearScan = useCallback(() => {
        cancelTerrain();
        cancelHistoric();
        dispatch({ type: 'CLEAR_SCAN' });
        setSelectedId(null);
        setSelectedHotspotId(null);
        setMobileSheetMode('hotspots');
        setShowSuggestion(false);
        setShowPermissionPicker(false);
        setShowFieldsPicker(false);
        setFieldPickerStep('top');
        setScanStatus('');
        setSystemLog([makeLog('SYSTEM CLEARED. Ready for new scan.')]);
        setPasFinds([]);
        setPlaceSignals([]);
        setPotentialScore(null);
        setScanConfidence(null);
        setHistoricMode(false);
        setHistoricLayerToggles({ lidar: false, os1930: false, os1880: false });
        setHistoricLayerVisibility({ routes: true, corridors: true, crossings: true, monuments: true, aim: true, context: true, userFinds: true });
        setMapClickLabel(null);
        setSelectedMonument(undefined);
        setSelectedUserFind(null);
        terrainScanCenterRef.current = null;
        setSourceAvailability(null);
        setScanFromCache(false);
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

        dispatch({ type: 'SET_HERITAGE_COUNT', count: result.heritageCount, monumentPoints: result.monumentPoints });

        if (!result.drifted && result.enhancedHotspots.length > 0) {
            setSelectedHotspotId(null);   // dismiss the terrain-phase selection; user chooses from enhanced list
            setShowSuggestion(false);
            dispatch({ type: 'HISTORIC_ENHANCE', hotspots: result.enhancedHotspots });
        }
    }, [runHistoricScan, permissions, fields, targetPeriod, calculatePotentialScore]); // eslint-disable-line react-hooks/exhaustive-deps

    // ─── Main terrain scan ────────────────────────────────────────────────────

    const executeScan = async () => {
        if (!mapRef.current || analyzing) return;

        setScanCount(prev => {
            const next = prev + 1;
            try { localStorage.setItem('fs_fg_scan_count', String(next)); } catch {}
            return next;
        });
        clearScan();
        dispatch({ type: 'SCAN_START' });
        addLog('> SCAN: Reading terrain at survey zoom.', 'terrain');

        const result = await runTerrainScan({ mapRef, permissions, fields, targetPeriod });

        if (!result) {
            dispatch({ type: 'SCAN_FAIL' });
            return;
        }

        // Push NHLE and AIM data to map sources
        applyNhleToMap(result.nhleData);
        applyAimToMap(result.aimData);

        setSourceAvailability(result.sourceAvailability ?? null);
        setScanFromCache(result.fromCache);

        dispatch({
            type: 'SCAN_SUCCESS',
            features:       result.detectedFeatures,
            hotspots:       result.hotspots,
            monumentPoints: result.monumentPoints,
            routes:         result.routes,
            heritageCount:  result.heritageCount,
        });

        // Highlight the top hotspot without moving the map away from the user's chosen view.
        if (!hasScanned && result.hotspots.length > 0) {
            setShowSuggestion(true);
            setSelectedHotspotId(result.hotspots[0].id);
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

    // ─── Standalone historic scan (context drawer / historic layers button) ───

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
        // Open the intel panel after a user-triggered historic scan
        setIsIntelOpen(true);
        setIntelDetailsOpen(false);
    }, [isHistoricScanning, terrainClusters, monumentPoints, historicRoutes, runHistoricPhase]);

    // ─── Auto-trigger effects ─────────────────────────────────────────────────

    useEffect(() => {
        if (isIntelOpen && !isHistoricScanning && pasFinds.length === 0 && placeSignals.length === 0) loadStandaloneHistoric();
    }, [isIntelOpen]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        if (historicMode && !isHistoricScanning && pasFinds.length === 0 && placeSignals.length === 0) loadStandaloneHistoric();
    }, [historicMode]); // eslint-disable-line react-hooks/exhaustive-deps


    // ─── Scroll on feature select ─────────────────────────────────────────────

    useEffect(() => {
        if (selectedId) {
            const el = document.getElementById(`card-${selectedId}`);
            if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'start' });
        }
    }, [selectedId]);

    // Reset sheet scroll to top whenever a card opens in the panel
    useEffect(() => {
        if (selectedId || selectedUserFind || selectedPASFind || selectedMonument !== undefined) {
            sheetScrollRef.current?.scrollTo({ top: 0 });
        }
    }, [selectedId, selectedUserFind, selectedPASFind, selectedMonument]);

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
                setUserGpsPos([longitude, latitude]);
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
    const terrainScanComplete = hasScanned && !analyzing && !isTerrainScanning && detectedFeatures.length > 0;
    const historicScanComplete = historicMode && isIntelOpen && !loadingPAS;

    // ─── Render ───────────────────────────────────────────────────────────────

    return (
        <div className={focusMode ? 'fixed inset-0 z-[200] flex flex-col bg-slate-950 overflow-hidden' : 'flex flex-col h-[calc(100vh-140px)] landscape:h-[calc(100vh-100px)] sm:h-[calc(100vh-220px)] bg-slate-950 rounded-3xl overflow-hidden border border-slate-800 shadow-2xl relative'}>
            <header className={`bg-slate-900/80 border-b border-white/5 shrink-0 z-50 backdrop-blur-md${focusMode ? ' hidden' : ''}`}>
                {/* Bottom Row: Primary FieldGuide Actions */}
                <div className="hidden justify-between items-center gap-3 px-3 sm:px-4 py-2 bg-black/20 relative">
                    <div className="flex gap-2 items-center min-w-0 relative">
                        <button
                            onClick={() => {
                                if (analyzing) return;
                                if (!historicMode) { clearScan(); setHistoricMode(true); }
                                else { setIsIntelOpen(false); setIntelDetailsOpen(false); setIntelLayersOpen(false); setHistoricMode(false); setHistoricLayerToggles({ lidar: false, os1930: false, os1880: false }); }
                            }}
                            disabled={analyzing}
                            className={`px-3 sm:px-4 py-2 rounded-lg text-[10px] font-black tracking-widest uppercase border transition-all shadow-lg whitespace-nowrap ${analyzing ? 'bg-slate-700 text-slate-400 border-slate-600 opacity-60 cursor-not-allowed' : historicMode ? 'bg-slate-600 text-white border-slate-500' : 'bg-blue-600 text-white border-blue-400/50 shadow-[0_0_15px_rgba(37,99,235,0.3)]'} ${loadingPAS && historicMode ? 'animate-pulse opacity-80' : ''}`}
                        >
                            {(loadingPAS && historicMode) ? 'Reading...' : historicMode ? 'Clear' : 'Historic Layers'}
                        </button>
                    </div>

                    <div className="flex gap-2 items-center shrink-0 relative">
                        <button onClick={findMe} disabled={isLocating} className="bg-slate-800 text-white px-3 sm:px-4 py-2 rounded-lg text-[10px] font-black tracking-widest uppercase hover:bg-slate-700 transition-colors disabled:opacity-50 whitespace-nowrap">
                            {isLocating ? '...' : 'GPS'}
                        </button>
                        <button
                            onClick={detectedFeatures.length > 0 ? clearScan : executeScan}
                            disabled={analyzing || isTerrainScanning}
                            title={detectedFeatures.length > 0 ? 'Clear scan results' : 'Scan area locked to Z16 for precision'}
                            className={`px-3 sm:px-4 py-2 rounded-lg text-[10px] font-black tracking-widest uppercase transition-all whitespace-nowrap disabled:opacity-50 disabled:animate-pulse ${detectedFeatures.length > 0 ? 'bg-slate-600 text-white hover:bg-slate-500' : 'bg-emerald-500 text-white hover:bg-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.3)]'}`}
                        >
                            {analyzing || isTerrainScanning ? '...' : detectedFeatures.length > 0 ? 'Clear' : 'Scan Terrain'}
                        </button>
                    </div>
                </div>
            </header>

            <div className="flex flex-1 overflow-hidden relative">
                <div className="flex-1 relative bg-slate-900">
                    <div ref={mapContainerRef} className="absolute inset-0" />

                    {/* My Fields Picker */}
                    {showFieldsPicker && (
                        <div className="absolute left-3 right-3 bottom-[150px] z-[110] animate-in fade-in slide-in-from-bottom-2 duration-150 lg:top-2 lg:left-2 lg:right-auto lg:bottom-auto lg:slide-in-from-top-2">
                            <div className="bg-slate-900/95 border border-white/10 rounded-xl shadow-2xl backdrop-blur-md p-2 w-full max-h-[45vh] overflow-y-auto lg:w-auto lg:min-w-[170px] lg:max-w-[220px] lg:max-h-[60vh]">
                                {fieldPickerStep === 'top' ? (
                                    <>
                                        <p className="text-[7px] font-black text-white/30 uppercase tracking-widest px-1 mb-1.5">Show fields</p>
                                        <button
                                            onClick={() => { setShowFields(false); setShowFieldsPicker(false); }}
                                            className={`w-full text-left px-3 py-1.5 rounded-lg text-[11px] font-bold transition-all truncate mb-0.5 ${showFields === false ? 'bg-teal-500/20 border border-teal-500/40 text-teal-300' : 'bg-white/5 border border-white/10 text-white/50 hover:text-white hover:bg-white/10'}`}
                                        >
                                            Off
                                        </button>
                                        {(fields.some(f => f.boundary) || permissions.some(p => p.boundary && !fields.some(f => f.permissionId === p.id))) && (
                                            <button
                                                onClick={() => { setShowFields('all'); setShowFieldsPicker(false); }}
                                                className={`w-full text-left px-3 py-1.5 rounded-lg text-[11px] font-bold transition-all truncate mb-1 ${showFields === 'all' ? 'bg-teal-500/20 border border-teal-500/40 text-teal-300' : 'bg-white/5 border border-white/10 text-white/70 hover:text-white hover:bg-white/10'}`}
                                            >
                                                All fields
                                            </button>
                                        )}
                                        {realPermissions.map(p => {
                                                const permFieldCount = fields.filter(f => f.permissionId === p.id && f.boundary).length;
                                                const hasBoundaries = permFieldCount > 0 || (permFieldCount === 0 && !!p.boundary);
                                                const isActive = showFields === p.id || (typeof showFields === 'string' && showFields.startsWith('field:') && fields.find(f => f.id === showFields.slice(6))?.permissionId === p.id);
                                                return (
                                                    <button
                                                        key={p.id}
                                                        onClick={() => {
                                                            if (!hasBoundaries) return;
                                                            if (permFieldCount > 1) {
                                                                setFieldPickerStep(p.id);
                                                            } else {
                                                                setShowFields(p.id);
                                                                setShowFieldsPicker(false);
                                                                const boundary = permFieldCount === 1
                                                                    ? fields.find(f => f.permissionId === p.id && f.boundary)?.boundary
                                                                    : p.boundary;
                                                                if (boundary?.coordinates?.[0] && mapRef.current) {
                                                                    const bounds = new maplibregl.LngLatBounds();
                                                                    (boundary.coordinates[0] as [number, number][]).forEach(pt => bounds.extend(pt));
                                                                    mapRef.current.fitBounds(bounds, { padding: 60 });
                                                                }
                                                            }
                                                        }}
                                                        className={`w-full text-left px-3 py-1.5 rounded-lg text-[11px] font-bold transition-all truncate mt-0.5 flex items-center justify-between gap-2 ${isActive ? 'bg-teal-500/20 border border-teal-500/40 text-teal-300' : hasBoundaries ? 'bg-white/5 border border-white/10 text-white/70 hover:text-white hover:bg-white/10' : 'bg-white/5 border border-white/5 text-white/25 cursor-default'}`}
                                                    >
                                                        <span className="truncate">{p.name || '(Unnamed)'}</span>
                                                        {!hasBoundaries
                                                            ? <span className="text-[8px] font-normal opacity-50 shrink-0">No boundaries</span>
                                                            : permFieldCount > 1 && <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="shrink-0 opacity-50"><polyline points="9 18 15 12 9 6"/></svg>
                                                        }
                                                    </button>
                                                );
                                            })
                                        }
                                    </>
                                ) : (
                                    <>
                                        {/* Field-level drill-down for a specific permission */}
                                        <button
                                            onClick={() => setFieldPickerStep('top')}
                                            className="flex items-center gap-1 text-[9px] font-black text-white/40 hover:text-white/70 uppercase tracking-widest px-1 mb-1.5 transition-colors"
                                        >
                                            <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="15 18 9 12 15 6"/></svg>
                                            {realPermissions.find(p => p.id === fieldPickerStep)?.name ?? 'Back'}
                                        </button>
                                        <button
                                            onClick={() => { setShowFields(fieldPickerStep); setShowFieldsPicker(false); setFieldPickerStep('top'); }}
                                            className={`w-full text-left px-3 py-1.5 rounded-lg text-[11px] font-bold transition-all truncate mb-1 ${showFields === fieldPickerStep ? 'bg-teal-500/20 border border-teal-500/40 text-teal-300' : 'bg-white/5 border border-white/10 text-white/70 hover:text-white hover:bg-white/10'}`}
                                        >
                                            All fields
                                        </button>
                                        {fields
                                            .filter(f => f.permissionId === fieldPickerStep && f.boundary)
                                            .map(f => (
                                                <button
                                                    key={f.id}
                                                    onClick={() => {
                                                        setShowFields(`field:${f.id}`);
                                                        setShowFieldsPicker(false);
                                                        setFieldPickerStep('top');
                                                        if (f.boundary?.coordinates?.[0] && mapRef.current) {
                                                            const bounds = new maplibregl.LngLatBounds();
                                                            (f.boundary.coordinates[0] as [number, number][]).forEach(pt => bounds.extend(pt));
                                                            mapRef.current.fitBounds(bounds, { padding: 60 });
                                                        }
                                                    }}
                                                    className={`w-full text-left px-3 py-1.5 rounded-lg text-[11px] font-bold transition-all truncate mt-0.5 ${showFields === `field:${f.id}` ? 'bg-teal-500/20 border border-teal-500/40 text-teal-300' : 'bg-white/5 border border-white/10 text-white/70 hover:text-white hover:bg-white/10'}`}
                                                >
                                                    {f.name || '(Unnamed)'}
                                                </button>
                                            ))
                                        }
                                    </>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Map Layer Toggle + Search */}
                    {showLayerPicker && <div className="fixed inset-0 z-[58] lg:hidden" onClick={() => setShowLayerPicker(false)} />}
                    <div className="absolute top-4 right-4 z-[59] flex flex-col gap-2 lg:hidden">
                        <button
                            onClick={() => { setIsSearchOpen(!isSearchOpen); setShowLayerPicker(false); }}
                            aria-label={isSearchOpen ? 'Close search' : 'Search place'}
                            className={`w-10 h-10 flex items-center justify-center rounded-xl border shadow-xl backdrop-blur-md transition-all active:scale-95 ${isSearchOpen ? 'bg-emerald-500 border-white text-white' : 'bg-slate-900/90 border-white/10 text-slate-300'}`}
                        >
                            {isSearchOpen ? (
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                    <line x1="18" y1="6" x2="6" y2="18" />
                                    <line x1="6" y1="6" x2="18" y2="18" />
                                </svg>
                            ) : (
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                    <circle cx="11" cy="11" r="8" />
                                    <path d="m21 21-4.3-4.3" />
                                </svg>
                            )}
                        </button>
                        <div className="relative">
                            <button
                                onClick={() => setShowLayerPicker(v => !v)}
                                aria-label="Map layers"
                                className={`w-10 h-10 flex items-center justify-center rounded-xl border shadow-xl backdrop-blur-md transition-all active:scale-95 relative ${showLayerPicker || isSatellite || historicLayerToggles.lidar || historicLayerToggles.os1880 || historicLayerToggles.os1930 ? 'bg-slate-900/90 border-emerald-500/50 text-emerald-400' : 'bg-slate-900/90 border-white/10 text-slate-300'}`}
                            >
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                    <polygon points="12 2 2 7 12 12 22 7 12 2"/>
                                    <polyline points="2 17 12 22 22 17"/>
                                    <polyline points="2 12 12 17 22 12"/>
                                </svg>
                                {(isSatellite || historicLayerToggles.lidar || historicLayerToggles.os1880 || historicLayerToggles.os1930) && (
                                    <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-emerald-400" />
                                )}
                            </button>
                            {showLayerPicker && (
                                <div className="absolute top-12 right-0 z-[60] bg-slate-900/95 border border-white/12 rounded-xl shadow-2xl backdrop-blur-xl p-2 min-w-[130px] animate-in fade-in slide-in-from-top-1 duration-150">
                                    <p className="text-[7px] font-black text-white/30 uppercase tracking-widest px-1.5 mb-1.5">Map Style</p>
                                    <button onClick={() => setIsSatellite(v => !v)} className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[10px] font-bold transition-all mb-0.5 ${isSatellite ? 'bg-emerald-500/20 border border-emerald-500/40 text-emerald-300' : 'text-white/50 hover:text-white hover:bg-white/5'}`}>
                                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
                                        Satellite
                                    </button>
                                    <p className="text-[7px] font-black text-white/30 uppercase tracking-widest px-1.5 mt-2 mb-1.5">Overlays</p>
                                    <button onClick={() => setHistoricLayerToggles(p => ({ ...p, lidar: !p.lidar }))} className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[10px] font-bold transition-all mb-0.5 ${historicLayerToggles.lidar ? 'bg-emerald-500/20 border border-emerald-500/40 text-emerald-300' : 'text-white/50 hover:text-white hover:bg-white/5'}`}>
                                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M3 17l9-14 9 14H3z"/></svg>
                                        LiDAR
                                    </button>
                                    <button onClick={() => setHistoricLayerToggles(p => ({ ...p, os1880: !p.os1880 }))} className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[10px] font-bold transition-all mb-0.5 ${historicLayerToggles.os1880 ? 'bg-amber-500/20 border border-amber-500/40 text-amber-300' : 'text-white/50 hover:text-white hover:bg-white/5'}`}>
                                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg>
                                        OS 1895
                                    </button>
                                    <button onClick={() => setHistoricLayerToggles(p => ({ ...p, os1930: !p.os1930 }))} className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[10px] font-bold transition-all mb-0.5 ${historicLayerToggles.os1930 ? 'bg-orange-500/20 border border-orange-500/40 text-orange-300' : 'text-white/50 hover:text-white hover:bg-white/5'}`}>
                                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg>
                                        OS 1900
                                    </button>
                                    <p className="text-[7px] font-black text-white/30 uppercase tracking-widest px-1.5 mt-2 mb-1.5">Finds</p>
                                    <button onClick={() => setHistoricLayerVisibility(p => ({ ...p, userFinds: !p.userFinds }))} className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[10px] font-bold transition-all ${historicLayerVisibility.userFinds ? 'text-white/50 hover:text-white hover:bg-white/5' : 'bg-white/10 border border-white/20 text-white/70'}`}>
                                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                                        My Finds
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                    {/* Desktop map controls (search + satellite unchanged) */}
                    <div className="absolute top-4 right-4 z-[59] hidden lg:flex flex-col gap-2">
                        <button
                            onClick={() => setIsSearchOpen(!isSearchOpen)}
                            aria-label={isSearchOpen ? 'Close search' : 'Search place'}
                            className={`w-10 h-10 flex items-center justify-center rounded-xl border shadow-xl backdrop-blur-md transition-all active:scale-95 ${isSearchOpen ? 'bg-emerald-500 border-white text-white' : 'bg-slate-900/90 border-white/10 text-slate-300'}`}
                        >
                            {isSearchOpen ? (
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                            ) : (
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></svg>
                            )}
                        </button>
                        <button
                            onClick={() => setIsSatellite(!isSatellite)}
                            className={`w-10 h-10 flex items-center justify-center rounded-xl border shadow-xl backdrop-blur-md transition-all active:scale-95 ${isSatellite ? 'bg-emerald-500 border-white text-white' : 'bg-slate-900/90 border-white/10 text-slate-300'}`}
                        >
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2" /><polyline points="2 17 12 22 22 17" /><polyline points="2 12 12 17 22 12" /></svg>
                        </button>
                    </div>

                    {/* Floating Search Input */}
                    {isSearchOpen && (
                        <div className="absolute top-4 left-4 right-16 z-[60]">
                            <form onSubmit={searchLocation}>
                                <input
                                    autoFocus
                                    value={searchQuery}
                                    onChange={e => setSearchQuery(e.target.value)}
                                    placeholder="Search place..."
                                    className="w-full bg-slate-900/90 border border-white/10 text-white px-3 py-2.5 rounded-xl text-xs outline-none focus:ring-1 focus:ring-emerald-500 shadow-xl backdrop-blur-md"
                                />
                            </form>
                        </div>
                    )}

                    {/* Center Reticle */}
                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none z-20">
                        <div className="w-10 h-10 border-2 border-emerald-500/50 rounded-full flex items-center justify-center">
                            <div className="w-1 h-1 bg-emerald-500 rounded-full" />
                        </div>
                    </div>

                    {/* Floating Alerts */}
                    <div className="absolute top-12 left-1/2 -translate-x-1/2 z-[100] flex flex-col gap-2 items-center pointer-events-none w-[90%] max-w-sm">
                        {!analyzing && !historicMode && detectedFeatures.length === 0 && hotspots.length === 0 && scanCount < 1 && realPermissions.length === 0 && projectFinds.length === 0 && (
                            <div className="bg-slate-700/60 text-slate-200 px-4 py-2 rounded-full text-[9px] sm:text-[10px] font-black tracking-widest uppercase shadow-lg border border-white/10 backdrop-blur-md">
                                Navigate, search or GPS to your area · then scan
                            </div>
                        )}
                        {mapClickLabel && (
                            <div className="bg-slate-900/95 text-white px-4 py-1.5 rounded-full text-[9px] font-black tracking-widest uppercase shadow-2xl border border-blue-500/40">
                                {mapClickLabel}
                            </div>
                        )}
                        {zoomWarning && !historicLayerToggles.lidar && (
                            <div className="bg-amber-500 text-black px-4 py-1.5 rounded-full text-[8px] sm:text-[10px] font-black tracking-widest uppercase shadow-2xl border border-white/20">
                                ⚠️ MAX SCAN ZOOM
                            </div>
                        )}
                    </div>

                    {/* Mobile Bottom Sheet */}
                    {(!isIntelOpen || historicMode || selectedMonument !== undefined || !!selectedUserFind || !!selectedPASFind || (!!selectedId && !selectedHotspotId)) && (
                        <div
                            className={`absolute bottom-3 left-3 right-3 z-[85] lg:hidden flex flex-col bg-black/95 border border-white/12 rounded-2xl shadow-2xl backdrop-blur-xl overflow-hidden transition-[max-height] duration-300 ease-out ${sheetExpanded ? 'max-h-[65vh]' : 'max-h-[136px]'}`}
                            onTouchStart={handleSheetTouchStart}
                            onTouchEnd={handleSheetTouchEnd}
                        >
                            {/* Handle + Status + Actions — always visible */}
                            <div className="shrink-0 h-[136px] px-4 pt-2 pb-3 border-b border-white/5 cursor-pointer select-none flex flex-col gap-2.5" onClick={() => persistSheetExpanded(!sheetExpanded)}>
                                <div className="mx-auto h-1 w-8 rounded-full bg-white/20" />
                                <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                        <div className="flex items-center gap-2 mb-0.5">
                                            <p className="text-[15px] font-black text-white leading-tight truncate">
                                                {analyzing || isTerrainScanning || loadingPAS ? (scanStatus || 'Reading landscape signals') : selectedUserFind ? 'Your Find' : selectedPASFind ? 'Heritage Feature' : (selectedId && !selectedHotspotId) ? (detectedFeatures.find(f => f.id === selectedId)?.isProtected ? 'Scheduled Monument' : 'Target Details') : selectedMonument !== undefined ? 'Scheduled Monument' : historicMode ? 'Historic Review' : hasScanned ? (mobileSheetMode === 'targets' ? 'Target Review' : 'Hotspot Review') : 'Ready to Scan'}
                                            </p>
                                            {selectedMonument === undefined && !analyzing && !isTerrainScanning && !loadingPAS && ((historicMode && historicScanComplete) || (!historicMode && hasScanned && mobileSheetMode === 'hotspots' && terrainScanComplete)) && (
                                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-300 shadow-[0_0_6px_rgba(52,211,153,0.8)] shrink-0" />
                                            )}
                                        </div>
                                        <p className="text-[10px] font-bold text-white/35 leading-tight truncate">
                                            {analyzing || isTerrainScanning || loadingPAS ? 'Reading scan data' : selectedUserFind ? 'Tap × to dismiss' : selectedPASFind ? 'Heritage record' : (selectedId && !selectedHotspotId) ? (detectedFeatures.find(f => f.id === selectedId)?.isProtected ? 'Legal protection applies' : 'Signal analysis') : selectedMonument !== undefined ? 'Legal protection applies' : historicMode ? 'Tap panel for historic details' : hasScanned && sortedHotspots.length === 0 && displayTargets.length === 0 ? 'Quiet spot - tap for scan notes' : hasScanned ? (mobileSheetMode === 'targets' ? 'Tap panel for investigation targets' : 'Tap panel to review hotspots') : 'Move the map, then run a scan'}
                                        </p>
                                    </div>
                                    <div className="flex items-center gap-1.5 shrink-0 pt-0.5">
                                        <button
                                            onClick={e => { e.stopPropagation(); setShowFieldsPicker(v => !v); setShowLayerPicker(false); }}
                                            className={`px-2 py-1.5 rounded-lg border text-[8px] font-black uppercase tracking-[0.14em] transition-colors ${showFields !== false ? 'bg-emerald-500/15 border-emerald-400/30 text-emerald-300' : 'bg-white/[0.04] border-white/10 text-emerald-400'}`}
                                        >
                                            {showFields !== false && showFields !== 'all'
                                                ? showFields.startsWith('field:')
                                                    ? (fields.find(f => f.id === showFields.slice(6))?.name?.split(' ')[0] ?? 'My Fields')
                                                    : (realPermissions.find(p => p.id === showFields)?.name?.split(' ')[0] ?? 'My Fields')
                                                : 'My Fields'}
                                        </button>
                                        <div className="w-7 h-7 rounded-lg border border-white/10 bg-white/[0.04] grid place-items-center">
                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" className={`text-white/45 transition-transform duration-300 ${sheetExpanded ? 'rotate-180' : ''}`}><polyline points="6 9 12 15 18 9"/></svg>
                                        </div>
                                    </div>
                                </div>
                                <div className="grid grid-cols-[auto_auto_1fr_1fr] gap-2" onClick={e => e.stopPropagation()}>
                                    <button onClick={findMe} disabled={isLocating} className="min-h-[34px] bg-slate-800/90 text-slate-200 px-2.5 rounded-xl text-[8px] font-black tracking-widest uppercase hover:bg-slate-700 hover:text-white transition-colors disabled:opacity-50 whitespace-nowrap border border-white/10 shrink-0">
                                        {isLocating ? '...' : 'GPS'}
                                    </button>
                                    <button onClick={() => setFocusMode(v => !v)} className={`min-h-[34px] px-2.5 rounded-xl border shrink-0 transition-colors ${focusMode ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300' : 'bg-slate-800/90 border-white/10 text-slate-200 hover:bg-slate-700 hover:text-white'}`} title={focusMode ? 'Exit focus' : 'Focus — full screen map'}>
                                        {focusMode
                                            ? <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="10" y1="14" x2="21" y2="3"/><line x1="3" y1="21" x2="14" y2="10"/></svg>
                                            : <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>
                                        }
                                    </button>
                                    <button
                                        onClick={detectedFeatures.length > 0 ? clearScan : executeScan}
                                        disabled={analyzing || isTerrainScanning}
                                        className={`min-h-[34px] px-3 rounded-xl text-[10px] font-black tracking-widest uppercase border transition-all whitespace-nowrap disabled:opacity-50 disabled:animate-pulse ${detectedFeatures.length > 0 ? 'bg-emerald-500/20 text-emerald-200 border-emerald-400/40' : 'bg-emerald-500 text-white border-emerald-300/50 shadow-[0_0_12px_rgba(16,185,129,0.22)] hover:bg-emerald-400'}`}
                                    >
                                        {analyzing || isTerrainScanning ? '...' : detectedFeatures.length > 0 ? 'Clear' : 'Terrain'}
                                    </button>
                                    <button
                                        onClick={() => {
                                            if (analyzing) return;
                                            if (!historicMode) { clearScan(); setHistoricMode(true); }
                                            else { setIsIntelOpen(false); setIntelDetailsOpen(false); setIntelLayersOpen(false); setHistoricMode(false); setHistoricLayerToggles({ lidar: false, os1930: false, os1880: false }); }
                                        }}
                                        disabled={analyzing}
                                        className={`min-h-[34px] px-3 rounded-xl text-[10px] font-black tracking-widest uppercase border transition-all whitespace-nowrap ${analyzing ? 'bg-slate-800 text-slate-500 border-white/5 opacity-60 cursor-not-allowed' : historicMode ? 'bg-blue-500 text-white border-blue-300/50 shadow-[0_0_12px_rgba(59,130,246,0.22)]' : 'bg-blue-500/15 text-blue-200 border-blue-500/35 hover:bg-blue-500/25'} ${loadingPAS && historicMode ? 'animate-pulse opacity-80' : ''}`}
                                    >
                                        {(loadingPAS && historicMode) ? '...' : historicMode ? 'Clear' : 'Historic'}
                                    </button>
                                </div>
                            </div>

                            {/* Scrollable content — inspector (when selected) or list */}
                            <div ref={sheetScrollRef} className="flex-1 overflow-y-auto scrollbar-hide px-3 py-3 space-y-4">

                                {/* Your Find — in panel (mobile) */}
                                {selectedUserFind && (() => {
                                    const PERIOD_CHIP: Record<string, string> = {
                                        'Prehistoric': 'bg-gray-700/60 text-gray-300', 'Bronze Age': 'bg-orange-900/50 text-orange-300',
                                        'Iron Age': 'bg-red-900/50 text-red-300', 'Celtic': 'bg-teal-900/50 text-teal-300',
                                        'Roman': 'bg-purple-900/50 text-purple-300', 'Anglo-Saxon': 'bg-amber-900/50 text-amber-300',
                                        'Early Medieval': 'bg-emerald-900/50 text-emerald-300', 'Medieval': 'bg-blue-900/50 text-blue-300',
                                        'Post-medieval': 'bg-indigo-900/50 text-indigo-300', 'Modern': 'bg-green-900/50 text-green-300',
                                        'Unknown': 'bg-white/5 text-white/40',
                                    };
                                    const chipClass = PERIOD_CHIP[selectedUserFind.period] ?? PERIOD_CHIP['Unknown'];
                                    const foundDate = selectedUserFind.foundAt ?? selectedUserFind.createdAt;
                                    const dateLabel = foundDate ? new Date(foundDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : null;
                                    return (
                                        <div className="space-y-3">
                                            <div className="flex items-start gap-3">
                                                <div className="w-16 h-16 rounded-xl overflow-hidden flex-shrink-0 border border-white/10">
                                                    {selectedUserFindMedia
                                                        ? <ScaledImage media={selectedUserFindMedia} className="w-full h-full" imgClassName="object-cover" showScale={false} />
                                                        : <div className="w-full h-full border border-dashed border-white/15 rounded-xl grid place-items-center text-[9px] font-black text-white/20 uppercase tracking-wider">No Photo</div>
                                                    }
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-start justify-between">
                                                        <h3 className="text-base font-black text-white tracking-tight leading-tight mb-1 pr-2">
                                                            {selectedUserFind.objectType || 'Unknown Object'}
                                                        </h3>
                                                        <button onClick={() => setSelectedUserFind(null)} className="bg-white/[0.04] hover:bg-white/[0.08] text-white/50 hover:text-white rounded-full p-1.5 transition-colors border border-white/10 flex-shrink-0 -mt-0.5">
                                                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                                                        </button>
                                                    </div>
                                                    <div className="flex items-center gap-1.5 flex-wrap">
                                                        <span className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest ${chipClass}`}>{selectedUserFind.period}</span>
                                                        {selectedUserFind.material && <span className="text-[10px] text-white/40">{selectedUserFind.material}</span>}
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-3 flex-wrap">
                                                {dateLabel && (
                                                    <span className="flex items-center gap-1 text-[10px] text-white/40">
                                                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                                                        {dateLabel}
                                                    </span>
                                                )}
                                                {selectedUserFind.depthCm != null && (
                                                    <span className="flex items-center gap-1 text-[10px] text-white/40">
                                                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="2" x2="12" y2="22"/><polyline points="6 16 12 22 18 16"/></svg>
                                                        {selectedUserFind.depthCm} cm
                                                    </span>
                                                )}
                                                {selectedUserFind.weightG != null && <span className="text-[10px] text-white/40">{selectedUserFind.weightG} g</span>}
                                            </div>
                                            {selectedUserFind.notes?.trim() && (
                                                <p className="text-[11px] text-white/40 italic leading-snug line-clamp-3">{selectedUserFind.notes.trim()}</p>
                                            )}
                                            <div className="border-t border-white/8 pt-2">
                                                <span className="text-[10px] text-white/25 font-mono">{selectedUserFind.findCode}</span>
                                            </div>
                                        </div>
                                    );
                                })()}

                                {/* Heritage Feature — in panel (mobile) */}
                                {selectedPASFind && !selectedUserFind && (
                                    <div className="space-y-3">
                                        <div className="flex items-start justify-between gap-2">
                                            <div className="min-w-0">
                                                <p className="text-[8px] font-black text-emerald-400 uppercase tracking-[0.2em] mb-1">Heritage Feature</p>
                                                <h3 className="text-sm font-black text-white tracking-tight leading-tight">{selectedPASFind.objectType}</h3>
                                                <p className="text-[11px] font-black text-emerald-400 mt-0.5">{selectedPASFind.broadperiod}</p>
                                            </div>
                                            <button onClick={() => setSelectedPASFind(null)} className="bg-white/[0.04] hover:bg-white/[0.08] text-white/50 hover:text-white rounded-full p-1.5 transition-colors border border-white/10 shrink-0">
                                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                                            </button>
                                        </div>
                                        <p className="text-[11px] font-bold text-white/70 leading-snug">Standing heritage feature recorded in the OpenStreetMap community dataset.</p>
                                        <a
                                            href={`https://www.openstreetmap.org/${selectedPASFind.osmType || 'node'}/${selectedPASFind.internalId}`}
                                            target="_blank" rel="noreferrer"
                                            className="flex items-center justify-center gap-2 w-full py-3 bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/30 text-emerald-300 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all active:scale-[0.98]"
                                        >
                                            View on OpenStreetMap
                                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                                        </a>
                                    </div>
                                )}

                                {/* Target Details — in panel (mobile) */}
                                {selectedId && !selectedHotspotId && !selectedUserFind && !selectedPASFind && detectedFeatures.filter(f => f.id === selectedId).map(f => {
                                    const tInterp = buildTargetInterpretation(f);
                                    const isPrimaryTarget = f.id === primaryTargetId;
                                    const strengthColour: Record<TargetSignalStrength, string> = {
                                        'Strong Signal': 'text-amber-400', 'Moderate Signal': 'text-emerald-400', 'Supporting Signal': 'text-white/40',
                                    };
                                    if (f.isProtected) return (
                                        <div key={f.id} className="space-y-3">
                                            <div className="flex items-start justify-between gap-3">
                                                <div className="min-w-0">
                                                    <p className="text-[8px] font-black text-stone-400/70 uppercase tracking-[0.2em] mb-1">Scheduled Monument</p>
                                                    {f.aimInfo && <h3 className="text-sm font-black text-white/90 tracking-tight leading-tight">{f.aimInfo.type}</h3>}
                                                </div>
                                                <button onClick={() => setSelectedId(null)} className="bg-white/[0.04] hover:bg-white/[0.08] text-white/50 hover:text-white rounded-full p-1.5 transition-colors border border-white/10 shrink-0">
                                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                                                </button>
                                            </div>
                                            <div className="rounded-xl bg-stone-900/40 border border-stone-700/40 p-3 space-y-2">
                                                <p className="text-xs font-bold text-stone-200/85 leading-snug">This area is protected as a Scheduled Monument.</p>
                                                <p className="text-[11px] font-bold text-stone-300/60 leading-snug">Metal detecting, excavation, or intrusive activity may require legal consent. Avoid disturbing the site boundary and check current protections before any fieldwork.</p>
                                            </div>
                                            {f.aimInfo && (
                                                <div className="p-2 rounded-xl border bg-stone-900/30 border-stone-700/30">
                                                    <p className="text-[9px] font-black uppercase text-stone-400/60 leading-tight mb-0.5">Recorded designation</p>
                                                    <p className="text-[10px] font-bold text-stone-200/70 leading-tight">{f.aimInfo.type} · {f.aimInfo.period}</p>
                                                </div>
                                            )}
                                        </div>
                                    );
                                    return (
                                        <div key={f.id} className="space-y-3">
                                            <div className="flex items-start justify-between gap-2">
                                                <div className="min-w-0">
                                                    {isPrimaryTarget && <span className="bg-emerald-500/20 border border-emerald-400/40 text-emerald-200 px-2 py-0.5 rounded-full text-[7px] font-black uppercase tracking-widest mb-1 inline-block">Start Here</span>}
                                                    <p className="text-[8px] font-black text-white/35 uppercase tracking-[0.2em]">Target {f.number}</p>
                                                    <h3 className="text-sm font-black text-white tracking-tight leading-tight mt-0.5">{f.type}</h3>
                                                    <p className={`text-xs font-black mt-0.5 ${strengthColour[tInterp.signalStrength]}`}>{tInterp.signalStrength}</p>
                                                </div>
                                                <button onClick={() => setSelectedId(null)} className="bg-white/[0.04] hover:bg-white/[0.08] text-white/50 hover:text-white rounded-full p-1.5 transition-colors border border-white/10 shrink-0">
                                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                                                </button>
                                            </div>
                                            <p className="text-xs font-black text-white/85 leading-snug">{getTargetVerdict(tInterp.signalStrength, isPrimaryTarget)}</p>
                                            <p className="text-[11px] font-bold text-white/50 leading-snug">{tInterp.hook}</p>
                                            {(() => {
                                                const ctx = targetFindContext.get(f.id);
                                                if (!ctx) return null;
                                                return ctx.status === 'within'
                                                    ? <p className="text-[9px] font-black text-emerald-400/80 uppercase tracking-widest">{ctx.count} find{ctx.count !== 1 ? 's' : ''} recorded here — signal supported</p>
                                                    : <p className="text-[9px] font-black text-emerald-400/80 uppercase tracking-widest">{ctx.count} find{ctx.count !== 1 ? 's' : ''} recorded nearby</p>;
                                            })()}
                                            {f.isHighConfidenceCrossing && (
                                                <div className="bg-blue-600/30 p-2 rounded-xl border border-blue-400/70 animate-pulse">
                                                    <p className="text-[10px] font-black uppercase text-white text-center tracking-[0.18em]">Likely historic crossing point</p>
                                                </div>
                                            )}
                                            {f.explanationLines && f.explanationLines.length > 0 && (
                                                <div className="border-t border-white/8 pt-3">
                                                    <p className="text-[8px] font-black text-white/40 uppercase tracking-widest mb-2">Why this matters</p>
                                                    <div className="space-y-1.5">
                                                        {f.explanationLines.slice(0, 3).map((line, idx) => (
                                                            <div key={idx} className="flex items-start gap-2">
                                                                <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 mt-1 shrink-0 shadow-[0_0_6px_rgba(52,211,153,0.7)]" />
                                                                <p className="text-xs font-bold text-white/80 leading-tight">{line}</p>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}
                                            <div className="border-t border-emerald-500/15 pt-2">
                                                <p className="text-[8px] font-black text-emerald-500/70 uppercase tracking-[0.12em] mb-1">Target focus</p>
                                                <p className="text-xs font-bold text-emerald-300 leading-snug">{tInterp.focus}</p>
                                            </div>
                                            {f.aimInfo && (
                                                <div className="p-2 rounded-xl border bg-amber-500/10 border-amber-400/30">
                                                    <p className="text-[9px] font-black uppercase text-amber-300 leading-tight mb-0.5">Historic verification</p>
                                                    <p className="text-[10px] font-bold text-white/80 leading-tight">{f.aimInfo.type} · {f.aimInfo.period}</p>
                                                </div>
                                            )}
                                            <div className="border-t border-white/8 pt-2">
                                                <span
                                                    onClick={() => setExpandedTargetId(expandedTargetId === f.id ? null : f.id)}
                                                    className="text-xs font-black text-amber-400 hover:text-amber-300 transition-colors cursor-pointer flex items-center gap-1"
                                                >
                                                    {expandedTargetId === f.id ? '▲ Hide reasoning' : '▼ See full reasoning'}
                                                </span>
                                                {expandedTargetId === f.id && (
                                                    <div className="mt-3 space-y-3 animate-in fade-in duration-200">
                                                        <div>
                                                            <p className="text-[8px] font-black text-white/55 uppercase tracking-[0.15em] mb-1">Summary</p>
                                                            <p className="text-[11px] text-white/85 leading-relaxed">{tInterp.summary}</p>
                                                        </div>
                                                        <div>
                                                            <p className="text-[8px] font-black text-white/55 uppercase tracking-[0.15em] mb-1">Why it stands out</p>
                                                            <p className="text-[11px] text-white/85 leading-relaxed">{tInterp.whyItStandsOut}</p>
                                                        </div>
                                                        <div>
                                                            <p className="text-[8px] font-black text-white/55 uppercase tracking-[0.15em] mb-1">How to approach it</p>
                                                            <p className="text-[11px] text-white/85 leading-relaxed">{tInterp.howToApproach}</p>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}

                                {selectedMonument !== undefined && !selectedUserFind && !selectedPASFind && !selectedId && (
                                    <div className="space-y-3">
                                        <div className="flex items-start justify-between gap-3">
                                            <div className="min-w-0">
                                                <p className="text-[8px] font-black text-stone-400/70 uppercase tracking-[0.2em] mb-1">Scheduled Monument</p>
                                                {selectedMonument && <h3 className="text-sm font-black text-white/90 tracking-tight leading-tight">{selectedMonument}</h3>}
                                            </div>
                                            <button onClick={() => setSelectedMonument(undefined)} className="bg-white/[0.04] hover:bg-white/[0.08] text-white/50 hover:text-white rounded-full p-1.5 transition-colors border border-white/10 shrink-0">
                                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                                            </button>
                                        </div>
                                        <div className="rounded-xl bg-stone-900/40 border border-stone-700/40 p-3 space-y-2">
                                            <p className="text-xs font-bold text-stone-200/85 leading-snug">This area is protected as a Scheduled Monument.</p>
                                            <p className="text-[11px] font-bold text-stone-300/60 leading-snug">Metal detecting, excavation, or intrusive activity may require legal consent. Avoid disturbing the site boundary and check current protections before any fieldwork.</p>
                                        </div>
                                    </div>
                                )}
                                {selectedMonument === undefined && !selectedUserFind && !selectedPASFind && !(selectedId && !selectedHotspotId) && historicMode && (() => {
                                    const bd = potentialScore?.breakdown ?? null;
                                    const interp = getHistoricInterpretation(bd ? { terrain: bd.terrain, historic: bd.historic, spectral: bd.signals } : null);
                                    const sigLines = getSignalSummary(bd ? { terrain: bd.terrain, hydro: bd.hydro, historic: bd.historic, spectral: bd.signals } : null);
                                    const hasData = pasFinds.length > 0 || historicRoutes.length > 0 || placeSignals.length > 0;
                                    const mc = mapRef.current?.getCenter();
                                    const nearbyProjectFinds = mc ? projectFinds.filter(f => f.lat !== null && f.lon !== null && getDistance([f.lon!, f.lat!], [mc.lng, mc.lat]) <= 500) : [];
                                    return (
                                        <div className="space-y-3">
                                            <div>
                                                <p className="text-[8px] font-black text-blue-300 uppercase tracking-[0.2em] mb-1">Landscape Context</p>
                                                <h3 className="text-sm font-black text-white tracking-tight leading-tight">{loadingPAS ? 'Reading historic layers' : interp.title}</h3>
                                                <p className="text-[11px] font-bold text-white/65 leading-snug mt-1">{loadingPAS ? 'Checking records, route context and wider landscape signals.' : interp.subtitle}</p>
                                            </div>
                                            {sigLines.length > 0 && (
                                                <div className="border-t border-white/8 pt-3">
                                                    <p className="text-[8px] font-black text-white/40 uppercase tracking-widest mb-2">Why this stands out</p>
                                                    <div className="space-y-2">
                                                        {sigLines.map((line, i) => (
                                                            <div key={i} className="flex items-start gap-2">
                                                                <div className="w-1 h-1 rounded-full bg-blue-400 mt-1.5 shrink-0 shadow-[0_0_6px_rgba(96,165,250,0.7)]" />
                                                                <p className="text-xs font-bold text-white/85 leading-tight">{line}</p>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}
                                            {hasData && (
                                                <div className="grid grid-cols-3 gap-2">
                                                    <div className="rounded-xl bg-blue-500/10 border border-blue-500/20 p-2 text-center">
                                                        <span className="block text-sm font-black text-blue-300">{pasFinds.length}</span>
                                                        <span className="text-[7px] font-black text-white/45 uppercase tracking-widest">Sites</span>
                                                    </div>
                                                    <div className="rounded-xl bg-blue-500/10 border border-blue-500/20 p-2 text-center">
                                                        <span className="block text-sm font-black text-blue-300">{historicRoutes.length}</span>
                                                        <span className="text-[7px] font-black text-white/45 uppercase tracking-widest">Routes</span>
                                                    </div>
                                                    <div className="rounded-xl bg-blue-500/10 border border-blue-500/20 p-2 text-center">
                                                        <span className="block text-sm font-black text-blue-300">{placeSignals.length}</span>
                                                        <span className="text-[7px] font-black text-white/45 uppercase tracking-widest">Names</span>
                                                    </div>
                                                </div>
                                            )}
                                            {nearbyProjectFinds.length > 0 && (
                                                <p className="text-[9px] font-black text-emerald-400/80 uppercase tracking-widest">{nearbyProjectFinds.length} find{nearbyProjectFinds.length !== 1 ? 's' : ''} recorded nearby</p>
                                            )}
                                            {sourceAvailability && (
                                                <div className="border-t border-white/8 pt-3">
                                                    <p className="text-[8px] font-black text-white/40 uppercase tracking-widest mb-2">Scan Source Coverage</p>
                                                    <div className="grid grid-cols-3 gap-1.5">
                                                        {[
                                                            { key: 'terrain', label: 'LiDAR' },
                                                            { key: 'terrain_global', label: 'Terrain' },
                                                            { key: 'slope', label: 'Slope' },
                                                            { key: 'hydrology', label: 'Water' },
                                                            { key: 'satellite_spring', label: 'Spring' },
                                                            { key: 'satellite_summer', label: 'Summer' },
                                                        ].map(({ key, label }) => {
                                                            const usability = sourceUsability[key] ?? 'none';
                                                            return (
                                                                <div key={key} className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg border ${usability === 'usable' ? 'bg-emerald-500/10 border-emerald-500/25' : usability === 'loaded' ? 'bg-white/5 border-white/15' : 'bg-white/3 border-white/8'}`}>
                                                                    <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${usability === 'usable' ? 'bg-emerald-400' : usability === 'loaded' ? 'bg-slate-400' : 'bg-slate-600'}`} />
                                                                    <span className={`text-[7px] font-black uppercase tracking-wide leading-tight ${usability === 'usable' ? 'text-emerald-300' : usability === 'loaded' ? 'text-slate-400' : 'text-slate-600'}`}>{label}</span>
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                </div>
                                            )}
                                            {!loadingPAS && !hasData && (
                                                <p className="text-center text-[10px] font-bold text-white/25 uppercase tracking-widest italic py-4">No historic context found here</p>
                                            )}
                                            {(hasData || potentialScore) && (
                                                <div className="border-t border-white/8 pt-3">
                                                    <div className="grid grid-cols-2 gap-2">
                                                        <button
                                                            onClick={() => setIntelDetailsOpen(v => !v)}
                                                            className={`rounded-xl border px-3 py-2 text-[9px] font-black uppercase tracking-widest transition-colors ${intelDetailsOpen ? 'bg-amber-500/20 border-amber-400/40 text-amber-200' : 'bg-white/[0.04] border-white/10 text-amber-400'}`}
                                                        >
                                                            Details
                                                        </button>
                                                        <button
                                                            onClick={() => setIntelLayersOpen(v => !v)}
                                                            className={`rounded-xl border px-3 py-2 text-[9px] font-black uppercase tracking-widest transition-colors ${intelLayersOpen ? 'bg-amber-500/20 border-amber-400/40 text-amber-200' : 'bg-white/[0.04] border-white/10 text-amber-400'}`}
                                                        >
                                                            Layers
                                                        </button>
                                                    </div>
                                                    {intelLayersOpen && (
                                                        <div className="mt-3 flex flex-wrap gap-2 animate-in fade-in duration-200">
                                                            {[{ key: 'context', label: 'Context' }, { key: 'routes', label: 'Routes' }, { key: 'corridors', label: 'Corridors' }, { key: 'crossings', label: 'Crossings' }, { key: 'monuments', label: 'Monuments' }, { key: 'aim', label: 'AIM' }, { key: 'userFinds', label: 'Finds' }].map(({ key, label }) => (
                                                                <button key={key} onClick={() => setHistoricLayerVisibility(p => ({ ...p, [key]: !p[key as keyof typeof p] }))} className={`px-3 py-1.5 rounded-xl border text-[9px] font-black uppercase tracking-wider transition-all active:scale-95 ${historicLayerVisibility[key as keyof typeof historicLayerVisibility] ? 'bg-blue-500/20 border-blue-500/50 text-blue-300' : 'bg-white/5 border-white/10 text-slate-500'}`}>
                                                                    {label}
                                                                </button>
                                                            ))}
                                                        </div>
                                                    )}
                                                    {intelDetailsOpen && (
                                                        <div className="mt-4 space-y-4 animate-in fade-in duration-200">
                                                            {pasFinds.length > 0 && (
                                                                <div className="space-y-2">
                                                                    <p className="text-[8px] font-black text-blue-400/60 uppercase tracking-widest">Historic Period Profile</p>
                                                                    <div className="grid grid-cols-2 gap-2">
                                                                        {Object.entries(pasFinds.reduce((acc, f) => { const p = f.broadperiod || 'Unknown'; acc[p] = (acc[p] || 0) + 1; return acc; }, {} as Record<string, number>)).sort((a, b) => b[1] - a[1]).map(([period, count]) => (
                                                                            <div key={period} className="bg-blue-500/5 border border-blue-500/10 p-3 rounded-xl flex justify-between items-center">
                                                                                <span className="text-[9px] font-black text-slate-300 uppercase truncate pr-2">{period}</span>
                                                                                <span className="text-sm font-black text-blue-400">{count}</span>
                                                                            </div>
                                                                        ))}
                                                                    </div>
                                                                </div>
                                                            )}
                                                            {nearbyProjectFinds.length > 0 && (
                                                                <div className="space-y-2">
                                                                    <p className="text-[8px] font-black text-emerald-400/60 uppercase tracking-widest">Your Recorded Finds</p>
                                                                    <div className="space-y-1.5">
                                                                        {nearbyProjectFinds.map(f => (
                                                                            <div key={f.id} className="bg-emerald-500/5 border border-emerald-500/10 px-3 py-2 rounded-xl flex justify-between items-center">
                                                                                <span className="text-[10px] font-black text-white uppercase truncate pr-3">{f.objectType || 'Unknown'}</span>
                                                                                <span className="text-[9px] font-bold text-emerald-400/70 uppercase shrink-0">{f.period}</span>
                                                                            </div>
                                                                        ))}
                                                                    </div>
                                                                </div>
                                                            )}
                                                            {pasFinds.length > 0 && (
                                                                <div className="space-y-2">
                                                                    <p className="text-[8px] font-black text-blue-400/60 uppercase tracking-widest">Historic Findings</p>
                                                                    <div className="space-y-2">
                                                                        {pasFinds.map(f => (
                                                                            <div key={f.id} onClick={() => { setSelectedPASFind(f); setIsIntelOpen(false); mapRef.current?.flyTo({ center: [f.lon, f.lat], zoom: 17 }); }} className="bg-blue-500/5 p-3 rounded-xl border border-blue-500/10 flex justify-between items-center active:bg-blue-500/20 transition-all">
                                                                                <div className="flex-1 min-w-0 pr-3">
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
                                                                <div className="space-y-2">
                                                                    <p className="text-[8px] font-black text-emerald-500/60 uppercase tracking-widest">Etymological Signals</p>
                                                                    <div className="space-y-2">
                                                                        {placeSignals.map((s, i) => (
                                                                            <div key={i} className="bg-emerald-500/5 border border-emerald-500/10 p-3 rounded-xl">
                                                                                <div className="flex justify-between items-start mb-1">
                                                                                    <span className="text-xs font-black text-white uppercase italic tracking-tight truncate pr-2">"{s.name}"</span>
                                                                                    <span className="text-[9px] font-bold text-emerald-500/60 uppercase shrink-0">{s.distance.toFixed(1)} km</span>
                                                                                </div>
                                                                                <p className="text-[8px] font-black text-emerald-500/40 uppercase mb-1 tracking-widest">{s.type}</p>
                                                                                <p className="text-[10px] font-bold text-slate-300 leading-tight">{s.meaning}</p>
                                                                            </div>
                                                                        ))}
                                                                    </div>
                                                                </div>
                                                            )}
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })()}

                                {selectedMonument === undefined && !selectedUserFind && !selectedPASFind && !(selectedId && !selectedHotspotId) && !historicMode && hasScanned && !selectedHotspotId && (sortedHotspots.length > 0 || displayTargets.length > 0) && (
                                    <div className="grid grid-cols-2 gap-1 rounded-xl border border-emerald-500/25 bg-slate-950/80 p-1 shadow-[0_0_14px_rgba(16,185,129,0.08)]">
                                        <button
                                            onClick={() => setMobileSheetMode('hotspots')}
                                            className={`rounded-lg px-2 py-2 text-[10px] font-black uppercase tracking-widest transition-colors ${mobileSheetMode === 'hotspots' ? 'bg-emerald-500 text-white shadow-[0_0_10px_rgba(16,185,129,0.25)]' : 'bg-white/[0.04] text-white/65 hover:text-white'}`}
                                        >
                                            Hotspots
                                        </button>
                                        <button
                                            onClick={() => setMobileSheetMode('targets')}
                                            className={`rounded-lg px-2 py-2 text-[10px] font-black uppercase tracking-widest transition-colors ${mobileSheetMode === 'targets' ? 'bg-emerald-500 text-white shadow-[0_0_10px_rgba(16,185,129,0.25)]' : 'bg-white/[0.04] text-white/65 hover:text-white'}`}
                                        >
                                            Targets
                                        </button>
                                    </div>
                                )}

                                {/* Hotspot Inspector (mobile) */}
                                {selectedMonument === undefined && selectedHotspotId && !historicMode && (() => {
                                    const h = hotspots.find(h => h.id === selectedHotspotId);
                                    if (!h) return null;
                                    const hStrength = getHotspotSignalStrength(h.score);
                                    const hierarchy = getHotspotResultHierarchy(h, hStrength);
                                    const hStrengthColour = hStrength === 'Strong Zone' ? 'text-amber-400' : hStrength === 'Moderate Zone' ? 'text-emerald-400' : 'text-slate-200';
                                    const isPrimaryHotspot = h.number === 1;
                                    return (
                                        <div className="space-y-3">
                                            <div className="flex items-start justify-between gap-2">
                                                <div className="min-w-0">
                                                    <p className="text-[7px] font-black text-white/30 uppercase tracking-widest mb-0.5">{HOTSPOT_TITLES[h.classification]} · Hotspot {h.number}</p>
                                                    <div className="flex items-center gap-2 flex-wrap">
                                                        <p className={`text-sm font-black leading-tight ${hStrengthColour}`}>{hierarchy.signalStrength}</p>
                                                        {isPrimaryHotspot && <span className="bg-emerald-500/15 border border-emerald-400/30 text-emerald-200 px-1.5 py-0.5 rounded-full text-[7px] font-black uppercase tracking-widest">Priority</span>}
                                                    </div>
                                                </div>
                                                <button onClick={() => setSelectedHotspotId(null)} className="bg-white/[0.04] hover:bg-white/[0.08] text-white/50 hover:text-white rounded-full p-1.5 transition-colors border border-white/10 shrink-0">
                                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                                                </button>
                                            </div>
                                            <div className="space-y-2">
                                                <div>
                                                    <p className="text-[7px] font-black text-white/30 uppercase tracking-[0.18em] mb-0.5">Why it matters</p>
                                                    <p className="text-xs font-bold text-white/85 leading-snug">{hierarchy.whyItMatters}</p>
                                                </div>
                                                <div>
                                                    <p className="text-[7px] font-black text-emerald-400/60 uppercase tracking-[0.18em] mb-0.5">Interpretive cue</p>
                                                    <p className="text-[11px] font-bold text-emerald-300 leading-snug">{hierarchy.nextAction}</p>
                                                </div>
                                            </div>
                                            {(h.secondaryTag || h.isOnCorridor || (h.linkedCount ?? 0) > 0) && (
                                                <div className="flex items-center gap-2 flex-wrap">
                                                    {h.secondaryTag && <span className="text-[9px] font-bold text-amber-300/60 uppercase tracking-widest">{h.secondaryTag}</span>}
                                                    {h.isOnCorridor && <span className="text-[9px] font-bold text-emerald-500/60 uppercase tracking-widest">On corridor</span>}
                                                    {(h.linkedCount ?? 0) > 0 && <span className="text-[9px] font-bold text-white/40 uppercase tracking-widest">Linked to {h.linkedCount} nearby</span>}
                                                </div>
                                            )}
                                            {(() => {
                                                const ctx = hotspotFindContext.get(h.id);
                                                if (!ctx) return null;
                                                return ctx.status === 'within'
                                                    ? <p className="text-[9px] font-black text-emerald-400/80 uppercase tracking-widest">{ctx.count} find{ctx.count !== 1 ? 's' : ''} recorded here — signal supported</p>
                                                    : <p className="text-[9px] font-black text-emerald-400/80 uppercase tracking-widest">{ctx.count} find{ctx.count !== 1 ? 's' : ''} recorded nearby</p>;
                                            })()}
                                            {h.isHighConfidenceCrossing && <div className="bg-blue-600/30 p-2 rounded-xl border border-blue-400/70 animate-pulse"><p className="text-[10px] font-black uppercase text-white text-center tracking-[0.18em]">Likely historic crossing point</p></div>}
                                            {h.disturbanceRisk === 'High' && <div className="bg-red-500/15 p-2 rounded-xl border border-red-400/30"><p className="text-[9px] font-black uppercase text-red-300 tracking-widest">Disturbed ground — interpret with caution</p></div>}
                                            <div className="border-t border-white/8 pt-3">
                                                <p className="text-[8px] font-black text-white/40 uppercase tracking-widest mb-2">Evidence</p>
                                                <div className="space-y-1.5">
                                                    {h.explanation.slice(0, 3).map((reason, idx) => (
                                                        <div key={idx} className="flex items-start gap-2">
                                                            <div className="w-1 h-1 rounded-full bg-emerald-400 mt-1.5 shrink-0 shadow-[0_0_6px_rgba(52,211,153,0.8)]" />
                                                            <p className="text-xs font-bold text-white/80 leading-tight">{reason}</p>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                            {h.suggestedFocus && (
                                                <div className="pt-2 border-t border-emerald-500/15">
                                                    <p className="text-[8px] font-black text-emerald-500/70 uppercase tracking-[0.12em] mb-1">Field focus</p>
                                                    <p className="text-xs font-bold text-emerald-300 leading-snug">{h.suggestedFocus}</p>
                                                </div>
                                            )}
                                            <div className="pt-2 border-t border-white/8">
                                                <span onClick={() => setExpandedInterpretationId(expandedInterpretationId === h.id ? null : h.id)} className="text-xs font-black text-amber-400 hover:text-amber-300 cursor-pointer flex items-center gap-1">
                                                    {expandedInterpretationId === h.id ? '▲ Hide breakdown' : '▼ Full evidence breakdown'}
                                                </span>
                                                {expandedInterpretationId === h.id && (() => {
                                                    const interp = buildInterpretation(h);
                                                    const breakdown = [{ label: 'Anomaly', val: h.metrics.anomaly, cap: 30 }, { label: 'Context', val: h.metrics.context, cap: 25 }, { label: 'Convergence', val: h.metrics.convergence, cap: 20 }, { label: 'Behaviour', val: h.metrics.behaviour, cap: 15 }];
                                                    return (
                                                        <div className="mt-3 space-y-3 animate-in fade-in duration-200">
                                                            <p className="text-[8px] font-black text-white/25 uppercase tracking-[0.2em]">{getInterpretationLabel(h.confidence)}</p>
                                                            <p className="text-xs text-white/80 leading-relaxed">{interp.summary}</p>
                                                            <p className="text-xs text-white/80 leading-relaxed">{interp.reasoning}</p>
                                                            <p className="text-xs text-white/80 leading-relaxed">{interp.strategy}</p>
                                                            <div className="space-y-1.5 pt-2 border-t border-white/10">
                                                                {breakdown.map(({ label, val, cap }) => (
                                                                    <div key={label} className="flex items-center gap-2">
                                                                        <span className="text-[7px] text-white/45 w-16 shrink-0">{label}</span>
                                                                        <div className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden"><div className="h-full bg-emerald-500/70 rounded-full" style={{ width: `${Math.min(100, (val / cap) * 100)}%` }} /></div>
                                                                        <span className="text-[7px] text-white/40 w-8 text-right shrink-0">{Math.min(val, cap)}/{cap}</span>
                                                                    </div>
                                                                ))}
                                                                {h.metrics.penalty !== 0 && <p className="text-[7px] text-white/35 mt-1">Penalty: {h.metrics.penalty} · Final: {h.score}</p>}
                                                            </div>
                                                        </div>
                                                    );
                                                })()}
                                            </div>
                                            <p className="text-center text-[7px] text-white/40 italic">Highlights historic activity — not guaranteed finds.</p>
                                        </div>
                                    );
                                })()}

                                {selectedMonument === undefined && !selectedHotspotId && mobileSheetMode === 'hotspots' && sortedHotspots.length > 0 && (
                                    <div>
                                        <p className="text-[8px] font-black text-white/25 uppercase tracking-[0.25em] mb-2 px-1">Landscape Hotspots</p>
                                        <div className="space-y-2">
                                            {sortedHotspots.map(h => {
                                                const isPrimary = h.number === 1;
                                                const hStr = getHotspotSignalStrength(h.score);
                                                const hier = getHotspotResultHierarchy(h, hStr);
                                                const onClick = () => { persistSheetExpanded(true); setSelectedHotspotId(h.id); mapRef.current?.fitBounds(h.bounds as maplibregl.LngLatBoundsLike, { padding: 40 }); };
                                                if (isPrimary) return (
                                                    <button key={h.id} onClick={onClick} className="w-full text-left p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 shadow-[0_0_14px_rgba(16,185,129,0.08)] active:scale-[0.98] transition-all hover:border-emerald-500/50">
                                                        <div className="flex items-start justify-between gap-2 mb-1.5">
                                                            <div className="min-w-0">
                                                                <p className="text-[8px] font-black text-white uppercase tracking-widest mb-0.5">{HOTSPOT_TITLES[h.classification]}</p>
                                                                <p className="text-xs font-black text-emerald-300 leading-tight">{hier.signalStrength}</p>
                                                            </div>
                                                            <span className="text-[7px] font-black text-emerald-500/50 bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.5 rounded shrink-0">Priority</span>
                                                        </div>
                                                        <p className="text-[10px] font-bold text-emerald-200/70 leading-tight line-clamp-2">{hier.whyItMatters}</p>
                                                    </button>
                                                );
                                                return (
                                                    <button key={h.id} onClick={onClick} className="w-full text-left px-3 py-2 rounded-xl bg-slate-900/40 border border-white/6 active:scale-[0.98] transition-all hover:border-white/12">
                                                        <div className="flex items-center justify-between gap-2">
                                                            <div className="min-w-0">
                                                                <p className="text-[8px] font-black text-white uppercase tracking-widest mb-0.5">{HOTSPOT_TITLES[h.classification]}</p>
                                                                <p className="text-[10px] font-bold text-white/70 leading-tight truncate">{hier.signalStrength}</p>
                                                            </div>
                                                            <span className="text-[10px] font-black text-white/25 shrink-0">{h.score}%</span>
                                                        </div>
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>
                                )}
                                {selectedMonument === undefined && !selectedHotspotId && mobileSheetMode === 'targets' && displayTargets.length > 0 && (
                                    <div>
                                        <p className="text-[8px] font-black text-white/25 uppercase tracking-[0.25em] mb-2 px-1">Investigation Targets</p>
                                        <div className="space-y-2">
                                            {displayTargets.map(f => {
                                                const tI = buildTargetInterpretation(f);
                                                const isPrimary = f.id === primaryTargetId;
                                                return (
                                                    <button
                                                        key={f.id}
                                                        onClick={() => { setSelectedId(f.id); mapRef.current?.flyTo({ center: f.center, zoom: 17 }); }}
                                                        className={`w-full text-left p-3 rounded-xl border active:scale-[0.98] transition-all ${f.isProtected ? 'bg-red-950/20 border-red-900/50' : isPrimary ? 'bg-emerald-500/10 border-emerald-500/30 shadow-[0_0_14px_rgba(16,185,129,0.08)]' : 'bg-slate-900/40 border-white/8 hover:border-white/15'}`}
                                                    >
                                                        <div className="flex items-start justify-between gap-2">
                                                            <div className="min-w-0">
                                                                {!f.isProtected && <p className={`text-[8px] font-black uppercase tracking-widest mb-0.5 ${isPrimary ? 'text-white' : 'text-white/85'}`}>{f.type}</p>}
                                                                <p className={`text-xs font-black leading-tight ${f.isProtected ? 'text-stone-400' : isPrimary ? 'text-emerald-300' : 'text-white/65'}`}>
                                                                    {f.isProtected ? 'Scheduled Monument' : getTargetVerdict(tI.signalStrength, isPrimary)}
                                                                </p>
                                                                {!f.isProtected && <p className="text-[10px] font-bold text-white/65 leading-tight mt-0.5 line-clamp-2">{tI.hook}</p>}
                                                            </div>
                                                            {isPrimary && !f.isProtected && <span className="text-[7px] font-black text-emerald-300 bg-emerald-500/15 border border-emerald-500/30 px-1.5 py-0.5 rounded-full shrink-0">Start</span>}
                                                        </div>
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>
                                )}
                                {selectedMonument === undefined && !historicMode && !selectedHotspotId && hasScanned && sortedHotspots.length === 0 && displayTargets.length === 0 && (
                                    <div className="rounded-xl bg-white/[0.03] border border-white/10 p-4 text-center">
                                        <p className="text-xs font-black text-white/70 leading-tight">Quiet scan area</p>
                                        <p className="text-[10px] font-bold text-white/35 leading-snug mt-1">No strong hotspots or investigation targets stood out here. Try widening the view, checking the historic layers, or scanning a neighbouring field.</p>
                                    </div>
                                )}
                                {selectedMonument === undefined && !selectedHotspotId && mobileSheetMode === 'targets' && hasScanned && displayTargets.length === 0 && (sortedHotspots.length > 0 || displayTargets.length > 0) && (
                                    <p className="text-center text-[10px] font-bold text-white/20 uppercase tracking-widest italic py-6">No investigation targets from this scan</p>
                                )}
                                {selectedMonument === undefined && !hasScanned && (
                                    <p className="text-center text-[10px] font-bold text-white/20 uppercase tracking-widest italic py-6">Scan to read the landscape</p>
                                )}
                            </div>
                        </div>
                    )}


                    {/* Scheduled Monument Card — on boundary click */}
                    {selectedMonument !== undefined && (
                        <div className="hidden lg:block absolute bottom-6 left-auto right-6 w-96 z-[100] animate-in slide-in-from-bottom-4 fade-in duration-200">
                            <div className="bg-slate-950/98 border border-stone-700/50 rounded-3xl p-5 shadow-2xl">
                                <div className="flex items-start justify-between mb-3">
                                    <p className="text-[8px] font-black text-stone-400/70 uppercase tracking-[0.2em]">Scheduled Monument</p>
                                    <button onClick={() => setSelectedMonument(undefined)} className="text-white/30 hover:text-white/60 transition-colors -mt-0.5 -mr-1 p-1">
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
                                    </button>
                                </div>
                                {selectedMonument && <p className="text-white/90 font-black text-sm leading-snug mb-3">{selectedMonument}</p>}
                                <div className="space-y-1.5">
                                    <p className="text-stone-200/80 text-xs font-bold leading-snug">This area is protected as a Scheduled Monument.</p>
                                    <p className="text-stone-400/60 text-[11px] leading-snug">Metal detecting or intrusive activity may require legal consent. Check current protections before any fieldwork.</p>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Hotspot Card Popup */}
                    {selectedHotspotId && !historicMode && (
                        <div className="hidden lg:block absolute lg:bottom-6 lg:left-auto lg:right-6 lg:w-96 lg:max-h-[80vh] overflow-y-auto scrollbar-hide animate-in slide-in-from-bottom-4 fade-in duration-200">
                            {hotspots.filter(h => h.id === selectedHotspotId).map(h => {
                                const hStrength = getHotspotSignalStrength(h.score);
                                const hierarchy = getHotspotResultHierarchy(h, hStrength);
                                const hBorder = hStrength === 'Strong Zone' ? 'bg-black/95 border-amber-500/35' : hStrength === 'Moderate Zone' ? 'bg-black/95 border-emerald-500/35' : 'bg-black/95 border-white/15';
                                const hStrengthColour = hStrength === 'Strong Zone' ? 'text-amber-400' : hStrength === 'Moderate Zone' ? 'text-emerald-400' : 'text-slate-200';
                                const isPrimaryHotspot = h.number === 1;
                                const investigationStatus = investigationMap.get(h.id)?.status ?? 'unreviewed';
                                return (
                                <div key={h.id} className={`p-4 lg:p-5 rounded-2xl lg:rounded-3xl border shadow-2xl transition-all backdrop-blur-xl ${hBorder}`}>
                                    <div className="mx-auto mb-3 h-1 w-6 rounded-full bg-white/15 lg:hidden" />
                                    <div className="flex justify-between items-start mb-3 lg:mb-4">
                                        <div className="flex-1 min-w-0 pr-3">
                                            <div className="mb-2.5">
                                                <div className="flex items-start justify-between gap-2 mb-1">
                                                    <h3 className="text-sm lg:text-base font-black text-white tracking-tight leading-tight">{HOTSPOT_TITLES[h.classification]}</h3>
                                                    {isPrimaryHotspot && (
                                                        <span className="bg-emerald-500/15 border border-emerald-400/30 text-emerald-200 px-1.5 py-0.5 rounded-full text-[7px] font-black uppercase tracking-widest shrink-0">Priority</span>
                                                    )}
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <span className="text-[8px] lg:text-[9px] font-black text-white/40 uppercase tracking-[0.16em]">Hotspot {h.number}</span>
                                                    <span className={`rounded-full border px-1.5 py-0.5 text-[8px] font-black ${hStrength === 'Strong Zone' ? 'border-amber-400/30 bg-amber-500/10 text-amber-300' : hStrength === 'Moderate Zone' ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-300' : 'border-white/10 bg-white/[0.04] text-slate-300'}`}>{hierarchy.signalStrength}</span>
                                                </div>
                                            </div>
                                            <div className="space-y-2 mb-2">
                                                <div>
                                                    <p className="text-[8px] font-black text-white/35 uppercase tracking-[0.18em] mb-0.5">Why it matters</p>
                                                    <p className="text-xs lg:text-[13px] font-bold text-white/85 leading-snug">{hierarchy.whyItMatters}</p>
                                                </div>
                                                <div>
                                                    <p className="text-[8px] font-black text-emerald-400/60 uppercase tracking-[0.18em] mb-0.5">Interpretive cue</p>
                                                    <p className="text-[11px] lg:text-[12px] font-bold text-emerald-300 leading-snug">{hierarchy.nextAction}</p>
                                                </div>
                                            </div>
                                            {(h.secondaryTag || h.isOnCorridor || (h.linkedCount ?? 0) > 0) && (
                                                <div className="flex items-center gap-2.5 flex-wrap mt-1">
                                                    {h.secondaryTag && <span className="text-[9px] font-bold text-amber-300/60 uppercase tracking-widest">{h.secondaryTag}</span>}
                                                    {h.isOnCorridor && <span className="text-[9px] font-bold text-emerald-500/60 uppercase tracking-widest">On corridor</span>}
                                                    {(h.linkedCount ?? 0) > 0 && <span className="text-[9px] font-bold text-white/40 uppercase tracking-widest">Linked to {h.linkedCount} nearby</span>}
                                                </div>
                                            )}
                                            {(() => {
                                                const ctx = hotspotFindContext.get(h.id);
                                                if (!ctx) return null;
                                                return ctx.status === 'within'
                                                    ? <p className="text-[9px] font-black text-emerald-400/80 uppercase tracking-widest mt-1.5">{ctx.count} find{ctx.count !== 1 ? 's' : ''} recorded here — signal supported</p>
                                                    : <p className="text-[9px] font-black text-emerald-400/80 uppercase tracking-widest mt-1.5">{ctx.count} find{ctx.count !== 1 ? 's' : ''} recorded nearby</p>;
                                            })()}
                                        </div>
                                        <button onClick={() => setSelectedHotspotId(null)} className="bg-white/[0.04] hover:bg-white/[0.08] text-white/70 hover:text-white rounded-full p-2 transition-colors border border-white/10 flex-shrink-0">
                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                                        </button>
                                    </div>
                                    <div className="mb-3 lg:mb-4 flex items-center justify-between gap-3 rounded-xl lg:rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-2">
                                        <span className="text-[8px] font-black text-white/40 uppercase tracking-[0.18em]">Investigation</span>
                                        <select
                                            value={investigationStatus}
                                            onChange={(e) => void setHotspotInvestigationStatus(h.id, e.target.value as FieldGuideInvestigationStatus)}
                                            className="bg-slate-950/80 border border-white/10 rounded-lg px-2 py-1 text-[10px] font-black text-white uppercase tracking-wider outline-none"
                                        >
                                            {INVESTIGATION_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                                        </select>
                                    </div>
                                    {h.isHighConfidenceCrossing && (
                                        <div className="bg-blue-600/30 p-2 rounded-xl lg:rounded-2xl border border-blue-400/70 mb-3 lg:mb-4 animate-pulse">
                                            <p className="m-0 text-[10px] lg:text-xs font-black uppercase text-white text-center tracking-[0.18em]">Likely historic crossing point</p>
                                        </div>
                                    )}
                                    {h.disturbanceRisk === 'High' && (
                                        <div className="bg-red-500/15 p-2 rounded-xl lg:rounded-2xl border border-red-400/30 mb-3 lg:mb-4">
                                            <p className="m-0 text-[9px] font-black uppercase text-red-300 tracking-widest">Disturbed ground — interpret with caution</p>
                                        </div>
                                    )}
                                    <div className="border-t border-white/8 pt-3 mb-3">
                                        <p className="text-[9px] font-black text-white/60 uppercase tracking-widest mb-2.5">Evidence summary</p>
                                        <div className="space-y-2">
                                            {h.explanation.slice(0, 3).map((reason, idx) => (
                                                <div key={idx} className="flex items-start gap-3">
                                                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 mt-1 shadow-[0_0_8px_rgba(52,211,153,0.8)]" />
                                                    <p className="text-xs lg:text-[13px] font-bold text-white leading-tight flex-1">{reason}</p>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                    {h.suggestedFocus && (
                                        <div className="mt-3 pt-3 border-t border-emerald-500/15">
                                            <p className="text-[9px] font-black text-emerald-500/70 uppercase tracking-[0.12em] mb-1">Field focus</p>
                                            <p className="text-xs font-bold text-emerald-300 leading-snug">{h.suggestedFocus}</p>
                                        </div>
                                    )}
                                    {/* Full reasoning */}
                                    <div className="mt-3 pt-3 border-t border-white/8">
                                        <span
                                            onClick={() => setExpandedInterpretationId(expandedInterpretationId === h.id ? null : h.id)}
                                            className="text-xs font-black text-amber-400 hover:text-amber-300 transition-colors duration-150 cursor-pointer flex items-center gap-1"
                                        >
                                            {expandedInterpretationId === h.id ? '▲ Hide evidence breakdown' : '▼ See full evidence breakdown'}
                                        </span>
                                        {expandedInterpretationId === h.id && (() => {
                                            const interp = buildInterpretation(h);
                                            const breakdown = [
                                                { label: 'Anomaly',     val: h.metrics.anomaly,     cap: 30 },
                                                { label: 'Context',     val: h.metrics.context,     cap: 25 },
                                                { label: 'Convergence', val: h.metrics.convergence, cap: 20 },
                                                { label: 'Behaviour',   val: h.metrics.behaviour,   cap: 15 },
                                            ];
                                            return (
                                                <div className="mt-4 space-y-4 animate-in fade-in duration-200">
                                                    <p className="text-[9px] font-black text-white/30 uppercase tracking-[0.2em]">{getInterpretationLabel(h.confidence)}</p>
                                                    <div>
                                                        <p className="text-[9px] font-black text-white/55 uppercase tracking-[0.15em] mb-1.5">Summary</p>
                                                        <p className="text-xs text-white/85 leading-relaxed">{interp.summary}</p>
                                                    </div>
                                                    <div>
                                                        <p className="text-[9px] font-black text-white/55 uppercase tracking-[0.15em] mb-1.5">Why it stands out</p>
                                                        <p className="text-xs text-white/85 leading-relaxed">{interp.reasoning}</p>
                                                    </div>
                                                    <div>
                                                        <p className="text-[9px] font-black text-white/55 uppercase tracking-[0.15em] mb-1.5">How to approach it</p>
                                                        <p className="text-xs text-white/85 leading-relaxed">{interp.strategy}</p>
                                                    </div>
                                                    <div className="border-t border-white/10 pt-3">
                                                        <p className="text-[8px] font-black text-white/45 uppercase tracking-[0.2em] mb-2">Signal breakdown</p>
                                                        <div className="space-y-1.5">
                                                            {breakdown.map(({ label, val, cap }) => (
                                                                <div key={label} className="flex items-center gap-2">
                                                                    <span className="text-[7px] text-white/55 w-16 flex-shrink-0">{label}</span>
                                                                    <div className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden">
                                                                        <div className="h-full bg-emerald-500/70 rounded-full" style={{ width: `${Math.min(100, (val / cap) * 100)}%` }} />
                                                                    </div>
                                                                    <span className="text-[7px] text-white/50 w-8 text-right flex-shrink-0">{Math.min(val, cap)}/{cap}</span>
                                                                </div>
                                                            ))}
                                                            {h.metrics.penalty !== 0 && <p className="text-[7px] text-white/45 mt-1">Penalty: {h.metrics.penalty} &nbsp;·&nbsp; Final: {h.score}</p>}
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })()}
                                    </div>
                                    <p className="text-center text-[7px] text-white/55 italic mt-3">Highlights historic activity — not guaranteed finds.</p>
                                </div>
                                );
                            })}
                        </div>
                    )}

                    {/* Target Card Popup — desktop only; mobile shows inside panel */}
                    {selectedId && !selectedHotspotId && (
                        <div className="hidden lg:block absolute bottom-6 left-auto right-6 w-96 max-h-[80vh] overflow-y-auto scrollbar-hide animate-in slide-in-from-bottom-4 fade-in duration-200">
                            {detectedFeatures.filter(f => f.id === selectedId).map(f => {
                                const tInterp = buildTargetInterpretation(f);
                                const isPrimaryTarget = f.id === primaryTargetId;
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
                                    <div key={f.id} className={`${f.isProtected ? 'p-4' : 'p-4 lg:p-5'} rounded-2xl lg:rounded-3xl border bg-slate-950/98 shadow-2xl backdrop-blur-xl transition-all ${f.isProtected ? 'border-stone-700/50' : borderColour[tInterp.signalStrength]}`}>
                                        <div className="mx-auto mb-3 h-1 w-6 rounded-full bg-white/15 lg:hidden" />
                                        {f.isProtected ? (
                                            /* Scheduled Monument — restrained heritage warning, no investigation prompts */
                                            <div className="space-y-3">
                                                <div className="flex items-start justify-between gap-3">
                                                    <div className="min-w-0">
                                                        <p className="text-[8px] font-black text-stone-400/70 uppercase tracking-[0.2em] mb-1">Scheduled Monument</p>
                                                        {f.aimInfo && <h3 className="text-sm font-black text-white/90 tracking-tight leading-tight">{f.aimInfo.type}</h3>}
                                                    </div>
                                                    <button onClick={(e) => { e.stopPropagation(); setSelectedId(null); }} className="bg-white/[0.04] hover:bg-white/[0.08] text-white/50 hover:text-white rounded-full p-1.5 transition-colors border border-white/10 shrink-0">
                                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                                                    </button>
                                                </div>
                                                <div className="rounded-xl bg-stone-900/40 border border-stone-700/40 p-3 space-y-2">
                                                    <p className="text-xs font-bold text-stone-200/85 leading-snug">This area is protected as a Scheduled Monument.</p>
                                                    <p className="text-[11px] font-bold text-stone-300/60 leading-snug">Metal detecting, excavation, or intrusive activity may require legal consent. Avoid disturbing the site boundary and check current protections before any fieldwork.</p>
                                                </div>
                                                {f.aimInfo && (
                                                    <div className="p-2 rounded-xl border bg-stone-900/30 border-stone-700/30">
                                                        <p className="text-[9px] font-black uppercase text-stone-400/60 leading-tight mb-0.5">Recorded designation</p>
                                                        <p className="text-[10px] font-bold text-stone-200/70 leading-tight">{f.aimInfo.type} · {f.aimInfo.period}</p>
                                                    </div>
                                                )}
                                            </div>
                                        ) : (
                                            <>
                                            <div className="flex items-center justify-between gap-2 mb-3">
                                                {isPrimaryTarget && (
                                                    <span className="bg-emerald-500/20 border border-emerald-400/40 text-emerald-200 px-2 py-0.5 rounded-full text-[7px] lg:text-[8px] font-black uppercase tracking-widest">Start Here</span>
                                                )}
                                                <p className="text-[8px] lg:text-[9px] font-black text-white/55 uppercase tracking-[0.2em] ml-auto">Target {f.number}</p>
                                            </div>
                                            {/* Header */}
                                            <div className="flex justify-between items-start mb-3 lg:mb-4">
                                                <div className="flex-1 min-w-0 pr-3">
                                                    <h3 className="text-sm lg:text-base font-black text-white tracking-tight leading-tight mb-1">{f.type}</h3>
                                                    <p className={`text-xs font-black ${strengthColour[tInterp.signalStrength]}`}>{tInterp.signalStrength}</p>
                                                </div>
                                                <button onClick={(e) => { e.stopPropagation(); setSelectedId(null); }} className="bg-white/[0.04] hover:bg-white/[0.08] text-white/70 hover:text-white rounded-full p-2 transition-colors border border-white/10 flex-shrink-0">
                                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                                                </button>
                                            </div>
                                            <>
                                                {/* Verdict + hook */}
                                                <p className="text-xs lg:text-sm font-black text-white/85 leading-snug mb-0.5">{getTargetVerdict(tInterp.signalStrength, isPrimaryTarget)}</p>
                                                <p className="text-[11px] font-bold text-white/50 leading-snug mb-3">{tInterp.hook}</p>
                                                {/* Find context with count */}
                                                {(() => {
                                                    const ctx = targetFindContext.get(f.id);
                                                    if (!ctx) return null;
                                                    return ctx.status === 'within'
                                                        ? <p className="text-[9px] font-black text-emerald-400/80 uppercase tracking-widest mb-2">{ctx.count} find{ctx.count !== 1 ? 's' : ''} recorded here — signal supported</p>
                                                        : <p className="text-[9px] font-black text-emerald-400/80 uppercase tracking-widest mb-2">{ctx.count} find{ctx.count !== 1 ? 's' : ''} recorded nearby</p>;
                                                })()}
                                                {/* Crossing badge */}
                                                {f.isHighConfidenceCrossing && (
                                                    <div className="bg-blue-600/30 p-2 rounded-xl lg:rounded-2xl border border-blue-400/70 mb-3 animate-pulse">
                                                        <p className="m-0 text-[10px] lg:text-xs font-black uppercase text-white text-center tracking-[0.18em]">Likely historic crossing point</p>
                                                    </div>
                                                )}
                                                {/* Edge-of-scan notice */}
                                                {(() => {
                                                    const EDGE_PX = 768 * 0.1;
                                                    const cxPx = (f.minX + f.maxX) / 2;
                                                    const cyPx = (f.minY + f.maxY) / 2;
                                                    const isEdge = cxPx < EDGE_PX || cyPx < EDGE_PX || cxPx > 768 - EDGE_PX || cyPx > 768 - EDGE_PX;
                                                    return isEdge ? (
                                                        <div className="bg-amber-500/10 p-2 rounded-xl border border-amber-400/25 mb-3">
                                                            <p className="text-[9px] font-black uppercase text-amber-300/80 tracking-widest">Near scan edge — wider scan may improve confidence</p>
                                                        </div>
                                                    ) : null;
                                                })()}
                                                {/* Why this matters */}
                                                <div className="border-t border-white/8 pt-3 mb-3">
                                                    <p className="text-[9px] font-black text-white/60 uppercase tracking-widest mb-2.5">Why this matters</p>
                                                    {f.explanationLines && f.explanationLines.length > 0 ? (
                                                        <div className="space-y-2">
                                                            {f.explanationLines.slice(0, 3).map((line, idx) => (
                                                                <div key={idx} className="flex items-start gap-3">
                                                                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 mt-1 shadow-[0_0_8px_rgba(52,211,153,0.8)]" />
                                                                    <p className="text-xs lg:text-[13px] font-bold text-white leading-tight flex-1">{line}</p>
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
                                                    <p className="text-[9px] font-black text-emerald-500/70 uppercase tracking-[0.12em] mb-1">Target focus</p>
                                                    <p className="text-xs font-bold text-emerald-300 leading-snug">{tInterp.focus}</p>
                                                </div>
                                                {/* Full reasoning */}
                                                <div className="mt-3 pt-3 border-t border-white/8">
                                                    <span
                                                        onClick={() => setExpandedTargetId(expandedTargetId === f.id ? null : f.id)}
                                                        className="text-xs font-black text-amber-400 hover:text-amber-300 transition-colors duration-150 cursor-pointer flex items-center gap-1"
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
                                            <p className="text-center text-[7px] text-white/55 italic mt-3">Highlights historic activity — not guaranteed finds.</p>
                                            </>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    {/* Historic Landscape Context Banner — compact pill */}
                    {historicMode && !isIntelOpen && (
                            <button
                                onClick={() => setIsIntelOpen(true)}
                                className="hidden lg:flex absolute top-14 left-4 z-[90] bg-slate-900/90 px-3 py-1.5 rounded-xl border border-blue-500/30 shadow-lg items-center gap-2 active:scale-95 transition-all"
                            >
                                <div className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse shrink-0" />
                                <span className="text-[10px] font-black text-blue-400 uppercase tracking-[0.2em]">
                                    {loadingPAS ? 'Reading layers...' : 'Historic Layers'}
                                </span>
                                {!loadingPAS && (() => {
                                    const c = mapRef.current?.getCenter();
                                    const n = c ? projectFinds.filter(f => f.lat !== null && f.lon !== null && getDistance([f.lon!, f.lat!], [c.lng, c.lat]) <= 500).length : 0;
                                    return n > 0 ? <span className="text-[9px] font-black text-emerald-400/80 uppercase tracking-widest">{n} find{n !== 1 ? 's' : ''}</span> : null;
                                })()}
                            </button>
                    )}

                    {/* Mobile Landscape Context Panel */}
                    {isIntelOpen && (() => {
                        const bd = potentialScore?.breakdown ?? null;
                        const interp = getHistoricInterpretation(bd ? { terrain: bd.terrain, historic: bd.historic, spectral: bd.signals } : null);
                        const sigLines = getSignalSummary(bd ? { terrain: bd.terrain, hydro: bd.hydro, historic: bd.historic, spectral: bd.signals } : null);
                        const hasData = pasFinds.length > 0 || historicRoutes.length > 0 || placeSignals.length > 0;
                        const mc = mapRef.current?.getCenter();
                        const nearbyProjectFinds = mc ? projectFinds.filter(f => f.lat !== null && f.lon !== null && getDistance([f.lon!, f.lat!], [mc.lng, mc.lat]) <= 500) : [];
                        return (
                        <>
                        {/* Tap-behind to dismiss */}
                        <div className="hidden lg:block absolute inset-0 z-[104]" onClick={() => setIsIntelOpen(false)} />
                        {/* Context card — same position/style as hotspot card popup */}
                        <div className="hidden lg:block absolute bottom-6 left-4 right-4 z-[105] lg:left-auto lg:right-6 lg:w-96 animate-in slide-in-from-bottom-4 fade-in duration-200">
                        <div className="bg-slate-900 border-2 border-amber-500/40 shadow-[0_0_40px_rgba(245,158,11,0.15)] rounded-3xl overflow-hidden">

                            {/* Card header row */}
                            <div className="flex justify-between items-start px-5 pt-4 pb-0">
                                <p className="text-[9px] font-black text-blue-400 uppercase tracking-[0.2em]">Landscape Context</p>
                                <button onClick={() => setIsIntelOpen(false)} className="text-white/30 hover:text-white/60 transition-colors -mt-1 -mr-1 p-1">
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
                                </button>
                            </div>

                            <div className="overflow-y-auto max-h-[52vh] px-5 pb-5 pt-2 space-y-3">

                                    <h3 className="text-base font-black text-white tracking-tight leading-tight mb-1">{interp.title}</h3>
                                    <p className="text-[11px] font-bold text-white/70 leading-snug mb-3">{interp.subtitle}</p>

                                    {/* Signal bullets — like "Why this matters" */}
                                    {sigLines.length > 0 && (
                                        <div className="border-t border-white/8 pt-3 mb-3">
                                            <p className="text-[8px] font-medium text-white/40 mb-2.5">Why this stands out</p>
                                            <div className="space-y-2">
                                                {sigLines.map((line, i) => (
                                                    <div key={i} className="flex items-start gap-3">
                                                        <div className="w-1.5 h-1.5 rounded-full bg-blue-400 mt-1 shrink-0 shadow-[0_0_6px_rgba(96,165,250,0.7)]" />
                                                        <p className="text-xs font-bold text-white leading-tight flex-1">{line}</p>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {/* Your finds nearby */}
                                    {nearbyProjectFinds.length > 0 && (
                                        <p className="text-[9px] font-black text-emerald-400/80 uppercase tracking-widest">{nearbyProjectFinds.length} find{nearbyProjectFinds.length !== 1 ? 's' : ''} recorded nearby</p>
                                    )}

                                    {/* Summary counts */}
                                    {hasData && (
                                        <>
                                        <div className="flex gap-2 mt-3">
                                            {pasFinds.length > 0 && (
                                                <div className="flex-1 bg-blue-500/10 border border-blue-500/20 rounded-2xl p-3 text-center">
                                                    <span className="block text-lg font-black text-blue-400">{pasFinds.length}</span>
                                                    <span className="text-[8px] font-black text-slate-500 uppercase tracking-widest">Sites</span>
                                                </div>
                                            )}
                                            {historicRoutes.length > 0 && (
                                                <div className="flex-1 bg-blue-500/10 border border-blue-500/20 rounded-2xl p-3 text-center">
                                                    <span className="block text-lg font-black text-blue-400">{historicRoutes.length}</span>
                                                    <span className="text-[8px] font-black text-slate-500 uppercase tracking-widest">Routes</span>
                                                </div>
                                            )}
                                            {placeSignals.length > 0 && (
                                                <div className="flex-1 bg-blue-500/10 border border-blue-500/20 rounded-2xl p-3 text-center">
                                                    <span className="block text-lg font-black text-blue-300">{placeSignals.length}</span>
                                                    <span className="text-[8px] font-black text-slate-500 uppercase tracking-widest">Place Names</span>
                                                </div>
                                            )}
                                        </div>
                                        <p className="text-[9px] font-black text-white/60 italic mt-2 text-center tracking-wide">Zoom out to understand wider context</p>
                                        </>
                                    )}

                                    {/* Source coverage — three-state: usable / loaded-only / not present */}
                                    {sourceAvailability && (
                                        <div className="border-t border-white/8 pt-3">
                                            <div className="flex justify-between items-center mb-2">
                                                <p className="text-[8px] font-black text-white/40 uppercase tracking-widest">Scan Source Coverage</p>
                                                {scanFromCache && <span className="text-[7px] font-black text-amber-500/60 uppercase tracking-widest bg-amber-500/10 border border-amber-500/20 px-1.5 py-0.5 rounded">Cached</span>}
                                            </div>
                                            <div className="grid grid-cols-3 gap-1.5">
                                                {[
                                                    { key: 'terrain',          label: 'LiDAR' },
                                                    { key: 'terrain_global',   label: 'Global Terrain' },
                                                    { key: 'slope',            label: 'Slope' },
                                                    { key: 'hydrology',        label: 'Hydrology' },
                                                    { key: 'satellite_spring', label: 'Spring SAT' },
                                                    { key: 'satellite_summer', label: 'Summer SAT' },
                                                ].map(({ key, label }) => {
                                                    const usability = sourceUsability[key] ?? 'none';
                                                    return (
                                                        <div key={key} className={`flex items-center gap-1.5 px-2 py-1.5 rounded-xl border ${usability === 'usable' ? 'bg-emerald-500/10 border-emerald-500/25' : usability === 'loaded' ? 'bg-white/5 border-white/15' : 'bg-white/3 border-white/8'}`}>
                                                            <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${usability === 'usable' ? 'bg-emerald-400 shadow-[0_0_4px_rgba(52,211,153,0.8)]' : usability === 'loaded' ? 'bg-slate-400' : 'bg-slate-600'}`} />
                                                            <span className={`text-[7px] font-black uppercase tracking-wide leading-tight ${usability === 'usable' ? 'text-emerald-300' : usability === 'loaded' ? 'text-slate-400' : 'text-slate-600'}`}>{label}</span>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                            <p className="text-[7px] text-white/20 mt-1.5 text-center italic">Green = signal contributed · Grey = data present · Dark = no data</p>
                                        </div>
                                    )}

                                    {/* Further details + Layers on same row */}
                                    {(hasData || potentialScore) && (
                                        <div className="mt-4 pt-3 border-t border-white/8">
                                            <div className="flex justify-between items-center">
                                                <span
                                                    onClick={() => setIntelDetailsOpen(v => !v)}
                                                    className="text-[11px] font-black text-amber-400 hover:text-amber-300 transition-colors duration-150 cursor-pointer"
                                                >
                                                    {intelDetailsOpen ? '▲ Hide details' : '▼ View full breakdown'}
                                                </span>
                                                <span
                                                    onClick={() => setIntelLayersOpen(v => !v)}
                                                    className="text-[11px] font-black text-amber-400 hover:text-amber-300 transition-colors duration-150 cursor-pointer"
                                                >
                                                    {intelLayersOpen ? '▲ Hide layers' : '▼ Map layers'}
                                                </span>
                                            </div>

                                            {intelLayersOpen && (
                                                <div className="mt-3 flex flex-wrap gap-2 animate-in fade-in duration-200">
                                                    {[{ key: 'context', label: 'Context' }, { key: 'routes', label: 'Routes' }, { key: 'corridors', label: 'Corridors' }, { key: 'crossings', label: 'Crossings' }, { key: 'monuments', label: 'Monuments' }, { key: 'aim', label: 'AIM' }, { key: 'userFinds', label: 'Your Finds' }].map(({ key, label }) => (
                                                        <button key={key} onClick={() => setHistoricLayerVisibility(p => ({ ...p, [key]: !p[key as keyof typeof p] }))} className={`px-3 py-1.5 rounded-xl border text-[9px] font-black uppercase tracking-wider transition-all active:scale-95 ${historicLayerVisibility[key as keyof typeof historicLayerVisibility] ? 'bg-blue-500/20 border-blue-500/50 text-blue-300' : 'bg-white/5 border-white/10 text-slate-500'}`}>
                                                            {label}
                                                        </button>
                                                    ))}
                                                </div>
                                            )}

                                            {intelDetailsOpen && (
                                                <div className="mt-4 space-y-4 animate-in fade-in duration-200">

                                                    {/* Period Profile */}
                                                    {pasFinds.length > 0 && (
                                                        <div className="space-y-2">
                                                            <p className="text-[8px] font-black text-blue-400/60 uppercase tracking-widest">Historic Period Profile</p>
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

                                                    {/* Your Recorded Finds */}
                                                    {nearbyProjectFinds.length > 0 && (
                                                        <div className="space-y-2">
                                                            <p className="text-[8px] font-black text-emerald-400/60 uppercase tracking-widest">Your Recorded Finds</p>
                                                            <div className="space-y-1.5">
                                                                {nearbyProjectFinds.map(f => (
                                                                    <div key={f.id} className="bg-emerald-500/5 border border-emerald-500/10 px-3 py-2 rounded-xl flex justify-between items-center">
                                                                        <span className="text-[10px] font-black text-white uppercase truncate pr-3">{f.objectType || 'Unknown'}</span>
                                                                        <span className="text-[9px] font-bold text-emerald-400/70 uppercase shrink-0">{f.period}</span>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    )}

                                                    {/* Historic Findings */}
                                                    {pasFinds.length > 0 && (
                                                        <div className="space-y-2">
                                                            <p className="text-[8px] font-black text-blue-400/60 uppercase tracking-widest">Historic Findings</p>
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

                                                    {/* Etymological Signals */}
                                                    {placeSignals.length > 0 && (
                                                        <div className="space-y-2">
                                                            <p className="text-[8px] font-black text-emerald-500/60 uppercase tracking-widest">Etymological Signals</p>
                                                            <p className="text-[9px] text-slate-500 font-bold">Place-name evidence suggests historic activity in the wider area.</p>
                                                            <div className="space-y-2">
                                                                {placeSignals.map((s, i) => (
                                                                    <div key={i} className="bg-emerald-500/5 border border-emerald-500/10 p-4 rounded-2xl relative overflow-hidden">
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

                                                    {/* Detailed Breakdown */}
                                                    {potentialScore && (
                                                        <div className="space-y-2">
                                                            <p className="text-[8px] font-black text-slate-500 uppercase tracking-widest">Detailed Breakdown</p>
                                                            <div className="grid grid-cols-2 gap-3">
                                                                <div className="bg-white/5 p-4 rounded-3xl border border-white/10 relative">
                                                                    {scanConfidence && (
                                                                        <span className={`absolute top-2 right-2 text-[6px] font-black px-1 rounded border ${scanConfidence === 'Corroborated Signal' ? 'text-emerald-400 border-emerald-400/30' : scanConfidence === 'Developing Signal' ? 'text-amber-400 border-amber-400/30' : 'text-white/35 border-white/20'}`}>{scanConfidence}</span>
                                                                    )}
                                                                    <span className="block text-[8px] font-black text-slate-500 uppercase tracking-widest mb-1">Terrain Relief</span>
                                                                    <div className="h-1 bg-slate-800 rounded-full overflow-hidden my-1.5"><div className="h-full bg-emerald-500" style={{ width: `${potentialScore.breakdown?.terrain || 0}%` }} /></div>
                                                                    <span className="text-lg font-black text-emerald-500">{potentialScore.breakdown?.terrain || '0'}<span className="text-[10px] text-emerald-500/50 italic">%</span></span>
                                                                </div>
                                                                <div className="bg-white/5 p-4 rounded-3xl border border-white/10">
                                                                    <span className="block text-[8px] font-black text-slate-500 uppercase tracking-widest mb-1">Hydro Context</span>
                                                                    <div className="h-1 bg-slate-800 rounded-full overflow-hidden my-1.5"><div className="h-full bg-blue-500" style={{ width: `${potentialScore.breakdown?.hydro || 0}%` }} /></div>
                                                                    <span className="text-lg font-black text-blue-500">{potentialScore.breakdown?.hydro || '0'}<span className="text-[10px] text-blue-500/50 italic">%</span></span>
                                                                </div>
                                                                <div className="bg-white/5 p-4 rounded-3xl border border-white/10">
                                                                    <span className="block text-[8px] font-black text-slate-500 uppercase tracking-widest mb-1">Historic Density</span>
                                                                    <div className="h-1 bg-slate-800 rounded-full overflow-hidden my-1.5"><div className="h-full bg-amber-500" style={{ width: `${potentialScore.breakdown?.historic || 0}%` }} /></div>
                                                                    <span className="text-lg font-black text-amber-500">{potentialScore.breakdown?.historic || '0'}<span className="text-[10px] text-amber-500/50 italic">%</span></span>
                                                                </div>
                                                                <div className="bg-white/5 p-4 rounded-3xl border border-white/10">
                                                                    <span className="block text-[8px] font-black text-slate-500 uppercase tracking-widest mb-1">Spectral Signals</span>
                                                                    <div className="h-1 bg-slate-800 rounded-full overflow-hidden my-1.5"><div className="h-full bg-purple-500" style={{ width: `${potentialScore.breakdown?.signals || 0}%` }} /></div>
                                                                    <span className="text-lg font-black text-purple-500">{potentialScore.breakdown?.signals || '0'}<span className="text-[10px] text-purple-500/50 italic">%</span></span>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            )}

                                            {/* Export scan data — for validation / debugging */}
                                            {sourceAvailability && sortedHotspots.length > 0 && (
                                                <div className="pt-2 border-t border-white/8">
                                                    <button
                                                        onClick={() => {
                                                            const mc  = mapRef.current?.getCenter();
                                                            const mb  = mapRef.current?.getBounds();
                                                            const payload = {
                                                                exportedAt:        new Date().toISOString(),
                                                                engineVersion:     'FG-2026.05.02',
                                                                fromCache:         scanFromCache,
                                                                scanCenter:        mc ? { lat: mc.lat, lng: mc.lng } : null,
                                                                viewportBounds:    mb ? { west: mb.getWest(), south: mb.getSouth(), east: mb.getEast(), north: mb.getNorth() } : null,
                                                                sourceAvailability,
                                                                totalTargetCount:  displayTargets.length,
                                                                hotspots: sortedHotspots.map(h => ({
                                                                    id:                   h.id,
                                                                    classification:       h.classification,
                                                                    score:                h.score,
                                                                    confidence:           h.confidence,
                                                                    center:               h.center,
                                                                    metrics:              h.metrics,
                                                                    signalClassCount:     h.metrics.signalClassCount,
                                                                    disturbanceRisk:      h.disturbanceRisk,
                                                                    passedPrimaryEvidence: true,
                                                                    survivedDisturbanceGate: h.disturbanceRisk === 'High',
                                                                    explanation:          h.explanation,
                                                                })),
                                                                targets: displayTargets.map(t => ({
                                                                    id:            t.id,
                                                                    type:          t.type,
                                                                    findPotential: t.findPotential,
                                                                    confidence:    t.confidence,
                                                                    center:        t.center,
                                                                    sources:       t.sources,
                                                                    disturbanceRisk: t.disturbanceRisk,
                                                                })),
                                                            };
                                                            const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
                                                            const url  = URL.createObjectURL(blob);
                                                            const a    = Object.assign(document.createElement('a'), { href: url, download: `fieldguide-scan-${Date.now()}.json` });
                                                            document.body.appendChild(a); a.click();
                                                            setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 1000);
                                                        }}
                                                        className="w-full text-center text-[9px] font-black text-slate-500 hover:text-slate-300 uppercase tracking-widest transition-colors py-1"
                                                    >
                                                        ↓ Export scan data
                                                    </button>
                                                </div>
                                            )}

                                            {/* Principle statement */}
                                            <p className="text-[7px] text-white/15 text-center italic pt-2">Signal agreement, not direct detection</p>
                                        </div>
                                    )}


                            </div>
                        </div>
                        </div>
                        </>
                        );
                    })()}
                </div>

                {/* Sidebar */}
                <div className="hidden lg:flex lg:w-96 flex-col bg-slate-900/80 backdrop-blur-xl border-l border-white/5 shrink-0 relative z-50 overflow-y-auto scrollbar-hide">

                    {/* Unified Scan Panel - Desktop */}
                    <div className="p-5 border-b border-white/10 bg-slate-950/35">
                        <div className="flex items-start justify-between gap-4 mb-4">
                            <div className="min-w-0">
                                <p className="text-[10px] font-black text-emerald-400 uppercase tracking-[0.2em]">Scan Panel</p>
                                <div className="flex items-center gap-2 mt-1">
                                    <h2 className="text-lg font-black text-white tracking-tight leading-tight">
                                        {analyzing || isTerrainScanning || loadingPAS ? (scanStatus || 'Reading landscape signals') : historicMode ? 'Historic Review' : hasScanned ? 'Hotspot Review' : 'Ready to Scan'}
                                    </h2>
                                    {!analyzing && !isTerrainScanning && !loadingPAS && ((historicMode && historicScanComplete) || (!historicMode && hasScanned && terrainScanComplete)) && (
                                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-300 shadow-[0_0_6px_rgba(52,211,153,0.8)] shrink-0" />
                                    )}
                                </div>
                            </div>
                            {potentialScore && (
                                <span className="text-[10px] font-black text-white bg-emerald-500 px-2.5 py-1 rounded-full shadow-[0_0_10px_rgba(16,185,129,0.35)] shrink-0">{potentialScore.score}%</span>
                            )}
                        </div>

                        <div className="grid grid-cols-2 gap-2 mb-4">
                            <button
                                onClick={detectedFeatures.length > 0 ? clearScan : executeScan}
                                disabled={analyzing || isTerrainScanning}
                                title={detectedFeatures.length > 0 ? 'Clear scan results' : 'Scan area locked to Z16 for precision'}
                                className={`px-3 py-2.5 rounded-xl text-[10px] font-black tracking-widest uppercase border transition-all whitespace-nowrap disabled:opacity-50 disabled:animate-pulse ${detectedFeatures.length > 0 ? 'bg-emerald-500/20 text-emerald-200 border-emerald-400/40' : 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30 hover:bg-emerald-500/20'}`}
                            >
                                {analyzing || isTerrainScanning ? 'Reading...' : detectedFeatures.length > 0 ? 'Clear Scan' : 'Terrain'}
                            </button>
                            <button
                                onClick={() => {
                                    if (analyzing) return;
                                    if (!historicMode) { clearScan(); setHistoricMode(true); }
                                    else { setIsIntelOpen(false); setIntelDetailsOpen(false); setIntelLayersOpen(false); setHistoricMode(false); setHistoricLayerToggles({ lidar: false, os1930: false, os1880: false }); }
                                }}
                                disabled={analyzing}
                                className={`px-3 py-2.5 rounded-xl text-[10px] font-black tracking-widest uppercase border transition-all whitespace-nowrap ${analyzing ? 'bg-slate-800 text-slate-500 border-white/5 opacity-60 cursor-not-allowed' : historicMode ? 'bg-blue-500/20 text-blue-200 border-blue-400/40' : 'bg-blue-500/10 text-blue-300 border-blue-500/30 hover:bg-blue-500/20'} ${loadingPAS && historicMode ? 'animate-pulse opacity-80' : ''}`}
                            >
                                {(loadingPAS && historicMode) ? 'Reading...' : 'Historic'}
                            </button>
                        </div>

                        <div className="grid grid-cols-2 gap-2 mb-4">
                            <button
                                onClick={() => setShowFieldsPicker(v => !v)}
                                aria-label="Choose visible fields"
                                className={`flex items-center justify-center gap-1.5 px-2.5 py-2 rounded-xl border text-[9px] font-black uppercase tracking-wider transition-all active:scale-95 ${showFields !== false ? 'bg-teal-500/15 border-teal-400/40 text-teal-200' : showFieldsPicker ? 'bg-white/10 border-white/20 text-white' : 'bg-white/[0.03] border-white/10 text-slate-400'}`}
                            >
                                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="2" y="3" width="20" height="18" rx="2"/><path d="M2 9h20M12 9v12"/></svg>
                                {showFields !== false && showFields !== 'all'
                                    ? showFields.startsWith('field:')
                                        ? (fields.find(f => f.id === showFields.slice(6))?.name?.split(' ')[0] ?? 'Field')
                                        : (realPermissions.find(p => p.id === showFields)?.name?.split(' ')[0] ?? 'Fields')
                                    : showFields === 'all' ? 'All Fields' : 'My Fields'}
                            </button>
                            <button
                                onClick={() => setHistoricLayerToggles(p => ({ ...p, lidar: !p.lidar }))}
                                aria-label="Toggle LiDAR overlay"
                                className={`flex items-center justify-center gap-1.5 px-2.5 py-2 rounded-xl border text-[9px] font-black uppercase tracking-wider transition-all active:scale-95 ${historicLayerToggles.lidar ? 'bg-emerald-500/20 border-emerald-400/40 text-emerald-200' : 'bg-white/[0.03] border-white/10 text-slate-400'}`}
                            >
                                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M3 17l9-14 9 14H3z"/></svg>
                                LiDAR
                            </button>
                            <button
                                onClick={() => setHistoricLayerToggles(p => ({ ...p, os1880: !p.os1880 }))}
                                aria-label="Toggle OS 1895 overlay"
                                className={`flex items-center justify-center gap-1.5 px-2.5 py-2 rounded-xl border text-[9px] font-black uppercase tracking-wider transition-all active:scale-95 ${historicLayerToggles.os1880 ? 'bg-amber-500/20 border-amber-400/50 text-amber-200' : 'bg-white/[0.03] border-white/10 text-slate-400'}`}
                            >
                                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg>
                                OS 1895
                            </button>
                            <button
                                onClick={() => setHistoricLayerToggles(p => ({ ...p, os1930: !p.os1930 }))}
                                aria-label="Toggle OS 1900 overlay"
                                className={`flex items-center justify-center gap-1.5 px-2.5 py-2 rounded-xl border text-[9px] font-black uppercase tracking-wider transition-all active:scale-95 ${historicLayerToggles.os1930 ? 'bg-orange-500/20 border-orange-400/50 text-orange-200' : 'bg-white/[0.03] border-white/10 text-slate-400'}`}
                            >
                                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg>
                                OS 1900
                            </button>
                            <button
                                onClick={() => setHistoricLayerVisibility(p => ({ ...p, context: !p.context }))}
                                aria-label="Toggle landscape context layer"
                                className={`flex items-center justify-center gap-1.5 px-2.5 py-2 rounded-xl border text-[9px] font-black uppercase tracking-wider transition-all active:scale-95 ${historicLayerVisibility.context ? 'bg-blue-500/15 border-blue-400/40 text-blue-200' : 'bg-white/[0.03] border-white/10 text-slate-400'}`}
                            >
                                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M4 19h16M6 15l4-8 4 5 2-3 2 6"/></svg>
                                Context
                            </button>
                        </div>

                        <div className="grid grid-cols-3 gap-2 mb-4">
                            <div className="bg-white/[0.03] border border-white/10 rounded-xl p-2">
                                <span className="block text-sm font-black text-emerald-300">{sortedHotspots.length}</span>
                                <span className="text-[7px] font-black text-white/35 uppercase tracking-widest">Hotspots</span>
                            </div>
                            <div className="bg-white/[0.03] border border-white/10 rounded-xl p-2">
                                <span className="block text-sm font-black text-white">{displayTargets.length}</span>
                                <span className="text-[7px] font-black text-white/35 uppercase tracking-widest">Targets</span>
                            </div>
                            <div className="bg-white/[0.03] border border-white/10 rounded-xl p-2">
                                <span className="block text-sm font-black text-blue-300">{pasFinds.length + historicRoutes.length + placeSignals.length}</span>
                                <span className="text-[7px] font-black text-white/35 uppercase tracking-widest">Context</span>
                            </div>
                        </div>

                        {potentialScore ? (
                            <div className="space-y-3">
                                <div className="relative h-2 bg-black/40 rounded-full overflow-hidden">
                                    <div className="absolute inset-y-0 left-0 bg-emerald-500 shadow-[0_0_15px_rgba(16,185,129,0.5)] transition-all duration-1000" style={{ width: `${potentialScore.score}%` }} />
                                </div>
                                <div className="space-y-1.5">
                                    {potentialScore.reasons.slice(0, 3).map((reason, i) => (
                                        <div key={i} className="flex items-start gap-2">
                                            <div className="w-1 h-1 rounded-full bg-emerald-400 mt-1.5 shrink-0" />
                                            <p className="text-[10px] font-bold text-slate-300 leading-tight">{reason}</p>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ) : (
                            <p className="text-[10px] text-slate-500 font-bold uppercase italic leading-tight">Run a scan to read landscape signals.</p>
                        )}
                    </div>

                    <div className="p-5 border-b border-white/5 bg-white/[0.02]">
                        <div className="flex items-baseline justify-between gap-3 mb-3">
                            <h2 className="text-[10px] font-black text-blue-300 uppercase tracking-[0.2em]">Compare Hotspots</h2>
                            {compareHotspotIds.length > 0 && (
                                <button onClick={() => setCompareHotspotIds([])} className="text-[9px] font-black text-slate-500 hover:text-slate-300 uppercase tracking-widest">Clear</button>
                            )}
                        </div>
                        {compareHotspots.length === 2 ? (
                            <div className="grid grid-cols-2 gap-2">
                                {compareHotspots.map(h => {
                                    const hStrength = getHotspotSignalStrength(h.score);
                                    const hierarchy = getHotspotResultHierarchy(h, hStrength);
                                    const investigationStatus = investigationMap.get(h.id)?.status ?? 'unreviewed';
                                    return (
                                        <button
                                            key={h.id}
                                            onClick={() => {
                                                setSelectedHotspotId(h.id);
                                                mapRef.current?.fitBounds(h.bounds as maplibregl.LngLatBoundsLike, { padding: 40 });
                                            }}
                                            className="text-left rounded-2xl border border-white/10 bg-slate-950/45 p-3 hover:border-blue-400/40 transition-colors"
                                        >
                                            <div className="flex items-start justify-between gap-2 mb-2">
                                                <p className="text-[8px] font-black text-white/35 uppercase tracking-widest">{HOTSPOT_TITLES[h.classification]}</p>
                                                <span className="text-[8px] font-black text-blue-300">#{h.number}</span>
                                            </div>
                                            <p className="text-xs font-black text-white leading-tight mb-1">{hierarchy.signalStrength}</p>
                                            <p className="text-[9px] font-bold text-white/65 leading-tight mb-2">{hierarchy.whyItMatters}</p>
                                            <div className="grid grid-cols-2 gap-1.5">
                                                <div className="rounded-lg bg-white/[0.03] border border-white/8 px-2 py-1">
                                                    <span className="block text-[10px] font-black text-emerald-300">{h.metrics.signalClassCount}</span>
                                                    <span className="text-[6px] font-black text-white/35 uppercase tracking-widest">Signals</span>
                                                </div>
                                                <div className="rounded-lg bg-white/[0.03] border border-white/8 px-2 py-1">
                                                    <span className="block text-[10px] font-black text-amber-300">{h.disturbanceRisk ?? 'Low'}</span>
                                                    <span className="text-[6px] font-black text-white/35 uppercase tracking-widest">Disturbance</span>
                                                </div>
                                            </div>
                                            <p className="mt-2 text-[8px] font-black text-blue-300/75 uppercase tracking-widest">{INVESTIGATION_STATUSES.find(s => s.value === investigationStatus)?.label}</p>
                                        </button>
                                    );
                                })}
                            </div>
                        ) : (
                            <p className="text-[10px] text-slate-500 font-bold uppercase italic leading-tight">
                                Select two hotspots below to compare signal strength, evidence and status.
                            </p>
                        )}
                    </div>

                    <div className="p-6 border-b border-white/5 shrink-0 overflow-y-auto max-h-[40%] scrollbar-hide">
                        <div className="flex justify-between items-baseline mb-4">
                            <div className="flex items-center gap-2">
                                <h2 className="text-sm font-black text-white uppercase tracking-tighter">Hotspots</h2>
                                {hotspotVersion && (
                                    <span className={`text-[8px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded border ${hotspotVersion === 'enhanced' ? 'text-amber-400 border-amber-500/40 bg-amber-500/10' : 'text-slate-400 border-slate-500/40 bg-slate-500/10'}`}>
                                        {hotspotVersion === 'enhanced' ? 'Enhanced' : 'Terrain Only'}
                                    </span>
                                )}
                            </div>
                            {selectedHotspotId && <button onClick={() => setSelectedHotspotId(null)} className="text-[9px] font-black text-emerald-500 hover:underline tracking-widest uppercase">Clear View</button>}
                        </div>
                        <div className="flex flex-col gap-4">
                            {sortedHotspots.length > 0 ? sortedHotspots.map(h => {
                                const hStrength = getHotspotSignalStrength(h.score);
                                const hierarchy = getHotspotResultHierarchy(h, hStrength);
                                const hStrengthColour = hStrength === 'Strong Zone' ? 'text-amber-400' : hStrength === 'Moderate Zone' ? 'text-emerald-400' : 'text-slate-200';
                                const hBorderIdle = hStrength === 'Strong Zone' ? 'bg-slate-950/30 border-amber-500/20 hover:border-amber-500/35' : hStrength === 'Moderate Zone' ? 'bg-slate-950/30 border-emerald-500/20 hover:border-emerald-500/35' : 'bg-slate-950/30 border-white/10 hover:border-white/18';
                                const isPrimaryHotspot = h.number === 1;
                                const investigationStatus = investigationMap.get(h.id)?.status ?? 'unreviewed';
                                const isCompared = compareHotspotIds.includes(h.id);
                                return (
                                <div
                                    key={h.id}
                                    onClick={() => {
                                        setShowSuggestion(false);
                                        setSelectedHotspotId(h.id);
                                        mapRef.current?.fitBounds(h.bounds as maplibregl.LngLatBoundsLike, { padding: 40 });
                                    }}
                                    className={`p-4 rounded-2xl border cursor-pointer transition-all active:scale-[0.98] ${selectedHotspotId === h.id ? 'bg-white/[0.07] border-white/50 ring-2 ring-white/5' : hBorderIdle}`}
                                >
                                    <div className="mb-3">
                                        <div className="flex justify-between items-start gap-2 mb-1.5">
                                            <div className="min-w-0">
                                                <h3 className="text-[12px] font-black text-white leading-tight">{HOTSPOT_TITLES[h.classification]}</h3>
                                                <div className="flex items-center gap-1.5 mt-1">
                                                    <span className="text-[7px] font-black text-white/40 uppercase tracking-[0.16em]">Hotspot {h.number}</span>
                                                    <span className={`rounded-full border px-1.5 py-0.5 text-[7px] font-black ${hStrength === 'Strong Zone' ? 'border-amber-400/30 bg-amber-500/10 text-amber-300' : hStrength === 'Moderate Zone' ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-300' : 'border-white/10 bg-white/[0.04] text-slate-300'}`}>{hierarchy.signalStrength}</span>
                                                </div>
                                            </div>
                                            {isPrimaryHotspot && <span className="bg-emerald-500/15 border border-emerald-400/30 text-emerald-200 px-1.5 py-0.5 rounded-full text-[7px] font-black uppercase tracking-widest flex-shrink-0">Priority</span>}
                                        </div>
                                        <p className="text-[10px] font-bold text-white/75 leading-snug mb-1.5">{hierarchy.whyItMatters}</p>
                                        <p className="text-[9px] font-black text-emerald-400/70 uppercase tracking-widest leading-tight mb-1.5">Cue: {hierarchy.nextAction}</p>
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                toggleCompareHotspot(h.id);
                                            }}
                                            className={`mb-1.5 w-full rounded-lg border px-2 py-1.5 text-[8px] font-black uppercase tracking-widest transition-colors ${isCompared ? 'bg-blue-500/20 border-blue-400/50 text-blue-200' : 'bg-white/[0.03] border-white/10 text-white/45 hover:text-white/70'}`}
                                        >
                                            {isCompared ? 'Selected for Compare' : 'Compare'}
                                        </button>
                                        <select
                                            value={investigationStatus}
                                            onClick={(e) => e.stopPropagation()}
                                            onChange={(e) => {
                                                e.stopPropagation();
                                                void setHotspotInvestigationStatus(h.id, e.target.value as FieldGuideInvestigationStatus);
                                            }}
                                            className="mt-1 mb-1.5 w-full bg-slate-950/70 border border-white/10 rounded-lg px-2 py-1.5 text-[9px] font-black text-white/80 uppercase tracking-wider outline-none"
                                        >
                                            {INVESTIGATION_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                                        </select>
                                        <textarea
                                            value={pendingNotes[h.id] ?? (investigationMap.get(h.id)?.notes ?? '')}
                                            onClick={(e) => e.stopPropagation()}
                                            onChange={(e) => {
                                                e.stopPropagation();
                                                setPendingNotes(prev => ({ ...prev, [h.id]: e.target.value }));
                                            }}
                                            onBlur={(e) => {
                                                void saveHotspotNote(h.id, e.target.value);
                                            }}
                                            placeholder="Field notes..."
                                            rows={2}
                                            className="mb-1.5 w-full bg-slate-950/70 border border-white/10 rounded-lg px-2 py-1.5 text-[10px] text-white/70 placeholder-white/20 outline-none focus:border-white/25 resize-none"
                                        />
                                        {(h.secondaryTag || h.isOnCorridor || (h.linkedCount ?? 0) > 0) && (
                                            <div className="flex items-center gap-2 flex-wrap mt-1 mb-1">
                                                {h.secondaryTag && <span className="text-[8px] font-bold text-amber-300/55 uppercase tracking-widest">{h.secondaryTag}</span>}
                                                {h.isOnCorridor && <span className="text-[8px] font-bold text-emerald-500/55 uppercase tracking-widest">On corridor</span>}
                                                {(h.linkedCount ?? 0) > 0 && <span className="text-[8px] font-bold text-white/35 uppercase tracking-widest">Linked to {h.linkedCount} nearby</span>}
                                            </div>
                                        )}
                                        {(() => {
                                            const ctx = hotspotFindContext.get(h.id);
                                            if (!ctx) return null;
                                            const text = ctx.status === 'within'
                                                ? `${ctx.count} find${ctx.count !== 1 ? 's' : ''} recorded here`
                                                : `${ctx.count} find${ctx.count !== 1 ? 's' : ''} nearby`;
                                            return <p className="text-[7px] font-black text-emerald-400 uppercase tracking-widest mt-1 bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.5 rounded inline-block">{text}</p>;
                                        })()}
                                    </div>
                                    {h.isHighConfidenceCrossing && (
                                        <div className="bg-blue-600/40 p-1.5 rounded-xl border border-blue-400 mb-3 animate-pulse">
                                            <p className="m-0 text-[9px] font-black uppercase text-white text-center tracking-widest">🌊 Likely historic crossing point</p>
                                        </div>
                                    )}
                                    {h.disturbanceRisk === 'High' && (
                                        <div className="bg-red-500/15 px-2 py-1.5 rounded-xl border border-red-400/30 mb-3">
                                            <p className="m-0 text-[8px] font-black uppercase text-red-300 tracking-widest">Disturbed ground — interpret with caution</p>
                                        </div>
                                    )}
                                    <div className="space-y-1.5 mt-3">
                                        <p className="text-[8px] font-black text-white/35 uppercase tracking-widest mb-1.5">Evidence summary</p>
                                        {h.explanation.slice(0, 3).map((reason, idx) => (
                                            <div key={idx} className="flex items-center gap-2">
                                                <div className="w-1 h-1 rounded-full bg-emerald-500 shrink-0" />
                                                <p className="text-[11px] font-bold text-slate-200 leading-tight">{reason}</p>
                                            </div>
                                        ))}
                                    </div>
                                    {h.suggestedFocus && (
                                        <div className="flex items-center gap-1.5 mt-2.5 pt-2.5 border-t border-white/5">
                                            <div className="w-1 h-1 rounded-full bg-emerald-500 flex-shrink-0" />
                                            <p className="text-[9px] leading-tight">
                                                <span className="font-black text-emerald-500/60 uppercase tracking-widest">Field focus: </span>
                                                <span className="font-bold text-emerald-300/80">{h.suggestedFocus}</span>
                                            </p>
                                        </div>
                                    )}
                                    <div className="mt-2.5 pt-2.5 border-t border-white/5">
                                        <span
                                            onClick={() => setExpandedInterpretationId(expandedInterpretationId === h.id ? null : h.id)}
                                            className="text-[10px] font-black text-amber-400 hover:text-amber-300 transition-colors duration-150 cursor-pointer"
                                        >
                                            {expandedInterpretationId === h.id ? '▲ Hide evidence breakdown' : '▼ See full evidence breakdown'}
                                        </span>
                                        {expandedInterpretationId === h.id && (() => {
                                            const interp = buildInterpretation(h);
                                            const breakdown = [
                                                { label: 'Anomaly',     val: h.metrics.anomaly,     cap: 30 },
                                                { label: 'Context',     val: h.metrics.context,     cap: 25 },
                                                { label: 'Convergence', val: h.metrics.convergence, cap: 20 },
                                                { label: 'Behaviour',   val: h.metrics.behaviour,   cap: 15 },
                                            ];
                                            return (
                                                <div className="mt-3 space-y-3.5 animate-in fade-in duration-200">
                                                    <p className="text-[8px] font-black text-white/25 uppercase tracking-[0.2em]">{getInterpretationLabel(h.confidence)}</p>
                                                    <div>
                                                        <p className="text-[8px] font-black text-white/45 uppercase tracking-[0.15em] mb-1">Summary</p>
                                                        <p className="text-[11px] text-white/80 leading-relaxed">{interp.summary}</p>
                                                    </div>
                                                    <div>
                                                        <p className="text-[8px] font-black text-white/45 uppercase tracking-[0.15em] mb-1">Why it stands out</p>
                                                        <p className="text-[11px] text-white/80 leading-relaxed">{interp.reasoning}</p>
                                                    </div>
                                                    <div>
                                                        <p className="text-[8px] font-black text-white/45 uppercase tracking-[0.15em] mb-1">How to approach it</p>
                                                        <p className="text-[11px] text-white/80 leading-relaxed">{interp.strategy}</p>
                                                    </div>
                                                    <div className="border-t border-white/10 pt-2.5">
                                                        <p className="text-[7px] font-black text-white/45 uppercase tracking-[0.2em] mb-2">Signal breakdown</p>
                                                        <div className="space-y-1.5">
                                                            {breakdown.map(({ label, val, cap }) => (
                                                                <div key={label} className="flex items-center gap-2">
                                                                    <span className="text-[7px] text-white/55 w-16 flex-shrink-0">{label}</span>
                                                                    <div className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden">
                                                                        <div className="h-full bg-emerald-500/70 rounded-full" style={{ width: `${Math.min(100, (val / cap) * 100)}%` }} />
                                                                    </div>
                                                                    <span className="text-[7px] text-white/50 w-8 text-right flex-shrink-0">{Math.min(val, cap)}/{cap}</span>
                                                                </div>
                                                            ))}
                                                            {h.metrics.penalty !== 0 && <p className="text-[7px] text-white/45 mt-1">Penalty: {h.metrics.penalty} &nbsp;·&nbsp; Final: {h.score}</p>}
                                                        </div>
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
                                <p className="text-[10px] text-slate-500 font-bold uppercase italic text-center py-4">No hotspots detected.</p>
                            )}
                        </div>
                    </div>

                    <div className="p-6 border-b border-white/5 flex justify-between items-center shrink-0">
                        <div>
                            <h2 className="text-sm font-black text-white uppercase tracking-tighter">Target Review</h2>
                            <p className="text-[10px] text-slate-500 font-bold uppercase">{detectedFeatures.length} Landscape Signal{detectedFeatures.length !== 1 ? 's' : ''}</p>
                        </div>
                        {selectedId && <button onClick={() => setSelectedId(null)} className="text-[10px] font-black text-emerald-500 hover:underline tracking-widest uppercase">Reset</button>}
                    </div>

                    <div ref={scrollRef} className="flex-1 overflow-y-auto p-5 scrollbar-hide space-y-4">
                        {displayTargets.map((f) => {
                            const tInterp = buildTargetInterpretation(f);
                            const isSelected = selectedId === f.id;
                            const isPrimaryTarget = f.id === primaryTargetId;
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
                                    className={`p-4 rounded-2xl cursor-pointer transition-all border-2 active:scale-[0.98] ${isSelected ? (f.isProtected ? 'bg-red-950/20 border-red-800/80 ring-2 ring-red-950/50' : 'bg-white/10 border-white ring-4 ring-white/10') : f.isProtected ? 'bg-slate-950/50 border-red-900/60 hover:border-red-800/80' : isPrimaryTarget ? 'bg-slate-900/55 border-emerald-500/45 hover:border-emerald-500/65 shadow-[0_0_20px_rgba(16,185,129,0.07)]' : tInterp.signalStrength === 'Strong Signal' ? 'bg-slate-900/50 border-amber-500/35 hover:border-amber-500/55' : tInterp.signalStrength === 'Moderate Signal' ? 'bg-slate-900/50 border-emerald-500/25 hover:border-emerald-500/45' : 'bg-slate-900/50 border-white/12 hover:border-white/22'}`}
                                >
                                    <div className="flex items-center justify-between gap-2 mb-2">
                                        {!f.isProtected && isPrimaryTarget && (
                                            <span className="bg-emerald-500/25 border border-emerald-500/50 text-emerald-200 px-2 py-0.5 rounded-full text-[7px] font-black uppercase tracking-widest shadow-[0_0_8px_rgba(16,185,129,0.15)]">Start Here</span>
                                        )}
                                        {!f.isProtected && !isPrimaryTarget && (
                                            <span className="bg-white/[0.04] border border-white/10 text-white/35 px-1.5 py-0.5 rounded-full text-[7px] font-black uppercase tracking-widest">Target</span>
                                        )}
                                        <p className={`text-[9px] font-black uppercase tracking-[0.2em] ml-auto ${f.isProtected ? 'text-stone-400/70' : 'text-white/70'}`}>
                                            {f.isProtected ? 'Scheduled Monument' : `Target ${f.number}`}
                                        </p>
                                    </div>
                                    {/* Header row: type + source dots */}
                                    <div className="flex justify-between items-start mb-2">
                                        <div className="flex-1 min-w-0 pr-2">
                                            {!f.isProtected && <h3 className={`text-[11px] font-black tracking-tight leading-tight mb-0.5 ${isSelected ? 'text-white' : 'text-slate-200'}`}>{f.type}</h3>}
                                            {!f.isProtected && <p className={`text-[10px] font-black ${strengthColour[tInterp.signalStrength]}`}>{tInterp.signalStrength}</p>}
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
                                        /* Scheduled Monument — no target guidance shown */
                                        <div className="border-t border-stone-700/30 pt-2 space-y-2">
                                            <div className="p-2 bg-stone-900/40 rounded-xl border border-stone-700/40 space-y-1">
                                                <p className="text-[9px] font-bold text-stone-200/80 leading-snug">This area is protected as a Scheduled Monument.</p>
                                                <p className="text-[9px] text-stone-400/55 leading-snug">Check legal protections before any fieldwork.</p>
                                            </div>
                                            {f.aimInfo && (
                                                <div className="px-2 py-1 bg-stone-900/30 border border-stone-700/30 rounded-lg">
                                                    <p className="text-[8px] font-black uppercase text-stone-400/60">{f.aimInfo.type} · {f.aimInfo.period}</p>
                                                </div>
                                            )}
                                        </div>
                                    ) : (
                                        <>
                                            <p className="text-[10px] font-black text-white/75 leading-snug mb-0.5">{getTargetVerdict(tInterp.signalStrength, isPrimaryTarget)}</p>
                                            {/* Hook */}
                                            <p className="text-[10px] font-bold text-white/70 leading-snug mb-2">{tInterp.hook}</p>
                                            {(() => {
                                                const ctx = targetFindContext.get(f.id);
                                                if (!ctx) return null;
                                                const text = ctx.status === 'within'
                                                    ? `${ctx.count} find${ctx.count !== 1 ? 's' : ''} recorded here`
                                                    : `${ctx.count} find${ctx.count !== 1 ? 's' : ''} nearby`;
                                                return <p className="text-[7px] font-black text-emerald-400 uppercase tracking-widest mb-1.5 bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.5 rounded inline-block">{text}</p>;
                                            })()}
                                            {/* Crossing badge */}
                                            {f.isHighConfidenceCrossing && (<div className="bg-blue-600/40 p-1.5 rounded-xl border border-blue-400 mb-2 animate-pulse"><p className="m-0 text-[9px] font-black uppercase text-white text-center tracking-widest">🌊 Likely historic crossing point</p></div>)}
                                            {/* Why this matters */}
                                            <div className="space-y-1.5 mt-2 border-t border-white/8 pt-2">
                                                <p className="text-[8px] font-black text-white/35 uppercase tracking-widest mb-1.5">Why this matters</p>
                                                {f.explanationLines && f.explanationLines.length > 0 ? (
                                                    f.explanationLines.slice(0, 3).map((line, idx) => (
                                                        <div key={idx} className="flex items-center gap-2">
                                                            <div className="w-1 h-1 rounded-full bg-emerald-500 shrink-0" />
                                                            <p className="text-[11px] font-bold text-slate-200 leading-tight">{line}</p>
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
                                                    <span className="font-black text-emerald-500/60 uppercase tracking-widest">Target focus: </span>
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

            {/* Your Find Card — desktop only; mobile shows inside panel */}
            {selectedUserFind && (() => {
                const PERIOD_CHIP: Record<string, string> = {
                    'Prehistoric': 'bg-gray-700/60 text-gray-300', 'Bronze Age': 'bg-orange-900/50 text-orange-300',
                    'Iron Age': 'bg-red-900/50 text-red-300', 'Celtic': 'bg-teal-900/50 text-teal-300',
                    'Roman': 'bg-purple-900/50 text-purple-300', 'Anglo-Saxon': 'bg-amber-900/50 text-amber-300',
                    'Early Medieval': 'bg-emerald-900/50 text-emerald-300', 'Medieval': 'bg-blue-900/50 text-blue-300',
                    'Post-medieval': 'bg-indigo-900/50 text-indigo-300', 'Modern': 'bg-green-900/50 text-green-300',
                    'Unknown': 'bg-white/5 text-white/40',
                };
                const chipClass = PERIOD_CHIP[selectedUserFind.period] ?? PERIOD_CHIP['Unknown'];
                const foundDate = selectedUserFind.foundAt ?? selectedUserFind.createdAt;
                const dateLabel = foundDate ? new Date(foundDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : null;
                return (
                <div className="hidden lg:block">
                    <div className="absolute inset-0 z-[199]" onClick={() => setSelectedUserFind(null)} />
                    <div className="absolute bottom-6 left-auto right-6 w-96 z-[200] animate-in slide-in-from-bottom-4 fade-in duration-200">
                        <div className="p-5 rounded-3xl border-2 border-emerald-500/40 bg-slate-900 shadow-2xl shadow-emerald-900/20">
                            <p className="text-[9px] font-black text-white uppercase tracking-[0.2em] text-center mb-3">Your Find</p>

                            {/* Top row: photo + main details */}
                            <div className="flex items-start gap-3 mb-4">
                                {/* Photo / placeholder */}
                                <div className="w-16 h-16 rounded-xl overflow-hidden flex-shrink-0 border border-white/10">
                                    {selectedUserFindMedia
                                        ? <ScaledImage media={selectedUserFindMedia} className="w-full h-full" imgClassName="object-cover" showScale={false} />
                                        : <div className="w-full h-full border border-dashed border-white/15 rounded-xl grid place-items-center text-[9px] font-black text-white/20 uppercase tracking-wider">No Photo</div>
                                    }
                                </div>

                                <div className="flex-1 min-w-0">
                                    <div className="flex items-start justify-between">
                                        <h3 className="text-base font-black text-white tracking-tight leading-tight mb-1 pr-2">
                                            {selectedUserFind.objectType || 'Unknown Object'}
                                        </h3>
                                        <button onClick={() => setSelectedUserFind(null)} className="bg-black/20 hover:bg-black/40 text-white rounded-full p-2 transition-colors border border-white/10 flex-shrink-0 -mt-0.5">
                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                                        </button>
                                    </div>
                                    {/* Period chip + material */}
                                    <div className="flex items-center gap-1.5 flex-wrap">
                                        <span className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest ${chipClass}`}>{selectedUserFind.period}</span>
                                        {selectedUserFind.material && <span className="text-[10px] text-white/40">{selectedUserFind.material}</span>}
                                    </div>
                                </div>
                            </div>

                            {/* Meta chips row */}
                            <div className="flex items-center gap-2 flex-wrap mb-3">
                                {dateLabel && (
                                    <span className="flex items-center gap-1 text-[10px] text-white/40">
                                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                                        {dateLabel}
                                    </span>
                                )}
                                {selectedUserFind.depthCm != null && (
                                    <span className="flex items-center gap-1 text-[10px] text-white/40">
                                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="2" x2="12" y2="22"/><polyline points="6 16 12 22 18 16"/></svg>
                                        {selectedUserFind.depthCm} cm
                                    </span>
                                )}
                                {selectedUserFind.weightG != null && (
                                    <span className="text-[10px] text-white/40">{selectedUserFind.weightG} g</span>
                                )}
                            </div>

                            {/* Notes snippet */}
                            {selectedUserFind.notes?.trim() && (
                                <p className="text-[11px] text-white/40 italic leading-snug line-clamp-2 mb-3">{selectedUserFind.notes.trim()}</p>
                            )}

                            {/* Footer: find code */}
                            <div className="border-t border-white/8 pt-3">
                                <span className="text-[10px] text-white/25 font-mono">{selectedUserFind.findCode}</span>
                            </div>
                        </div>
                    </div>
                </div>
                );
            })()}

            {/* Heritage Feature Card — desktop only; mobile shows inside panel */}
            {selectedPASFind && (
                <div className="hidden lg:block">
                    <div className="absolute inset-0 z-[199]" onClick={() => setSelectedPASFind(null)} />
                    <div className="absolute bottom-6 left-auto right-6 w-96 z-[200] animate-in slide-in-from-bottom-4 fade-in duration-200">
                        <div className="p-5 rounded-3xl border-2 border-emerald-500/40 bg-slate-900 shadow-2xl shadow-emerald-900/20">
                            <p className="text-[9px] font-black text-white uppercase tracking-[0.2em] text-center mb-3">Heritage Feature</p>
                            <div className="flex justify-between items-start mb-4">
                                <div className="flex-1 min-w-0 pr-3">
                                    <h3 className="text-base font-black text-white tracking-tight leading-tight mb-1">{selectedPASFind.objectType}</h3>
                                    <p className="text-[11px] font-black text-emerald-400">{selectedPASFind.broadperiod}</p>
                                </div>
                                <button onClick={() => setSelectedPASFind(null)} className="bg-black/20 hover:bg-black/40 text-white rounded-full p-2 transition-colors border border-white/10 flex-shrink-0">
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                                </button>
                            </div>
                            <div className="border-t border-white/8 pt-3 space-y-3">
                                <p className="text-[11px] font-bold text-white/70 leading-snug">Standing heritage feature recorded in the OpenStreetMap community dataset.</p>
                                <a
                                    href={`https://www.openstreetmap.org/${selectedPASFind.osmType || 'node'}/${selectedPASFind.internalId}`}
                                    target="_blank" rel="noreferrer"
                                    className="flex items-center justify-center gap-2 w-full py-3 bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/30 text-emerald-300 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all active:scale-[0.98]"
                                >
                                    View on OpenStreetMap
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
                                </a>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
