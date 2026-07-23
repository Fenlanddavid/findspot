import { useReducer, useRef, useState } from 'react';
import type maplibregl from 'maplibre-gl';
import type { Find } from '../db';
import type {
    AIMResponse,
    NHLEResponse,
    SMUnavailableReason,
} from '../services/historicScanService';
import { useDurableSetting } from '../services/clientStorage';
import type { GeologyContext } from '../engines/geologyContext';
import type {
    AnnotationConfidence,
    AnnotationType,
    BroadPeriod,
    DevAnnotation,
    LandscapeType,
} from '../utils/devAnnotation';
import { makeLog, type LogEntry } from '../utils/scanLogger';
import type {
    Cluster,
    HistoricFind,
    HistoricRoute,
    Hotspot,
    ModernWay,
    PlaceSignal,
} from '../pages/fieldGuideTypes';
import type { PASCellLookup } from '../services/pasDensityService';
import { usePotentialScore } from './usePotentialScore';

export type RasterOverlayKey = 'lidar' | 'lidar-wales' | 'os1880' | 'os1930';
export type RasterOverlayOpacity = Record<RasterOverlayKey, number>;

export const DEFAULT_RASTER_OVERLAY_OPACITY: RasterOverlayOpacity = {
    lidar: 1,
    'lidar-wales': 1,
    os1880: 1,
    os1930: 1,
};

export const RASTER_OVERLAY_STORAGE_KEY = 'fs_fg_overlay_opacity';

export type ScanPhase = 'idle' | 'terrain' | 'historic' | 'complete';
export type HotspotVersion = 'terrain' | 'enhanced' | 'geology-enhanced' | null;

export interface EngineState {
    analyzing: boolean;
    scanPhase: ScanPhase;
    hotspotVersion: HotspotVersion;
    terrainClusters: Cluster[];
    detectedFeatures: Cluster[];
    hotspots: Hotspot[];
    hasScanned: boolean;
    heritageCount: number;
    monumentPoints: [number, number][];
    historicRoutes: HistoricRoute[];
}

export type EngineAction =
    | { type: 'SCAN_START' }
    | { type: 'SCAN_SUCCESS'; features: Cluster[]; hotspots: Hotspot[]; monumentPoints: [number, number][]; routes: HistoricRoute[]; heritageCount: number }
    | { type: 'SCAN_FAIL' }
    | { type: 'HISTORIC_ENHANCE'; hotspots: Hotspot[] }
    | { type: 'GEOLOGY_ENHANCE'; hotspots: Hotspot[] }
    | { type: 'SET_HERITAGE_COUNT'; count: number; monumentPoints: [number, number][]; routes?: HistoricRoute[] }
    | { type: 'CLEAR_SCAN' };

const initialEngineState: EngineState = {
    analyzing: false,
    scanPhase: 'idle',
    hotspotVersion: null,
    terrainClusters: [],
    detectedFeatures: [],
    hotspots: [],
    hasScanned: false,
    heritageCount: 0,
    monumentPoints: [],
    historicRoutes: [],
};

