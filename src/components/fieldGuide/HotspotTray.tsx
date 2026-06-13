import React from 'react';
import type maplibregl from 'maplibre-gl';
import { getHotspotSignalStrength } from '../../utils/hotspotInterpreter';
import { buildTargetInterpretation, getTargetVerdict } from '../../utils/targetInterpreter';
import type { HotspotSignalStrength } from '../../utils/hotspotInterpreter';
import type { Hotspot, Cluster } from '../../pages/fieldGuideTypes';
import { useFieldGuideContext } from './FieldGuideContext';
import { HOTSPOT_TITLES } from './FieldGuideContext';
import { computeTargetLandscapeNarrative } from '../../utils/landscapeIntelligenceEngine';

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

// ─── Landscape Intelligence Summary ──────────────────────────────────────────
// Blue card shown above hotspot list after every scan. Default expanded.
// Sections appear only when signals exist; bullet count scales with signal count.

function LandscapeBulletGroup({ title, bullets }: { title: string; bullets: string[] }) {
    if (!bullets.length) return null;

    return (
        <div>
            <p className="text-[9px] font-black text-sky-400/65 uppercase tracking-[0.16em] mb-1.5">{title}</p>
            <div className="space-y-1">
                {bullets.map((bullet, i) => (
                    <div key={`${title}-${i}`} className="flex items-start gap-2">
                        <span className="text-sky-400/55 text-[10px] mt-px shrink-0">•</span>
                        <p className="text-[11px] font-bold text-sky-100/72 leading-snug">{bullet}</p>
                    </div>
                ))}
            </div>
        </div>
    );
}

