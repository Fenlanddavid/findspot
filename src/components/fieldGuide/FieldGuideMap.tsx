import React from 'react';
import maplibregl from 'maplibre-gl';
import { useSearchParams } from 'react-router-dom';
import { CoachTips } from '../CoachTips';
import { ScaledImage } from '../ScaledImage';
import { buildInterpretation, getInterpretationLabel, getHotspotSignalStrength } from '../../utils/hotspotInterpreter';
import { buildTargetInterpretation, getTargetVerdict } from '../../utils/targetInterpreter';
import type { TargetSignalStrength } from '../../utils/targetInterpreter';
import type { HotspotSignalStrength } from '../../utils/hotspotInterpreter';
import type { Cluster, Hotspot, HotspotClassification } from '../../pages/fieldGuideTypes';
import { SCAN_CONFIG } from '../../utils/scanConfig';
import { db } from '../../db';
import { getDistance } from '../../utils/fieldGuideAnalysis';
import { FIELDGUIDE_SHORT_NOTICE } from '../../utils/legalCopy';
import {
    ANNOTATION_TYPE_LABELS, LANDSCAPE_TYPE_LABELS,
    type AnnotationType, type BroadPeriod, type LandscapeType, type AnnotationConfidence,
} from '../../utils/devAnnotation';
import { useFieldGuideContext } from './FieldGuideContext';
import { HOTSPOT_TITLES, HISTORIC_LAYER_OPTIONS } from './FieldGuideContext';
import { MobileBottomSheet } from './MobileBottomSheet';
import { GeologyContextCard } from './GeologyContextCard';

const FIELDGUIDE_HELPERS_SEEN_KEY = 'fs_fg_helpers_seen';

const RASTER_OVERLAY_LABELS: Record<'lidar' | 'lidar-wales' | 'os1880' | 'os1930', string> = {
    lidar:          'LiDAR',
    'lidar-wales':  'LiDAR Wales',
    os1880:         'OS 1895',
    os1930:         'OS 1900',
};

