import React, { createContext, useContext } from 'react';
import type maplibregl from 'maplibre-gl';
import type { RefObject } from 'react';
import type { GeologyContext } from '../../engines/geologyContext';
import type { CoachTip } from '../CoachTips';
import type {
    Cluster, TraceTarget, HistoricFind, PlaceSignal, HistoricRoute, Hotspot,
    HotspotClassification, LandscapeIntelligence, LandscapeSummary,
} from '../../pages/fieldGuideTypes';
import type { Find, SavedPoint, Permission, Field, Media } from '../../db';
import type { LogEntry } from '../../utils/scanLogger';
import type { DevAnnotation, AnnotationType, BroadPeriod, LandscapeType, AnnotationConfidence } from '../../utils/devAnnotation';
import type { WorkflowState } from '../../types/significantFind';

// ─── Re-exported types used by child components ───────────────────────────────

export type RasterOverlayKey = 'lidar' | 'lidar-wales' | 'os1880' | 'os1930';

export const HISTORIC_LAYER_OPTIONS = [
    { key: 'context',    label: 'Recorded Heritage' },
    { key: 'routes',     label: 'Roman Roads & Trackways' },
    { key: 'corridors',  label: 'Movement Corridors' },
    { key: 'crossings',  label: 'Crossing Points' },
    { key: 'monuments',  label: 'Scheduled Monuments' },
    { key: 'aim',        label: 'Aerial Archaeology' },
    { key: 'pasDensity', label: 'PAS Record Density' },
    { key: 'userFinds',  label: 'Your Finds' },
] as const;

