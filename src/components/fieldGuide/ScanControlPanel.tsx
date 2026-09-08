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
            <div className={`flex min-w-0 flex-wrap gap-2 transition-[margin] duration-300 ${sheetExpanded ? '' : 'mt-3'}`} onClick={e => e.stopPropagation()}>
                <button onClick={findMe} disabled={isLocating} className="order-2 min-h-12 min-w-0 flex-1 whitespace-normal rounded-xl border border-white/15 bg-slate-800/90 px-3 text-sm font-bold text-slate-100 transition-colors hover:bg-slate-700 hover:text-white disabled:opacity-50 sm:order-none sm:flex-none sm:whitespace-nowrap">
                    {isLocating ? 'Locating…' : 'My location'}
                </button>
                <button aria-label={focusMode ? 'Exit full screen map' : 'Open full screen map'} onClick={() => setFocusMode(v => !v)} className={`order-2 min-h-12 min-w-12 shrink-0 rounded-xl border px-3 transition-colors sm:order-none ${focusMode ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-200' : 'bg-slate-800/90 border-white/15 text-slate-100 hover:bg-slate-700 hover:text-white'}`} title={focusMode ? 'Exit focus' : 'Focus — full screen map'}>
                    {focusMode
                        ? <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="10" y1="14" x2="21" y2="3"/><line x1="3" y1="21" x2="14" y2="10"/></svg>
                        : <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>
                    }
                </button>
                <button
                    onClick={executeScan}
                    disabled={scanBusy}
                    className="order-1 min-h-12 basis-full rounded-xl border border-emerald-300/60 bg-emerald-500 px-4 text-sm font-black text-white shadow-[0_0_12px_rgba(16,185,129,0.22)] transition-all hover:bg-emerald-400 disabled:opacity-50 sm:order-none sm:min-w-0 sm:flex-1 sm:basis-auto"
                >
                    {scanBusy ? 'Reading area…' : hasScanResult ? 'Scan again' : 'Scan area'}
                </button>
                {hasScanResult && <button type="button" onClick={clearScan} disabled={scanBusy} className="order-2 min-h-12 shrink-0 rounded-xl border border-white/15 bg-slate-800/80 px-3 text-sm font-bold text-slate-200 disabled:opacity-50 sm:order-none">Clear</button>}
            </div>
            {showResultSwitcher && (
                <div className="rounded-xl border border-white/10 bg-slate-950/72 px-3 py-2 shadow-[0_10px_24px_rgba(0,0,0,0.22),0_0_14px_rgba(16,185,129,0.06)]" onClick={e => e.stopPropagation()}>
                    <div className="flex items-center justify-between gap-3">
                        <button
                            type="button"
                            onClick={showLandscapeRead}
                            aria-label="Back to landscape read"
                            title="Back to landscape read"
                            className={`grid min-h-11 min-w-11 place-items-center rounded-full border transition-colors ${historicMode ? 'border-sky-300/45 bg-sky-300/12 text-sky-200' : 'border-white/15 bg-white/[0.03] text-white/70 hover:text-white'}`}
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
                            className={`group flex min-h-11 items-center gap-1.5 border-b px-2 text-sm font-bold transition-colors disabled:opacity-35 ${!historicMode && !showingTargets ? 'border-emerald-300 text-emerald-200' : 'border-transparent text-white/65 hover:text-white'}`}
                        >
                            <span>Hotspots</span>
                            <span className={`rounded-full px-1.5 py-0.5 text-[0.5rem] leading-none ${!historicMode && !showingTargets ? 'bg-emerald-300 text-slate-950' : 'bg-white/10 text-white/55 group-hover:text-white/75'}`}>{sortedHotspots.length}</span>
                        </button>
                        <button
                            type="button"
                            onClick={showTargets}
                            disabled={displayTargets.length === 0}
                            className={`group flex min-h-11 items-center gap-1.5 border-b px-2 text-sm font-bold transition-colors disabled:opacity-35 ${!historicMode && showingTargets ? 'border-amber-300 text-amber-200' : 'border-transparent text-white/65 hover:text-white'}`}
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
