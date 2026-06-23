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
        setHistoricMode,
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
        persistSheetExpanded,
    } = useFieldGuideContext();

    const scanBusy = analyzing || isTerrainScanning || loadingPAS;
    const hasScanResult = hasScanned || historicMode || detectedFeatures.length > 0 || sortedHotspots.length > 0 || displayTargets.length > 0;
    const showResultSwitcher = sheetExpanded && selectedMonument === undefined && !selectedUserFind && !selectedPASFind && hasScanned && (sortedHotspots.length > 0 || displayTargets.length > 0);
    const showingTargets = mobileSheetMode === 'targets';

    const scrollPanelSectionIntoView = (id: string) => {
        window.setTimeout(() => {
            document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 80);
    };

    const showLandscapeRead = () => {
        clearMapItemSelections();
        setHistoricMode(true);
        persistSheetExpanded(true);
        scrollPanelSectionIntoView('mobile-landscape-read');
    };

    const showHotspots = () => {
        clearMapItemSelections();
        setHistoricMode(false);
        setMobileSheetMode('hotspots');
        persistSheetExpanded(true);
        scrollPanelSectionIntoView('mobile-hotspots-list');
    };

    const showTargets = () => {
        clearMapItemSelections();
        setHistoricMode(false);
        setMobileSheetMode('targets');
        persistSheetExpanded(true);
        scrollPanelSectionIntoView('mobile-targets-list');
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
            {showResultSwitcher && (
                <div className="rounded-xl border border-white/10 bg-slate-950/72 px-3 py-2 shadow-[0_10px_24px_rgba(0,0,0,0.22),0_0_14px_rgba(16,185,129,0.06)]" onClick={e => e.stopPropagation()}>
                    <div className="flex items-center justify-between gap-3">
                        <button
                            type="button"
                            onClick={showLandscapeRead}
                            aria-label="Back to landscape read"
                            title="Back to landscape read"
                            className={`grid h-7 w-8 place-items-center rounded-full border transition-colors ${historicMode ? 'border-sky-300/45 bg-sky-300/12 text-sky-200' : 'border-white/10 bg-white/[0.03] text-white/45 hover:text-white/75'}`}
                        >
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <path d="M9 14 4 9l5-5" />
                                <path d="M4 9h9a7 7 0 1 1-5.8 10.9" />
                            </svg>
                        </button>
                        <button
                            type="button"
                            onClick={showHotspots}
                            disabled={sortedHotspots.length === 0}
                            className={`group flex items-center gap-1.5 border-b pb-1 text-[0.5625rem] font-black uppercase tracking-[0.18em] transition-colors disabled:opacity-35 ${!historicMode && !showingTargets ? 'border-emerald-300 text-emerald-200' : 'border-transparent text-white/45 hover:text-white/75'}`}
                        >
                            <span>Hotspots</span>
                            <span className={`rounded-full px-1.5 py-0.5 text-[0.5rem] leading-none ${!historicMode && !showingTargets ? 'bg-emerald-300 text-slate-950' : 'bg-white/10 text-white/55 group-hover:text-white/75'}`}>{sortedHotspots.length}</span>
                        </button>
                        <button
                            type="button"
                            onClick={showTargets}
                            disabled={displayTargets.length === 0}
                            className={`group flex items-center gap-1.5 border-b pb-1 text-[0.5625rem] font-black uppercase tracking-[0.18em] transition-colors disabled:opacity-35 ${!historicMode && showingTargets ? 'border-amber-300 text-amber-200' : 'border-transparent text-white/45 hover:text-white/75'}`}
                        >
                            <span>Targets</span>
                            <span className={`rounded-full px-1.5 py-0.5 text-[0.5rem] leading-none ${!historicMode && showingTargets ? 'bg-amber-300 text-slate-950' : 'bg-white/10 text-white/55 group-hover:text-white/75'}`}>{displayTargets.length}</span>
                        </button>
                    </div>
                </div>
            )}
        </>
    );
}
