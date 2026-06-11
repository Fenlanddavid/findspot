import React, { useState, useReducer, useRef, useEffect, useLayoutEffect, useCallback, useMemo } from 'react';
import maplibregl from 'maplibre-gl';
import * as turf from '@turf/turf';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useSearchParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, Find, Media, SavedPoint } from '../db';
import { ScaledImage } from '../components/ScaledImage';
import { CoachTip, CoachTips } from '../components/CoachTips';
import { useFieldGuideMap } from '../hooks/useFieldGuideMap';
import { useTerrainScan, ScanContext } from '../hooks/useTerrainScan';
import { useHistoricScan } from '../hooks/useHistoricScan';
import { useTilePrewarm } from '../hooks/useTilePrewarm';
import type { WorkflowState } from '../types/significantFind';
import { FieldGuideContext } from '../components/fieldGuide/FieldGuideContext';
import { FieldGuideMap } from '../components/fieldGuide/FieldGuideMap';
import { ScanLogDrawer } from '../components/fieldGuide/ScanLogDrawer';

import {
    Cluster, TraceTarget, HistoricFind, PlaceSignal, HistoricRoute, Hotspot,
    HotspotClassification, HOTSPOT_INTERPRETATION,
} from './fieldGuideTypes';
import { computeTraceTargets } from '../utils/traceTargetEngine';
import { usePotentialScore } from '../hooks/usePotentialScore';
import { SCAN_CONFIG } from '../utils/scanConfig';
import { LogEntry, LogSource, LogLevel, makeLog } from '../utils/scanLogger';
import {
    DevAnnotation, AnnotationType, BroadPeriod, LandscapeType, AnnotationConfidence,
    EngineContextAtPoint, ANNOTATION_TYPE_LABELS, LANDSCAPE_TYPE_LABELS,
} from '../utils/devAnnotation';
import { buildInterpretation, getInterpretationLabel, getHotspotSignalStrength, getSignalTypeSummary, HotspotSignalStrength } from '../utils/hotspotInterpreter';
import { buildTargetInterpretation, getTargetVerdict, TargetSignalStrength } from '../utils/targetInterpreter';
import { getDistance, MONUMENT_BOUNDARY_BUFFER_M } from '../utils/fieldGuideAnalysis';
import { FIELDGUIDE_SHORT_NOTICE } from '../utils/legalCopy';
import { runGeologyContext, sweepStaleGeologyCache } from '../engines/geologyContext';
import type { GeologyContext } from '../engines/geologyContext';
import { applyGeologyModifiers } from '../utils/hotspotEngine';
import { getSetting } from '../services/data';
import { recordFindHotspotSignals } from '../services/findHotspotService';

const FIELDGUIDE_HELPERS_SEEN_KEY = 'fs_fg_helpers_seen';

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

function formatRelativeDate(isoStr: string): string {
    const diff = Date.now() - new Date(isoStr).getTime();
    const days = Math.floor(diff / 86400000);
    if (days === 0) return 'Today';
    if (days === 1) return 'Yesterday';
    if (days < 7) return `${days} days ago`;
    const weeks = Math.floor(days / 7);
    if (weeks === 1) return '1 week ago';
    if (weeks < 5) return `${weeks} weeks ago`;
    const months = Math.floor(days / 30);
    if (months === 1) return '1 month ago';
    return `${months} months ago`;
}

function getSignalBand(value: number | null | undefined, cap = 100): string {
    const ratio = cap > 0 ? Math.max(0, Math.min(1, (value ?? 0) / cap)) : 0;
    if (ratio >= 0.72) return 'Strong';
    if (ratio >= 0.42) return 'Moderate';
    if (ratio > 0.08) return 'Trace';
    return 'Not present';
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
    'Multi-Period Occupation Zone':     'Multi-Period Site',
    'Terrain Structure Candidate':      'Structural Feature',
    'Spectral Activity Candidate':      'Cropmark Signal',
    'Lowland Activity Zone':            'Lowland Activity Zone',
    'Raised Activity Area':             'Raised Activity Area',
    'Route-Influenced Area':            'Route-Influenced Area',
    'Cropmark Activity Zone':           'Cropmark Activity Zone',
    'Multi-Signal Activity Zone':       'Multi-Signal Activity Zone',
    'General Activity Zone':            'Supporting Activity Zone',
};

const HISTORIC_LAYER_OPTIONS = [
    { key: 'context',   label: 'Recorded Heritage' },
    { key: 'routes',    label: 'Roman Roads & Trackways' },
    { key: 'corridors', label: 'Movement Corridors' },
    { key: 'crossings', label: 'Crossing Points' },
    { key: 'monuments', label: 'Scheduled Monuments' },
    { key: 'aim',       label: 'Aerial Archaeology' },
    { key: 'userFinds', label: 'Your Finds' },
] as const;

type RasterOverlayKey = 'lidar' | 'os1880' | 'os1930';
type RasterOverlayOpacity = Record<RasterOverlayKey, number>;

const DEFAULT_RASTER_OVERLAY_OPACITY: RasterOverlayOpacity = {
    lidar:  1,
    os1880: 1,
    os1930: 1,
};

const RASTER_OVERLAY_LABELS: Record<RasterOverlayKey, string> = {
    lidar:  'LiDAR',
    os1880: 'OS 1895',
    os1930: 'OS 1900',
};

const RASTER_OVERLAY_STORAGE_KEY = 'fs_fg_overlay_opacity';

function clampOpacity(value: unknown, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value)
        ? Math.max(0, Math.min(1, value))
        : fallback;
}

function readRasterOverlayOpacity(): RasterOverlayOpacity {
    try {
        const raw = localStorage.getItem(RASTER_OVERLAY_STORAGE_KEY);
        if (!raw) return DEFAULT_RASTER_OVERLAY_OPACITY;
        const parsed = JSON.parse(raw) as Partial<RasterOverlayOpacity>;
        return {
            lidar:  clampOpacity(parsed.lidar, DEFAULT_RASTER_OVERLAY_OPACITY.lidar),
            os1880: clampOpacity(parsed.os1880, DEFAULT_RASTER_OVERLAY_OPACITY.os1880),
            os1930: clampOpacity(parsed.os1930, DEFAULT_RASTER_OVERLAY_OPACITY.os1930),
        };
    } catch {
        return DEFAULT_RASTER_OVERLAY_OPACITY;
    }
}

// ─── Engine state (reducer) ───────────────────────────────────────────────────

