import React from 'react';
import type maplibregl from 'maplibre-gl';
import { getHotspotSignalStrength } from '../../utils/hotspotInterpreter';
import { buildTargetInterpretation, getTargetVerdict } from '../../utils/targetInterpreter';
import type { HotspotSignalStrength } from '../../utils/hotspotInterpreter';
import type { Hotspot, Cluster } from '../../pages/fieldGuideTypes';
import { useFieldGuideContext } from './FieldGuideContext';
import { HOTSPOT_TITLES } from './FieldGuideContext';

function getPotentialTier(score: number): string {
    if (score > 80) return 'High Potential';
    if (score > 60) return 'Strong Potential';
    if (score > 35) return 'Moderate Potential';
    return 'Low Potential';
}

function getPotentialTierShort(score: number): string {
    if (score > 80) return 'HIGH';
    if (score > 60) return 'STRG';
    if (score > 35) return 'MOD';
    return 'LOW';
}

type HotspotResultHierarchy = {
    signalStrength: 'Developing Signal' | 'Strong Signal' | 'Corroborated Signal';
    whyItMatters: string;
    nextAction: string;
};

import type { HotspotClassification } from '../../pages/fieldGuideTypes';

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

function TargetNumberBadge({ number }: { number: number }) {
    return (
        <span className="inline-flex items-center rounded-full border border-amber-300/25 bg-amber-300/8 px-2 py-0.5 text-[0.5rem] font-black text-amber-100/85 uppercase tracking-[0.16em] shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] shrink-0">
            Target {number.toString().padStart(2, '0')}
        </span>
    );
}

function StartBadge() {
    return (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200/45 bg-[linear-gradient(135deg,rgba(6,78,59,0.92),rgba(15,118,110,0.72)_55%,rgba(245,158,11,0.34))] px-2.5 py-1 text-[0.4375rem] font-black uppercase tracking-widest text-emerald-50 shadow-[0_0_0_1px_rgba(16,185,129,0.15),0_8px_22px_rgba(0,0,0,0.26),inset_0_1px_0_rgba(255,255,255,0.22)] shrink-0">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-300 shadow-[0_0_10px_rgba(251,191,36,0.9)]" />
            Start
        </span>
    );
}