function engineReducer(state: EngineState, action: EngineAction): EngineState {
    switch (action.type) {
        case 'SCAN_START':
            return { ...state, analyzing: true, scanPhase: 'terrain', hotspotVersion: null, terrainClusters: [] };
        case 'SCAN_SUCCESS':
            return {
                ...state,
                analyzing: false,
                scanPhase: 'terrain',
                hotspotVersion: 'terrain',
                terrainClusters: action.features,
                detectedFeatures: action.features,
                hotspots: action.hotspots,
                monumentPoints: action.monumentPoints,
                historicRoutes: action.routes,
                heritageCount: action.heritageCount,
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

export function useFieldGuidePageState() {
    const [engineState, dispatch] = useReducer(engineReducer, initialEngineState);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [selectedHotspotId, setSelectedHotspotId] = useState<string | null>(null);
    const [showSuggestion, setShowSuggestion] = useState(false);
    const [scanStatus, setScanStatus] = useState('');
    const [systemLog, setSystemLog] = useState<LogEntry[]>([
        makeLog('READY. Run scan to read landscape signals.'),
    ]);
    const [zoomWarning, setZoomWarning] = useState(false);
    const [isSatellite, setIsSatellite] = useState(false);
    const [scanCount, setScanCount] = useDurableSetting('fs_fg_scan_count', 0);
    const [searchQuery, setSearchQuery] = useState('');
    const [isSearchOpen, setIsSearchOpen] = useState(false);
    const [isIntelOpen, setIsIntelOpen] = useState(false);
    const [intelDetailsOpen, setIntelDetailsOpen] = useState(false);
    const [intelLayersOpen, setIntelLayersOpen] = useState(false);
    const [targetPeriod] = useState<'All' | 'Bronze Age' | 'Roman' | 'Medieval'>('All');
    const [isLocating, setIsLocating] = useState(false);
    const [selectedMonument, setSelectedMonument] = useState<string | null | undefined>(undefined);
    const [historicMode, setHistoricMode] = useState(false);
    const [historicScanCompleted, setHistoricScanCompleted] = useState(false);
    const [historicLayerToggles, setHistoricLayerToggles] = useState({
        lidar: false,
        'lidar-wales': false,
        os1930: false,
        os1880: false,
    });
    const [historicLayerOpacity, setHistoricLayerOpacity] =
        useDurableSetting<RasterOverlayOpacity>(
            RASTER_OVERLAY_STORAGE_KEY,
            DEFAULT_RASTER_OVERLAY_OPACITY,
        );
    const [activeOpacityLayer, setActiveOpacityLayer] = useState<RasterOverlayKey | null>(null);
    const [historicLayerVisibility, setHistoricLayerVisibility] = useState({
        routes: true,
        corridors: true,
        crossings: true,
        monuments: true,
        aim: true,
        context: true,
        pasDensity: false,
        userFinds: false,
    });
    const [showFields, setShowFields] = useState<false | 'all' | string>(false);
    const [showFieldsPicker, setShowFieldsPicker] = useState(false);
    const [showLayerPicker, setShowLayerPicker] = useState(false);
    const [helperActive, setHelperActive] = useState(false);
    const [helperTipIndex, setHelperTipIndex] = useState(0);
    const [fieldPickerStep, setFieldPickerStep] = useState<'top' | string>('top');
    const [mapClickLabel, setMapClickLabel] = useState<string | null>(null);
    const [expandedInterpretationId, setExpandedInterpretationId] = useState<string | null>(null);
    const [expandedTargetId, setExpandedTargetId] = useState<string | null>(null);
    const [sheetExpanded, setSheetExpanded] = useDurableSetting('fs_fg_sheet', false);
    const [devMode, setDevMode] = useDurableSetting('fs_fg_devmode', false);
    const [annotationMode, setAnnotationMode] = useState(false);
    const [devAnnotations, setDevAnnotations] = useState<DevAnnotation[]>([]);
    const [pendingAnnotation, setPendingAnnotation] = useState<{ lat: number; lon: number } | null>(null);
    const [annotationForm, setAnnotationForm] = useState<{
        annotationType: AnnotationType;
        broadPeriod: BroadPeriod;
        landscapeType: LandscapeType;
        confidence: AnnotationConfidence;
        reviewerNote: string;
    }>({
        annotationType: 'missed_hotspot',
        broadPeriod: 'Unknown',
        landscapeType: 'unknown',
        confidence: 'low',
        reviewerNote: '',
    });
    const [focusMode, setFocusMode] = useState(false);
    const [mobileSheetMode, setMobileSheetMode] = useState<'hotspots' | 'targets'>('hotspots');
    const [selectedTraceId, setSelectedTraceId] = useState<string | null>(null);
    const [showSavedPoints, setShowSavedPoints] = useState(false);
    const [savingPoint, setSavingPoint] = useState(false);
    const [savedPointLabel, setSavedPointLabel] = useState('');
    const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
    const [sourceAvailability, setSourceAvailability] = useState<Record<string, boolean> | null>(null);
    const [scanFromCache, setScanFromCache] = useState(false);
    const [scanNoSignal, setScanNoSignal] = useState(false);
    const [scheduledMonumentCheckFailed, setScheduledMonumentCheckFailed] = useState(false);
    const [scheduledMonumentUnavailableReason, setScheduledMonumentUnavailableReason] =
        useState<SMUnavailableReason | null>(null);
    const [pasFinds, setPasFinds] = useState<HistoricFind[]>([]);
    const [selectedPASFind, setSelectedPASFind] = useState<HistoricFind | null>(null);
    const [selectedUserFind, setSelectedUserFind] = useState<Find | null>(null);
    const [placeSignals, setPlaceSignals] = useState<PlaceSignal[]>([]);
    const [rawClusters, setRawClusters] = useState<Cluster[]>([]);
    const [geologyContext, setGeologyContext] = useState<GeologyContext | null>(null);
    const [geologyContextLoading, setGeologyContextLoading] = useState(false);
    const [pasDensityCell, setPasDensityCell] = useState<PASCellLookup | null>(null);
    const [userGpsPos, setUserGpsPos] = useState<[number, number] | null>(null);
    const [sfBannerDismissed, setSfBannerDismissed] = useState(false);

    const traceCardRefs = useRef<Map<string, HTMLDivElement>>(new Map());
    const sheetDragStartY = useRef<number | null>(null);
    const savedPointJustClickedRef = useRef(false);
    const terrainScanCenterRef = useRef<{ lat: number; lng: number } | null>(null);
    const terrainScanBoundsRef = useRef<{ west: number; south: number; east: number; north: number } | null>(null);
    const terrainAnalysisBoundsRef = useRef<{ west: number; south: number; east: number; north: number } | null>(null);
    const terrainHistoricRoutesAvailableRef = useRef(false);
    const questionTerrainAvailabilityRef = useRef<Record<string, boolean>>({});
    const questionScanAutoStartedRef = useRef(false);
    const nhleDataRef = useRef<NHLEResponse | null>(null);
    const aimDataRef = useRef<AIMResponse | null>(null);
    const modernWaysRef = useRef<ModernWay[]>([]);
    const geologyEnabledRef = useRef<boolean | null>(null);
    const geologyRequestSeqRef = useRef(0);
    const geologyAppliedRef = useRef<string | null>(null);
    const userLocationMarkerRef = useRef<maplibregl.Marker | null>(null);
    const logContainerRef = useRef<HTMLDivElement>(null);
    const sheetScrollRef = useRef<HTMLDivElement>(null);
    const scoring = usePotentialScore();

    return {
        engineState, dispatch,
        selectedId, setSelectedId, selectedHotspotId, setSelectedHotspotId,
        showSuggestion, setShowSuggestion, scanStatus, setScanStatus,
        systemLog, setSystemLog, zoomWarning, setZoomWarning,
        isSatellite, setIsSatellite, scanCount, setScanCount,
        searchQuery, setSearchQuery, isSearchOpen, setIsSearchOpen,
        isIntelOpen, setIsIntelOpen, intelDetailsOpen, setIntelDetailsOpen,
        intelLayersOpen, setIntelLayersOpen, targetPeriod, isLocating, setIsLocating,
        selectedMonument, setSelectedMonument, historicMode, setHistoricMode,
        historicScanCompleted, setHistoricScanCompleted,
        historicLayerToggles, setHistoricLayerToggles,
        historicLayerOpacity, setHistoricLayerOpacity,
        activeOpacityLayer, setActiveOpacityLayer,
        historicLayerVisibility, setHistoricLayerVisibility,
        showFields, setShowFields, showFieldsPicker, setShowFieldsPicker,
        showLayerPicker, setShowLayerPicker, helperActive, setHelperActive,
        helperTipIndex, setHelperTipIndex, fieldPickerStep, setFieldPickerStep,
        mapClickLabel, setMapClickLabel,
        expandedInterpretationId, setExpandedInterpretationId,
        expandedTargetId, setExpandedTargetId, sheetExpanded, setSheetExpanded,
        devMode, setDevMode, annotationMode, setAnnotationMode,
        devAnnotations, setDevAnnotations, pendingAnnotation, setPendingAnnotation,
        annotationForm, setAnnotationForm, focusMode, setFocusMode,
        mobileSheetMode, setMobileSheetMode, selectedTraceId, setSelectedTraceId,
        showSavedPoints, setShowSavedPoints, savingPoint, setSavingPoint,
        savedPointLabel, setSavedPointLabel, pendingDeleteId, setPendingDeleteId,
        sourceAvailability, setSourceAvailability, scanFromCache, setScanFromCache,
        scanNoSignal, setScanNoSignal,
        scheduledMonumentCheckFailed, setScheduledMonumentCheckFailed,
        scheduledMonumentUnavailableReason, setScheduledMonumentUnavailableReason,
        pasFinds, setPasFinds, selectedPASFind, setSelectedPASFind,
        selectedUserFind, setSelectedUserFind, placeSignals, setPlaceSignals,
        rawClusters, setRawClusters, geologyContext, setGeologyContext,
        geologyContextLoading, setGeologyContextLoading,
        pasDensityCell, setPasDensityCell, userGpsPos, setUserGpsPos,
        sfBannerDismissed, setSfBannerDismissed,
        traceCardRefs, sheetDragStartY, savedPointJustClickedRef,
        terrainScanCenterRef, terrainScanBoundsRef, terrainAnalysisBoundsRef,
        terrainHistoricRoutesAvailableRef, questionTerrainAvailabilityRef,
        questionScanAutoStartedRef, nhleDataRef, aimDataRef, modernWaysRef,
        geologyEnabledRef, geologyRequestSeqRef, geologyAppliedRef,
        userLocationMarkerRef, logContainerRef, sheetScrollRef,
        ...scoring,
    };
}

export type FieldGuidePageState = ReturnType<typeof useFieldGuidePageState>;
