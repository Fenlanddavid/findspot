import React from 'react';
import type maplibregl from 'maplibre-gl';
import { useFieldGuideContext } from './FieldGuideContext';
import { HOTSPOT_TITLES } from './FieldGuideContext';

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
        loadingPAS,
        sheetExpanded,
        selectedMonument,
        selectedUserFind,
        selectedPASFind,
        hasScanned,
        sortedHotspots,
        displayTargets,
        setMobileSheetMode,
        clearMapItemSelections,
        selectedId,
        selectedHotspotId,
        setSelectedHotspotId,
        persistSheetExpanded,
        focusTarget,
        mapRef,
    } = useFieldGuideContext();

    const scanBusy = analyzing || isTerrainScanning || loadingPAS;
    const hasScanResult = hasScanned || historicMode || detectedFeatures.length > 0 || sortedHotspots.length > 0 || displayTargets.length > 0;
    const activeTargetId = displayTargets.some(t => t.id === selectedId) ? selectedId ?? '' : '';
    const activeHotspotId = sortedHotspots.some(h => h.id === selectedHotspotId) ? selectedHotspotId ?? '' : '';

    const openHotspot = (id: string) => {
        const hotspot = sortedHotspots.find(h => h.id === id);
        if (!hotspot) return;
        clearMapItemSelections('hotspot');
        setMobileSheetMode('hotspots');
        setSelectedHotspotId(hotspot.id);
        persistSheetExpanded(true);
        mapRef.current?.fitBounds(hotspot.bounds as maplibregl.LngLatBoundsLike, { padding: 40 });
    };

    const openTarget = (id: string) => {
        const target = displayTargets.find(t => t.id === id);
        if (!target) return;
        setMobileSheetMode('targets');
        focusTarget(target);
    };

    return (
        <>
            <div className={`grid grid-cols-[auto_auto_1fr] gap-2 transition-[margin] duration-300 ${sheetExpanded ? '' : 'mt-3'}`} onClick={e => e.stopPropagation()}>
                <button onClick={findMe} disabled={isLocating} className="min-h-[34px] bg-slate-800/90 text-slate-200 px-2.5 rounded-xl text-[0.5rem] font-black tracking-widest uppercase hover:bg-slate-700 hover:text-white transition-colors disabled:opacity-50 whitespace-nowrap border border-white/10 shrink-0">
                    {isLocating ? '...' : 'GPS'}
                </button>
                <button onClick={() => setFocusMode(v => !v)} className={`min-h-[34px] px-2.5 rounded-xl border shrink-0 transition-colors ${focusMode ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300' : 'bg-slate-800/90 border-white/10 text-slate-200 hover:bg-slate-700 hover:text-white'}`} title={focusMode ? 'Exit focus' : 'Focus — full screen map'}>
                    {focusMode
                        ? <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="10" y1="14" x2="21" y2="3"/><line x1="3" y1="21" x2="14" y2="10"/></svg>
                        : <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>
                    }
                </button>
                <button
                    onClick={hasScanResult ? clearScan : executeScan}
                    disabled={scanBusy}
                    className={`min-h-[34px] px-3 rounded-xl text-[0.625rem] font-black tracking-widest uppercase border transition-all whitespace-nowrap disabled:opacity-50 disabled:animate-pulse ${hasScanResult ? 'bg-emerald-500/20 text-emerald-200 border-emerald-400/40' : 'bg-emerald-500 text-white border-emerald-300/50 shadow-[0_0_12px_rgba(16,185,129,0.22)] hover:bg-emerald-400'}`}
                >
                    {scanBusy ? 'Reading...' : hasScanResult ? 'Clear Scan' : 'Scan Area'}
                </button>
            </div>
            {sheetExpanded && selectedMonument === undefined && !selectedUserFind && !selectedPASFind && hasScanned && (sortedHotspots.length > 0 || displayTargets.length > 0) && (
                <div className="grid grid-cols-2 gap-1 rounded-xl border border-emerald-500/25 bg-slate-950/80 p-1 shadow-[0_0_14px_rgba(16,185,129,0.08)]" onClick={e => e.stopPropagation()}>
                    <label className="min-w-0">
                        <span className="sr-only">Open hotspot</span>
                        <select
                            value={activeHotspotId}
                            onChange={e => openHotspot(e.target.value)}
                            disabled={sortedHotspots.length === 0}
                            className="h-9 w-full rounded-lg border border-white/10 bg-white/[0.04] px-2 text-[0.625rem] font-black uppercase tracking-widest text-white/80 outline-none transition-colors disabled:opacity-35"
                        >
                            <option value="">Hotspots</option>
                            {sortedHotspots.map(h => (
                                <option key={h.id} value={h.id}>
                                    {`Hotspot ${h.number} - ${HOTSPOT_TITLES[h.classification]}`}
                                </option>
                            ))}
                        </select>
                    </label>
                    <label className="min-w-0">
                        <span className="sr-only">Open target</span>
                        <select
                            value={activeTargetId}
                            onChange={e => openTarget(e.target.value)}
                            disabled={displayTargets.length === 0}
                            className="h-9 w-full rounded-lg border border-white/10 bg-white/[0.04] px-2 text-[0.625rem] font-black uppercase tracking-widest text-white/80 outline-none transition-colors disabled:opacity-35"
                        >
                            <option value="">Targets</option>
                            {displayTargets.map(t => (
                                <option key={t.id} value={t.id}>
                                    {`${t.isProtected ? 'Scheduled Monument' : `Target ${t.number.toString().padStart(2, '0')}`}${t.id === selectedId ? ' - Open' : ''}`}
                                </option>
                            ))}
                        </select>
                    </label>
                </div>
            )}
        </>
    );
}
