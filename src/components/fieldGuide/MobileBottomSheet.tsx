import React from 'react';
import maplibregl from 'maplibre-gl';
import { buildInterpretation, getInterpretationLabel, getHotspotSignalStrength, getSignalTypeSummary } from '../../engines/hotspot/hotspotInterpreter';
import { buildTargetInterpretation, getTargetVerdict } from '../../engines/hotspot/targetInterpreter';
import type { TargetSignalStrength } from '../../engines/hotspot/targetInterpreter';
import type { HotspotSignalStrength } from '../../engines/hotspot/hotspotInterpreter';
import type { Cluster, Hotspot, HotspotClassification, LandscapeIntelligence } from '../../pages/fieldGuideTypes';
import { ScaledImage } from '../ScaledImage';
import { FIELDGUIDE_SHORT_NOTICE } from '../../utils/legalCopy';
import { useFieldGuideContext } from './FieldGuideContext';
import { HOTSPOT_TITLES, HISTORIC_LAYER_OPTIONS } from './FieldGuideContext';
import { ScanControlPanel } from './ScanControlPanel';
import { SavedPointsPanel } from './SavedPointsPanel';
import { HotspotTray } from './HotspotTray';
import { HistoricLayerManager } from './HistoricLayerManager';
import { GeologyContextCard } from './GeologyContextCard';
import { SMUnavailableBanner } from './SMUnavailableBanner';
import { buildHotspotFindFeedback, buildFindHotspotAnnotation } from '../../services/findHotspotService';
import { usePersistedHotspotSignals } from '../../hooks/usePersistedHotspotSignals';

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

function LandscapeInterpretationPanel({
    isOpen,
    onToggle,
    narrative,
    chips = [],
}: {
    isOpen: boolean;
    onToggle: () => void;
    narrative: string;
    chips?: string[];
}) {
    return (
        <div className="rounded-xl border border-sky-400/20 bg-sky-500/[0.06] overflow-hidden">
            <button
                type="button"
                onClick={onToggle}
                className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left"
            >
                <span className="text-[0.625rem] font-black text-sky-400/75 uppercase tracking-[0.16em]">Terrain Reading</span>
                <svg
                    width="10"
                    height="10"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeLinecap="round"
                    className={`text-sky-400/50 shrink-0 transition-transform duration-150 ${isOpen ? 'rotate-180' : ''}`}
                >
                    <polyline points="6 9 12 15 18 9" />
                </svg>
            </button>
            {isOpen && (
                <div className={`px-3 pb-3 animate-in fade-in duration-150 ${chips.length ? 'space-y-2' : ''}`}>
                    {chips.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                            {chips.map(chip => (
                                <span key={chip} className="text-[0.625rem] font-bold text-sky-200/75 bg-sky-400/10 border border-sky-400/20 px-1.5 py-0.5 rounded">
                                    {chip}
                                </span>
                            ))}
                        </div>
                    )}
                    <p className="text-xs font-bold text-sky-100/82 leading-relaxed">{narrative}</p>
                </div>
            )}
        </div>
    );
}

function getLandscapeChips(li: LandscapeIntelligence): string[] {
    const chips = [
        li.landformType,
        li.crossingType,
        li.transitionType,
        li.wetlandContext,
        li.visibilityContext,
        li.occupationPotential,
    ];
    return chips.flatMap(chip => chip ? [chip] : []);
}