type ScanPhase    = 'idle' | 'terrain' | 'historic' | 'complete';
type HotspotVersion = 'terrain' | 'enhanced' | 'geology-enhanced' | null;

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
    | { type: 'GEOLOGY_ENHANCE'; hotspots: Hotspot[] }
    | { type: 'SET_HERITAGE_COUNT'; count: number; monumentPoints: [number, number][]; routes?: HistoricRoute[] }
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
                hasScanned: true,
            };
        case 'SCAN_FAIL':
            return { ...state, analyzing: false, scanPhase: 'idle' };
        case 'HISTORIC_ENHANCE':
            return { ...state, scanPhase: 'complete', hotspotVersion: 'enhanced', hotspots: action.hotspots };
        case 'GEOLOGY_ENHANCE':
            return { ...state, hotspotVersion: 'geology-enhanced', hotspots: action.hotspots };
        case 'SET_HERITAGE_COUNT':
            return {
                ...state,
                heritageCount: action.count,
                monumentPoints: action.monumentPoints,
                historicRoutes: action.routes ?? state.historicRoutes,
            };
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

function getProtectedTargetCopy(f: Cluster): { label: string; body: string; detail: string } {
    if (f.monumentBufferM) {
        return {
            label: 'Scheduled Monument Buffer',
            body: `This target falls inside the ${f.monumentBufferM} m buffer around a Scheduled Monument boundary.`,
            detail: 'Treat the buffer as a no-detect zone. Avoid disturbing the site boundary and check current protections before any fieldwork.',
        };
    }
    return {
        label: 'Scheduled Monument',
        body: 'This area is protected as a Scheduled Monument.',
        detail: 'Metal detecting, excavation, or intrusive activity may require legal consent. Avoid disturbing the site boundary and check current protections before any fieldwork.',
    };
}

function buildMonumentBufferGeoJSON(data: { features?: unknown[] }): GeoJSON.FeatureCollection {
    const features = (data.features ?? []).flatMap(feature => {
        const geoFeature = feature as GeoJSON.Feature;
        const geometryType = geoFeature.geometry?.type;
        if (geometryType !== 'Polygon' && geometryType !== 'MultiPolygon') return [];
        try {
            const buffered = turf.buffer(geoFeature, MONUMENT_BOUNDARY_BUFFER_M / 1000, { units: 'kilometers' });
            if (!buffered) return [];
            buffered.properties = {
                ...(geoFeature.properties ?? {}),
                bufferMetres: MONUMENT_BOUNDARY_BUFFER_M,
            };
            return [buffered as GeoJSON.Feature];
        } catch {
            return [];
        }
    });
    return { type: 'FeatureCollection', features };
}

type HotspotResultHierarchy = {
    signalStrength: 'Developing Signal' | 'Strong Signal' | 'Corroborated Signal';
    whyItMatters: string;
    nextAction: string;
};

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
        'Multi-Period Occupation Zone':     'Physical earthwork and spectral signals indicate layered use across time',
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
    const hasLidar = f.sources.includes('terrain') || f.sources.includes('terrain_global');
    const hasSlopeWithPhysicalSupport = f.sources.includes('slope') && (
        hasLidar ||
        f.sources.includes('hydrology') ||
        f.sources.includes('satellite_spring') ||
        f.sources.includes('satellite_summer')
    );
    // Hydrology corroborated by LiDAR is strong independent physical evidence —
    // a palaeochannel confirmed in both sources is a valid target signal, but
    // hydrology alone (without LiDAR) is too ambiguous to pass this gate.
    const hasCorroboratedHydrology = f.sources.includes('hydrology') && hasLidar;
    return (
        hasLidar ||
        hasSlopeWithPhysicalSupport ||
        hasCorroboratedHydrology ||
        (f.sources.includes('satellite_summer') && f.sources.includes('satellite_spring')) ||
        f.aimInfo !== undefined
    );
}