export const HOTSPOT_TITLES: Record<HotspotClassification, string> = {
    'Crossing Point Candidate':         'Crossing Point',
    'Junction / Convergence Zone':      'Route Junction',
    'Settlement Edge Candidate':        'Settlement Edge',
    'Burial / Barrow Candidate':        'Burial / Barrow',
    'Organised Field System Candidate': 'Field System',
    'Palaeochannel Activity Zone':      'Former Watercourse',
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

// ─── Context type ─────────────────────────────────────────────────────────────

export interface FieldGuideContextValue {
    // Props passed in
    projectId: string;
    onSignificantFind?: (initialContext?: Partial<WorkflowState>) => void;

    // Map refs
    mapRef: RefObject<maplibregl.Map | null>;
    mapContainerRef: RefObject<HTMLDivElement>;

    // Dev/log refs
    logContainerRef: RefObject<HTMLDivElement>;
    sheetScrollRef: RefObject<HTMLDivElement>;
    sheetDragStartY: RefObject<number | null>;
    traceCardRefs: RefObject<Map<string, HTMLDivElement>>;
    savedPointJustClickedRef: RefObject<boolean>;
    terrainScanCenterRef: RefObject<{ lat: number; lng: number } | null>;
    terrainScanBoundsRef: RefObject<{ west: number; south: number; east: number; north: number } | null>;
    nhleDataRef: RefObject<{ features: any[] } | null>;
    aimDataRef: RefObject<{ features: any[] } | null>;
    modernWaysRef: RefObject<import('../../pages/fieldGuideTypes').ModernWay[]>;
    userLocationMarkerRef: RefObject<maplibregl.Marker | null>;

    // Engine state
    analyzing: boolean;
    scanPhase: 'idle' | 'terrain' | 'historic' | 'complete';
    hotspotVersion: 'terrain' | 'enhanced' | 'geology-enhanced' | null;
    terrainClusters: Cluster[];
    detectedFeatures: Cluster[];
    hotspots: Hotspot[];
    hasScanned: boolean;
    heritageCount: number;
    monumentPoints: [number, number][];
    historicRoutes: HistoricRoute[];

    // Derived / computed
    sortedHotspots: Hotspot[];
    displayTargets: Cluster[];
    traceTargets: TraceTarget[];
    primaryTargetId: string | null;
    sourceUsability: Record<string, 'usable' | 'loaded' | 'none'>;
    hotspotFindContext: Map<string, { status: 'within' | 'nearby'; count: number }>;
    targetFindContext: Map<string, { status: 'within' | 'nearby'; count: number }>;
    showConcentrationBanner: boolean;

    // UI state
    selectedId: string | null;
    setSelectedId: React.Dispatch<React.SetStateAction<string | null>>;
    selectedHotspotId: string | null;
    setSelectedHotspotId: React.Dispatch<React.SetStateAction<string | null>>;
    showSuggestion: boolean;
    setShowSuggestion: React.Dispatch<React.SetStateAction<boolean>>;
    scanStatus: string;
    systemLog: LogEntry[];
    zoomWarning: boolean;
    isSatellite: boolean;
    setIsSatellite: React.Dispatch<React.SetStateAction<boolean>>;
    scanCount: number;
    searchQuery: string;
    setSearchQuery: React.Dispatch<React.SetStateAction<string>>;
    isSearchOpen: boolean;
    setIsSearchOpen: React.Dispatch<React.SetStateAction<boolean>>;
    isIntelOpen: boolean;
    setIsIntelOpen: React.Dispatch<React.SetStateAction<boolean>>;
    intelDetailsOpen: boolean;
    setIntelDetailsOpen: React.Dispatch<React.SetStateAction<boolean>>;
    intelLayersOpen: boolean;
    setIntelLayersOpen: React.Dispatch<React.SetStateAction<boolean>>;
    targetPeriod: 'All' | 'Bronze Age' | 'Roman' | 'Medieval';
    isLocating: boolean;
    selectedMonument: string | null | undefined;
    setSelectedMonument: React.Dispatch<React.SetStateAction<string | null | undefined>>;
    historicMode: boolean;
    setHistoricMode: React.Dispatch<React.SetStateAction<boolean>>;
    historicScanCompleted: boolean;
    historicLayerToggles: { lidar: boolean; 'lidar-wales': boolean; os1930: boolean; os1880: boolean };
    setHistoricLayerToggles: React.Dispatch<React.SetStateAction<{ lidar: boolean; 'lidar-wales': boolean; os1930: boolean; os1880: boolean }>>;
    historicLayerOpacity: Record<RasterOverlayKey, number>;
    activeOpacityLayer: RasterOverlayKey | null;
    setActiveOpacityLayer: React.Dispatch<React.SetStateAction<RasterOverlayKey | null>>;
    historicLayerVisibility: { routes: boolean; corridors: boolean; crossings: boolean; monuments: boolean; aim: boolean; context: boolean; pasDensity: boolean; userFinds: boolean };
    setHistoricLayerVisibility: React.Dispatch<React.SetStateAction<{ routes: boolean; corridors: boolean; crossings: boolean; monuments: boolean; aim: boolean; context: boolean; pasDensity: boolean; userFinds: boolean }>>;
    showFields: false | 'all' | string;
    setShowFields: React.Dispatch<React.SetStateAction<false | 'all' | string>>;
    showFieldsPicker: boolean;
    setShowFieldsPicker: React.Dispatch<React.SetStateAction<boolean>>;
    showLayerPicker: boolean;
    setShowLayerPicker: React.Dispatch<React.SetStateAction<boolean>>;
    helperActive: boolean;
    setHelperActive: React.Dispatch<React.SetStateAction<boolean>>;
    helperTipIndex: number;
    setHelperTipIndex: React.Dispatch<React.SetStateAction<number>>;
    fieldPickerStep: 'top' | string;
    setFieldPickerStep: React.Dispatch<React.SetStateAction<'top' | string>>;
    mapClickLabel: string | null;
    expandedInterpretationId: string | null;
    setExpandedInterpretationId: React.Dispatch<React.SetStateAction<string | null>>;
    expandedTargetId: string | null;
    setExpandedTargetId: React.Dispatch<React.SetStateAction<string | null>>;
    sheetExpanded: boolean;
    devMode: boolean;
    setDevMode: React.Dispatch<React.SetStateAction<boolean>>;
    annotationMode: boolean;
    setAnnotationMode: React.Dispatch<React.SetStateAction<boolean>>;
    devAnnotations: DevAnnotation[];
    setDevAnnotations: React.Dispatch<React.SetStateAction<DevAnnotation[]>>;
    pendingAnnotation: { lat: number; lon: number } | null;
    setPendingAnnotation: React.Dispatch<React.SetStateAction<{ lat: number; lon: number } | null>>;
    annotationForm: {
        annotationType: AnnotationType;
        broadPeriod: BroadPeriod;
        landscapeType: LandscapeType;
        confidence: AnnotationConfidence;
        reviewerNote: string;
    };
    setAnnotationForm: React.Dispatch<React.SetStateAction<{
        annotationType: AnnotationType;
        broadPeriod: BroadPeriod;
        landscapeType: LandscapeType;
        confidence: AnnotationConfidence;
        reviewerNote: string;
    }>>;
    focusMode: boolean;
    setFocusMode: React.Dispatch<React.SetStateAction<boolean>>;
    mobileSheetMode: 'hotspots' | 'targets';
    setMobileSheetMode: React.Dispatch<React.SetStateAction<'hotspots' | 'targets'>>;
    selectedTraceId: string | null;
    setSelectedTraceId: React.Dispatch<React.SetStateAction<string | null>>;
    showSavedPoints: boolean;
    setShowSavedPoints: React.Dispatch<React.SetStateAction<boolean>>;
    savingPoint: boolean;
    setSavingPoint: React.Dispatch<React.SetStateAction<boolean>>;
    savedPointLabel: string;
    setSavedPointLabel: React.Dispatch<React.SetStateAction<string>>;
    pendingDeleteId: string | null;
    setPendingDeleteId: React.Dispatch<React.SetStateAction<string | null>>;
    sourceAvailability: Record<string, boolean> | null;
    scanFromCache: boolean;
    scanNoSignal: boolean;
    scheduledMonumentCheckFailed: boolean;

    // PAS / intel state
    pasFinds: HistoricFind[];
    selectedPASFind: HistoricFind | null;
    setSelectedPASFind: React.Dispatch<React.SetStateAction<HistoricFind | null>>;
    selectedUserFind: Find | null;
    setSelectedUserFind: React.Dispatch<React.SetStateAction<Find | null>>;
    placeSignals: PlaceSignal[];

    // Live queries
    permissions: Permission[];
    realPermissions: Permission[];
    fields: Field[];
    projectFinds: Find[];
    savedPoints: SavedPoint[];

    // Scoring hook
    potentialScore: { score: number; reasons: string[]; breakdown?: { terrain: number; hydro: number; historic: number; signals: number } } | null;
    scanConfidence: string | null;

    // Media for selected user find
    selectedUserFindMedia: Media | undefined;

    // Significant find banner
    sfBannerDismissed: boolean;
    setSfBannerDismissed: React.Dispatch<React.SetStateAction<boolean>>;

    // Scan state
    isTerrainScanning: boolean;
    isHistoricScanning: boolean;
    loadingPAS: boolean;
    terrainScanComplete: boolean;
    historicScanComplete: boolean;
    selectedTarget: Cluster | null;

    // Raster overlay helpers
    activeOverlayOpacityLayer: RasterOverlayKey | null;
    rasterOverlayButtonClass: (key: RasterOverlayKey, selectedClass: string) => string;
    handleRasterOverlayPress: (key: RasterOverlayKey) => void;
    updateRasterOverlayOpacity: (key: RasterOverlayKey, value: number) => void;

    // Coach tips
    helperTips: CoachTip[];

    // Callbacks
    persistSheetExpanded: (expanded: boolean) => void;
    handleSheetTouchStart: (e: React.TouchEvent) => void;
    handleSheetTouchEnd: (e: React.TouchEvent) => void;
    clearMapItemSelections: (keep?: 'target' | 'hotspot' | 'userFind' | 'pasFind' | 'monument' | 'trace') => void;
    focusTarget: (f: Cluster) => void;
    clearScan: () => void;
    executeScan: () => void;
    findMe: () => void;
    searchLocation: (e: React.FormEvent) => void;
    loadStandaloneHistoric: () => void;
    handleLabExport: () => void;
    handleAnnotationConfirm: () => void;
    buildSuggestedLabel: () => string;

    // Dev raw state
    rawClusters: Cluster[];
    userGpsPos: [number, number] | null;
    setUserGpsPos: React.Dispatch<React.SetStateAction<[number, number] | null>>;

    // Geology context
    geologyContext: GeologyContext | null;
    geologyContextLoading: boolean;

    // PAS density cell for current scan area
    pasDensityCell: import('../../services/pasDensityService').PASCellLookup | null;

    // Landscape Intelligence
    landscapeIntelligenceMap: Map<string, LandscapeIntelligence>;
    landscapeSummary: LandscapeSummary | null;
}

// ─── Context ──────────────────────────────────────────────────────────────────

const FieldGuideContext = createContext<FieldGuideContextValue | null>(null);

export function useFieldGuideContext(): FieldGuideContextValue {
    const ctx = useContext(FieldGuideContext);
    if (!ctx) throw new Error('useFieldGuideContext must be used inside FieldGuideProvider');
    return ctx;
}

export { FieldGuideContext };
