import React from 'react';
import { useFieldGuideContext } from './FieldGuideContext';

export function ScanControlPanel() {
    const {
        findMe,
        isLocating,
        focusMode,
        setFocusMode,
        detectedFeatures,
        analyzing,
        isTerrainScanning,
        clearScan,
        executeScan,
        historicMode,
        setIsIntelOpen,
        setIntelDetailsOpen,
        setIntelLayersOpen,
        setHistoricMode,
        setHistoricLayerToggles,
        setActiveOpacityLayer,
        loadingPAS,
        sheetExpanded,
        selectedMonument,
        selectedUserFind,
        selectedPASFind,
        hasScanned,
        sortedHotspots,
        displayTargets,
        mobileSheetMode,
        setMobileSheetMode,
        clearMapItemSelections,
        selectedId,
    } = useFieldGuideContext();

    return (
        <>
            <div className={`grid grid-cols-[auto_auto_1fr_1fr] gap-2 transition-[margin] duration-300 ${sheetExpanded ? '' : 'mt-3'}`} onClick={e => e.stopPropagation()}>
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
                        else { setIsIntelOpen(false); setIntelDetailsOpen(false); setIntelLayersOpen(false); setHistoricMode(false); setHistoricLayerToggles({ lidar: false, os1930: false, os1880: false }); setActiveOpacityLayer(null); }
                    }}
                    disabled={analyzing}
                    className={`min-h-[34px] px-3 rounded-xl text-[10px] font-black tracking-widest uppercase border transition-all whitespace-nowrap ${analyzing ? 'bg-slate-800 text-slate-500 border-white/5 opacity-60 cursor-not-allowed' : historicMode ? 'bg-blue-500/20 text-blue-200 border-blue-400/40' : 'bg-blue-500 text-white border-blue-300/50 shadow-[0_0_12px_rgba(59,130,246,0.24)] hover:bg-blue-400'} ${loadingPAS && historicMode ? 'animate-pulse opacity-80' : ''}`}
                >
                    {(loadingPAS && historicMode) ? '...' : historicMode ? 'Clear' : 'Historic'}
                </button>
            </div>
            {sheetExpanded && selectedMonument === undefined && !selectedUserFind && !selectedPASFind && !historicMode && hasScanned && (sortedHotspots.length > 0 || displayTargets.length > 0) && (
                <div className="grid grid-cols-2 gap-1 rounded-xl border border-emerald-500/25 bg-slate-950/80 p-1 shadow-[0_0_14px_rgba(16,185,129,0.08)]" onClick={e => e.stopPropagation()}>
                    <button
                        onClick={() => { clearMapItemSelections(); setMobileSheetMode('hotspots'); }}
                        className={`rounded-lg px-2 py-2 text-[10px] font-black uppercase tracking-widest transition-colors ${mobileSheetMode === 'hotspots' && !selectedId ? 'bg-emerald-500 text-white shadow-[0_0_10px_rgba(16,185,129,0.25)]' : 'bg-white/[0.04] text-white/65 hover:text-white'}`}
                    >
                        Hotspots
                    </button>
                    <button
                        onClick={() => { clearMapItemSelections(); setMobileSheetMode('targets'); }}
                        className={`rounded-lg px-2 py-2 text-[10px] font-black uppercase tracking-widest transition-colors ${mobileSheetMode === 'targets' || !!selectedId ? 'bg-emerald-500 text-white shadow-[0_0_10px_rgba(16,185,129,0.25)]' : 'bg-white/[0.04] text-white/65 hover:text-white'}`}
                    >
                        Targets
                    </button>
                </div>
            )}
        </>
    );
}