export function MobileBottomSheet() {
    const {
        isIntelOpen,
        historicMode,
        selectedMonument,
        selectedUserFind,
        selectedPASFind,
        selectedId,
        selectedHotspotId,
        sheetExpanded,
        helperActive,
        helperTipIndex,
        persistSheetExpanded,
        handleSheetTouchStart,
        handleSheetTouchEnd,
        analyzing,
        isTerrainScanning,
        loadingPAS,
        scanStatus,
        hasScanned,
        terrainScanComplete,
        historicScanComplete,
        mobileSheetMode,
        showSavedPoints,
        savedPoints,
        showSavedPoints: _showSavedPoints,
        selectedTarget,
        sortedHotspots,
        displayTargets,
        scanNoSignal,
        showFields,
        fields,
        realPermissions,
        setShowFieldsPicker,
        setShowLayerPicker,
        sheetScrollRef,
        setSelectedMonument,
        setSelectedId,
        setSelectedHotspotId,
        setSelectedPASFind,
        setSelectedUserFind,
        selectedUserFindMedia,
        expandedInterpretationId,
        setExpandedInterpretationId,
        expandedTargetId,
        setExpandedTargetId,
        hotspots,
        targetFindContext,
        primaryTargetId,
        focusTarget,
        clearMapItemSelections,
        mapRef,
        pasFinds,
        historicRoutes,
        placeSignals,
        potentialScore,
        scanConfidence,
        sourceAvailability,
        sourceUsability,
        scanFromCache,
        scheduledMonumentCheckFailed,
        scheduledMonumentUnavailableReason,
        projectFinds,
        setIsIntelOpen,
        intelDetailsOpen,
        setIntelDetailsOpen,
        intelLayersOpen,
        setIntelLayersOpen,
        historicLayerVisibility,
        setHistoricLayerVisibility,
        geologyContext,
        geologyContextLoading,
        landscapeIntelligenceMap,
    } = useFieldGuideContext();
    const [expandedGeologyId,       setExpandedGeologyId]       = React.useState<string | null>(null);
    const [expandedLandscapeHotspot, setExpandedLandscapeHotspot] = React.useState<string | null>(null);
    const persistedSignals = usePersistedHotspotSignals(hotspots);

    if (!(!isIntelOpen || historicMode || selectedMonument !== undefined || !!selectedUserFind || !!selectedPASFind || (!!selectedId && !selectedHotspotId))) {
        return null;
    }

    const sheetHeaderExpanded = sheetExpanded && selectedMonument === undefined && !selectedUserFind && !selectedPASFind && hasScanned && (sortedHotspots.length > 0 || displayTargets.length > 0);

    // Compute header title
    const headerTitle = analyzing || isTerrainScanning || loadingPAS
        ? (scanStatus || 'Reading landscape signals')
        : selectedUserFind ? 'Your Find'
        : selectedPASFind ? 'Heritage Feature'
        : (selectedId && !selectedHotspotId) ? (selectedTarget?.isProtected ? getProtectedTargetCopy(selectedTarget).label : 'Target Details')
        : selectedHotspotId ? 'Hotspot Details'
        : selectedMonument !== undefined ? 'Scheduled Monument'
        : showSavedPoints ? 'Saved Points'
        : historicMode ? 'Landscape Review'
        : hasScanned ? (mobileSheetMode === 'targets' ? 'Target Review' : 'Terrain Review')
        : 'Ready to Scan';

    const headerSub = analyzing || isTerrainScanning || loadingPAS
        ? 'Reading scan data'
        : selectedUserFind ? 'Tap × to dismiss'
        : selectedPASFind ? 'Heritage record'
        : (selectedId && !selectedHotspotId) ? (selectedTarget?.isProtected ? (selectedTarget.monumentBufferM ? '20 m safety buffer' : 'Legal protection applies') : 'Signal analysis')
        : selectedHotspotId ? 'Signal analysis'
        : selectedMonument !== undefined ? 'Legal protection applies'
        : showSavedPoints ? (savedPoints.length > 0 ? `${savedPoints.length} point${savedPoints.length !== 1 ? 's' : ''} saved` : 'No saved points yet')
        : historicMode ? 'Tap panel for historic details'
        : hasScanned && sortedHotspots.length === 0 && displayTargets.length === 0 ? (scanNoSignal ? 'No signal — tap for details' : 'Quiet spot - tap for scan notes')
        : hasScanned ? (mobileSheetMode === 'targets' ? 'Tap panel for investigation targets' : 'Tap panel to review hotspots')
        : 'Move the map, then run a scan';

    const subIsHighlighted = !analyzing && !isTerrainScanning && !loadingPAS && !selectedUserFind && !selectedPASFind && !(selectedId && !selectedHotspotId) && selectedMonument === undefined && (historicMode || (hasScanned && !(sortedHotspots.length === 0 && displayTargets.length === 0)));

    const showStatusDot = selectedMonument === undefined && !analyzing && !isTerrainScanning && !loadingPAS && ((historicMode && historicScanComplete) || (!historicMode && hasScanned && mobileSheetMode === 'hotspots' && terrainScanComplete));

    const myFieldsLabel = showFields !== false && showFields !== 'all'
        ? showFields.startsWith('field:')
            ? (fields.find(f => f.id === (showFields as string).slice(6))?.name?.split(' ')[0] ?? 'My Fields')
            : (realPermissions.find(p => p.id === showFields)?.name?.split(' ')[0] ?? 'My Fields')
        : 'My Fields';
    const scrollExpandedSectionIntoView = (id: string) => {
        window.setTimeout(() => {
            document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }, 0);
    };
    const toggleGeologyDetails = (key: string) => {
        const opening = expandedGeologyId !== key;
        setExpandedGeologyId(opening ? key : null);
        if (opening) persistSheetExpanded(false);
    };
    const toggleHotspotDetails = (id: string) => {
        const opening = expandedInterpretationId !== id;
        setExpandedInterpretationId(opening ? id : null);
        if (opening) scrollExpandedSectionIntoView(`mobile-hotspot-details-${id}`);
    };
    const toggleTargetDetails = (id: string) => {
        const opening = expandedTargetId !== id;
        setExpandedTargetId(opening ? id : null);
        if (opening) scrollExpandedSectionIntoView(`mobile-target-details-${id}`);
    };
    const neutralMobileGeologyAvailable =
        !historicMode &&
        !selectedUserFind &&
        !selectedPASFind &&
        selectedMonument === undefined &&
        !showSavedPoints &&
        !selectedId &&
        !selectedHotspotId &&
        (hasScanned || geologyContext || geologyContextLoading);
    const activeMobileGeologyTitle =
        neutralMobileGeologyAvailable && expandedGeologyId === 'scan' ? 'Scan Geology'
        : historicMode && expandedGeologyId === 'historic' ? 'Historic Geology'
        : selectedHotspotId && expandedGeologyId === `hotspot:${selectedHotspotId}` ? 'Hotspot Geology'
        : selectedId && expandedGeologyId === `target:${selectedId}` ? 'Target Geology'
        : null;

    return (
        <>
        <div
            className={`absolute bottom-3 left-3 right-3 z-[85] flex flex-col bg-black/95 border border-white/12 rounded-2xl shadow-2xl backdrop-blur-xl overflow-hidden transition-[max-height] duration-300 ease-out ${sheetExpanded ? 'max-h-[65vh]' : 'max-h-[136px]'} ${helperActive && helperTipIndex === 1 ? 'ring-2 ring-blue-300/45' : ''}`}
        >
            {/* Handle + Status + Actions — always visible */}
            <div
                className={`shrink-0 px-4 pt-2 pb-3 border-b border-white/5 cursor-pointer select-none flex flex-col gap-2.5 transition-[height] duration-300 ${sheetHeaderExpanded ? 'h-auto' : 'h-[136px]'}`}
                onClick={() => persistSheetExpanded(!sheetExpanded)}
                onTouchStart={handleSheetTouchStart}
                onTouchEnd={handleSheetTouchEnd}
            >
                <div className="mx-auto h-1 w-8 rounded-full bg-white/20" />
                <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                            <p className="text-[0.9375rem] font-black text-white leading-tight truncate">
                                {headerTitle}
                            </p>
                            {showStatusDot && (
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-300 shadow-[0_0_6px_rgba(52,211,153,0.8)] shrink-0" />
                            )}
                        </div>
                        <p className={`text-[0.625rem] font-bold leading-tight truncate ${subIsHighlighted ? 'text-amber-400' : 'text-white/35'}`}>
                            {headerSub}
                        </p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0 pt-0.5">
                        <button
                            onClick={e => { e.stopPropagation(); setShowFieldsPicker(v => !v); setShowLayerPicker(false); }}
                            className={`px-2 py-1.5 rounded-lg border text-[0.5rem] font-black uppercase tracking-[0.14em] transition-colors ${showFields !== false ? 'bg-emerald-500/15 border-emerald-400/30 text-emerald-300' : 'bg-white/[0.04] border-white/10 text-emerald-400'}`}
                        >
                            {myFieldsLabel}
                        </button>
                        <div className="w-7 h-7 rounded-lg border border-white/10 bg-white/[0.04] grid place-items-center">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" className={`text-white/45 transition-transform duration-300 ${sheetExpanded ? 'rotate-180' : ''}`}><polyline points="6 9 12 15 18 9"/></svg>
                        </div>
                    </div>
                </div>
                <ScanControlPanel />
            </div>

            {/* Scrollable content */}
            <div ref={sheetScrollRef} className="flex-1 overflow-y-auto scrollbar-hide px-3 py-3 space-y-4">

                <SavedPointsPanel />

                <div id="mobile-landscape-read" className="-mt-1" />

                {!showSavedPoints && !selectedUserFind && !selectedPASFind && !selectedId && !selectedHotspotId && selectedMonument === undefined && (
                    historicScanComplete ? (
                        <div className="space-y-2" onClick={e => e.stopPropagation()}>
                            <div className="grid grid-cols-2 gap-2">
                                {historicMode ? (
                                    <button
                                        type="button"
                                        onClick={(e) => { e.stopPropagation(); toggleGeologyDetails('historic'); }}
                                        className={`rounded-xl border px-3 py-2 text-[0.625rem] font-black uppercase tracking-widest transition-colors ${expandedGeologyId === 'historic' ? 'bg-emerald-500/20 border-emerald-400/40 text-emerald-200' : 'bg-white/[0.04] border-sky-400/20 text-sky-300'}`}
                                    >
                                        Geology
                                    </button>
                                ) : (
                                    <div aria-hidden="true" />
                                )}
                                <button
                                    onClick={() => setIntelLayersOpen(v => !v)}
                                    className={`rounded-xl border px-3 py-2 text-[0.625rem] font-black uppercase tracking-widest transition-colors ${intelLayersOpen ? 'bg-amber-500/20 border-amber-400/40 text-amber-200' : 'bg-white/[0.04] border-white/10 text-amber-400'}`}
                                >
                                    Layers
                                </button>
                            </div>
                            {intelLayersOpen && (
                                <div className="rounded-xl border border-white/10 bg-slate-950/85 p-1.5 shadow-[0_10px_28px_rgba(0,0,0,0.24)] animate-in fade-in slide-in-from-top-1 duration-150">
                                    {HISTORIC_LAYER_OPTIONS.map(({ key, label }) => {
                                        const active = historicLayerVisibility[key];
                                        return (
                                            <button
                                                key={key}
                                                onClick={() => setHistoricLayerVisibility(p => ({ ...p, [key]: !p[key] }))}
                                                className={`w-full flex items-center justify-between gap-3 rounded-lg px-3 py-2 text-left transition-colors ${active ? 'bg-blue-500/15 text-blue-200' : 'text-slate-400 hover:bg-white/[0.04] hover:text-slate-200'}`}
                                            >
                                                <span className="text-[0.6875rem] font-black uppercase tracking-widest leading-tight">{label}</span>
                                                <span className={`h-2 w-2 rounded-full shrink-0 ${active ? 'bg-blue-300 shadow-[0_0_8px_rgba(147,197,253,0.8)]' : 'bg-slate-700'}`} />
                                            </button>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="px-1 text-center text-[0.625rem] font-medium leading-snug text-slate-400">
                            {FIELDGUIDE_SHORT_NOTICE}
                        </div>
                    )
                )}

                {/* Historic layer manager — shown when no selection active */}
                {!showSavedPoints && !selectedUserFind && !selectedPASFind && !selectedId && !selectedHotspotId && selectedMonument === undefined && (
                    <HistoricLayerManager />
                )}

                {/* HotspotTray — shown when not in historic mode and no selection */}
                {!historicMode && !showSavedPoints && !selectedUserFind && !selectedPASFind && !selectedId && !selectedHotspotId && selectedMonument === undefined && (
                    <>
                        {scheduledMonumentCheckFailed && hasScanned && (
                            <SMUnavailableBanner
                                reason={scheduledMonumentUnavailableReason}
                                fallbackBody="Protected monument data could not be checked for this scan. Treat the result as incomplete and verify official records before fieldwork."
                            />
                        )}
                        <HotspotTray />
                    </>
                )}

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
                                        : <div className="w-full h-full border border-dashed border-white/15 rounded-xl grid place-items-center text-[0.625rem] font-black text-white/20 uppercase tracking-wider">No Photo</div>
                                    }
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-start justify-between">
                                        <h3 className="text-lg font-black text-white tracking-tight leading-tight mb-1 pr-2">
                                            {selectedUserFind.objectType || 'Unknown Object'}
                                        </h3>
                                        <button onClick={() => setSelectedUserFind(null)} className="bg-white/[0.04] hover:bg-white/[0.08] text-white/50 hover:text-white rounded-full p-1.5 transition-colors border border-white/10 flex-shrink-0 -mt-0.5">
                                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                                        </button>
                                    </div>
                                    <div className="flex items-center gap-1.5 flex-wrap">
                                        <span className={`px-2 py-0.5 rounded-full text-[0.625rem] font-black uppercase tracking-widest ${chipClass}`}>{selectedUserFind.period}</span>
                                        {selectedUserFind.material && <span className="text-[0.6875rem] text-white/40">{selectedUserFind.material}</span>}
                                    </div>
                                </div>
                            </div>
                            <div className="flex items-center gap-3 flex-wrap">
                                {dateLabel && (
                                    <span className="flex items-center gap-1 text-[0.6875rem] text-white/40">
                                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                                        {dateLabel}
                                    </span>
                                )}
                                {selectedUserFind.depthCm != null && (
                                    <span className="flex items-center gap-1 text-[0.6875rem] text-white/40">
                                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="2" x2="12" y2="22"/><polyline points="6 16 12 22 18 16"/></svg>
                                        {selectedUserFind.depthCm} cm
                                    </span>
                                )}
                                {selectedUserFind.weightG != null && <span className="text-[0.6875rem] text-white/40">{selectedUserFind.weightG} g</span>}
                            </div>
                            {(() => {
                                const annotation = hotspots.length > 0
                                    ? buildFindHotspotAnnotation(selectedUserFind, hotspots)
                                    : null;
                                if (!annotation) return null;
                                return (
                                    <div className="flex items-start gap-2 rounded-xl bg-teal-500/6 border border-teal-500/15 px-2.5 py-2 mt-1">
                                        <span className="text-teal-400 text-[0.625rem] shrink-0 mt-0.5">◆</span>
                                        <div className="min-w-0">
                                            <p className="text-[0.5625rem] font-black text-teal-300/80 uppercase tracking-widest mb-0.5">
                                                FieldGuide{annotation.status === 'within' ? ' · Inside zone' : ' · Nearby'}
                                            </p>
                                            <p className="text-[0.625rem] font-bold text-white/65 leading-snug">{annotation.note}</p>
                                        </div>
                                    </div>
                                );
                            })()}
                            {selectedUserFind.notes?.trim() && (
                                <p className="text-xs text-white/40 italic leading-snug line-clamp-3">{selectedUserFind.notes.trim()}</p>
                            )}
                            <div className="border-t border-white/8 pt-2">
                                <span className="text-[0.6875rem] text-white/25 font-mono">{selectedUserFind.findCode}</span>
                            </div>
                        </div>
                    );
                })()}

                {/* Heritage Feature — in panel (mobile) */}
                {selectedPASFind && !selectedUserFind && (
                    <div className="space-y-3">
                        <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                                <p className="text-[0.5625rem] font-black text-emerald-400 uppercase tracking-[0.2em] mb-1">Heritage Feature</p>
                                <h3 className="text-base font-black text-white tracking-tight leading-tight">{selectedPASFind.objectType}</h3>
                                <p className="text-xs font-black text-emerald-400 mt-0.5">{selectedPASFind.broadperiod}</p>
                            </div>
                            <button onClick={() => setSelectedPASFind(null)} className="bg-white/[0.04] hover:bg-white/[0.08] text-white/50 hover:text-white rounded-full p-1.5 transition-colors border border-white/10 shrink-0">
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                            </button>
                            </div>
                            <p className="text-xs font-bold text-white/70 leading-snug">Standing heritage feature recorded in the OpenStreetMap community dataset.</p>
                            <a
                                href={`https://www.openstreetmap.org/${selectedPASFind.osmType || 'node'}/${selectedPASFind.internalId}`}
                                target="_blank" rel="noreferrer"
                            className="flex items-center justify-center gap-2 w-full py-3 bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/30 text-emerald-300 rounded-2xl text-[0.6875rem] font-black uppercase tracking-widest transition-all active:scale-[0.98]"
                        >
                            View on OpenStreetMap
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                        </a>
                    </div>
                )}

                {/* Target Details — in panel (mobile) */}
                {selectedId && !selectedHotspotId && !selectedUserFind && !selectedPASFind && displayTargets.filter(f => f.id === selectedId).map(f => {
                    const tInterp = buildTargetInterpretation(f);
                    const isPrimaryTarget = f.id === primaryTargetId;
                    const strengthColour: Record<TargetSignalStrength, string> = {
                        'Strong Signal': 'text-amber-400', 'Moderate Signal': 'text-emerald-400', 'Supporting Signal': 'text-white/40',
                    };
                    if (f.isProtected) {
                        const protectedCopy = getProtectedTargetCopy(f);
                        return (
                        <div key={f.id} className="space-y-3">
                            <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                    <p className="text-[0.5625rem] font-black text-stone-400/70 uppercase tracking-[0.2em] mb-1">{protectedCopy.label}</p>
                                    {f.aimInfo && <h3 className="text-base font-black text-white/90 tracking-tight leading-tight">{f.aimInfo.type}</h3>}
                                </div>
                                    <div className="flex items-center gap-2 shrink-0">
                                        <button
                                            type="button"
                                            onClick={(e) => { e.stopPropagation(); toggleGeologyDetails(`target:${f.id}`); }}
                                            className={`text-[0.5625rem] font-black uppercase tracking-widest transition-colors ${expandedGeologyId === `target:${f.id}` ? 'text-emerald-300' : 'text-sky-300 hover:text-sky-200'}`}
                                        >
                                            Geology
                                        </button>
                                        <button onClick={() => setSelectedId(null)} className="bg-white/[0.04] hover:bg-white/[0.08] text-white/50 hover:text-white rounded-full p-1.5 transition-colors border border-white/10">
                                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                                        </button>
                                    </div>
                                </div>
                            <div className="rounded-xl bg-stone-900/40 border border-stone-700/40 p-3 space-y-2">
                                <p className="text-sm font-bold text-stone-200/85 leading-snug">{protectedCopy.body}</p>
                                <p className="text-xs font-bold text-stone-300/60 leading-snug">{protectedCopy.detail}</p>
                            </div>
                                {f.aimInfo && (
                                    <div className="p-2 rounded-xl border bg-stone-900/30 border-stone-700/30">
                                        <p className="text-[0.625rem] font-black uppercase text-stone-400/60 leading-tight mb-0.5">Recorded designation</p>
                                        <p className="text-[0.6875rem] font-bold text-stone-200/70 leading-tight">{f.aimInfo.type} · {f.aimInfo.period}</p>
                                    </div>
                                )}
                            </div>
                            );
                        }
                    return (
                        <div key={f.id} className="space-y-3">
                                <div className="flex items-start justify-between gap-2">
                                    <div className="min-w-0">
                                    {isPrimaryTarget && (
                                        <button
                                            type="button"
                                            onClick={(e) => { e.stopPropagation(); focusTarget(f); }}
                                            className="mb-1 inline-flex items-center gap-1.5 rounded-full border border-emerald-200/45 bg-[linear-gradient(135deg,rgba(6,78,59,0.92),rgba(15,118,110,0.72)_55%,rgba(245,158,11,0.34))] px-2.5 py-1 text-[0.5rem] font-black uppercase tracking-widest text-emerald-50 shadow-[0_0_0_1px_rgba(16,185,129,0.15),0_8px_22px_rgba(0,0,0,0.26),inset_0_1px_0_rgba(255,255,255,0.22)] active:scale-[0.98]"
                                        >
                                            <span className="h-1.5 w-1.5 rounded-full bg-amber-300 shadow-[0_0_10px_rgba(251,191,36,0.9)]" />
                                            Start Here
                                        </button>
                                    )}
                                    <p className="inline-flex rounded-full border border-slate-200/25 bg-slate-900/45 px-2 py-0.5 text-[0.5625rem] font-black text-slate-100 uppercase tracking-[0.14em] shadow-[inset_0_1px_0_rgba(255,255,255,0.10)]">T{f.number.toString().padStart(2, '0')}</p>
                                    <h3 className="text-base font-black text-white tracking-tight leading-tight mt-0.5">{f.type}</h3>
                                    <p className={`text-sm font-black mt-0.5 ${strengthColour[tInterp.signalStrength]}`}>{tInterp.signalStrength}</p>
                                </div>
                                    <div className="flex items-center gap-2 shrink-0">
                                        <button
                                            type="button"
                                            onClick={(e) => { e.stopPropagation(); toggleGeologyDetails(`target:${f.id}`); }}
                                            className={`text-[0.5625rem] font-black uppercase tracking-widest transition-colors ${expandedGeologyId === `target:${f.id}` ? 'text-emerald-300' : 'text-sky-300 hover:text-sky-200'}`}
                                        >
                                            Geology
                                        </button>
                                        <button onClick={() => setSelectedId(null)} className="bg-white/[0.04] hover:bg-white/[0.08] text-white/50 hover:text-white rounded-full p-1.5 transition-colors border border-white/10">
                                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                                        </button>
                                    </div>
                                </div>
                            <p className="text-sm font-black text-white/85 leading-snug">{getTargetVerdict(tInterp.signalStrength, isPrimaryTarget)}</p>
                            <p className="text-xs font-bold text-white/50 leading-snug">{tInterp.hook}</p>

                                    {(() => {
                                        const ctx = targetFindContext.get(f.id);
                                    if (!ctx) return null;
                                        return ctx.status === 'within'
                                            ? <p className="text-[0.625rem] font-black text-emerald-400/80 uppercase tracking-widest">{ctx.count} find{ctx.count !== 1 ? 's' : ''} recorded here — signal supported</p>
                                            : <p className="text-[0.625rem] font-black text-emerald-400/80 uppercase tracking-widest">{ctx.count} find{ctx.count !== 1 ? 's' : ''} recorded nearby</p>;
                                    })()}
                                {f.isHighConfidenceCrossing && (
                                    <div className="bg-blue-600/30 p-2 rounded-xl border border-blue-400/70 animate-pulse">
                                        <p className="text-[0.6875rem] font-black uppercase text-white text-center tracking-[0.18em]">Likely historic crossing point</p>
                                </div>
                            )}
                            {f.explanationLines && f.explanationLines.length > 0 && (
                                <div className="border-t border-white/8 pt-3">
                                    <p className="text-[0.5625rem] font-black text-white/40 uppercase tracking-widest mb-2">Why this matters</p>
                                    <div className="space-y-1.5">
                                        {f.explanationLines.slice(0, 3).map((line, idx) => (
                                            <div key={idx} className="flex items-start gap-2">
                                                <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 mt-1 shrink-0 shadow-[0_0_6px_rgba(52,211,153,0.7)]" />
                                                <p className="text-sm font-bold text-white/80 leading-tight">{line}</p>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                            <div className="border-t border-emerald-500/15 pt-2">
                                <p className="text-[0.5625rem] font-black text-emerald-500/70 uppercase tracking-[0.12em] mb-1">Target focus</p>
                                <p className="text-sm font-bold text-emerald-300 leading-snug">{tInterp.focus}</p>
                            </div>
                            {f.aimInfo && (
                                <div className="p-2 rounded-xl border bg-amber-500/10 border-amber-400/30">
                                    <p className="text-[0.625rem] font-black uppercase text-amber-300 leading-tight mb-0.5">Historic verification</p>
                                    <p className="text-[0.6875rem] font-bold text-white/80 leading-tight">{f.aimInfo.type} · {f.aimInfo.period}</p>
                                </div>
                            )}
                            {f.routeAssessment?.relationship === 'route_edge_activity_candidate' && (
                                <div className="p-2 rounded-xl border bg-sky-500/10 border-sky-400/30">
                                    <p className="text-[0.625rem] font-black uppercase text-sky-300 leading-tight mb-0.5">Route-Edge Signal</p>
                                    <p className="text-[0.6875rem] font-bold text-white/80 leading-tight">This signal sits beside, not on, a mapped route. It may reflect older movement or route-edge activity.</p>
                                </div>
                            )}
                            {f.routeAssessment?.relationship === 'historic_movement_candidate' && (
                                <div className="p-2 rounded-xl border bg-amber-500/10 border-amber-400/30">
                                    <p className="text-[0.625rem] font-black uppercase text-amber-300 leading-tight mb-0.5">Movement Corridor</p>
                                    <p className="text-[0.6875rem] font-bold text-white/80 leading-tight">Multiple signals suggest this may relate to an older movement corridor rather than a modern track.</p>
                                </div>
                            )}
                            {f.routeAssessment?.relationship === 'possible_modern_route_noise' && (
                                <div className="p-2 rounded-xl border bg-amber-500/15 border-amber-400/40">
                                    <p className="text-[0.625rem] font-black uppercase text-amber-300 leading-tight mb-0.5">Proximity Caution</p>
                                    <p className="text-[0.6875rem] font-bold text-white/80 leading-tight">This signal lies close to a mapped modern track or road edge. Treat with additional caution.</p>
                                </div>
                            )}
                                <div className="border-t border-white/8 pt-2">
                                    <span
                                        onClick={() => toggleTargetDetails(f.id)}
                                        className="text-sm font-black text-amber-400 hover:text-amber-300 transition-colors cursor-pointer flex items-center gap-1"
                                    >
                                        {expandedTargetId === f.id ? '▲ Hide reasoning' : '▼ See full reasoning'}
                                    </span>
                                    {expandedTargetId === f.id && (
                                        <div id={`mobile-target-details-${f.id}`} className="mt-3 space-y-3 animate-in fade-in duration-200">
                                            <div>
                                            <p className="text-[0.5625rem] font-black text-white/55 uppercase tracking-[0.15em] mb-1">Summary</p>
                                            <p className="text-xs text-white/85 leading-relaxed">{tInterp.summary}</p>
                                        </div>
                                        <div>
                                            <p className="text-[0.5625rem] font-black text-white/55 uppercase tracking-[0.15em] mb-1">Why it stands out</p>
                                            <p className="text-xs text-white/85 leading-relaxed">{tInterp.whyItStandsOut}</p>
                                        </div>
                                        <div>
                                            <p className="text-[0.5625rem] font-black text-white/55 uppercase tracking-[0.15em] mb-1">How to approach it</p>
                                            <p className="text-xs text-white/85 leading-relaxed">{tInterp.howToApproach}</p>
                                        </div>
                                    </div>
                                    )}
                                </div>
                                </div>
                    );
                })}

                    {neutralMobileGeologyAvailable && (
                        <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); toggleGeologyDetails('scan'); }}
                            className={`w-full rounded-xl border px-3 py-2.5 text-[0.625rem] font-black uppercase tracking-widest transition-colors ${expandedGeologyId === 'scan' ? 'bg-emerald-500/15 border-emerald-400/30 text-emerald-300' : 'bg-white/[0.04] border-sky-400/20 text-sky-300'}`}
                        >
                            Geology
                        </button>
                    )}

                {/* Scheduled Monument click card */}
                {selectedMonument !== undefined && !selectedUserFind && !selectedPASFind && !selectedId && (
                    <div className="space-y-3">
                        <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                                <p className="text-[0.5625rem] font-black text-stone-400/70 uppercase tracking-[0.2em] mb-1">Scheduled Monument</p>
                                {selectedMonument && <h3 className="text-base font-black text-white/90 tracking-tight leading-tight">{selectedMonument}</h3>}
                            </div>
                            <button onClick={() => setSelectedMonument(undefined)} className="bg-white/[0.04] hover:bg-white/[0.08] text-white/50 hover:text-white rounded-full p-1.5 transition-colors border border-white/10 shrink-0">
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                            </button>
                        </div>
                        <div className="rounded-xl bg-stone-900/40 border border-stone-700/40 p-3 space-y-2">
                            <p className="text-sm font-bold text-stone-200/85 leading-snug">This area is protected as a Scheduled Monument.</p>
                            <p className="text-xs font-bold text-stone-300/60 leading-snug">Metal detecting, excavation, or intrusive activity may require legal consent. Avoid disturbing the site boundary and check current protections before any fieldwork.</p>
                        </div>
                    </div>
                )}

                {/* Hotspot Inspector (mobile) */}
                {selectedMonument === undefined && selectedHotspotId && (() => {
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
                                    <p className="text-[0.5rem] font-black text-white/30 uppercase tracking-widest mb-0.5">{HOTSPOT_TITLES[h.classification]} · Hotspot {h.number}</p>
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <p className={`text-base font-black leading-tight ${hStrengthColour}`}>{hierarchy.signalStrength}</p>
                                        {isPrimaryHotspot && <span className="bg-emerald-500/15 border border-emerald-400/30 text-emerald-200 px-1.5 py-0.5 rounded-full text-[0.5rem] font-black uppercase tracking-widest">Priority</span>}
                                    </div>
                                </div>
                                    <div className="flex items-center gap-2 shrink-0">
                                        <button
                                            type="button"
                                            onClick={(e) => { e.stopPropagation(); toggleGeologyDetails(`hotspot:${h.id}`); }}
                                            className={`text-[0.5625rem] font-black uppercase tracking-widest transition-colors ${expandedGeologyId === `hotspot:${h.id}` ? 'text-emerald-300' : 'text-sky-300 hover:text-sky-200'}`}
                                        >
                                            Geology
                                        </button>
                                        <button onClick={() => setSelectedHotspotId(null)} className="bg-white/[0.04] hover:bg-white/[0.08] text-white/50 hover:text-white rounded-full p-1.5 transition-colors border border-white/10">
                                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                                        </button>
                                    </div>
                                </div>
                            <div className="space-y-2">
                                <div>
                                    <p className="text-[0.5rem] font-black text-white/30 uppercase tracking-[0.18em] mb-0.5">Why it matters</p>
                                    <p className="text-sm font-bold text-white/85 leading-snug">{hierarchy.whyItMatters}</p>
                                </div>
                                <div>
                                    <p className="text-[0.5rem] font-black text-emerald-400/60 uppercase tracking-[0.18em] mb-0.5">Interpretive cue</p>
                                    <p className="text-xs font-bold text-emerald-300 leading-snug">{hierarchy.nextAction}</p>
                                </div>
                            </div>
                            {(h.secondaryTag || h.isOnCorridor || (h.linkedCount ?? 0) > 0) && (
                                <div className="flex items-center gap-2 flex-wrap">
                                    {h.secondaryTag && <span className="text-[0.625rem] font-bold text-amber-300/60 uppercase tracking-widest">{h.secondaryTag}</span>}
                                    {h.isOnCorridor && <span className="text-[0.625rem] font-bold text-emerald-500/60 uppercase tracking-widest">On corridor</span>}
                                    {(h.linkedCount ?? 0) > 0 && <span className="text-[0.625rem] font-bold text-white/40 uppercase tracking-widest">Linked to {h.linkedCount} nearby</span>}
                                </div>
                            )}

                            {/* Landscape Interpretation — between signal explanation and evidence */}
                            {(() => {
                                const li = landscapeIntelligenceMap.get(h.id);
                                if (!li || !li.narrative) return null;
                                const isOpen = expandedLandscapeHotspot === h.id;
                                return (
                                    <LandscapeInterpretationPanel
                                        isOpen={isOpen}
                                        onToggle={() => setExpandedLandscapeHotspot(isOpen ? null : h.id)}
                                        narrative={li.narrative}
                                        chips={getLandscapeChips(li)}
                                    />
                                );
                            })()}

                                    {h.isHighConfidenceCrossing && <div className="bg-blue-600/30 p-2 rounded-xl border border-blue-400/70 animate-pulse"><p className="text-[0.6875rem] font-black uppercase text-white text-center tracking-[0.18em]">Likely historic crossing point</p></div>}
                            {h.disturbanceRisk === 'High' && <div className="bg-red-500/15 p-2 rounded-xl border border-red-400/30"><p className="text-[0.625rem] font-black uppercase text-red-300 tracking-widest">Disturbed ground — interpret with caution</p></div>}
                            <div className="border-t border-white/8 pt-3">
                                <p className="text-[0.5625rem] font-black text-white/40 uppercase tracking-widest mb-2">Evidence</p>
                                <div className="space-y-1.5">
                                    {h.explanation.slice(0, 3).map((reason, idx) => (
                                        <div key={`${reason.tag}:${reason.qualifier ?? idx}`} className="flex items-start gap-2">
                                            <div className="w-1 h-1 rounded-full bg-emerald-400 mt-1.5 shrink-0 shadow-[0_0_6px_rgba(52,211,153,0.8)]" />
                                            <p className="text-sm font-bold text-white/80 leading-tight">{reason.text}</p>
                                        </div>
                                    ))}
                                </div>
                            </div>
                            {(() => {
                                const feedback = buildHotspotFindFeedback(h, projectFinds);
                                if (!feedback) return null;
                                const isValidates = feedback.status === 'validates';
                                return (
                                    <div className={`mt-2 rounded-xl border px-3 py-2.5 space-y-1 ${isValidates ? 'bg-emerald-500/8 border-emerald-500/20' : 'bg-sky-500/6 border-sky-500/15'}`}>
                                        <div className="flex items-center gap-2">
                                            <span className={`text-[0.5rem] font-black uppercase tracking-widest shrink-0 ${isValidates ? 'text-emerald-400' : 'text-sky-400'}`}>
                                                Your finds
                                            </span>
                                            <span className={`text-[0.625rem] font-black ${isValidates ? 'text-emerald-200' : 'text-sky-200'}`}>
                                                {feedback.label}
                                            </span>
                                        </div>
                                        <p className="text-[0.625rem] font-bold text-white/65 leading-snug">{feedback.note}</p>
                                    </div>
                                );
                            })()}
                            {(() => {
                                const persisted = persistedSignals.get(h.id);
                                if (!persisted) return null;
                                return (
                                    <div className="mt-2 rounded-xl border border-amber-500/20 bg-amber-500/8 px-3 py-2.5 space-y-1">
                                        <span className="text-[0.5rem] font-black uppercase tracking-widest text-amber-400">
                                            Track record
                                        </span>
                                        <p className="text-[0.625rem] font-bold text-white/65 leading-snug">{persisted.note}</p>
                                    </div>
                                );
                            })()}
                            {h.suggestedFocus && (
                                <div className="pt-2 border-t border-emerald-500/15">
                                    <p className="text-[0.5625rem] font-black text-emerald-500/70 uppercase tracking-[0.12em] mb-1">Field focus</p>
                                    <p className="text-sm font-bold text-emerald-300 leading-snug">{h.suggestedFocus}</p>
                                </div>
                            )}
                                <div className="pt-2 border-t border-white/8">
                                    <span onClick={() => toggleHotspotDetails(h.id)} className="text-sm font-black text-amber-400 hover:text-amber-300 cursor-pointer flex items-center gap-1">
                                        {expandedInterpretationId === h.id ? '▲ Hide breakdown' : '▼ Full evidence breakdown'}
                                    </span>
                                {expandedInterpretationId === h.id && (() => {
                                    const interp = buildInterpretation(h);
                                    const breakdown = [{ label: 'Anomaly', val: h.metrics.anomaly, cap: 30 }, { label: 'Context', val: h.metrics.context, cap: 25 }, { label: 'Convergence', val: h.metrics.convergence, cap: 20 }, { label: 'Behaviour', val: h.metrics.behaviour, cap: 15 }];
                                        return (
                                            <div id={`mobile-hotspot-details-${h.id}`} className="mt-3 space-y-3 animate-in fade-in duration-200">
                                                <p className="text-[0.5625rem] font-black text-white/25 uppercase tracking-[0.2em]">{getInterpretationLabel(h.confidence)}</p>
                                            <p className="text-sm text-white/80 leading-relaxed">{interp.summary}</p>
                                            <p className="text-sm text-white/80 leading-relaxed">{interp.reasoning}</p>
                                            <p className="text-sm text-white/80 leading-relaxed">{interp.strategy}</p>
                                            {interp.soilNote && (
                                                <p className="text-sm text-sky-300/70 leading-relaxed italic border-t border-white/8 pt-2">{interp.soilNote}</p>
                                            )}
                                            <div className="space-y-1.5 pt-2 border-t border-white/10">
                                                {breakdown.map(({ label, val, cap }) => (
                                                    <div key={label} className="flex items-center gap-2">
                                                        <span className="text-[0.5rem] text-white/45 w-16 shrink-0">{label}</span>
                                                        <div className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden"><div className="h-full bg-emerald-500/70 rounded-full" style={{ width: `${Math.min(100, (val / cap) * 100)}%` }} /></div>
                                                        <span className="text-[0.5rem] text-white/40 w-14 text-right shrink-0">{getSignalBand(val, cap)}</span>
                                                    </div>
                                                ))}
                                                {h.metrics.penalty !== 0 && <p className="text-[0.5rem] text-white/35 mt-1">Modern disturbance or noise was discounted before interpretation.</p>}
                                            </div>
                                        </div>
                                    );
                                    })()}
                                </div>
                                    <p className="text-center text-[0.5rem] text-white/40 italic">Highlights historic activity — not guaranteed finds.</p>
                        </div>
                    );
                })()}

            </div>
        </div>
        {activeMobileGeologyTitle && (
            <div className="absolute bottom-[calc(0.75rem+32.5vh)] left-3 right-3 z-[95] translate-y-1/2 animate-in fade-in zoom-in-95 duration-150">
                <div className="relative rounded-2xl border border-emerald-400/25 bg-black/95 shadow-2xl backdrop-blur-xl">
                    <div className="mx-auto mt-2 h-1 w-8 rounded-full bg-white/20" />
                    <button
                        type="button"
                        aria-label="Close geology context"
                        onClick={() => setExpandedGeologyId(null)}
                        className="absolute right-3 top-3 z-10 bg-white/[0.04] hover:bg-white/[0.08] text-white/45 hover:text-white rounded-full p-1.5 transition-colors border border-white/10"
                    >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                    <GeologyContextCard
                        title={activeMobileGeologyTitle}
                        context={geologyContext}
                        loading={geologyContextLoading}
                        showUnavailable
                        className="border-0 bg-transparent pt-3 pr-10"
                    />
                </div>
            </div>
        )}
        </>
    );
}
