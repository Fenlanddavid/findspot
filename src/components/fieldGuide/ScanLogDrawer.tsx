import React from 'react';
import { setDurableSetting } from '../../services/clientStorage';
import { ANNOTATION_TYPE_LABELS } from '../../utils/devAnnotation';
import { useFieldGuideContext } from './FieldGuideContext';

function getPotentialTier(score: number): string {
    if (score > 80) return 'High Potential';
    if (score > 60) return 'Strong Potential';
    if (score > 35) return 'Moderate Potential';
    return 'Low Potential';
}

export function ScanLogDrawer() {
    const {
        devMode,
        setDevMode,
        setAnnotationMode,
        setPendingAnnotation,
        setDevAnnotations,
        sortedHotspots,
        displayTargets,
        pasFinds,
        historicRoutes,
        placeSignals,
        scanPhase,
        potentialScore,
        scanConfidence,
        sourceAvailability,
        hasScanned,
        annotationMode,
        devAnnotations,
        systemLog,
        logContainerRef,
        handleLabExport,
    } = useFieldGuideContext();

    return (
        <div className={devMode ? 'flex w-80 flex-col bg-slate-950 border-l border-white/5 shrink-0 relative z-50' : 'hidden'}>

            {/* Dev Mode Header */}
            <div className="px-4 py-3 border-b border-white/8 bg-amber-500/5 flex items-center justify-between shrink-0">
                <div className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                    <span className="text-[0.5625rem] font-black text-amber-400 uppercase tracking-[0.25em]">Dev Mode</span>
                </div>
                <button
                    onClick={() => {
                        setDevMode(false);
                        setAnnotationMode(false);
                        setPendingAnnotation(null);
                        setDevAnnotations([]);
                        void setDurableSetting('fs_fg_devmode', false);
                    }}
                    className="text-[0.5rem] font-black text-white/30 hover:text-white/70 uppercase tracking-widest transition-colors px-2 py-1 rounded-lg hover:bg-white/5 active:scale-95"
                >
                    Exit
                </button>
            </div>

            {/* Scan Stats */}
            <div className="px-4 py-3 border-b border-white/8 shrink-0">
                <p className="text-[0.4375rem] font-black text-white/25 uppercase tracking-[0.2em] mb-2">Scan State</p>
                <div className="grid grid-cols-3 gap-1.5 mb-2">
                    <div className="bg-white/[0.03] border border-white/8 rounded-lg p-2 text-center">
                        <span className="block text-sm font-black text-emerald-300">{sortedHotspots.length}</span>
                        <span className="text-[0.375rem] font-black text-white/25 uppercase tracking-widest">Hotspots</span>
                    </div>
                    <div className="bg-white/[0.03] border border-white/8 rounded-lg p-2 text-center">
                        <span className="block text-sm font-black text-white">{displayTargets.length}</span>
                        <span className="text-[0.375rem] font-black text-white/25 uppercase tracking-widest">Targets</span>
                    </div>
                    <div className="bg-white/[0.03] border border-white/8 rounded-lg p-2 text-center">
                        <span className="block text-sm font-black text-blue-300">{pasFinds.length + historicRoutes.length + placeSignals.length}</span>
                        <span className="text-[0.375rem] font-black text-white/25 uppercase tracking-widest">Context</span>
                    </div>
                </div>
                <div className="flex items-center justify-between gap-2">
                    <span className="text-[0.5rem] font-mono text-white/30">phase: <span className="text-emerald-400">{scanPhase}</span></span>
                    {potentialScore && <span className="text-[0.5rem] font-mono text-white/30">tier: <span className="text-emerald-400">{getPotentialTier(potentialScore.score)}</span></span>}
                    {scanConfidence && <span className="text-[0.5rem] font-mono text-white/30">conf: <span className="text-emerald-400">{scanConfidence}</span></span>}
                </div>
                {sourceAvailability && (
                    <div className="mt-2 flex flex-wrap gap-1">
                        {Object.entries(sourceAvailability).map(([k, v]) => (
                            <span key={k} className={`text-[0.375rem] font-black uppercase tracking-widest px-1.5 py-0.5 rounded border ${v ? 'text-emerald-400 border-emerald-500/30 bg-emerald-500/8' : 'text-white/20 border-white/8'}`}>{k}</span>
                        ))}
                    </div>
                )}
            </div>

            {/* Annotation Controls */}
            <div className="px-4 py-3 border-b border-white/8 shrink-0 space-y-2">
                <div className="flex items-center justify-between mb-2">
                    <p className="text-[0.4375rem] font-black text-white/25 uppercase tracking-[0.2em]">Annotations</p>
                    {devAnnotations.length > 0 && (
                        <span className="text-[0.4375rem] font-black text-orange-400 bg-orange-500/10 border border-orange-500/20 px-1.5 py-0.5 rounded">
                            {devAnnotations.length} placed
                        </span>
                    )}
                </div>
                <button
                    onClick={() => setAnnotationMode(v => !v)}
                    disabled={!hasScanned}
                    className={`w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg border text-[0.5625rem] font-black uppercase tracking-widest transition-colors disabled:opacity-30 disabled:cursor-not-allowed active:scale-[0.98] ${annotationMode ? 'border-orange-500/60 bg-orange-500/20 text-orange-300' : 'border-orange-500/30 bg-orange-500/8 text-orange-400 hover:bg-orange-500/15'}`}
                >
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/></svg>
                    {annotationMode ? 'Tap map to place pin' : 'Annotate Scan'}
                </button>
                {devAnnotations.length > 0 && (
                    <div className="space-y-1 max-h-28 overflow-y-auto scrollbar-hide">
                        {devAnnotations.map((a, i) => (
                            <div key={a.id} className="flex items-center justify-between bg-orange-500/5 border border-orange-500/15 rounded-lg px-2 py-1.5">
                                <div className="min-w-0">
                                    <span className="text-[0.4375rem] font-black text-orange-400 mr-1.5">#{i + 1}</span>
                                    <span className="text-[0.4375rem] text-white/50 truncate">{ANNOTATION_TYPE_LABELS[a.annotationType]}</span>
                                </div>
                                <button
                                    onClick={() => setDevAnnotations(prev => prev.filter(x => x.id !== a.id))}
                                    className="text-white/20 hover:text-white/60 ml-2 shrink-0 transition-colors"
                                >
                                    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Export Buttons */}
            <div className="px-4 py-3 border-b border-white/8 shrink-0 space-y-2">
                <p className="text-[0.4375rem] font-black text-white/25 uppercase tracking-[0.2em] mb-2">Export</p>
                <button
                    onClick={handleLabExport}
                    disabled={!sourceAvailability && devAnnotations.length === 0}
                    className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-amber-500/30 bg-amber-500/8 text-amber-400 text-[0.5625rem] font-black uppercase tracking-widest hover:bg-amber-500/15 transition-colors disabled:opacity-30 disabled:cursor-not-allowed active:scale-[0.98]"
                >
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                    Export for Lab
                </button>
            </div>

            {/* System Console — fills remaining space */}
            <div className="flex-1 bg-black/60 overflow-y-auto p-4 scrollbar-hide" ref={logContainerRef}>
                <p className="text-[0.4375rem] font-black text-white/40 uppercase tracking-[0.2em] mb-2">Console</p>
                <div className="font-mono text-[0.5625rem] leading-relaxed">
                    {systemLog.map((l, i) => (
                        <div key={i} className={`mb-1 ${l.level === 'error' ? 'text-red-400' : l.level === 'warn' ? 'text-amber-400' : l.source === 'historic' ? 'text-blue-300' : 'text-emerald-400'}`}>
                            {l.message}
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