function hasLocalPhysicalEvidence(f: Cluster): boolean {
    const hasLidar = f.sources.includes('terrain') || f.sources.includes('terrain_global');
    const hasSlopeWithLocalSupport = f.sources.includes('slope') && (
        hasLidar ||
        (f.sources.includes('satellite_spring') && f.sources.includes('satellite_summer')) ||
        f.multiScale === true
    );
    return (
        hasLidar ||
        hasSlopeWithLocalSupport ||
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

export default function FieldGuide({ projectId, onSignificantFind }: { projectId: string; onSignificantFind?: (initialContext?: Partial<WorkflowState>) => void }) {
    // Engine state
    const [engineState, dispatch] = useReducer(engineReducer, initialEngineState);
    const {
        analyzing, hotspotVersion, terrainClusters, scanPhase,
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
    const [historicScanCompleted,  setHistoricScanCompleted]  = useState(false);
    const [historicLayerToggles,   setHistoricLayerToggles]   = useState({ lidar: false, os1930: false, os1880: false });
    const [historicLayerOpacity,   setHistoricLayerOpacity]   = useState<RasterOverlayOpacity>(readRasterOverlayOpacity);
    const [activeOpacityLayer,     setActiveOpacityLayer]     = useState<RasterOverlayKey | null>(null);
    const [historicLayerVisibility, setHistoricLayerVisibility] = useState({ routes: true, corridors: true, crossings: true, monuments: true, aim: true, context: true, userFinds: false });
    const [showFields,             setShowFields]             = useState<false | 'all' | string>(false);
    const [showFieldsPicker,       setShowFieldsPicker]       = useState(false);
    const [showLayerPicker,        setShowLayerPicker]        = useState(false);
    const [helperActive,           setHelperActive]           = useState(false);
    const [helperTipIndex,         setHelperTipIndex]         = useState(0);
    const [fieldPickerStep,        setFieldPickerStep]        = useState<'top' | string>('top'); // string = permId drilling into its fields
    const [mapClickLabel,          setMapClickLabel]          = useState<string | null>(null);
    const [expandedInterpretationId, setExpandedInterpretationId] = useState<string | null>(null);
    const [expandedTargetId,         setExpandedTargetId]         = useState<string | null>(null);
    const [sheetExpanded,          setSheetExpanded]          = useState(() => { try { return localStorage.getItem('fs_fg_sheet') === '1'; } catch { return false; } });
    const [devMode,                setDevMode]                = useState(() => { try { return localStorage.getItem('fs_fg_devmode') === '1'; } catch { return false; } });
    const [annotationMode,         setAnnotationMode]         = useState(false);
    const [devAnnotations,         setDevAnnotations]         = useState<DevAnnotation[]>([]);
    const [pendingAnnotation,      setPendingAnnotation]      = useState<{ lat: number; lon: number } | null>(null);
    const [annotationForm,         setAnnotationForm]         = useState<{
        annotationType: AnnotationType; broadPeriod: BroadPeriod;
        landscapeType: LandscapeType; confidence: AnnotationConfidence; reviewerNote: string;
    }>({ annotationType: 'missed_hotspot', broadPeriod: 'Unknown', landscapeType: 'unknown', confidence: 'low', reviewerNote: '' });
    const [focusMode,              setFocusMode]              = useState(false);
    const [mobileSheetMode,        setMobileSheetMode]        = useState<'hotspots' | 'targets'>('hotspots');
    const [selectedTraceId,        setSelectedTraceId]        = useState<string | null>(null);
    const [showSavedPoints,        setShowSavedPoints]        = useState(false);
    const [savingPoint,            setSavingPoint]            = useState(false);
    const [savedPointLabel,        setSavedPointLabel]        = useState('');
    const [pendingDeleteId,        setPendingDeleteId]        = useState<string | null>(null);
    const traceCardRefs = useRef<Map<string, HTMLDivElement>>(new Map());
    const sheetDragStartY = useRef<number | null>(null);
    const [sourceAvailability,     setSourceAvailability]     = useState<Record<string, boolean> | null>(null);
    const [scanFromCache,          setScanFromCache]          = useState(false);
    const [scanNoSignal,           setScanNoSignal]           = useState(false);
    // PAS / intel state
    const [pasFinds,        setPasFinds]        = useState<HistoricFind[]>([]);
    const [selectedPASFind, setSelectedPASFind] = useState<HistoricFind | null>(null);
    const [selectedUserFind, setSelectedUserFind] = useState<Find | null>(null);
    const [placeSignals,    setPlaceSignals]    = useState<PlaceSignal[]>([]);

    // Terrain scan centre — for drift guard in historic phase
    const savedPointJustClickedRef = useRef(false);
    const terrainScanCenterRef = useRef<{ lat: number; lng: number } | null>(null);
    const terrainScanBoundsRef = useRef<{ west: number; south: number; east: number; north: number } | null>(null);

    // Lab export: NHLE/AIM responses, modern ways, and raw clusters stored after scan
    const nhleDataRef      = useRef<{ features: any[] } | null>(null);
    const aimDataRef       = useRef<{ features: any[] } | null>(null);
    const modernWaysRef    = useRef<import('./fieldGuideTypes').ModernWay[]>([]);
    const [rawClusters,    setRawClusters]    = useState<Cluster[]>([]);

    // Geology context (Phase 1: display only, no scoring changes)
    const [geologyContext,        setGeologyContext]        = useState<GeologyContext | null>(null);
    const [geologyContextLoading, setGeologyContextLoading] = useState(false);
    const geologyEnabledRef = useRef<boolean | null>(null);
    const geologyRequestSeqRef = useRef(0);
    const geologyAppliedRef = useRef<string | null>(null); // tileKey of last applied geology

    // User location marker (shown after GPS button press, persists for session)
    const userLocationMarkerRef = useRef<maplibregl.Marker | null>(null);
    const [userGpsPos, setUserGpsPos] = useState<[number, number] | null>(null);

    // Scoring hook
    const { potentialScore, scanConfidence, setPotentialScore, setScanConfidence, calculatePotentialScore } = usePotentialScore();

    const permissions = useLiveQuery(() => db.permissions.where('projectId').equals(projectId).toArray()) || [];
    const realPermissions = permissions.filter(p => !p.isDefault);
    const fields      = useLiveQuery(() => db.fields.where('projectId').equals(projectId).toArray()) || [];

    // ─── Find context for hotspot annotation ─────────────────────────────────
    const projectFinds = useLiveQuery(
        () => db.finds.where('projectId').equals(projectId).toArray(),
        [projectId]
    ) ?? [];

    const savedPoints = useLiveQuery(
        () => db.savedPoints.where('projectId').equals(projectId ?? '').sortBy('createdAt'),
        [projectId]
    ) ?? [] as SavedPoint[];

    // ─── Significant find auto-trigger ───────────────────────────────────────
    const liveActiveSession = useLiveQuery(
        () => db.sessions.where('projectId').equals(projectId).filter(s => !s.isFinished).sortBy('updatedAt').then(arr => arr[arr.length - 1]),
        [projectId]
    );
    const [sfBannerDismissed, setSfBannerDismissed] = useState(false);

    const showConcentrationBanner = useMemo(() => {
        if (!onSignificantFind || sfBannerDismissed || !liveActiveSession) return false;
        // Only check finds from the current session
        const sessionFinds = projectFinds.filter(f =>
            f.sessionId === liveActiveSession.id &&
            f.lat != null && f.lon != null
        );
        if (sessionFinds.length < 6) return false;
        // Check average pairwise distance (simple centroid approach)
        const lats = sessionFinds.map(f => f.lat!);
        const lons = sessionFinds.map(f => f.lon!);
        const cLat = lats.reduce((a, b) => a + b, 0) / lats.length;
        const cLon = lons.reduce((a, b) => a + b, 0) / lons.length;
        const avgDist = sessionFinds.reduce((sum, f) => {
            const dlat = (f.lat! - cLat) * 111320;
            const dlon = (f.lon! - cLon) * 111320 * Math.cos(cLat * Math.PI / 180);
            return sum + Math.sqrt(dlat * dlat + dlon * dlon);
        }, 0) / sessionFinds.length;
        return avgDist <= 40;
    }, [projectFinds, liveActiveSession, sfBannerDismissed, onSignificantFind]);

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

    const clearMapItemSelections = useCallback((keep?: 'target' | 'hotspot' | 'userFind' | 'pasFind' | 'monument' | 'trace') => {
        if (keep !== 'target') setSelectedId(null);
        if (keep !== 'hotspot') setSelectedHotspotId(null);
        if (keep !== 'userFind') setSelectedUserFind(null);
        if (keep !== 'pasFind') setSelectedPASFind(null);
        if (keep !== 'monument') setSelectedMonument(undefined);
        if (keep !== 'trace') setSelectedTraceId(null);
    }, []);

    const handleRasterOverlayPress = useCallback((key: RasterOverlayKey) => {
        const enabled = historicLayerToggles[key];
        const otherOldMapKey: RasterOverlayKey | null = key === 'os1880' ? 'os1930' : key === 'os1930' ? 'os1880' : null;
        if (enabled) {
            setHistoricLayerToggles(prev => ({ ...prev, [key]: false }));
            if (activeOpacityLayer === key) setActiveOpacityLayer(null);
            setShowLayerPicker(false);
            return;
        }
        setHistoricLayerToggles(prev => ({
            ...prev,
            [key]: true,
            ...(otherOldMapKey ? { [otherOldMapKey]: false } : {}),
        }));
        setHistoricLayerOpacity(prev => ({ ...prev, [key]: 1 }));
        setActiveOpacityLayer(key);
        setShowLayerPicker(false);
    }, [activeOpacityLayer, historicLayerToggles]);

    const updateRasterOverlayOpacity = useCallback((key: RasterOverlayKey, value: number) => {
        setHistoricLayerOpacity(prev => ({ ...prev, [key]: clampOpacity(value, prev[key]) }));
    }, []);

    const persistSheetExpanded = useCallback((expanded: boolean) => {
        setSheetExpanded(expanded);
        try { localStorage.setItem('fs_fg_sheet', expanded ? '1' : '0'); } catch {}
    }, []);

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
    // Monument interiors always show regardless of evidence; buffer-only hits
    // still pass the normal target and route-noise gates.
    // Capped at 12 per scan to keep the list actionable.
    const displayTargets = useMemo(() => {
        // Annotate suppression reasons before filtering so the Engine Lab can see
        // exactly why each cluster was rejected at the gate level.
        for (const f of detectedFeatures) {
            if (f.isProtected && !f.monumentBufferM) continue;
            if (!hasTargetEvidence(f)) {
                if (!f.suppressedBy) f.suppressedBy = [];
                if (!f.suppressedBy.includes('failed_evidence_gate')) f.suppressedBy.push('failed_evidence_gate');
            }
            if (!hasLocalPhysicalEvidence(f)) {
                if (!f.suppressedBy) f.suppressedBy = [];
                if (!f.suppressedBy.includes('failed_physical_gate')) f.suppressedBy.push('failed_physical_gate');
            }
        }
        return detectedFeatures
            .filter(f => (f.isProtected && !f.monumentBufferM) || (
                hasTargetEvidence(f) &&
                hasLocalPhysicalEvidence(f) &&
                !f.isRouteArtefactRisk
            ))
            .sort((a, b) => b.findPotential - a.findPotential)
            .slice(0, 12);
    }, [detectedFeatures]);

    // ─── Trace Signals ────────────────────────────────────────────────────────
    // Secondary exploratory tier — never feeds back into hotspots or displayTargets.
    const traceTargets = useMemo<TraceTarget[]>(() => {
        if (!detectedFeatures.length) return [];
        return computeTraceTargets(detectedFeatures, displayTargets, rawClusters, devMode, modernWaysRef.current);
    }, [detectedFeatures, displayTargets, rawClusters, devMode]);

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

    const [searchParams, setSearchParams] = useSearchParams();
    const initLat = parseFloat(searchParams.get('lat') ?? '');
    const initLng = parseFloat(searchParams.get('lng') ?? '');

    // Clear lat/lng from the URL after the map uses them
    useEffect(() => {
        if (!isNaN(initLat) && !isNaN(initLng)) setSearchParams({}, { replace: true });
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // Load geology enabled setting and run initial DB maintenance
    useEffect(() => {
        getSetting('fs_geology_enabled', true).then(v => {
            geologyEnabledRef.current = v !== false;
        }).catch(() => {
            geologyEnabledRef.current = false;
        });
        sweepStaleGeologyCache();
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // ─── Logging ─────────────────────────────────────────────────────────────

    const addLog = useCallback((msg: string, source?: LogSource, level?: LogLevel) => {
        setSystemLog(prev => [...prev, makeLog(msg, source, level)]);
    }, []);

    const logContainerRef  = useRef<HTMLDivElement>(null);
    const sheetScrollRef   = useRef<HTMLDivElement>(null);

    useLayoutEffect(() => {
        if (logContainerRef.current) logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }, [systemLog]);

    useEffect(() => {
        try { localStorage.setItem(RASTER_OVERLAY_STORAGE_KEY, JSON.stringify(historicLayerOpacity)); } catch {}
    }, [historicLayerOpacity]);

    useEffect(() => {
        if (activeOpacityLayer && !historicLayerToggles[activeOpacityLayer]) setActiveOpacityLayer(null);
    }, [activeOpacityLayer, historicLayerToggles]);

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
        hotspots, selectedHotspotId, detectedFeatures: displayTargets, traceTargets, selectedTraceId, primaryTargetId, pasFinds, historicRoutes,
        fieldBoundaries: [
            ...fields.filter(f => f.boundary).map(f => ({ id: f.id, name: f.name, permissionId: f.permissionId, boundary: f.boundary })),
            // Fall back to the permission's own boundary when no fields have been drawn
            ...permissions.filter(p => p.boundary && !fields.some(f => f.permissionId === p.id)).map(p => ({ id: p.id, name: p.name, permissionId: p.id, boundary: p.boundary! })),
        ],
        isSatellite, historicMode, showFields, historicLayerVisibility, historicLayerToggles, historicLayerOpacity,
        userFinds: projectFinds,
        savedPoints, showSavedPoints,
        initLat, initLng,
        devMode, annotationMode, devAnnotations,
        callbacks: {
            onFeatureClick:  (id)  => {
                clearMapItemSelections('target');
                setMobileSheetMode('targets');
                setSelectedId(id);
                persistSheetExpanded(true);
            },
            onHotspotClick:  (id)  => {
                clearMapItemSelections('hotspot');
                setMobileSheetMode('hotspots');
                setShowSuggestion(false);
                setSelectedHotspotId(id);
                persistSheetExpanded(true);
                const h = hotspots.find(h => h.id === id);
                if (h) mapRef.current?.fitBounds(h.bounds as maplibregl.LngLatBoundsLike, { padding: 40 });
            },
            onTraceTargetClick: (id) => {
                clearMapItemSelections('trace');
                setMobileSheetMode('targets');
                setSelectedTraceId(id);
                persistSheetExpanded(true);
                // Scroll card into view after state settles
                requestAnimationFrame(() => {
                    traceCardRefs.current.get(id)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                });
            },
            onDeselect:      ()    => { if (savedPointJustClickedRef.current) return; setShowSuggestion(false); clearMapItemSelections(); setShowFieldsPicker(false); setFieldPickerStep('top'); persistSheetExpanded(false); },
            onDragStart:     ()    => { setShowSuggestion(false); setShowFieldsPicker(false); setFieldPickerStep('top'); persistSheetExpanded(false); },
            onZoomChange:    (z)   => setZoomWarning(z > SCAN_CONFIG.ZOOM_WARNING),
            onSetClickLabel: (l)   => setMapClickLabel(l),
            onPASFindLog:    (msg) => addLog(msg, 'historic'),
            onPASFindSelect: (f)   => { clearMapItemSelections('pasFind'); setSelectedPASFind(f); persistSheetExpanded(true); },
            onCrossingsLog:  (msg) => addLog(msg, 'historic'),
            onMonumentClick: (name) => { clearMapItemSelections('monument'); setSelectedMonument(name === null ? undefined : (name || null)); if (name !== null) persistSheetExpanded(true); },
            onUserFindClick:    (id)       => { clearMapItemSelections('userFind'); setSelectedUserFind(projectFinds.find(f => f.id === id) ?? null); persistSheetExpanded(true); },
            onSavedPointClick:  ()         => { savedPointJustClickedRef.current = true; setTimeout(() => { savedPointJustClickedRef.current = false; }, 150); setShowSavedPoints(true); persistSheetExpanded(true); },
            onAnnotationDrop:   (lat, lon) => {
                setPendingAnnotation({ lat, lon });
                setAnnotationForm({ annotationType: 'missed_hotspot', broadPeriod: 'Unknown', landscapeType: 'unknown', confidence: 'low', reviewerNote: '' });
            },
        },
    });

    useTilePrewarm(mapRef);

    const buildSuggestedLabel = (): string => {
        if (selectedHotspotId) {
            const h = hotspots.find(h => h.id === selectedHotspotId);
            if (h) return `${HOTSPOT_TITLES[h.classification]} · Hotspot ${h.number}`;
        }
        if (historicMode && historicRoutes.length > 0) {
            const named = historicRoutes.find(r => r.name && r.name.toLowerCase() !== 'null');
            return `Historic · ${named?.name ?? 'Route area'}`;
        }
        if (historicLayerToggles.lidar && hasScanned && sortedHotspots.length > 0) {
            return `LiDAR · ${getPotentialTier(sortedHotspots[0].score)}`;
        }
        if (hasScanned && sortedHotspots.length > 0) {
            return `${getPotentialTier(sortedHotspots[0].score)} area`;
        }
        return 'Saved point';
    };

    const focusTarget = useCallback((f: Cluster) => {
        clearMapItemSelections('target');
        setSelectedId(f.id);
        setMobileSheetMode('targets');
        persistSheetExpanded(true);
        mapRef.current?.flyTo({ center: f.center, zoom: 17 });
    }, [clearMapItemSelections, mapRef, persistSheetExpanded]);

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
        setShowFieldsPicker(false);
        setFieldPickerStep('top');
        setScanStatus('');
        setSystemLog([makeLog('SYSTEM CLEARED. Ready for new scan.')]);
        setPasFinds([]);
        setPlaceSignals([]);
        setPotentialScore(null);
        setScanConfidence(null);
        setHistoricMode(false);
        setHistoricScanCompleted(false);
        setHistoricLayerToggles({ lidar: false, os1930: false, os1880: false });
        setActiveOpacityLayer(null);
        setHistoricLayerVisibility(prev => ({ routes: true, corridors: true, crossings: true, monuments: true, aim: true, context: true, userFinds: prev.userFinds }));
        setMapClickLabel(null);
        setSelectedMonument(undefined);
        setSelectedUserFind(null);
        terrainScanCenterRef.current = null;
        terrainScanBoundsRef.current = null;
        setSourceAvailability(null);
        setScanFromCache(false);
        setScanNoSignal(false);
        setRawClusters([]);
        setSelectedTraceId(null);
        setAnnotationMode(false);
        setDevAnnotations([]);
        setPendingAnnotation(null);
        geologyRequestSeqRef.current++;
        setGeologyContext(null);
        setGeologyContextLoading(false);
        clearMapSources();
    }, [cancelTerrain, cancelHistoric, clearMapSources, setPotentialScore, setScanConfidence]);

    // ─── Map source helpers ───────────────────────────────────────────────────

    const applyNhleToMap = (data: { features: unknown[] }) => {
        const src = mapRef.current?.getSource('monuments') as maplibregl.GeoJSONSource | undefined;
        if (src) src.setData(data as unknown as GeoJSON.FeatureCollection);
        const bufferSrc = mapRef.current?.getSource('monument-buffers') as maplibregl.GeoJSONSource | undefined;
        if (bufferSrc) bufferSrc.setData(buildMonumentBufferGeoJSON(data));
    };

    const applyAimToMap = (data: { features: unknown[] }) => {
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
        setHistoricScanCompleted(true);
        calculatePotentialScore(result.pasFinds, result.monumentPoints, result.placeSignals, result.center.lat, result.center.lng);

        dispatch({ type: 'SET_HERITAGE_COUNT', count: result.heritageCount, monumentPoints: result.monumentPoints, routes: result.routes });

        if (!result.drifted && result.enhancedHotspots.length > 0) {
            setSelectedHotspotId(null);   // dismiss the terrain-phase selection; user chooses from enhanced list
            setShowSuggestion(false);
            dispatch({ type: 'HISTORIC_ENHANCE', hotspots: result.enhancedHotspots });
            // Non-blocking feedback signal — does not affect scan result
            recordFindHotspotSignals(result.enhancedHotspots, projectFinds).catch(() => {});
        }
    }, [runHistoricScan, permissions, fields, targetPeriod, calculatePotentialScore, projectFinds]); // eslint-disable-line react-hooks/exhaustive-deps

    // ─── Geology context phase (non-blocking) ────────────────────────────────

    const runGeologyContextPhase = useCallback(async (center: { lat: number; lng: number }) => {
        if (geologyEnabledRef.current !== true) {
            if (geologyEnabledRef.current === false) {
                addLog('Geology context disabled in settings.', 'system');
            }
            return;
        }
        const requestSeq = ++geologyRequestSeqRef.current;
        setGeologyContextLoading(true);
        setGeologyContext(null);
        try {
            const ctx = await runGeologyContext(
                { lat: center.lat, lon: center.lng },
                {
                    onAudit: (entry) => {
                        if (entry.action === 'timeout') {
                            addLog('BGS geology lookup timed out. Scan unaffected.', 'system', 'warn');
                        } else if (entry.action === 'cors_fail') {
                            addLog('BGS geology unavailable via proxy. Scan unaffected.', 'system', 'warn');
                        }
                    },
                },
            );
            if (geologyRequestSeqRef.current === requestSeq) {
                setGeologyContext(ctx);
            }
        } catch {
            // Non-blocking — geology failure never interrupts the scan
        } finally {
            if (geologyRequestSeqRef.current === requestSeq) {
                setGeologyContextLoading(false);
            }
        }
    }, [addLog]); // eslint-disable-line react-hooks/exhaustive-deps

    // ─── Apply geology modifiers to hotspots (Phase 2) ───────────────────────
    // Fires when geology context becomes available AND historic enhancement is done.
    // Guards against re-application using the tileKey of the last applied context.
    // GEOLOGY_RULE: applyGeologyModifiers enforces the primary-signal gate internally.

    useEffect(() => {
        if (!geologyContext) {
            geologyAppliedRef.current = null;
            return;
        }
        // Wait until historic enhancement is complete — geology is the last stage.
        if (hotspotVersion !== 'enhanced') return;
        // Guard against re-application for the same tile in the same scan session.
        if (geologyAppliedRef.current === geologyContext.tileKey) return;
        if (!hotspots.length) return;

        geologyAppliedRef.current = geologyContext.tileKey;
        const { hotspots: enhanced, appliedCount, netScore } = applyGeologyModifiers(hotspots, geologyContext);
        if (appliedCount > 0) {
            addLog(`Geology modifiers applied (${geologyContext.landscapeClass}, net ${netScore > 0 ? '+' : ''}${netScore}) to ${appliedCount} hotspot${appliedCount !== 1 ? 's' : ''}.`, 'system');
            dispatch({ type: 'GEOLOGY_ENHANCE', hotspots: enhanced });
        }
    }, [geologyContext, hotspots, hotspotVersion]); // eslint-disable-line react-hooks/exhaustive-deps

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
        setHistoricScanCompleted(false);
        addLog('> SCAN: Reading terrain at survey zoom.', 'terrain');

        const result = await runTerrainScan({ mapRef, permissions, fields, targetPeriod });

        if (!result) {
            dispatch({ type: 'SCAN_FAIL' });
            return;
        }

        // Push NHLE and AIM data to map sources
        applyNhleToMap(result.nhleData);
        applyAimToMap(result.aimData);
        nhleDataRef.current   = result.nhleData;
        aimDataRef.current    = result.aimData;
        modernWaysRef.current = result.modernWays ?? [];

        setSourceAvailability(result.sourceAvailability ?? null);
        setScanFromCache(result.fromCache);
        setScanNoSignal(result.noSignal ?? false);
        setRawClusters(result.rawClusters ?? []);

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
        }

        // If there are no hotspots, jump straight to the Targets tab so the list
        // isn't hidden behind an empty Hotspots panel.
        if (result.hotspots.length === 0) {
            setMobileSheetMode('targets');
        }

        const scanCenter = result.scanStartCenter;
        terrainScanCenterRef.current = scanCenter;
        terrainScanBoundsRef.current = result.scanStartBounds;

        // Fire geology context lookup concurrently — non-blocking, updates state when ready
        runGeologyContextPhase(scanCenter);

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
        setHistoricScanCompleted(false);
        // clearScan() (called before entering historicMode) resets geologyContext,
        // so re-trigger geology for the current map centre.
        const center = mapRef.current.getCenter();
        runGeologyContextPhase({ lat: center.lat, lng: center.lng });
        // Standalone: re-fetch NHLE/AIM, reuse any routes already loaded
        await runHistoricPhase({
            terrainClusters,
            monumentPoints,
            routes:     historicRoutes,
            nhleData:   null,
            aimData:    null,
            scanCenter: terrainScanCenterRef.current,
        });
        setIntelDetailsOpen(false);
    }, [isHistoricScanning, terrainClusters, monumentPoints, historicRoutes, runHistoricPhase, runGeologyContextPhase]);

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
        if (searchQuery.trim().toLowerCase() === 'dev mode') {
            const next = !devMode;
            setDevMode(next);
            try { localStorage.setItem('fs_fg_devmode', next ? '1' : '0'); } catch {}
            setSearchQuery('');
            setIsSearchOpen(false);
            return;
        }
        try {
            const res  = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(searchQuery)}`);
            const data = await res.json();
            if (data[0]) { mapRef.current?.flyTo({ center: [parseFloat(data[0].lon), parseFloat(data[0].lat)], zoom: 16 }); setIsSearchOpen(false); }
        } catch { addLog('> Search failed.', 'system', 'warn'); }
    };

    // ─── Dev annotation engine context capture ────────────────────────────────
    const captureEngineContext = useCallback((lat: number, lon: number): EngineContextAtPoint => {
        const clusterDists = detectedFeatures.map(c => getDistance(c.center, [lon, lat]));
        const clustersWithin50m  = clusterDists.filter(d => d <=  50).length;
        const clustersWithin100m = clusterDists.filter(d => d <= 100).length;
        const clustersWithin250m = clusterDists.filter(d => d <= 250).length;

        let nearestHotspotId: string | null = null;
        let nearestHotspotDist: number | null = null;
        for (const h of sortedHotspots) {
            const d = getDistance([lon, lat], h.center);
            if (nearestHotspotDist === null || d < nearestHotspotDist) {
                nearestHotspotId = h.id;
                nearestHotspotDist = Math.round(d);
            }
        }

        let nearestTargetId: string | null = null;
        let nearestTargetDist: number | null = null;
        for (const t of displayTargets) {
            const d = getDistance([lon, lat], t.center);
            if (nearestTargetDist === null || d < nearestTargetDist) {
                nearestTargetId = t.id;
                nearestTargetDist = Math.round(d);
            }
        }

        const suppressionReasons: string[] = [];
        detectedFeatures.forEach((c, i) => {
            if (clusterDists[i] > 250) return;
            if (c.isRouteArtefactRisk && c.routeArtefactReason) suppressionReasons.push(c.routeArtefactReason);
            if (c.disturbanceReason) suppressionReasons.push(c.disturbanceReason);
        });

        return {
            clustersWithin50m,
            clustersWithin100m,
            clustersWithin250m,
            nearestHotspotId,
            nearestHotspotDist,
            nearestTargetId,
            nearestTargetDist,
            sourceAvailability: sourceAvailability ?? null,
            hadSuppressionNearby: suppressionReasons.length > 0,
            suppressionReasons: [...new Set(suppressionReasons)],
            belowHotspotThreshold: clustersWithin250m > 0 && sortedHotspots.length === 0,
        };
    }, [detectedFeatures, sortedHotspots, displayTargets, sourceAvailability]);

    const handleAnnotationConfirm = useCallback(() => {
        if (!pendingAnnotation) return;
        const annotation: DevAnnotation = {
            id: `ann-${Date.now()}`,
            lat: pendingAnnotation.lat,
            lon: pendingAnnotation.lon,
            timestamp: Date.now(),
            engineVersion: 'FG-2026.05.20b',
            ...annotationForm,
            engineContext: captureEngineContext(pendingAnnotation.lat, pendingAnnotation.lon),
        };
        setDevAnnotations(prev => [...prev, annotation]);
        setPendingAnnotation(null);
    }, [pendingAnnotation, annotationForm, captureEngineContext]);

    // ─── Engine Lab export ────────────────────────────────────────────────────
    const handleLabExport = useCallback(async () => {
        const map = mapRef.current;
        if (!map) return;

        const zoom     = SCAN_CONFIG.TERRAIN_ZOOM;
        const center   = map.getCenter();
        const bounds   = map.getBounds();
        const n        = Math.pow(2, zoom);
        const cX       = (center.lng + 180) / 360 * n;
        const cY       = (1 - Math.log(Math.tan(center.lat * Math.PI / 180) + 1 / Math.cos(center.lat * Math.PI / 180)) / Math.PI) / 2 * n;
        const tileKey  = `${zoom}-${Math.floor(cX) - 1}-${Math.floor(cY) - 1}`;

        const cached = await db.fieldGuideCache.get(tileKey);

        const payload = {
            exportVersion:    '1',
            engineVersion:    'FG-2026.05.20b',
            exportedAt:       Date.now(),
            scanId:           tileKey,
            center:           { lat: center.lat, lng: center.lng },
            bounds:           { west: bounds.getWest(), south: bounds.getSouth(), east: bounds.getEast(), north: bounds.getNorth() },
            scanStartCenter:   terrainScanCenterRef.current,
            scanStartBounds:   terrainScanBoundsRef.current,
            sourceAvailability,
            rawClusters:      cached?.rawClusters ?? [],
            nhleData:         nhleDataRef.current    ?? { features: [] },
            aimData:          aimDataRef.current     ?? { features: [] },
            modernWays:       modernWaysRef.current  ?? [],
            routes:           historicRoutes,
            pasFinds,
            placeSignals,
            monumentPoints,
            referenceTargets: displayTargets,
            traceTargets,
            devAnnotations,
        };

        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        const url  = URL.createObjectURL(blob);
        const a    = Object.assign(document.createElement('a'), {
            href: url, download: `fieldguide-lab-${tileKey}-${Date.now()}.json`,
        });
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 1000);
    }, [sourceAvailability, historicRoutes, pasFinds, placeSignals, monumentPoints, displayTargets, traceTargets, devAnnotations]);

    // ─── Derived convenience aliases ──────────────────────────────────────────

    // loadingPAS used in JSX — maps to historic scan in-progress flag
    const loadingPAS = isHistoricScanning;
    const terrainScanComplete = hasScanned && !analyzing && !isTerrainScanning;
    const historicScanComplete = historicMode && historicScanCompleted && !loadingPAS;
    const selectedTarget = selectedId ? detectedFeatures.find(f => f.id === selectedId) ?? null : null;
    const activeOverlayOpacityLayer = activeOpacityLayer && historicLayerToggles[activeOpacityLayer] ? activeOpacityLayer : null;
    const rasterOverlayButtonClass = (key: RasterOverlayKey, selectedClass: string) => {
        const enabled = historicLayerToggles[key];
        const selected = activeOverlayOpacityLayer === key;
        if (selected) return `w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[10px] font-bold transition-all mb-0.5 border ${selectedClass}`;
        if (enabled) return 'w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[10px] font-bold transition-all mb-0.5 bg-white/[0.08] border border-white/15 text-white/85';
        return 'w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[10px] font-bold transition-all mb-0.5 text-white/50 hover:text-white hover:bg-white/5 border border-transparent';
    };

    const helperTips: CoachTip[] = [
        {
            title: 'Map layers',
            body: 'Tap the layers button to toggle satellite, LiDAR, old OS maps and your finds.',
            accent: 'text-emerald-300',
            border: 'border-emerald-400/35',
            button: 'Show layers',
            action: () => setShowLayerPicker(true),
            position: 'top-[72px] right-4 left-4 sm:left-auto sm:right-[68px] sm:max-w-[240px]',
        },
        {
            title: 'Scan panel',
            body: 'Use Terrain or Historic to scan. Tap the panel handle to expand results and switch between Hotspots and Targets.',
            accent: 'text-blue-300',
            border: 'border-blue-400/35',
            button: 'Expand panel',
            action: () => persistSheetExpanded(true),
            position: 'bottom-[152px] left-4 right-4 sm:left-6 sm:right-auto sm:max-w-[280px]',
        },
        {
            title: 'Targets and hotspots',
            body: 'After a scan, tap target pins or hotspot areas on the map to open their detail cards.',
            accent: 'text-amber-300',
            border: 'border-amber-400/35',
            button: 'Got it',
            position: 'top-[34%] left-4 right-4 sm:left-6 sm:right-auto sm:max-w-[280px]',
        },
    ];

    // ─── Context value ────────────────────────────────────────────────────────

    const contextValue = {
        projectId, onSignificantFind,
        mapRef, mapContainerRef,
        logContainerRef, sheetScrollRef, sheetDragStartY, traceCardRefs,
        savedPointJustClickedRef, terrainScanCenterRef, terrainScanBoundsRef,
        nhleDataRef, aimDataRef, modernWaysRef, userLocationMarkerRef,
        analyzing, scanPhase, hotspotVersion, terrainClusters, detectedFeatures,
        hotspots, hasScanned, heritageCount, monumentPoints, historicRoutes,
        sortedHotspots, displayTargets, traceTargets, primaryTargetId,
        sourceUsability, hotspotFindContext, targetFindContext, showConcentrationBanner,
        selectedId, setSelectedId, selectedHotspotId, setSelectedHotspotId,
        showSuggestion, setShowSuggestion, scanStatus, systemLog, zoomWarning,
        isSatellite, setIsSatellite, scanCount, searchQuery, setSearchQuery,
        isSearchOpen, setIsSearchOpen, isIntelOpen, setIsIntelOpen,
        intelDetailsOpen, setIntelDetailsOpen, intelLayersOpen, setIntelLayersOpen,
        targetPeriod, isLocating, selectedMonument, setSelectedMonument,
        historicMode, setHistoricMode, historicScanCompleted, setHistoricScanCompleted,
        historicLayerToggles, setHistoricLayerToggles, historicLayerOpacity,
        activeOpacityLayer, setActiveOpacityLayer, historicLayerVisibility, setHistoricLayerVisibility,
        showFields, setShowFields, showFieldsPicker, setShowFieldsPicker,
        showLayerPicker, setShowLayerPicker, helperActive, setHelperActive,
        helperTipIndex, setHelperTipIndex, fieldPickerStep, setFieldPickerStep,
        mapClickLabel, expandedInterpretationId, setExpandedInterpretationId,
        expandedTargetId, setExpandedTargetId, sheetExpanded,
        devMode, setDevMode, annotationMode, setAnnotationMode,
        devAnnotations, setDevAnnotations, pendingAnnotation, setPendingAnnotation,
        annotationForm, setAnnotationForm, focusMode, setFocusMode,
        mobileSheetMode, setMobileSheetMode, selectedTraceId, setSelectedTraceId,
        showSavedPoints, setShowSavedPoints, savingPoint, setSavingPoint,
        savedPointLabel, setSavedPointLabel, pendingDeleteId, setPendingDeleteId,
        sourceAvailability, scanFromCache, scanNoSignal,
        pasFinds, selectedPASFind, setSelectedPASFind, selectedUserFind, setSelectedUserFind, placeSignals,
        permissions, realPermissions, fields, projectFinds, savedPoints,
        potentialScore, scanConfidence, selectedUserFindMedia,
        sfBannerDismissed, setSfBannerDismissed,
        isTerrainScanning, isHistoricScanning, loadingPAS,
        terrainScanComplete, historicScanComplete, selectedTarget,
        activeOverlayOpacityLayer, rasterOverlayButtonClass,
        handleRasterOverlayPress, updateRasterOverlayOpacity,
        helperTips,
        persistSheetExpanded, handleSheetTouchStart, handleSheetTouchEnd,
        clearMapItemSelections, focusTarget, clearScan, executeScan,
        findMe, searchLocation, loadStandaloneHistoric,
        handleLabExport, handleAnnotationConfirm, buildSuggestedLabel,
        rawClusters, userGpsPos, setUserGpsPos,
        geologyContext, geologyContextLoading,
    };

    // ─── Render ───────────────────────────────────────────────────────────────

    return (
        <FieldGuideContext.Provider value={contextValue}>
        <div className={focusMode ? 'fixed inset-0 z-[200] flex flex-col bg-slate-950 overflow-hidden' : 'flex flex-col h-[calc(100vh-140px)] landscape:h-[calc(100vh-100px)] sm:h-[calc(100vh-220px)] bg-slate-950 rounded-3xl overflow-hidden border border-slate-800 shadow-2xl relative'}>
            <header className={`bg-slate-900/80 border-b border-white/5 shrink-0 z-50 backdrop-blur-md${focusMode ? ' hidden' : ''}`}>
                {/* Bottom Row: Primary FieldGuide Actions */}
                <div className="hidden justify-between items-center gap-3 px-3 sm:px-4 py-2 bg-black/20 relative">
                    <div className="flex gap-2 items-center min-w-0 relative">
                        <button
                            onClick={() => {
                                if (analyzing) return;
                                if (!historicMode) { clearScan(); setHistoricMode(true); }
                                else { setIsIntelOpen(false); setIntelDetailsOpen(false); setIntelLayersOpen(false); setHistoricMode(false); setHistoricLayerToggles({ lidar: false, os1930: false, os1880: false }); setActiveOpacityLayer(null); }
                            }}
                            disabled={analyzing}
                            className={`px-3 sm:px-4 py-2 rounded-lg text-[10px] font-black tracking-widest uppercase border transition-all shadow-lg whitespace-nowrap ${analyzing ? 'bg-slate-700 text-slate-400 border-slate-600 opacity-60 cursor-not-allowed' : historicMode ? 'bg-blue-500/20 text-blue-200 border-blue-400/40' : 'bg-blue-500 text-white border-blue-300/50 shadow-[0_0_15px_rgba(59,130,246,0.3)] hover:bg-blue-400'} ${loadingPAS && historicMode ? 'animate-pulse opacity-80' : ''}`}
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
                <FieldGuideMap />
                <ScanLogDrawer />
            </div>

            {/* Dev Annotation Modal — shown when a pin has been dropped in annotation mode */}
            {devMode && pendingAnnotation && (
                <div className="absolute bottom-6 left-6 z-[300] w-72 bg-slate-900 border border-orange-500/40 rounded-2xl shadow-2xl shadow-orange-900/20 overflow-hidden animate-in slide-in-from-bottom-4 fade-in duration-200">
                    <div className="px-4 py-3 border-b border-orange-500/15 bg-orange-500/5 flex items-center gap-2">
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#f97316" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/></svg>
                        <span className="text-[9px] font-black text-orange-400 uppercase tracking-[0.2em]">Dev Annotation</span>
                        <span className="ml-auto text-[7px] font-mono text-white/25">{pendingAnnotation.lat.toFixed(4)}, {pendingAnnotation.lon.toFixed(4)}</span>
                    </div>
                    <div className="px-4 py-3 space-y-2.5">
                        {/* Annotation type */}
                        <div>
                            <p className="text-[7px] font-black text-white/30 uppercase tracking-widest mb-1">Type</p>
                            <select
                                value={annotationForm.annotationType}
                                onChange={e => setAnnotationForm(f => ({ ...f, annotationType: e.target.value as AnnotationType }))}
                                className="w-full bg-slate-800 border border-white/10 rounded-lg px-2.5 py-1.5 text-[9px] text-white/80 font-mono focus:outline-none focus:border-orange-500/50"
                            >
                                {(Object.entries(ANNOTATION_TYPE_LABELS) as [AnnotationType, string][]).map(([v, l]) => (
                                    <option key={v} value={v}>{l}</option>
                                ))}
                            </select>
                        </div>
                        {/* Row: period + landscape */}
                        <div className="grid grid-cols-2 gap-2">
                            <div>
                                <p className="text-[7px] font-black text-white/30 uppercase tracking-widest mb-1">Period</p>
                                <select
                                    value={annotationForm.broadPeriod}
                                    onChange={e => setAnnotationForm(f => ({ ...f, broadPeriod: e.target.value as BroadPeriod }))}
                                    className="w-full bg-slate-800 border border-white/10 rounded-lg px-2 py-1.5 text-[9px] text-white/80 font-mono focus:outline-none focus:border-orange-500/50"
                                >
                                    {(['Prehistoric','Roman','Early Medieval','Medieval','Post-Medieval','Multi-period','Unknown'] as BroadPeriod[]).map(v => (
                                        <option key={v} value={v}>{v}</option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <p className="text-[7px] font-black text-white/30 uppercase tracking-widest mb-1">Confidence</p>
                                <select
                                    value={annotationForm.confidence}
                                    onChange={e => setAnnotationForm(f => ({ ...f, confidence: e.target.value as AnnotationConfidence }))}
                                    className="w-full bg-slate-800 border border-white/10 rounded-lg px-2 py-1.5 text-[9px] text-white/80 font-mono focus:outline-none focus:border-orange-500/50"
                                >
                                    {(['low','medium','high'] as AnnotationConfidence[]).map(v => (
                                        <option key={v} value={v}>{v}</option>
                                    ))}
                                </select>
                            </div>
                        </div>
                        {/* Landscape type */}
                        <div>
                            <p className="text-[7px] font-black text-white/30 uppercase tracking-widest mb-1">Landscape</p>
                            <select
                                value={annotationForm.landscapeType}
                                onChange={e => setAnnotationForm(f => ({ ...f, landscapeType: e.target.value as LandscapeType }))}
                                className="w-full bg-slate-800 border border-white/10 rounded-lg px-2.5 py-1.5 text-[9px] text-white/80 font-mono focus:outline-none focus:border-orange-500/50"
                            >
                                {(Object.entries(LANDSCAPE_TYPE_LABELS) as [LandscapeType, string][]).map(([v, l]) => (
                                    <option key={v} value={v}>{l}</option>
                                ))}
                            </select>
                        </div>
                        {/* Note */}
                        <div>
                            <p className="text-[7px] font-black text-white/30 uppercase tracking-widest mb-1">Note (optional)</p>
                            <input
                                type="text"
                                value={annotationForm.reviewerNote}
                                onChange={e => setAnnotationForm(f => ({ ...f, reviewerNote: e.target.value }))}
                                placeholder="e.g. Roman activity likely, no hotspot"
                                className="w-full bg-slate-800 border border-white/10 rounded-lg px-2.5 py-1.5 text-[9px] text-white/80 font-mono placeholder:text-white/20 focus:outline-none focus:border-orange-500/50"
                            />
                        </div>
                        {/* Actions */}
                        <div className="flex gap-2 pt-0.5">
                            <button
                                onClick={() => setPendingAnnotation(null)}
                                className="flex-1 px-3 py-2 rounded-lg border border-white/10 text-white/40 text-[9px] font-black uppercase tracking-widest hover:bg-white/5 transition-colors active:scale-[0.98]"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleAnnotationConfirm}
                                className="flex-1 px-3 py-2 rounded-lg border border-orange-500/40 bg-orange-500/15 text-orange-300 text-[9px] font-black uppercase tracking-widest hover:bg-orange-500/25 transition-colors active:scale-[0.98]"
                            >
                                Save Pin
                            </button>
                        </div>
                    </div>
                </div>
            )}

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
                <div className="hidden">
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
                <div className="hidden">
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
        </FieldGuideContext.Provider>
    );
}