function getSignalBand(value: number | null | undefined, cap = 100): string {
    const ratio = cap > 0 ? Math.max(0, Math.min(1, (value ?? 0) / cap)) : 0;
    if (ratio >= 0.72) return 'Strong';
    if (ratio >= 0.42) return 'Moderate';
    if (ratio > 0.08) return 'Trace';
    return 'Not present';
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
        'Palaeochannel Activity Zone':      'Former watercourse — activity concentrates at the channel margins',
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

export function FieldGuideMap() {
    const {
        mapContainerRef,
        mapRef,

        // Save point modal
        savingPoint,
        setSavingPoint,
        savedPointLabel,
        setSavedPointLabel,
        projectId,
        sortedHotspots,

        // SF banner
        showConcentrationBanner,
        setSfBannerDismissed,
        onSignificantFind,

        // Fields picker
        showFieldsPicker,
        fieldPickerStep,
        setFieldPickerStep,
        showFields,
        setShowFields,
        setShowFieldsPicker,
        fields,
        realPermissions,
        permissions,

        // Layer toggle + search
        isSearchOpen,
        setIsSearchOpen,
        showLayerPicker,
        setShowLayerPicker,
        isSatellite,
        setIsSatellite,
        historicLayerToggles,
        historicLayerOpacity,
        activeOverlayOpacityLayer,
        rasterOverlayButtonClass,
        handleRasterOverlayPress,
        updateRasterOverlayOpacity,
        historicLayerVisibility,
        setHistoricLayerVisibility,
        showSavedPoints,
        setShowSavedPoints,
        savedPoints,
        persistSheetExpanded,
        buildSuggestedLabel,
        helperActive,
        helperTipIndex,

        // Floating search
        searchQuery,
        setSearchQuery,
        searchLocation,

        // Floating alerts
        analyzing,
        historicMode,
        detectedFeatures,
        hotspots,
        scanCount,
        realPermissions: _rp,
        projectFinds,
        mapClickLabel,
        zoomWarning,

        // Coach tips
        helperTips,
        setHelperActive,
        setHelperTipIndex,
        annotationMode,

        // Bottom sheet condition
        isIntelOpen,
        selectedMonument,
        selectedUserFind,
        selectedPASFind,
        selectedId,
        selectedHotspotId,

        // Desktop popup cards
        setSelectedMonument,
        setSelectedHotspotId,
        setSelectedId,
        expandedInterpretationId,
        setExpandedInterpretationId,
        expandedTargetId,
        setExpandedTargetId,
        hotspotFindContext,
        targetFindContext,
        primaryTargetId,
        focusTarget,
        loadingPAS,
        isTerrainScanning,
        selectedTarget,
        displayTargets,

        // Historic compact pill
        historicMode: _hm,

        // Intel panel
        potentialScore,
        scanConfidence,
        pasFinds,
        historicRoutes,
        placeSignals,
        sourceAvailability,
        sourceUsability,
        scanFromCache,
        setIsIntelOpen,
        intelDetailsOpen,
        setIntelDetailsOpen,
        intelLayersOpen,
        setIntelLayersOpen,
        clearMapItemSelections,
        setSelectedPASFind,
        devMode,
        handleLabExport,
        terrainScanCenterRef,
        terrainScanBoundsRef,

        // Dev annotation
        pendingAnnotation,
        setPendingAnnotation,
        annotationForm,
        setAnnotationForm,
        handleAnnotationConfirm,

        // User find
        selectedUserFindMedia,

        // Geology context
        geologyContext,
        geologyContextLoading,
    } = useFieldGuideContext();

    const [searchParams] = useSearchParams();

    const bd = potentialScore?.breakdown ?? null;
    const interp = getHistoricInterpretation(bd ? { terrain: bd.terrain, historic: bd.historic, spectral: bd.signals } : null);
    const sigLines = getSignalSummary(bd ? { terrain: bd.terrain, hydro: bd.hydro, historic: bd.historic, spectral: bd.signals } : null);
    const hasData = pasFinds.length > 0 || historicRoutes.length > 0 || placeSignals.length > 0;
    const mc = mapRef.current?.getCenter();
    const nearbyProjectFinds = mc ? projectFinds.filter(f => f.lat !== null && f.lon !== null && getDistance([f.lon!, f.lat!], [mc.lng, mc.lat]) <= 500) : [];
    const [expandedGeologyId, setExpandedGeologyId] = React.useState<string | null>(null);
    const scrollExpandedSectionIntoView = (id: string) => {
        window.setTimeout(() => {
            document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }, 0);
    };
    const toggleGeologyDetails = (key: string) => {
        setExpandedGeologyId(expandedGeologyId === key ? null : key);
    };
    const toggleHotspotDetails = (id: string) => {
        const opening = expandedInterpretationId !== id;
        setExpandedInterpretationId(opening ? id : null);
        if (opening) scrollExpandedSectionIntoView(`desktop-hotspot-details-${id}`);
    };
    const toggleTargetDetails = (id: string) => {
        const opening = expandedTargetId !== id;
        setExpandedTargetId(opening ? id : null);
        if (opening) scrollExpandedSectionIntoView(`desktop-target-details-${id}`);
    };
    const neutralDesktopGeologyAvailable =
        !historicMode &&
        !selectedUserFind &&
        !selectedPASFind &&
        selectedMonument === undefined &&
        !selectedHotspotId &&
        !selectedId &&
        (scanCount > 0 || geologyContext || geologyContextLoading);
    const activeDesktopGeologyTitle =
        neutralDesktopGeologyAvailable && expandedGeologyId === 'scan' ? 'Scan Geology'
        : selectedHotspotId && expandedGeologyId === `hotspot:${selectedHotspotId}` ? 'Hotspot Geology'
        : selectedId && expandedGeologyId === `target:${selectedId}` ? 'Target Geology'
        : null;

    return (
        <div className="flex-1 relative bg-slate-900">
            <div ref={mapContainerRef} className="absolute inset-0" />

            {/* Save Point Modal */}
            {savingPoint && (
                <div className="absolute inset-0 z-[100] bg-black/70 backdrop-blur-sm flex items-end">
                    <div className="w-full bg-slate-900 border-t border-white/10 rounded-t-2xl p-4 space-y-3">
                        <p className="text-xs font-black text-white/40 uppercase tracking-widest">Save this map point</p>
                        <input
                            autoFocus
                            value={savedPointLabel}
                            onChange={e => setSavedPointLabel(e.target.value)}
                            placeholder="Name this point..."
                            maxLength={60}
                            className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder:text-white/25 outline-none focus:border-emerald-400/50"
                        />
                        <div className="flex gap-2">
                            <button
                                onClick={() => { setSavingPoint(false); setSavedPointLabel(''); }}
                                className="flex-1 py-2.5 rounded-xl border border-white/10 text-xs font-black text-white/40 uppercase tracking-widest"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={async () => {
                                    const map = mapRef.current;
                                    if (!map || !projectId) return;
                                    const { lat, lng } = map.getCenter();
                                    const snap = sortedHotspots.length > 0 ? {
                                        hotspotCount:    sortedHotspots.length,
                                        topHotspotTitle: HOTSPOT_TITLES[sortedHotspots[0].classification],
                                    } : undefined;
                                    await db.savedPoints.add({
                                        id:           crypto.randomUUID(),
                                        projectId,
                                        label:        savedPointLabel.trim() || 'Saved point',
                                        lat,
                                        lon:          lng,
                                        zoom:         map.getZoom(),
                                        note:         '',
                                        scanSnapshot: snap,
                                        createdAt:    new Date().toISOString(),
                                    });
                                    setSavingPoint(false);
                                    setSavedPointLabel('');
                                }}
                                className="flex-1 py-2.5 rounded-xl bg-emerald-500 text-white text-xs font-black uppercase tracking-widest"
                            >
                                Save
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Significant find concentration banner */}
            {showConcentrationBanner && (
                <div className="absolute top-3 left-3 right-3 z-[105] animate-in slide-in-from-top-2 fade-in duration-200 lg:left-auto lg:right-3 lg:w-80">
                    <div className="bg-amber-900/95 backdrop-blur-md border border-amber-500/50 rounded-2xl p-3 shadow-2xl flex items-start gap-3">
                        <span className="text-lg shrink-0">⚠️</span>
                        <div className="flex-1 min-w-0">
                            <p className="text-xs font-bold text-amber-200">Concentrated find pattern</p>
                            <p className="text-[0.6875rem] text-amber-300/80 mt-0.5 leading-snug">Your finds this session are clustering tightly. Could this be an in situ deposit?</p>
                        </div>
                        <div className="flex flex-col gap-1 shrink-0">
                            <button
                                onClick={() => { setSfBannerDismissed(true); onSignificantFind?.({ currentStep: "scatter_confirm", path: "map_scatter" }); }}
                                className="text-[0.6875rem] font-black text-white bg-amber-600 hover:bg-amber-500 px-2.5 py-1 rounded-lg transition-all"
                            >
                                Review
                            </button>
                            <button
                                onClick={() => setSfBannerDismissed(true)}
                                className="text-[0.625rem] text-amber-400/60 hover:text-amber-300 text-center transition-all"
                            >
                                Dismiss
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* My Fields Picker */}
            {showFieldsPicker && (
                <div className="absolute left-3 right-3 bottom-[150px] z-[110] animate-in fade-in slide-in-from-bottom-2 duration-150 lg:top-2 lg:left-2 lg:right-auto lg:bottom-auto lg:slide-in-from-top-2">
                    <div className="bg-slate-900/95 border border-white/10 rounded-xl shadow-2xl backdrop-blur-md p-2 w-full max-h-[45vh] overflow-y-auto lg:w-auto lg:min-w-[170px] lg:max-w-[220px] lg:max-h-[60vh]">
                        {fieldPickerStep === 'top' ? (
                            <>
                                <p className="text-[0.4375rem] font-black text-white/30 uppercase tracking-widest px-1 mb-1.5">Show fields</p>
                                <button
                                    onClick={() => { setShowFields(false); setShowFieldsPicker(false); }}
                                    className={`w-full text-left px-3 py-1.5 rounded-lg text-[0.6875rem] font-bold transition-all truncate mb-0.5 ${showFields === false ? 'bg-teal-500/20 border border-teal-500/40 text-teal-300' : 'bg-white/5 border border-white/10 text-white/50 hover:text-white hover:bg-white/10'}`}
                                >
                                    Off
                                </button>
                                {(fields.some(f => f.boundary) || permissions.some(p => p.boundary && !fields.some(f => f.permissionId === p.id))) && (
                                    <button
                                        onClick={() => { setShowFields('all'); setShowFieldsPicker(false); }}
                                        className={`w-full text-left px-3 py-1.5 rounded-lg text-[0.6875rem] font-bold transition-all truncate mb-1 ${showFields === 'all' ? 'bg-teal-500/20 border border-teal-500/40 text-teal-300' : 'bg-white/5 border border-white/10 text-white/70 hover:text-white hover:bg-white/10'}`}
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
                                            className={`w-full text-left px-3 py-1.5 rounded-lg text-[0.6875rem] font-bold transition-all truncate mt-0.5 flex items-center justify-between gap-2 ${isActive ? 'bg-teal-500/20 border border-teal-500/40 text-teal-300' : hasBoundaries ? 'bg-white/5 border border-white/10 text-white/70 hover:text-white hover:bg-white/10' : 'bg-white/5 border border-white/5 text-white/25 cursor-default'}`}
                                        >
                                            <span className="truncate">{p.name || '(Unnamed)'}</span>
                                            {!hasBoundaries
                                                ? <span className="text-[0.5rem] font-normal opacity-50 shrink-0">No boundaries</span>
                                                : permFieldCount > 1 && <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="shrink-0 opacity-50"><polyline points="9 18 15 12 9 6"/></svg>
                                            }
                                        </button>
                                    );
                                })}
                            </>
                        ) : (
                            <>
                                <button
                                    onClick={() => setFieldPickerStep('top')}
                                    className="flex items-center gap-1 text-[0.5625rem] font-black text-white/40 hover:text-white/70 uppercase tracking-widest px-1 mb-1.5 transition-colors"
                                >
                                    <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="15 18 9 12 15 6"/></svg>
                                    {realPermissions.find(p => p.id === fieldPickerStep)?.name ?? 'Back'}
                                </button>
                                <button
                                    onClick={() => { setShowFields(fieldPickerStep); setShowFieldsPicker(false); setFieldPickerStep('top'); }}
                                    className={`w-full text-left px-3 py-1.5 rounded-lg text-[0.6875rem] font-bold transition-all truncate mb-1 ${showFields === fieldPickerStep ? 'bg-teal-500/20 border border-teal-500/40 text-teal-300' : 'bg-white/5 border border-white/10 text-white/70 hover:text-white hover:bg-white/10'}`}
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
                                            className={`w-full text-left px-3 py-1.5 rounded-lg text-[0.6875rem] font-bold transition-all truncate mt-0.5 ${showFields === `field:${f.id}` ? 'bg-teal-500/20 border border-teal-500/40 text-teal-300' : 'bg-white/5 border border-white/10 text-white/70 hover:text-white hover:bg-white/10'}`}
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
            <div className="absolute top-4 right-4 z-[59] flex flex-col gap-2">
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
                        className={`w-10 h-10 flex items-center justify-center rounded-xl border shadow-xl backdrop-blur-md transition-all active:scale-95 relative ${showLayerPicker || isSatellite || historicLayerToggles.lidar || historicLayerToggles['lidar-wales'] || historicLayerToggles.os1880 || historicLayerToggles.os1930 || showSavedPoints ? 'bg-slate-900/90 border-emerald-500/50 text-emerald-400' : 'bg-slate-900/90 border-white/10 text-slate-300'} ${helperActive && helperTipIndex === 0 ? 'ring-2 ring-emerald-300/70 ring-offset-2 ring-offset-slate-950' : ''}`}
                    >
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <polygon points="12 2 2 7 12 12 22 7 12 2"/>
                            <polyline points="2 17 12 22 22 17"/>
                            <polyline points="2 12 12 17 22 12"/>
                        </svg>
                        {(isSatellite || historicLayerToggles.lidar || historicLayerToggles['lidar-wales'] || historicLayerToggles.os1880 || historicLayerToggles.os1930) && (
                            <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-emerald-400" />
                        )}
                    </button>
                    {showLayerPicker && (
                        <div className="absolute top-12 right-0 z-[60] bg-slate-900/95 border border-white/12 rounded-xl shadow-2xl backdrop-blur-xl p-2 min-w-[130px] animate-in fade-in slide-in-from-top-1 duration-150">
                            <p className="text-[0.4375rem] font-black text-white/30 uppercase tracking-widest px-1.5 mb-1.5">Map Style</p>
                            <button onClick={() => setIsSatellite(v => !v)} className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[0.625rem] font-bold transition-all mb-0.5 ${isSatellite ? 'bg-emerald-500/20 border border-emerald-500/40 text-emerald-300' : 'text-white/50 hover:text-white hover:bg-white/5'}`}>
                                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
                                Satellite
                            </button>
                            <p className="text-[0.4375rem] font-black text-white/30 uppercase tracking-widest px-1.5 mt-2 mb-1.5">Overlays</p>
                            <button onClick={() => handleRasterOverlayPress('lidar')} className={rasterOverlayButtonClass('lidar', 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300')}>
                                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M3 17l9-14 9 14H3z"/></svg>
                                LiDAR
                            </button>
                            <button onClick={() => handleRasterOverlayPress('lidar-wales')} className={rasterOverlayButtonClass('lidar-wales', 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300')}>
                                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M3 17l9-14 9 14H3z"/></svg>
                                LiDAR Wales
                            </button>
                            <button onClick={() => handleRasterOverlayPress('os1880')} className={rasterOverlayButtonClass('os1880', 'bg-amber-500/20 border-amber-500/40 text-amber-300')}>
                                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg>
                                OS 1895
                            </button>
                            <button onClick={() => handleRasterOverlayPress('os1930')} className={rasterOverlayButtonClass('os1930', 'bg-orange-500/20 border-orange-500/40 text-orange-300')}>
                                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg>
                                OS 1900
                            </button>
                            <p className="text-[0.4375rem] font-black text-white/30 uppercase tracking-widest px-1.5 mt-2 mb-1.5">Finds</p>
                            <button onClick={() => setHistoricLayerVisibility(p => ({ ...p, userFinds: !p.userFinds }))} className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[0.625rem] font-bold transition-all ${historicLayerVisibility.userFinds ? 'bg-emerald-500/20 border border-emerald-500/40 text-emerald-300' : 'text-white/50 hover:text-white hover:bg-white/5'}`}>
                                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                                My Finds
                            </button>
                            <div className="border-t border-white/8 mt-1.5 pt-1.5" />
                            <button
                                onClick={() => { setShowSavedPoints(v => { if (!v) persistSheetExpanded(true); return !v; }); setShowLayerPicker(false); }}
                                className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[0.625rem] font-bold transition-all mb-0.5 ${showSavedPoints ? 'bg-emerald-500/20 border border-emerald-500/40 text-emerald-300' : 'text-white/50 hover:text-white hover:bg-white/5'}`}
                            >
                                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
                                Saved Points{savedPoints.length > 0 ? ` (${savedPoints.length})` : ''}
                            </button>
                            <button
                                onClick={() => {
                                    setSavedPointLabel(buildSuggestedLabel());
                                    setSavingPoint(true);
                                    setShowLayerPicker(false);
                                }}
                                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[0.625rem] font-bold text-white/50 hover:text-white hover:bg-white/5 transition-all"
                            >
                                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
                                Save This Point
                            </button>
                        </div>
                    )}
                </div>
            </div>

            {activeOverlayOpacityLayer && !showLayerPicker && (
                <div className="absolute right-3 top-28 bottom-[158px] z-[58] w-11 rounded-2xl border border-emerald-500/35 bg-slate-900/92 px-1.5 py-2 shadow-2xl backdrop-blur-xl flex flex-col items-center gap-2 animate-in fade-in slide-in-from-right-2 duration-150">
                    <span className="text-[0.5rem] font-black text-emerald-300 leading-none">{Math.round(historicLayerOpacity[activeOverlayOpacityLayer] * 100)}%</span>
                    <input
                        type="range"
                        min={0}
                        max={100}
                        value={Math.round(historicLayerOpacity[activeOverlayOpacityLayer] * 100)}
                        onChange={e => updateRasterOverlayOpacity(activeOverlayOpacityLayer, Number(e.target.value) / 100)}
                        aria-label={`${RASTER_OVERLAY_LABELS[activeOverlayOpacityLayer]} opacity`}
                        className="min-h-0 flex-1 w-8 accent-emerald-400"
                        style={{ writingMode: 'vertical-rl', direction: 'rtl' }}
                    />
                    <span className="text-[0.4375rem] font-black text-white/45 uppercase tracking-widest leading-tight text-center">{RASTER_OVERLAY_LABELS[activeOverlayOpacityLayer]}</span>
                </div>
            )}

            {/* Desktop map controls — hidden */}
            <div className="absolute top-4 right-4 z-[59] hidden flex-col gap-2">
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
                    <div className="bg-slate-700/60 text-slate-200 px-4 py-2 rounded-full text-[0.5625rem] sm:text-[0.625rem] font-black tracking-widest uppercase shadow-lg border border-white/10 backdrop-blur-md">
                        Navigate, search or GPS to your area · then scan
                    </div>
                )}
                {mapClickLabel && (
                    <div className="bg-slate-900/95 text-white px-4 py-1.5 rounded-full text-[0.5625rem] font-black tracking-widest uppercase shadow-2xl border border-blue-500/40">
                        {mapClickLabel}
                    </div>
                )}
                {zoomWarning && !historicLayerToggles.lidar && (
                    <div className="bg-amber-500 text-black px-4 py-1.5 rounded-full text-[0.5rem] sm:text-[0.625rem] font-black tracking-widest uppercase shadow-2xl border border-white/20">
                        ⚠️ MAX SCAN ZOOM
                    </div>
                )}
            </div>

            <CoachTips
                storageKey={FIELDGUIDE_HELPERS_SEEN_KEY}
                tips={helperTips}
                enabled={!annotationMode}
                forceShow={searchParams.get('tips') === '1'}
                onDismiss={() => { setHelperActive(false); setHelperTipIndex(0); }}
                onStepChange={(index) => { setHelperActive(true); setHelperTipIndex(index); }}
            />

            {/* Mobile Bottom Sheet */}
            <MobileBottomSheet />

            {neutralDesktopGeologyAvailable && !activeDesktopGeologyTitle && (
                <div className="hidden lg:block absolute bottom-6 left-6 z-[100] animate-in slide-in-from-bottom-3 fade-in duration-150">
                    <button
                        type="button"
                        onClick={() => toggleGeologyDetails('scan')}
                        className="rounded-full border border-sky-400/30 bg-slate-950/90 px-3 py-2 text-[0.5625rem] font-black uppercase tracking-widest text-sky-300 shadow-xl backdrop-blur-xl transition-colors hover:border-sky-300/50 hover:text-sky-200"
                    >
                        Geology
                    </button>
                </div>
            )}

            {activeDesktopGeologyTitle && (
                <div className="hidden lg:block absolute top-1/2 left-6 w-80 -translate-y-1/2 z-[120] animate-in fade-in zoom-in-95 duration-150">
                    <div className="relative">
                        <button
                            type="button"
                            aria-label="Close geology context"
                            onClick={() => setExpandedGeologyId(null)}
                            className="absolute right-3 top-3 z-10 bg-white/[0.04] hover:bg-white/[0.08] text-white/45 hover:text-white rounded-full p-1.5 transition-colors border border-white/10"
                        >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                        </button>
                        <GeologyContextCard
                            title={activeDesktopGeologyTitle}
                            context={geologyContext}
                            loading={geologyContextLoading}
                            showUnavailable
                            className="bg-slate-950/95 rounded-2xl shadow-2xl pr-10"
                        />
                    </div>
                </div>
            )}

            {/* Scheduled Monument Card — desktop only (hidden on mobile) */}
            {selectedMonument !== undefined && (
                <div className="hidden absolute bottom-6 left-auto right-6 w-96 z-[100] animate-in slide-in-from-bottom-4 fade-in duration-200">
                    <div className="bg-slate-950/98 border border-stone-700/50 rounded-3xl p-5 shadow-2xl">
                        <div className="flex items-start justify-between mb-3">
                            <p className="text-[0.5rem] font-black text-stone-400/70 uppercase tracking-[0.2em]">Scheduled Monument</p>
                            <button onClick={() => setSelectedMonument(undefined)} className="text-white/30 hover:text-white/60 transition-colors -mt-0.5 -mr-1 p-1">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
                            </button>
                        </div>
                        {selectedMonument && <p className="text-white/90 font-black text-sm leading-snug mb-3">{selectedMonument}</p>}
                        <div className="space-y-1.5">
                            <p className="text-stone-200/80 text-xs font-bold leading-snug">This area is protected as a Scheduled Monument.</p>
                            <p className="text-stone-400/60 text-[0.6875rem] leading-snug">Metal detecting or intrusive activity may require legal consent. Check current protections before any fieldwork.</p>
                        </div>
                    </div>
                </div>
            )}

            {/* Hotspot Card Popup — desktop only */}
            {selectedHotspotId && (
                <div className="hidden absolute bottom-6 left-auto right-6 w-96 max-h-[80vh] overflow-y-auto scrollbar-hide animate-in slide-in-from-bottom-4 fade-in duration-200">
                    {hotspots.filter(h => h.id === selectedHotspotId).map(h => {
                        const hStrength = getHotspotSignalStrength(h.score);
                        const hierarchy = getHotspotResultHierarchy(h, hStrength);
                        const hBorder = hStrength === 'Strong Zone' ? 'bg-black/95 border-amber-500/35' : hStrength === 'Moderate Zone' ? 'bg-black/95 border-emerald-500/35' : 'bg-black/95 border-white/15';
                        const hStrengthColour = hStrength === 'Strong Zone' ? 'text-amber-400' : hStrength === 'Moderate Zone' ? 'text-emerald-400' : 'text-slate-200';
                        const isPrimaryHotspot = h.number === 1;
                        return (
                        <div key={h.id} className={`p-4 lg:p-5 rounded-2xl lg:rounded-3xl border shadow-2xl transition-all backdrop-blur-xl ${hBorder}`}>
                            <div className="mx-auto mb-3 h-1 w-6 rounded-full bg-white/15 lg:hidden" />
                            <div className="flex justify-between items-start mb-3 lg:mb-4">
                                <div className="flex-1 min-w-0 pr-3">
                                    <div className="mb-2.5">
                                            <div className="flex items-start justify-between gap-2 mb-1">
                                                <h3 className="text-sm lg:text-base font-black text-white tracking-tight leading-tight">{HOTSPOT_TITLES[h.classification]}</h3>
                                                <div className="flex items-center gap-2 shrink-0">
                                                    <button
                                                        type="button"
                                                        onClick={(e) => { e.stopPropagation(); toggleGeologyDetails(`hotspot:${h.id}`); }}
                                                        className={`text-[0.5rem] font-black uppercase tracking-widest transition-colors ${expandedGeologyId === `hotspot:${h.id}` ? 'text-emerald-300' : 'text-sky-300 hover:text-sky-200'}`}
                                                    >
                                                        Geology
                                                    </button>
                                                    {isPrimaryHotspot && (
                                                        <span className="bg-emerald-500/15 border border-emerald-400/30 text-emerald-200 px-1.5 py-0.5 rounded-full text-[0.4375rem] font-black uppercase tracking-widest shrink-0">Priority</span>
                                                    )}
                                                </div>
                                            </div>
                                        <div className="flex items-center gap-2">
                                            <span className="text-[0.5rem] lg:text-[0.5625rem] font-black text-white/40 uppercase tracking-[0.16em]">Hotspot {h.number}</span>
                                            <span className={`rounded-full border px-1.5 py-0.5 text-[0.5rem] font-black ${hStrength === 'Strong Zone' ? 'border-amber-400/30 bg-amber-500/10 text-amber-300' : hStrength === 'Moderate Zone' ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-300' : 'border-white/10 bg-white/[0.04] text-slate-300'}`}>{hierarchy.signalStrength}</span>
                                        </div>
                                    </div>
                                    <div className="space-y-2 mb-2">
                                        <div>
                                            <p className="text-[0.5rem] font-black text-white/35 uppercase tracking-[0.18em] mb-0.5">Why it matters</p>
                                            <p className="text-xs lg:text-[0.8125rem] font-bold text-white/85 leading-snug">{hierarchy.whyItMatters}</p>
                                        </div>
                                        <div>
                                            <p className="text-[0.5rem] font-black text-emerald-400/60 uppercase tracking-[0.18em] mb-0.5">Interpretive cue</p>
                                            <p className="text-[0.6875rem] lg:text-[0.75rem] font-bold text-emerald-300 leading-snug">{hierarchy.nextAction}</p>
                                        </div>
                                    </div>
                                    {(h.secondaryTag || h.isOnCorridor || (h.linkedCount ?? 0) > 0) && (
                                        <div className="flex items-center gap-2.5 flex-wrap mt-1">
                                            {h.secondaryTag && <span className="text-[0.5625rem] font-bold text-amber-300/60 uppercase tracking-widest">{h.secondaryTag}</span>}
                                            {h.isOnCorridor && <span className="text-[0.5625rem] font-bold text-emerald-500/60 uppercase tracking-widest">On corridor</span>}
                                            {(h.linkedCount ?? 0) > 0 && <span className="text-[0.5625rem] font-bold text-white/40 uppercase tracking-widest">Linked to {h.linkedCount} nearby</span>}
                                        </div>
                                    )}
                                {(() => {
                                    const ctx = hotspotFindContext.get(h.id);
                                    if (!ctx) return null;
                                    return ctx.status === 'within'
                                        ? <p className="text-[0.5625rem] font-black text-emerald-400/80 uppercase tracking-widest mt-1.5">{ctx.count} find{ctx.count !== 1 ? 's' : ''} recorded here — signal supported</p>
                                        : <p className="text-[0.5625rem] font-black text-emerald-400/80 uppercase tracking-widest mt-1.5">{ctx.count} find{ctx.count !== 1 ? 's' : ''} recorded nearby</p>;
                                })()}
                            </div>
                            <button onClick={() => setSelectedHotspotId(null)} className="bg-white/[0.04] hover:bg-white/[0.08] text-white/70 hover:text-white rounded-full p-2 transition-colors border border-white/10 flex-shrink-0">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                            </button>
                            </div>
                            {h.isHighConfidenceCrossing && (
                            <div className="bg-blue-600/30 p-2 rounded-xl lg:rounded-2xl border border-blue-400/70 mb-3 lg:mb-4 animate-pulse">
                                <p className="m-0 text-[0.625rem] lg:text-xs font-black uppercase text-white text-center tracking-[0.18em]">Likely historic crossing point</p>
                                </div>
                            )}
                            {h.disturbanceRisk === 'High' && (
                                <div className="bg-red-500/15 p-2 rounded-xl lg:rounded-2xl border border-red-400/30 mb-3 lg:mb-4">
                                    <p className="m-0 text-[0.5625rem] font-black uppercase text-red-300 tracking-widest">Disturbed ground — interpret with caution</p>
                                </div>
                            )}
                            <div className="border-t border-white/8 pt-3 mb-3">
                                <p className="text-[0.5625rem] font-black text-white/60 uppercase tracking-widest mb-2.5">Evidence summary</p>
                                <div className="space-y-2">
                                    {h.explanation.slice(0, 3).map((reason, idx) => (
                                        <div key={idx} className="flex items-start gap-3">
                                            <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 mt-1 shadow-[0_0_8px_rgba(52,211,153,0.8)]" />
                                            <p className="text-xs lg:text-[0.8125rem] font-bold text-white leading-tight flex-1">{reason}</p>
                                        </div>
                                    ))}
                                </div>
                            </div>
                            {h.suggestedFocus && (
                                <div className="mt-3 pt-3 border-t border-emerald-500/15">
                                    <p className="text-[0.5625rem] font-black text-emerald-500/70 uppercase tracking-[0.12em] mb-1">Field focus</p>
                                    <p className="text-xs font-bold text-emerald-300 leading-snug">{h.suggestedFocus}</p>
                                </div>
                            )}
                                <div className="mt-3 pt-3 border-t border-white/8">
                                    <span
                                        onClick={() => toggleHotspotDetails(h.id)}
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
                                            <div id={`desktop-hotspot-details-${h.id}`} className="mt-4 space-y-4 animate-in fade-in duration-200">
                                                <p className="text-[0.5625rem] font-black text-white/30 uppercase tracking-[0.2em]">{getInterpretationLabel(h.confidence)}</p>
                                            <div>
                                                <p className="text-[0.5625rem] font-black text-white/55 uppercase tracking-[0.15em] mb-1.5">Summary</p>
                                                <p className="text-xs text-white/85 leading-relaxed">{interp.summary}</p>
                                            </div>
                                            <div>
                                                <p className="text-[0.5625rem] font-black text-white/55 uppercase tracking-[0.15em] mb-1.5">Why it stands out</p>
                                                <p className="text-xs text-white/85 leading-relaxed">{interp.reasoning}</p>
                                            </div>
                                            <div>
                                                <p className="text-[0.5625rem] font-black text-white/55 uppercase tracking-[0.15em] mb-1.5">How to approach it</p>
                                                <p className="text-xs text-white/85 leading-relaxed">{interp.strategy}</p>
                                            </div>
                                            {interp.soilNote && (
                                                <div className="border-t border-white/8 pt-3">
                                                    <p className="text-[0.5625rem] font-black text-sky-400/60 uppercase tracking-[0.15em] mb-1.5">Soil mechanics note</p>
                                                    <p className="text-xs text-sky-300/70 leading-relaxed italic">{interp.soilNote}</p>
                                                </div>
                                            )}
                                            <div className="border-t border-white/10 pt-3">
                                                <p className="text-[0.5rem] font-black text-white/45 uppercase tracking-[0.2em] mb-2">Signal breakdown</p>
                                                <div className="space-y-1.5">
                                                    {breakdown.map(({ label, val, cap }) => (
                                                        <div key={label} className="flex items-center gap-2">
                                                            <span className="text-[0.4375rem] text-white/55 w-16 flex-shrink-0">{label}</span>
                                                            <div className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden">
                                                                <div className="h-full bg-emerald-500/70 rounded-full" style={{ width: `${Math.min(100, (val / cap) * 100)}%` }} />
                                                            </div>
                                                            <span className="text-[0.4375rem] text-white/50 w-14 text-right flex-shrink-0">{getSignalBand(val, cap)}</span>
                                                        </div>
                                                    ))}
                                                    {h.metrics.penalty !== 0 && <p className="text-[0.4375rem] text-white/45 mt-1">Modern disturbance or noise was discounted before interpretation.</p>}
                                                </div>
                                            </div>
                                        </div>
                                    );
                                        })()}
                                    </div>
                                    <p className="text-center text-[0.4375rem] text-white/55 italic mt-3">Highlights historic activity — not guaranteed finds.</p>
                        </div>
                        );
                    })}
                </div>
            )}

            {/* Target Card Popup — desktop only */}
            {selectedId && !selectedHotspotId && (
                <div className="hidden absolute bottom-6 left-auto right-6 w-96 max-h-[80vh] overflow-y-auto scrollbar-hide animate-in slide-in-from-bottom-4 fade-in duration-200">
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
                            <div key={f.id} className={`${f.isProtected ? 'p-4' : 'p-4 lg:p-5'} rounded-2xl lg:rounded-3xl border bg-slate-900 shadow-2xl transition-all ${f.isProtected ? 'border-stone-700/50' : borderColour[tInterp.signalStrength]}`}>
                                <div className="mx-auto mb-3 h-1 w-6 rounded-full bg-white/15 lg:hidden" />
                                {f.isProtected ? (() => {
                                    const protectedCopy = getProtectedTargetCopy(f);
                                    return (
                                    <div className="space-y-3">
                                            <div className="flex items-start justify-between gap-3">
                                                <div className="min-w-0">
                                                    <p className="text-[0.5rem] font-black text-stone-400/70 uppercase tracking-[0.2em] mb-1">{protectedCopy.label}</p>
                                                    {f.aimInfo && <h3 className="text-sm font-black text-white/90 tracking-tight leading-tight">{f.aimInfo.type}</h3>}
                                                </div>
                                                <div className="flex items-center gap-2 shrink-0">
                                                    <button
                                                        type="button"
                                                        onClick={(e) => { e.stopPropagation(); toggleGeologyDetails(`target:${f.id}`); }}
                                                        className={`text-[0.5rem] font-black uppercase tracking-widest transition-colors ${expandedGeologyId === `target:${f.id}` ? 'text-emerald-300' : 'text-sky-300 hover:text-sky-200'}`}
                                                    >
                                                        Geology
                                                    </button>
                                                    <button onClick={(e) => { e.stopPropagation(); setSelectedId(null); }} className="bg-white/[0.04] hover:bg-white/[0.08] text-white/50 hover:text-white rounded-full p-1.5 transition-colors border border-white/10">
                                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                                                    </button>
                                                </div>
                                            </div>
                                        <div className="rounded-xl bg-stone-900/40 border border-stone-700/40 p-3 space-y-2">
                                            <p className="text-xs font-bold text-stone-200/85 leading-snug">{protectedCopy.body}</p>
                                            <p className="text-[0.6875rem] font-bold text-stone-300/60 leading-snug">{protectedCopy.detail}</p>
                                        </div>
                                            {f.aimInfo && (
                                                <div className="p-2 rounded-xl border bg-stone-900/30 border-stone-700/30">
                                                    <p className="text-[0.5625rem] font-black uppercase text-stone-400/60 leading-tight mb-0.5">Recorded designation</p>
                                                    <p className="text-[0.625rem] font-bold text-stone-200/70 leading-tight">{f.aimInfo.type} · {f.aimInfo.period}</p>
                                                </div>
                                            )}
                                        </div>
                                        );
                                    })() : (
                                    <>
                                        <div className="flex items-center justify-between gap-2 mb-3">
                                            {isPrimaryTarget && (
                                                <button
                                                type="button"
                                                onClick={(e) => { e.stopPropagation(); focusTarget(f); }}
                                                className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200/45 bg-[linear-gradient(135deg,rgba(6,78,59,0.92),rgba(15,118,110,0.72)_55%,rgba(245,158,11,0.34))] px-2.5 py-1 text-[0.4375rem] lg:text-[0.5rem] font-black uppercase tracking-widest text-emerald-50 shadow-[0_0_0_1px_rgba(16,185,129,0.15),0_8px_22px_rgba(0,0,0,0.26),inset_0_1px_0_rgba(255,255,255,0.22)] transition-transform active:scale-[0.98]"
                                            >
                                                    <span className="h-1.5 w-1.5 rounded-full bg-amber-300 shadow-[0_0_10px_rgba(251,191,36,0.9)]" />
                                                    Start Here
                                                </button>
                                            )}
                                            <div className="ml-auto flex items-center gap-2">
                                                <button
                                                    type="button"
                                                    onClick={(e) => { e.stopPropagation(); toggleGeologyDetails(`target:${f.id}`); }}
                                                    className={`text-[0.5rem] lg:text-[0.5625rem] font-black uppercase tracking-[0.2em] transition-colors ${expandedGeologyId === `target:${f.id}` ? 'text-emerald-300' : 'text-sky-300 hover:text-sky-200'}`}
                                                >
                                                    Geology
                                                </button>
                                                <p className="rounded-full border border-amber-300/25 bg-amber-300/8 px-2 py-0.5 text-[0.5rem] lg:text-[0.5625rem] font-black text-amber-100/85 uppercase tracking-[0.16em] shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">Target {f.number.toString().padStart(2, '0')}</p>
                                            </div>
                                        </div>
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
                                        <p className="text-xs lg:text-sm font-black text-white/85 leading-snug mb-0.5">{getTargetVerdict(tInterp.signalStrength, isPrimaryTarget)}</p>
                                        <p className="text-[0.6875rem] font-bold text-white/50 leading-snug mb-3">{tInterp.hook}</p>
                                                {(() => {
                                                    const ctx = targetFindContext.get(f.id);
                                                if (!ctx) return null;
                                                    return ctx.status === 'within'
                                                        ? <p className="text-[0.5625rem] font-black text-emerald-400/80 uppercase tracking-widest mb-2">{ctx.count} find{ctx.count !== 1 ? 's' : ''} recorded here — signal supported</p>
                                                        : <p className="text-[0.5625rem] font-black text-emerald-400/80 uppercase tracking-widest mb-2">{ctx.count} find{ctx.count !== 1 ? 's' : ''} recorded nearby</p>;
                                                })()}
                                                {f.isHighConfidenceCrossing && (
                                                <div className="bg-blue-600/30 p-2 rounded-xl lg:rounded-2xl border border-blue-400/70 mb-3 animate-pulse">
                                                    <p className="m-0 text-[0.625rem] lg:text-xs font-black uppercase text-white text-center tracking-[0.18em]">Likely historic crossing point</p>
                                            </div>
                                        )}
                                        {(() => {
                                            const EDGE_PX = 768 * 0.1;
                                            const cxPx = (f.minX + f.maxX) / 2;
                                            const cyPx = (f.minY + f.maxY) / 2;
                                            const isEdge = cxPx < EDGE_PX || cyPx < EDGE_PX || cxPx > 768 - EDGE_PX || cyPx > 768 - EDGE_PX;
                                            return isEdge ? (
                                                <div className="bg-amber-500/10 p-2 rounded-xl border border-amber-400/25 mb-3">
                                                    <p className="text-[0.5625rem] font-black uppercase text-amber-300/80 tracking-widest">Near scan edge — wider scan may improve confidence</p>
                                                </div>
                                            ) : null;
                                        })()}
                                        <div className="border-t border-white/8 pt-3 mb-3">
                                            <p className="text-[0.5625rem] font-black text-white/60 uppercase tracking-widest mb-2.5">Why this matters</p>
                                            {f.explanationLines && f.explanationLines.length > 0 ? (
                                                <div className="space-y-2">
                                                    {f.explanationLines.slice(0, 3).map((line, idx) => (
                                                        <div key={idx} className="flex items-start gap-3">
                                                            <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 mt-1 shadow-[0_0_8px_rgba(52,211,153,0.8)]" />
                                                            <p className="text-xs lg:text-[0.8125rem] font-bold text-white leading-tight flex-1">{line}</p>
                                                        </div>
                                                    ))}
                                                </div>
                                            ) : (
                                                <p className="text-xs text-white/50 leading-tight">Signal detected across available scan sources.</p>
                                            )}
                                            {f.disturbanceRisk && f.disturbanceRisk !== 'Low' && (
                                                <div className={`mt-3 p-2 rounded-xl border ${f.disturbanceRisk === 'High' ? 'bg-red-500/20 border-red-400/50' : 'bg-amber-500/20 border-amber-400/50'}`}>
                                                    <p className={`text-[0.5625rem] font-black uppercase leading-tight mb-0.5 ${f.disturbanceRisk === 'High' ? 'text-red-300' : 'text-amber-300'}`}>Disturbance risk: {f.disturbanceRisk}</p>
                                                    <p className="text-[0.625rem] font-bold text-white/80 leading-tight">{f.disturbanceReason}</p>
                                                </div>
                                            )}
                                            {f.aimInfo && (
                                                <div className="mt-2 p-2 rounded-xl border bg-amber-500/10 border-amber-400/30">
                                                    <p className="text-[0.5625rem] font-black uppercase text-amber-300 leading-tight mb-0.5">Historic verification</p>
                                                    <p className="text-[0.625rem] font-bold text-white/80 leading-tight">{f.aimInfo.type} ({f.aimInfo.period})</p>
                                                </div>
                                            )}
                                            {f.routeAssessment?.relationship === 'route_edge_activity_candidate' && (
                                                <div className="mt-2 p-2 rounded-xl border bg-sky-500/10 border-sky-400/30">
                                                    <p className="text-[0.5625rem] font-black uppercase text-sky-300 leading-tight mb-0.5">Route-Edge Signal</p>
                                                    <p className="text-[0.625rem] font-bold text-white/80 leading-tight">This signal sits beside, not on, a mapped route. It may reflect older movement or route-edge activity.</p>
                                                </div>
                                            )}
                                            {f.routeAssessment?.relationship === 'historic_movement_candidate' && (
                                                <div className="mt-2 p-2 rounded-xl border bg-amber-500/10 border-amber-400/30">
                                                    <p className="text-[0.5625rem] font-black uppercase text-amber-300 leading-tight mb-0.5">Movement Corridor</p>
                                                    <p className="text-[0.625rem] font-bold text-white/80 leading-tight">Multiple signals suggest this may relate to an older movement corridor rather than a modern track.</p>
                                                </div>
                                            )}
                                            {f.routeAssessment?.relationship === 'possible_modern_route_noise' && (
                                                <div className="mt-2 p-2 rounded-xl border bg-amber-500/15 border-amber-400/40">
                                                    <p className="text-[0.5625rem] font-black uppercase text-amber-300 leading-tight mb-0.5">Proximity Caution</p>
                                                    <p className="text-[0.625rem] font-bold text-white/80 leading-tight">This signal lies close to a mapped modern track or road edge. Treat with additional caution.</p>
                                                </div>
                                            )}
                                        </div>
                                        <div className="mt-3 pt-3 border-t border-emerald-500/15">
                                            <p className="text-[0.5625rem] font-black text-emerald-500/70 uppercase tracking-[0.12em] mb-1">Target focus</p>
                                            <p className="text-xs font-bold text-emerald-300 leading-snug">{tInterp.focus}</p>
                                        </div>
                                            <div className="mt-3 pt-3 border-t border-white/8">
                                                <span
                                                    onClick={() => toggleTargetDetails(f.id)}
                                                    className="text-xs font-black text-amber-400 hover:text-amber-300 transition-colors duration-150 cursor-pointer flex items-center gap-1"
                                                >
                                                    {expandedTargetId === f.id ? '▲ Hide reasoning' : '▼ See full reasoning'}
                                                </span>
                                                {expandedTargetId === f.id && (
                                                    <div id={`desktop-target-details-${f.id}`} className="mt-4 space-y-4 animate-in fade-in duration-200">
                                                        <div>
                                                        <p className="text-[0.5rem] font-black text-white/55 uppercase tracking-[0.15em] mb-1.5">Summary</p>
                                                        <p className="text-[0.6875rem] text-white/85 leading-relaxed">{tInterp.summary}</p>
                                                    </div>
                                                    <div>
                                                        <p className="text-[0.5rem] font-black text-white/55 uppercase tracking-[0.15em] mb-1.5">Why it stands out</p>
                                                        <p className="text-[0.6875rem] text-white/85 leading-relaxed">{tInterp.whyItStandsOut}</p>
                                                    </div>
                                                    <div>
                                                        <p className="text-[0.5rem] font-black text-white/55 uppercase tracking-[0.15em] mb-1.5">How to approach it</p>
                                                        <p className="text-[0.6875rem] text-white/85 leading-relaxed">{tInterp.howToApproach}</p>
                                                    </div>
                                                </div>
                                                    )}
                                                </div>
                                            </>
                                    <p className="text-center text-[0.4375rem] text-white/55 italic mt-3">Highlights historic activity — not guaranteed finds.</p>
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
                        className="hidden absolute top-14 left-4 z-[90] bg-slate-900/90 px-3 py-1.5 rounded-xl border border-blue-500/30 shadow-lg items-center gap-2 active:scale-95 transition-all"
                    >
                        <div className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse shrink-0" />
                        <span className="text-[0.625rem] font-black text-blue-400 uppercase tracking-[0.2em]">
                            {loadingPAS ? 'Reading layers...' : 'Landscape'}
                        </span>
                        {!loadingPAS && (() => {
                            const c = mapRef.current?.getCenter();
                            const n = c ? projectFinds.filter(f => f.lat !== null && f.lon !== null && getDistance([f.lon!, f.lat!], [c.lng, c.lat]) <= 500).length : 0;
                            return n > 0 ? <span className="text-[0.5625rem] font-black text-emerald-400/80 uppercase tracking-widest">{n} find{n !== 1 ? 's' : ''}</span> : null;
                        })()}
                    </button>
            )}

            {/* Mobile Landscape Context Panel */}
            {isIntelOpen && (() => {
                return (
                <>
                <div className="hidden absolute inset-0 z-[104]" onClick={() => setIsIntelOpen(false)} />
                <div className="hidden absolute bottom-6 right-6 w-96 z-[105] animate-in slide-in-from-bottom-4 fade-in duration-200">
                <div className="bg-slate-900 border-2 border-amber-500/40 shadow-[0_0_40px_rgba(245,158,11,0.15)] rounded-3xl overflow-hidden">

                    <div className="flex justify-between items-start px-5 pt-4 pb-0">
                        <p className="text-[0.5625rem] font-black text-blue-400 uppercase tracking-[0.2em]">Landscape Context</p>
                        <div className="flex items-center gap-2 -mt-1 -mr-1">
                            {devMode && sourceAvailability && (
                                <button onClick={handleLabExport} className="text-[0.5rem] font-black text-amber-400 hover:text-amber-300 uppercase tracking-widest transition-colors px-2 py-1 border border-amber-500/30 rounded-lg bg-amber-500/10 hover:bg-amber-500/20">
                                    ↓ Export for Lab
                                </button>
                            )}
                            <button onClick={() => setIsIntelOpen(false)} className="text-white/30 hover:text-white/60 transition-colors p-1">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
                            </button>
                        </div>
                    </div>

                    <div className="overflow-y-auto max-h-[52vh] px-5 pb-5 pt-2 space-y-3">
                            <h3 className="text-base font-black text-white tracking-tight leading-tight mb-1">{interp.title}</h3>
                            <p className="text-[0.6875rem] font-bold text-white/70 leading-snug mb-3">{interp.subtitle}</p>
                            <GeologyContextCard context={geologyContext} loading={geologyContextLoading} className="mb-3" />
                            {sigLines.length > 0 && (
                                <div className="border-t border-white/8 pt-3 mb-3">
                                <p className="text-[0.5rem] font-medium text-white/40 mb-2.5">Why this stands out</p>
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
                        {nearbyProjectFinds.length > 0 && (
                            <p className="text-[0.5625rem] font-black text-emerald-400/80 uppercase tracking-widest">{nearbyProjectFinds.length} find{nearbyProjectFinds.length !== 1 ? 's' : ''} recorded nearby</p>
                        )}
                        {hasData && (
                            <>
                            <div className="flex gap-2 mt-3">
                                {pasFinds.length > 0 && (
                                    <div className="flex-1 bg-blue-500/10 border border-blue-500/20 rounded-2xl p-3 text-center">
                                        <span className="block text-lg font-black text-blue-400">{pasFinds.length}</span>
                                        <span className="text-[0.5rem] font-black text-slate-500 uppercase tracking-widest">Sites</span>
                                    </div>
                                )}
                                {historicRoutes.length > 0 && (
                                    <div className="flex-1 bg-blue-500/10 border border-blue-500/20 rounded-2xl p-3 text-center">
                                        <span className="block text-lg font-black text-blue-400">{historicRoutes.length}</span>
                                        <span className="text-[0.5rem] font-black text-slate-500 uppercase tracking-widest">Routes</span>
                                    </div>
                                )}
                                {placeSignals.length > 0 && (
                                    <div className="flex-1 bg-blue-500/10 border border-blue-500/20 rounded-2xl p-3 text-center">
                                        <span className="block text-lg font-black text-blue-300">{placeSignals.length}</span>
                                        <span className="text-[0.5rem] font-black text-slate-500 uppercase tracking-widest">Place Names</span>
                                    </div>
                                )}
                            </div>
                            <p className="text-[0.5625rem] font-black text-white/60 italic mt-2 text-center tracking-wide">Zoom out to understand wider context</p>
                            </>
                        )}
                        {sourceAvailability && (
                            <div className="border-t border-white/8 pt-3">
                                <div className="flex justify-between items-center mb-2">
                                    <p className="text-[0.5rem] font-black text-white/40 uppercase tracking-widest">Scan Source Coverage</p>
                                    {scanFromCache && <span className="text-[0.4375rem] font-black text-amber-500/60 uppercase tracking-widest bg-amber-500/10 border border-amber-500/20 px-1.5 py-0.5 rounded">Cached</span>}
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
                                                <span className={`text-[0.4375rem] font-black uppercase tracking-wide leading-tight ${usability === 'usable' ? 'text-emerald-300' : usability === 'loaded' ? 'text-slate-400' : 'text-slate-600'}`}>{label}</span>
                                            </div>
                                        );
                                    })}
                                </div>
                                <p className="text-[0.4375rem] text-white/20 mt-1.5 text-center italic">Green = source loaded · Dark = unavailable for this scan</p>
                            </div>
                        )}
                        {(hasData || potentialScore) && (
                            <div className="mt-4 pt-3 border-t border-white/8">
                                <div className="flex justify-between items-center">
                                    <span
                                        onClick={() => setIntelDetailsOpen(v => !v)}
                                        className="text-[0.6875rem] font-black text-amber-400 hover:text-amber-300 transition-colors duration-150 cursor-pointer"
                                    >
                                        {intelDetailsOpen ? '▲ Hide details' : '▼ View full breakdown'}
                                    </span>
                                    <span
                                        onClick={() => setIntelLayersOpen(v => !v)}
                                        className="text-[0.6875rem] font-black text-amber-400 hover:text-amber-300 transition-colors duration-150 cursor-pointer"
                                    >
                                        {intelLayersOpen ? '▲ Hide layers' : '▼ Map layers'}
                                    </span>
                                </div>

                                {intelLayersOpen && (
                                    <div className="mt-3 flex flex-wrap gap-2 animate-in fade-in duration-200">
                                        {HISTORIC_LAYER_OPTIONS.map(({ key, label }) => (
                                            <button key={key} onClick={() => setHistoricLayerVisibility(p => ({ ...p, [key]: !p[key as keyof typeof p] }))} className={`px-3 py-1.5 rounded-xl border text-[0.5625rem] font-black uppercase tracking-wider transition-all active:scale-95 ${historicLayerVisibility[key as keyof typeof historicLayerVisibility] ? 'bg-blue-500/20 border-blue-500/50 text-blue-300' : 'bg-white/5 border-white/10 text-slate-500'}`}>
                                                {label}
                                            </button>
                                        ))}
                                    </div>
                                )}

                                {intelDetailsOpen && (
                                    <div className="mt-4 space-y-4 animate-in fade-in duration-200">
                                        {pasFinds.length > 0 && (
                                            <div className="space-y-2">
                                                <p className="text-[0.5rem] font-black text-blue-400/60 uppercase tracking-widest">Historic Period Profile</p>
                                                <div className="grid grid-cols-2 gap-2">
                                                    {Object.entries(pasFinds.reduce((acc, f) => { const p = f.broadperiod || 'Unknown'; acc[p] = (acc[p] || 0) + 1; return acc; }, {} as Record<string, number>)).sort((a, b) => b[1] - a[1]).map(([period, count]) => (
                                                        <div key={period} className="bg-blue-500/5 border border-blue-500/10 p-3 rounded-2xl flex justify-between items-center">
                                                            <span className="text-[0.5625rem] font-black text-slate-300 uppercase truncate pr-2">{period}</span>
                                                            <span className="text-sm font-black text-blue-400">{count}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                        {nearbyProjectFinds.length > 0 && (
                                            <div className="space-y-2">
                                                <p className="text-[0.5rem] font-black text-emerald-400/60 uppercase tracking-widest">Your Recorded Finds</p>
                                                <div className="space-y-1.5">
                                                    {nearbyProjectFinds.map(f => (
                                                        <div key={f.id} className="bg-emerald-500/5 border border-emerald-500/10 px-3 py-2 rounded-xl flex justify-between items-center">
                                                            <span className="text-[0.625rem] font-black text-white uppercase truncate pr-3">{f.objectType || 'Unknown'}</span>
                                                            <span className="text-[0.5625rem] font-bold text-emerald-400/70 uppercase shrink-0">{f.period}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                        {pasFinds.length > 0 && (
                                            <div className="space-y-2">
                                                <p className="text-[0.5rem] font-black text-blue-400/60 uppercase tracking-widest">Historic Findings</p>
                                                <div className="space-y-2">
                                                    {pasFinds.map(f => (
                                                        <div key={f.id} onClick={() => { clearMapItemSelections('pasFind'); setSelectedPASFind(f); setIsIntelOpen(false); mapRef.current?.flyTo({ center: [f.lon, f.lat], zoom: 17 }); }} className="bg-blue-500/5 p-4 rounded-2xl border border-blue-500/10 flex justify-between items-center active:bg-blue-500/20 transition-all">
                                                            <div className="flex-1 min-w-0 pr-4">
                                                                <p className="text-xs font-black text-white uppercase truncate">{f.objectType}</p>
                                                                <p className="text-[0.5625rem] font-bold text-blue-400 uppercase">{f.broadperiod}</p>
                                                            </div>
                                                            <div className="text-right shrink-0">
                                                                <p className="text-[0.5625rem] font-black text-slate-500 font-mono tracking-tighter mb-0.5">{f.id}</p>
                                                                <p className="text-[0.5rem] font-bold text-slate-400 uppercase italic leading-none">{f.county}</p>
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                        {placeSignals.length > 0 && (
                                            <div className="space-y-2">
                                                <p className="text-[0.5rem] font-black text-emerald-500/60 uppercase tracking-widest">Etymological Signals</p>
                                                <p className="text-[0.5625rem] text-slate-500 font-bold">Place-name evidence suggests historic activity in the wider area.</p>
                                                <div className="space-y-2">
                                                    {placeSignals.map((s, i) => (
                                                        <div key={i} className="bg-emerald-500/5 border border-emerald-500/10 p-4 rounded-2xl relative overflow-hidden">
                                                            <div className="absolute top-0 right-0 px-2 py-0.5 bg-emerald-500/10 border-b border-l border-emerald-500/20 text-[0.4375rem] font-black text-emerald-400 uppercase tracking-tighter">Signal Detected</div>
                                                            <div className="flex justify-between items-start mb-1">
                                                                <span className="text-sm font-black text-white uppercase italic tracking-tight">"{s.name}"</span>
                                                                <span className="text-[0.5625rem] font-bold text-emerald-500/60 uppercase">{s.distance.toFixed(1)} km</span>
                                                            </div>
                                                            <p className="text-[0.5rem] font-black text-emerald-500/40 uppercase mb-2 tracking-widest">{s.type}</p>
                                                            <p className="text-[0.625rem] font-bold text-slate-300 leading-tight"><span className="text-emerald-500/80 uppercase text-[0.5625rem]">Meaning:</span> {s.meaning}</p>
                                                            <div className="mt-2.5 flex items-center justify-between border-t border-white/5 pt-2">
                                                                <span className="text-[0.5rem] font-black text-slate-400 uppercase tracking-widest bg-white/5 px-1.5 py-0.5 rounded">{s.period}</span>
                                                                <div className="flex items-center gap-1.5">
                                                                    <div className="w-10 h-1 bg-black/40 rounded-full overflow-hidden"><div className="h-full bg-emerald-500" style={{ width: `${s.confidence * 100}%` }} /></div>
                                                                    <span className="text-[0.4375rem] font-black text-emerald-500/60">{(s.confidence * 100).toFixed(0)}%</span>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                        {potentialScore && (
                                            <div className="space-y-2">
                                                <p className="text-[0.5rem] font-black text-slate-500 uppercase tracking-widest">Detailed Breakdown</p>
                                                <div className="grid grid-cols-2 gap-3">
                                                    <div className="bg-white/5 p-4 rounded-3xl border border-white/10 relative">
                                                        {scanConfidence && (
                                                            <span className={`absolute top-2 right-2 text-[0.375rem] font-black px-1 rounded border ${scanConfidence === 'Corroborated Signal' ? 'text-emerald-400 border-emerald-400/30' : scanConfidence === 'Developing Signal' ? 'text-amber-400 border-amber-400/30' : 'text-white/35 border-white/20'}`}>{scanConfidence}</span>
                                                        )}
                                                        <span className="block text-[0.5rem] font-black text-slate-500 uppercase tracking-widest mb-1">Terrain Relief</span>
                                                        <div className="h-1 bg-slate-800 rounded-full overflow-hidden my-1.5"><div className="h-full bg-emerald-500" style={{ width: `${potentialScore.breakdown?.terrain || 0}%` }} /></div>
                                                        <span className="text-sm font-black text-emerald-500">{getSignalBand(potentialScore.breakdown?.terrain)}</span>
                                                    </div>
                                                    <div className="bg-white/5 p-4 rounded-3xl border border-white/10">
                                                        <span className="block text-[0.5rem] font-black text-slate-500 uppercase tracking-widest mb-1">Hydro Context</span>
                                                        <div className="h-1 bg-slate-800 rounded-full overflow-hidden my-1.5"><div className="h-full bg-blue-500" style={{ width: `${potentialScore.breakdown?.hydro || 0}%` }} /></div>
                                                        <span className="text-sm font-black text-blue-500">{getSignalBand(potentialScore.breakdown?.hydro)}</span>
                                                    </div>
                                                    <div className="bg-white/5 p-4 rounded-3xl border border-white/10">
                                                        <span className="block text-[0.5rem] font-black text-slate-500 uppercase tracking-widest mb-1">Historic Density</span>
                                                        <div className="h-1 bg-slate-800 rounded-full overflow-hidden my-1.5"><div className="h-full bg-amber-500" style={{ width: `${potentialScore.breakdown?.historic || 0}%` }} /></div>
                                                        <span className="text-sm font-black text-amber-500">{getSignalBand(potentialScore.breakdown?.historic)}</span>
                                                    </div>
                                                    <div className="bg-white/5 p-4 rounded-3xl border border-white/10">
                                                        <span className="block text-[0.5rem] font-black text-slate-500 uppercase tracking-widest mb-1">Spectral Signals</span>
                                                        <div className="h-1 bg-slate-800 rounded-full overflow-hidden my-1.5"><div className="h-full bg-purple-500" style={{ width: `${potentialScore.breakdown?.signals || 0}%` }} /></div>
                                                        <span className="text-sm font-black text-purple-500">{getSignalBand(potentialScore.breakdown?.signals)}</span>
                                                    </div>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}

                                {devMode && sourceAvailability && sortedHotspots.length > 0 && (
                                    <div className="pt-2 border-t border-white/8 flex flex-col gap-1">
                                        <button
                                            onClick={handleLabExport}
                                            className="w-full text-center text-[0.5625rem] font-black text-amber-600/70 hover:text-amber-400 uppercase tracking-widest transition-colors py-1"
                                        >
                                            ↓ Export for Lab
                                        </button>
                                        <button
                                            onClick={() => {
                                                const mc2  = mapRef.current?.getCenter();
                                                const mb  = mapRef.current?.getBounds();
                                                const payload = {
                                                    exportedAt:        new Date().toISOString(),
                                                    engineVersion:     'FG-2026.05.20b',
                                                    fromCache:         scanFromCache,
                                                    scanCenter:        terrainScanCenterRef.current ?? (mc2 ? { lat: mc2.lat, lng: mc2.lng } : null),
                                                    scanStartBounds:   terrainScanBoundsRef.current,
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
                                            className="w-full text-center text-[0.5625rem] font-black text-slate-500 hover:text-slate-300 uppercase tracking-widest transition-colors py-1"
                                        >
                                            ↓ Export scan data
                                        </button>
                                    </div>
                                )}

                                <p className="text-[0.4375rem] text-white/15 text-center italic pt-2">Signal agreement, not direct detection</p>
                            </div>
                        )}
                    </div>
                </div>
                </div>
                </>
                );
            })()}
        </div>
    );
}