function LandscapeIntelligenceSummary() {
    const { landscapeSummary, sortedHotspots, displayTargets, hasScanned } = useFieldGuideContext();
    const [collapsed, setCollapsed] = React.useState(true);

    if (!hasScanned || !landscapeSummary || (!sortedHotspots.length && !displayTargets.length) || !landscapeSummary.fieldNarrative) return null;

    const { fieldNarrative, movementSummary, occupationSummary, environmentSummary, wetlandSummary } = landscapeSummary;
    const hasBullets = movementSummary.length > 0 || occupationSummary.length > 0 || environmentSummary.length > 0 || wetlandSummary.length > 0;

    return (
        <div className="rounded-xl border border-sky-400/20 bg-sky-500/[0.06] overflow-hidden">
            {/* Header */}
            <button
                type="button"
                onClick={() => setCollapsed(v => !v)}
                className="w-full flex items-center justify-between gap-2 px-3 py-2.5 text-left"
            >
                <div className="flex items-center gap-2 min-w-0">
                    <span className="text-[9px] font-black text-sky-400/75 uppercase tracking-[0.18em] shrink-0">Landscape Intelligence</span>
                </div>
                <svg
                    width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                    strokeWidth="3" strokeLinecap="round"
                    className={`text-sky-400/50 shrink-0 transition-transform duration-200 ${collapsed ? '' : 'rotate-180'}`}
                >
                    <polyline points="6 9 12 15 18 9" />
                </svg>
            </button>

            {/* Body */}
            {!collapsed && (
                <div className="px-3 pb-3 space-y-3">
                    {/* Field narrative */}
                    <p className="text-xs font-bold text-sky-100/85 leading-relaxed">{fieldNarrative}</p>

                    {/* Bullet groups */}
                    {hasBullets && (
                        <div className="space-y-2 pt-1 border-t border-sky-400/10">
                            <LandscapeBulletGroup title="Movement & Access" bullets={movementSummary} />
                            <LandscapeBulletGroup title="Landform & Occupation" bullets={occupationSummary} />
                            <LandscapeBulletGroup title="Environmental Context" bullets={environmentSummary} />
                            <LandscapeBulletGroup title="Wetland Context" bullets={wetlandSummary} />
                        </div>
                    )}
                </div>
            )}
        </div>
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
            {/* Landscape Intelligence Summary — above hotspot or target list */}
            {!historicMode && (mobileSheetMode === 'hotspots' || mobileSheetMode === 'targets') && (sortedHotspots.length > 0 || displayTargets.length > 0) && (
                <LandscapeIntelligenceSummary />
            )}

            {/* Hotspot list */}
            {!historicMode && mobileSheetMode === 'hotspots' && sortedHotspots.length > 0 && (
                <div>
                    <p className="text-[8px] font-black text-white/25 uppercase tracking-[0.25em] mb-2 px-1">Landscape Hotspots</p>
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
                                        <span className="text-[8px] font-black text-white/25 shrink-0 uppercase tracking-widest">{getPotentialTierShort(h.score)}</span>
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* Target list */}
            {!historicMode && mobileSheetMode === 'targets' && displayTargets.length > 0 && (
                <div>
                    <p className="text-[8px] font-black text-white/25 uppercase tracking-[0.25em] mb-2 px-1">Investigation Targets</p>
                    <div className="space-y-2">
                        {displayTargets.map(f => {
                            const tI = buildTargetInterpretation(f);
                            const isPrimary = f.id === primaryTargetId;
                            const landscapeCue = f.isProtected ? null : computeTargetLandscapeNarrative(f);
                            return (
                                <button
                                    key={f.id}
                                    onClick={() => focusTarget(f)}
                                    className={`w-full text-left p-3 rounded-xl border active:scale-[0.98] transition-all ${f.isProtected ? 'bg-red-950/20 border-red-900/50' : isPrimary ? 'bg-emerald-500/10 border-emerald-500/30 shadow-[0_0_14px_rgba(16,185,129,0.08)]' : 'bg-slate-900/45 border-white/8 hover:border-sky-300/20 hover:bg-slate-900/60'}`}
                                >
                                    <div className="flex items-start justify-between gap-2">
                                        <div className="min-w-0">
                                            {!f.isProtected && <p className={`text-[8px] font-black uppercase tracking-widest mb-0.5 ${isPrimary ? 'text-emerald-100' : 'text-sky-200/55'}`}>{f.type}</p>}
                                            <p className={`text-xs font-black leading-tight ${f.isProtected ? 'text-stone-400' : isPrimary ? 'text-emerald-300' : 'text-white/78'}`}>
                                                {f.isProtected ? getProtectedTargetCopy(f).label : getTargetVerdict(tI.signalStrength, isPrimary)}
                                            </p>
                                            {!f.isProtected && <p className={`text-[10px] font-bold leading-tight mt-0.5 line-clamp-2 ${isPrimary ? 'text-emerald-100/60' : 'text-white/45'}`}>{tI.hook}</p>}
                                            {landscapeCue && (
                                                <p className={`text-[11px] font-bold leading-snug mt-2 line-clamp-2 ${isPrimary ? 'text-sky-100/78' : 'text-sky-100/62'}`}>
                                                    {landscapeCue}
                                                </p>
                                            )}
                                        </div>
                                        {isPrimary && !f.isProtected
                                            ? <span className="text-[7px] font-black text-emerald-300 bg-emerald-500/15 border border-emerald-500/30 px-1.5 py-0.5 rounded-full shrink-0">Start</span>
                                            : !f.isProtected && <span className="text-[8px] font-black uppercase tracking-widest text-white/24 shrink-0 pt-0.5">{getPotentialTierShort(f.findPotential)}</span>}
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
                    <p className="text-[8px] font-black text-amber-500/40 uppercase tracking-[0.25em] mb-2 px-1 mt-1">Trace Signals</p>
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
                                            <p className={`text-[8px] font-black uppercase tracking-widest leading-tight ${isSelected ? 'text-amber-200' : 'text-amber-300/55'}`}>{t.traceLabel}</p>
                                            <p className="text-[10px] font-bold text-white/45 leading-snug mt-0.5">{t.traceReason}</p>
                                        </div>
                                        <span className={`text-[8px] font-black uppercase tracking-widest rounded-full border px-1.5 py-0.5 shrink-0 ${isSelected ? 'border-amber-300/25 text-amber-100/70 bg-amber-300/[0.08]' : 'border-white/10 text-white/38 bg-white/[0.03]'}`}>Clue</span>
                                    </div>
                                    <div className="flex flex-wrap gap-1 mb-1.5">
                                        {sourceChips.map(chip => (
                                            <span key={chip} className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${isSelected ? 'border-amber-300/25 text-amber-100/70 bg-amber-300/[0.08]' : 'border-white/10 text-white/38 bg-white/[0.03]'}`}>
                                                {chip}
                                            </span>
                                        ))}
                                    </div>
                                    <div className="flex items-center justify-end gap-2 pt-0.5">
                                        <span className="text-[8px] font-mono text-white/22 shrink-0">{distanceLabel}</span>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                    <p className="text-[8px] font-bold text-white/20 italic text-center mt-2">Trace signals are weaker clues, not investigation targets.</p>
                </div>
            )}

            {/* Quiet scan / no-signal state */}
            {!historicMode && hasScanned && sortedHotspots.length === 0 && displayTargets.length === 0 && (
                <div className="rounded-xl bg-white/[0.03] border border-white/10 p-4 text-center">
                    <p className="text-xs font-black text-white/70 leading-tight">{scanNoSignal ? 'No signal' : 'Quiet scan area'}</p>
                    <p className="text-[10px] font-bold text-white/35 leading-snug mt-1">{scanNoSignal ? 'Tile data could not be fetched — check your connection and scan again.' : 'No strong hotspots or investigation targets stood out here. Try widening the view, checking the historic layers, or scanning a neighbouring field.'}</p>
                </div>
            )}

            {/* No targets notice within targets tab */}
            {!historicMode && mobileSheetMode === 'targets' && hasScanned && displayTargets.length === 0 && (sortedHotspots.length > 0 || displayTargets.length > 0) && (
                <p className="text-center text-[10px] font-bold text-white/20 uppercase tracking-widest italic py-6">No investigation targets from this scan</p>
            )}

            {/* Not yet scanned */}
            {!hasScanned && (
                <p className="text-center text-[10px] font-bold text-white/20 uppercase tracking-widest italic py-6">Scan to read the landscape</p>
            )}

        </>
    );
}