export function HotspotTray() {
    const {
        showSavedPoints,
        selectedUserFind,
        selectedPASFind,
        selectedId,
        selectedHotspotId,
        selectedMonument,
        historicMode,
        mobileSheetMode,
        sortedHotspots,
        displayTargets,
        traceTargets,
        hasScanned,
        scanNoSignal,
        selectedTraceId,
        traceCardRefs,
        clearMapItemSelections,
        persistSheetExpanded,
        setSelectedHotspotId,
        mapRef,
        focusTarget,
        primaryTargetId,
        hotspotFindContext,
        targetFindContext,
    } = useFieldGuideContext();

    // Only render when no specific item is selected and not in historic mode
    if (showSavedPoints || selectedUserFind || selectedPASFind || selectedId || selectedHotspotId || selectedMonument !== undefined) {
        return null;
    }

    return (
        <>
            {/* Hotspot list */}
            {!historicMode && mobileSheetMode === 'hotspots' && sortedHotspots.length > 0 && (
                <div id="mobile-hotspots-list">
                    <p className="text-[0.5rem] font-black text-white/25 uppercase tracking-[0.25em] mb-2 px-1">Landscape Hotspots</p>
                    <div className="space-y-2">
                        {sortedHotspots.map(h => {
                            const isPrimary = h.number === 1;
                            const hStr = getHotspotSignalStrength(h.score);
                            const hier = getHotspotResultHierarchy(h, hStr);
                            const onClick = () => { clearMapItemSelections('hotspot'); persistSheetExpanded(true); setSelectedHotspotId(h.id); mapRef.current?.fitBounds(h.bounds as maplibregl.LngLatBoundsLike, { padding: 40 }); };
                            if (isPrimary) return (
                                <button key={h.id} onClick={onClick} className="w-full text-left p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 shadow-[0_0_14px_rgba(16,185,129,0.08)] active:scale-[0.98] transition-all hover:border-emerald-500/50">
                                    <div className="flex items-start justify-between gap-2 mb-1.5">
                                        <div className="min-w-0">
                                            <p className="text-[0.5rem] font-black text-white uppercase tracking-widest mb-0.5">{HOTSPOT_TITLES[h.classification]}</p>
                                            <p className="text-xs font-black text-emerald-300 leading-tight">{hier.signalStrength}</p>
                                        </div>
                                        <span className="text-[0.4375rem] font-black text-emerald-500/50 bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.5 rounded shrink-0">Priority</span>
                                    </div>
                                    <p className="text-[0.625rem] font-bold text-emerald-200/70 leading-tight line-clamp-2">{hier.whyItMatters}</p>
                                </button>
                            );
                            return (
                                <button key={h.id} onClick={onClick} className="w-full text-left px-3 py-2 rounded-xl bg-slate-900/40 border border-white/6 active:scale-[0.98] transition-all hover:border-white/12">
                                    <div className="flex items-center justify-between gap-2">
                                        <div className="min-w-0">
                                            <p className="text-[0.5rem] font-black text-white uppercase tracking-widest mb-0.5">{HOTSPOT_TITLES[h.classification]}</p>
                                            <p className="text-[0.625rem] font-bold text-white/70 leading-tight truncate">{hier.signalStrength}</p>
                                        </div>
                                        <span className="text-[0.5rem] font-black text-white/25 shrink-0 uppercase tracking-widest">{getPotentialTierShort(h.score)}</span>
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* Target list */}
            {!historicMode && mobileSheetMode === 'targets' && displayTargets.length > 0 && (
                <div id="mobile-targets-list">
                    <p className="text-[0.5rem] font-black text-white/25 uppercase tracking-[0.25em] mb-2 px-1">Investigation Targets</p>
                    <div className="space-y-2">
                        {displayTargets.map(f => {
                            const tI = buildTargetInterpretation(f);
                            const isPrimary = f.id === primaryTargetId;
                            return (
                                <button
                                    key={f.id}
                                    onClick={() => focusTarget(f)}
                                    className={`w-full text-left p-3 rounded-xl border active:scale-[0.98] transition-all ${f.isProtected ? 'bg-red-950/20 border-red-900/50' : isPrimary ? 'bg-emerald-500/10 border-emerald-500/30 shadow-[0_0_14px_rgba(16,185,129,0.08)]' : 'bg-slate-900/45 border-white/8 hover:border-sky-300/20 hover:bg-slate-900/60'}`}
                                >
                                    <div className="flex items-start justify-between gap-2">
                                        <div className="min-w-0">
                                            {!f.isProtected && <p className={`text-[0.5rem] font-black uppercase tracking-widest mb-0.5 ${isPrimary ? 'text-emerald-100' : 'text-sky-200/55'}`}>{f.type}</p>}
                                            <p className={`text-xs font-black leading-tight ${f.isProtected ? 'text-stone-400' : isPrimary ? 'text-emerald-300' : 'text-white/78'}`}>
                                                {f.isProtected ? getProtectedTargetCopy(f).label : getTargetVerdict(tI.signalStrength, isPrimary)}
                                            </p>
                                            {!f.isProtected && <p className={`text-[0.625rem] font-bold leading-tight mt-0.5 line-clamp-2 ${isPrimary ? 'text-emerald-100/60' : 'text-white/45'}`}>{tI.hook}</p>}
                                        </div>
                                        {!f.isProtected && (
                                            <div className="flex flex-col items-end gap-1">
                                                {isPrimary && <StartBadge />}
                                                <TargetNumberBadge number={f.number} />
                                                {!isPrimary && <span className="text-[0.5rem] font-black uppercase tracking-widest text-white/24 shrink-0 pt-0.5">{getPotentialTierShort(f.findPotential)}</span>}
                                            </div>
                                        )}
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* Trace Signals */}
            {!historicMode && mobileSheetMode === 'targets' && traceTargets.length > 0 && hasScanned && (
                <div>
                    <p className="text-[0.5rem] font-black text-amber-500/40 uppercase tracking-[0.25em] mb-2 px-1 mt-1">Trace Signals</p>
                    <div className="space-y-1.5">
                        {traceTargets.map(t => {
                            const isSelected = t.id === selectedTraceId;
                            const sourceChips: string[] = [];
                            if (t.sources.includes('terrain') || t.sources.includes('terrain_global')) sourceChips.push('LiDAR');
                            if (t.sources.includes('satellite_summer') || t.sources.includes('satellite_spring')) sourceChips.push('Sat');
                            if (t.sources.includes('hydrology')) sourceChips.push('Hydro');
                            if (t.sources.includes('slope')) sourceChips.push('Slope');
                            if (t.multiScale) sourceChips.push('Multi-Scale');
                            const distanceLabel = t.distanceToNearestTarget >= 1000
                                ? `${(t.distanceToNearestTarget / 1000).toFixed(1)}km from nearest target`
                                : `${Math.round(t.distanceToNearestTarget)}m from nearest target`;
                            return (
                                <div
                                    key={t.id}
                                    ref={el => { if (el) traceCardRefs.current?.set(t.id, el); else traceCardRefs.current?.delete(t.id); }}
                                    className={`w-full text-left p-2.5 rounded-xl border transition-all ${isSelected ? 'border-amber-300/20 bg-slate-900/70 shadow-[0_0_12px_rgba(245,158,11,0.06)]' : 'border-white/5 bg-slate-900/35 hover:border-white/9'}`}
                                >
                                    <div className="flex items-start justify-between gap-2 mb-1.5">
                                        <div className="min-w-0">
                                            <p className={`text-[0.5rem] font-black uppercase tracking-widest leading-tight ${isSelected ? 'text-amber-200' : 'text-amber-300/55'}`}>{t.traceLabel}</p>
                                            <p className="text-[0.625rem] font-bold text-white/45 leading-snug mt-0.5">{t.traceReason}</p>
                                        </div>
                                        <span className={`text-[0.5rem] font-black uppercase tracking-widest rounded-full border px-1.5 py-0.5 shrink-0 ${isSelected ? 'border-amber-300/25 text-amber-100/70 bg-amber-300/[0.08]' : 'border-white/10 text-white/38 bg-white/[0.03]'}`}>Clue</span>
                                    </div>
                                    <div className="flex flex-wrap gap-1 mb-1.5">
                                        {sourceChips.map(chip => (
                                            <span key={chip} className={`text-[0.5625rem] font-bold px-1.5 py-0.5 rounded border ${isSelected ? 'border-amber-300/25 text-amber-100/70 bg-amber-300/[0.08]' : 'border-white/10 text-white/38 bg-white/[0.03]'}`}>
                                                {chip}
                                            </span>
                                        ))}
                                    </div>
                                    <div className="flex items-center justify-end gap-2 pt-0.5">
                                        <span className="text-[0.5rem] font-mono text-white/22 shrink-0">{distanceLabel}</span>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                    <p className="text-[0.5rem] font-bold text-white/20 italic text-center mt-2">Trace signals are weaker clues, not investigation targets.</p>
                </div>
            )}

            {/* Quiet scan / no-signal state */}
            {!historicMode && hasScanned && sortedHotspots.length === 0 && displayTargets.length === 0 && (
                <div className="rounded-xl bg-white/[0.03] border border-white/10 p-4 text-center">
                    <p className="text-xs font-black text-white/70 leading-tight">{scanNoSignal ? 'No signal' : 'Quiet scan area'}</p>
                    <p className="text-[0.625rem] font-bold text-white/35 leading-snug mt-1">{scanNoSignal ? 'Tile data could not be fetched — check your connection and scan again.' : 'No strong hotspots or investigation targets stood out here. Try widening the view, checking the historic layers, or scanning a neighbouring field.'}</p>
                </div>
            )}

            {/* No targets notice within targets tab */}
            {!historicMode && mobileSheetMode === 'targets' && hasScanned && displayTargets.length === 0 && (sortedHotspots.length > 0 || displayTargets.length > 0) && (
                <p className="text-center text-[0.625rem] font-bold text-white/20 uppercase tracking-widest italic py-6">No investigation targets from this scan</p>
            )}

            {/* Not yet scanned */}
            {!hasScanned && (
                <p className="text-center text-[0.625rem] font-bold text-white/20 uppercase tracking-widest italic py-6">Scan to read the landscape</p>
            )}

        </>
    );
}
