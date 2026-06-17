import React, { useRef, useState, useEffect } from 'react';
import { getDistance } from '../../utils/fieldGuideAnalysis';
import { FIELDGUIDE_SHORT_NOTICE } from '../../utils/legalCopy';
import { useFieldGuideContext } from './FieldGuideContext';
import { HISTORIC_LAYER_OPTIONS } from './FieldGuideContext';
import { LandscapeInterpretationBlock } from '../fieldguide/LandscapeInterpretationBlock';
import { db } from '../../db';
import type { LandscapeInterpretation, LandscapeInterpretationWorkerInput, LandscapeInterpretationWorkerOutput } from '../../types/landscapeInterpretation';
import type { Cluster, Hotspot } from '../../pages/fieldGuideTypes';

const ALIE_ENGINE_VERSION = 'ALIE-2026.06.17h';

// ─── Geohash encoder (precision 6) ───────────────────────────────────────────
// Self-contained — avoids coupling to engine layer.
const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';
function geohashEncode(lat: number, lon: number, precision = 6): string {
    let hash = '', minLat = -90, maxLat = 90, minLon = -180, maxLon = 180;
    let isEven = true, bits = 0, hashValue = 0;
    while (hash.length < precision) {
        if (isEven) {
            const mid = (minLon + maxLon) / 2;
            if (lon >= mid) { hashValue = (hashValue << 1) | 1; minLon = mid; }
            else            { hashValue = hashValue << 1;        maxLon = mid; }
        } else {
            const mid = (minLat + maxLat) / 2;
            if (lat >= mid) { hashValue = (hashValue << 1) | 1; minLat = mid; }
            else            { hashValue = hashValue << 1;        maxLat = mid; }
        }
        isEven = !isEven; bits++;
        if (bits === 5) { hash += BASE32[hashValue]; bits = 0; hashValue = 0; }
    }
    return hash;
}

function getSignalBand(value: number | null | undefined, cap = 100): string {
    const ratio = cap > 0 ? Math.max(0, Math.min(1, (value ?? 0) / cap)) : 0;
    if (ratio >= 0.72) return 'Strong';
    if (ratio >= 0.42) return 'Moderate';
    if (ratio > 0.08) return 'Trace';
    return 'Not present';
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

function averageAspect(clusters: Cluster[]): number {
    const aspects = clusters
        .map(c => c.aspect)
        .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    if (!aspects.length) return 180;

    const vector = aspects.reduce((acc, degrees) => {
        const radians = degrees * Math.PI / 180;
        return {
            x: acc.x + Math.cos(radians),
            y: acc.y + Math.sin(radians),
        };
    }, { x: 0, y: 0 });

    const degrees = Math.atan2(vector.y, vector.x) * 180 / Math.PI;
    return Math.round((degrees + 360) % 360);
}

function deriveTerrainProxy(
    clusters: Cluster[],
    primaryHotspot: Hotspot | null,
): Pick<LandscapeInterpretationWorkerInput, 'elevationM' | 'slopePercent' | 'aspectDegrees'> {
    const memberIds = new Set(primaryHotspot?.memberIds ?? []);
    const relevant = memberIds.size
        ? clusters.filter(c => memberIds.has(c.id))
        : clusters;

    const hasSlopeSignal = relevant.some(c => c.sources.includes('slope') || c.relativeElevation === 'Slope');
    const hasRaisedSignal = relevant.some(c => c.relativeElevation === 'Ridge' || c.polarity === 'Raised');
    const hasHollowSignal = relevant.some(c => c.relativeElevation === 'Hollow' || c.polarity === 'Sunken');

    return {
        // Proxy values: the terrain scan exposes relative landform cues, not DEM metres.
        elevationM: hasRaisedSignal ? 18 : hasHollowSignal ? -2 : hasSlopeSignal ? 6 : 0,
        slopePercent: hasSlopeSignal ? 6 : hasRaisedSignal ? 3 : 0,
        aspectDegrees: averageAspect(relevant),
    };
}

export function HistoricLayerManager() {
    const {
        showSavedPoints,
        selectedUserFind,
        selectedPASFind,
        selectedId,
        selectedHotspotId,
        selectedMonument,
        historicMode,
        historicScanComplete,
        loadingPAS,
        intelLayersOpen,
        setIntelLayersOpen,
        intelDetailsOpen,
        setIntelDetailsOpen,
        historicLayerVisibility,
        setHistoricLayerVisibility,
        potentialScore,
        scanConfidence,
        pasFinds,
        historicRoutes,
        sortedHotspots,
        terrainClusters,
        placeSignals,
        projectFinds,
        mapRef,
        sourceAvailability,
        sourceUsability,
        scanFromCache,
        clearMapItemSelections,
        setSelectedPASFind,
        setIsIntelOpen,
        nhleDataRef,
        aimDataRef,
        geologyContext,
    } = useFieldGuideContext();

    // ── ALIE state ────────────────────────────────────────────────────────────
    const [landscapeInterpretation, setLandscapeInterpretation] = useState<LandscapeInterpretation | null>(null);
    const [alieLoading, setAlieLoading] = useState(false);
    const workerRef = useRef<Worker | null>(null);

    // Only show when in historic mode and nothing else is selected
    if (showSavedPoints || selectedUserFind || selectedPASFind || (selectedId && !selectedHotspotId) || selectedMonument !== undefined || !historicMode) {
        return null;
    }

    const bd = potentialScore?.breakdown ?? null;
    const interp = getHistoricInterpretation(bd ? { terrain: bd.terrain, historic: bd.historic, spectral: bd.signals } : null);
    const sigLines = getSignalSummary(bd ? { terrain: bd.terrain, hydro: bd.hydro, historic: bd.historic, spectral: bd.signals } : null);
    const dedupedRoutes = [...historicRoutes.reduce((map, r) => {
        const key = `${r.type}:${r.name ?? ''}`;
        const existing = map.get(key);
        if (!existing || r.confidenceClass < existing.confidenceClass) map.set(key, r);
        return map;
    }, new Map<string, typeof historicRoutes[number]>()).values()];
    const routeLines = [...new Set([
        ...historicRoutes.filter(r => r.type === 'roman_road').map(r => `Roman road${r.name ? ` ${r.name}` : ''} runs through this scan area.`),
        ...historicRoutes.filter(r => r.type !== 'roman_road').map(r => {
            const label = r.type === 'holloway' ? 'Holloway' : 'Historic trackway';
            return `${label}${r.name ? ` ${r.name}` : ''} detected in this scan area.`;
        }),
    ])];
    const hasData = pasFinds.length > 0 || historicRoutes.length > 0 || placeSignals.length > 0;
    const mc = mapRef.current?.getCenter();
    const nearbyProjectFinds = mc ? projectFinds.filter(f => f.lat !== null && f.lon !== null && getDistance([f.lon!, f.lat!], [mc.lng, mc.lat]) <= 500) : [];

    return (
        <div className="space-y-3">
            <AlieSection
                historicScanComplete={historicScanComplete}
                loadingPAS={loadingPAS}
                nhleDataRef={nhleDataRef}
                aimDataRef={aimDataRef}
                historicRoutes={historicRoutes}
                geologyContext={geologyContext}
                sortedHotspots={sortedHotspots}
                terrainClusters={terrainClusters}
                potentialScoreBreakdown={potentialScore?.breakdown ?? null}
                mapRef={mapRef}
                workerRef={workerRef}
                landscapeInterpretation={landscapeInterpretation}
                setLandscapeInterpretation={setLandscapeInterpretation}
                alieLoading={alieLoading}
                setAlieLoading={setAlieLoading}
            />
            <div>
                <p className="text-[8px] font-black text-white/62 uppercase tracking-[0.2em] mb-1">Supporting Context</p>
                <h3 className="text-sm font-black text-white tracking-tight leading-tight">{loadingPAS ? 'Reading historic layers' : interp.title}</h3>
                <p className="text-[11px] font-bold text-white/65 leading-snug mt-1">{loadingPAS ? 'Checking records, route context and wider landscape signals.' : interp.subtitle}</p>
            </div>
            {(routeLines.length > 0 || sigLines.length > 0) && (
                <div className="border-t border-white/8 pt-3">
                    <p className="text-[8px] font-black text-white/62 uppercase tracking-widest mb-2">Why this stands out</p>
                    <div className="space-y-2">
                        {routeLines.map((line, i) => (
                            <div key={`r-${i}`} className="flex items-start gap-2">
                                <div className="w-1 h-1 rounded-full bg-amber-400 mt-1.5 shrink-0 shadow-[0_0_6px_rgba(251,191,36,0.7)]" />
                                <p className="text-xs font-bold text-white/85 leading-tight">{line}</p>
                            </div>
                        ))}
                        {sigLines.map((line, i) => (
                            <div key={`s-${i}`} className="flex items-start gap-2">
                                <div className="w-1 h-1 rounded-full bg-blue-400 mt-1.5 shrink-0 shadow-[0_0_6px_rgba(96,165,250,0.7)]" />
                                <p className="text-xs font-bold text-white/85 leading-tight">{line}</p>
                            </div>
                        ))}
                    </div>
                </div>
            )}
            {hasData && (
                <div className="grid grid-cols-3 gap-2">
                    <div className="rounded-xl bg-blue-500/10 border border-blue-500/20 p-2 text-center">
                        <span className="block text-sm font-black text-blue-300">{pasFinds.length}</span>
                        <span className="text-[7px] font-black text-white/65 uppercase tracking-widest">Sites</span>
                    </div>
                    <div className="rounded-xl bg-blue-500/10 border border-blue-500/20 p-2 text-center">
                        <span className="block text-sm font-black text-blue-300">{historicRoutes.length}</span>
                        <span className="text-[7px] font-black text-white/65 uppercase tracking-widest">Routes</span>
                        {historicRoutes.some(r => r.type === 'roman_road') && (
                            <span className="block text-[7px] font-black text-amber-400/70 uppercase tracking-widest mt-0.5">inc. Roman</span>
                        )}
                    </div>
                    <div className="rounded-xl bg-blue-500/10 border border-blue-500/20 p-2 text-center">
                        <span className="block text-sm font-black text-blue-300">{placeSignals.length}</span>
                        <span className="text-[7px] font-black text-white/65 uppercase tracking-widest">Names</span>
                    </div>
                </div>
            )}
            {nearbyProjectFinds.length > 0 && (
                <p className="text-[9px] font-black text-emerald-400/80 uppercase tracking-widest">{nearbyProjectFinds.length} find{nearbyProjectFinds.length !== 1 ? 's' : ''} recorded nearby</p>
            )}
            {sourceAvailability && (
                <div className="border-t border-white/8 pt-3">
                    <p className="text-[8px] font-black text-white/62 uppercase tracking-widest mb-2">Scan Source Coverage</p>
                    <div className="grid grid-cols-3 gap-1.5">
                        {[
                            { key: 'terrain', label: 'LiDAR' },
                            { key: 'terrain_global', label: 'Terrain' },
                            { key: 'slope', label: 'Slope' },
                            { key: 'hydrology', label: 'Water' },
                            { key: 'satellite_spring', label: 'Spring' },
                            { key: 'satellite_summer', label: 'Summer' },
                        ].map(({ key, label }) => {
                            const usability = sourceUsability[key] ?? 'none';
                            return (
                                <div key={key} className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg border ${usability === 'usable' ? 'bg-emerald-500/10 border-emerald-500/25' : usability === 'loaded' ? 'bg-white/5 border-white/15' : 'bg-white/3 border-white/8'}`}>
                                    <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${usability === 'usable' ? 'bg-emerald-400' : usability === 'loaded' ? 'bg-slate-400' : 'bg-slate-600'}`} />
                                    <span className={`text-[7px] font-black uppercase tracking-wide leading-tight ${usability === 'usable' ? 'text-emerald-300' : usability === 'loaded' ? 'text-slate-400' : 'text-slate-600'}`}>{label}</span>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}
            {!loadingPAS && !hasData && (
                <p className="text-center text-[10px] font-bold text-white/55 uppercase tracking-widest italic py-4">No historic context found here</p>
            )}
            {(hasData || potentialScore) && (
                <div className="border-t border-white/8 pt-3">
                    {historicScanComplete ? (
                        <div className="grid grid-cols-2 gap-2">
                            <button
                                onClick={() => setIntelDetailsOpen(v => !v)}
                                className={`rounded-xl border px-3 py-2 text-[9px] font-black uppercase tracking-widest transition-colors ${intelDetailsOpen ? 'bg-amber-500/20 border-amber-400/40 text-amber-200' : 'bg-white/[0.04] border-white/10 text-amber-400'}`}
                            >
                                Details
                            </button>
                            <div aria-hidden="true" />
                        </div>
                    ) : (
                        <div className="grid grid-cols-2 gap-2">
                            <button
                                onClick={() => setIntelDetailsOpen(v => !v)}
                                className={`rounded-xl border px-3 py-2 text-[9px] font-black uppercase tracking-widest transition-colors ${intelDetailsOpen ? 'bg-amber-500/20 border-amber-400/40 text-amber-200' : 'bg-white/[0.04] border-white/10 text-amber-400'}`}
                            >
                                Details
                            </button>
                            <button
                                onClick={() => setIntelLayersOpen(v => !v)}
                                className={`rounded-xl border px-3 py-2 text-[9px] font-black uppercase tracking-widest transition-colors ${intelLayersOpen ? 'bg-amber-500/20 border-amber-400/40 text-amber-200' : 'bg-white/[0.04] border-white/10 text-amber-400'}`}
                            >
                                Layers
                            </button>
                        </div>
                    )}
                    {intelLayersOpen && !historicScanComplete && (
                        <div className="mt-3 flex flex-wrap gap-2 animate-in fade-in duration-200">
                            {HISTORIC_LAYER_OPTIONS.map(({ key, label }) => (
                                <button key={key} onClick={() => setHistoricLayerVisibility(p => ({ ...p, [key]: !p[key as keyof typeof p] }))} className={`px-3 py-1.5 rounded-xl border text-[9px] font-black uppercase tracking-wider transition-all active:scale-95 ${historicLayerVisibility[key as keyof typeof historicLayerVisibility] ? 'bg-blue-500/20 border-blue-500/50 text-blue-300' : 'bg-white/5 border-white/10 text-slate-500'}`}>
                                    {label}
                                </button>
                            ))}
                        </div>
                    )}
                    {intelDetailsOpen && (
                        <div className="mt-4 space-y-4 animate-in fade-in duration-200">
                            {(() => {
                                const romanRoadCount = historicRoutes.filter(r => r.type === 'roman_road').length;
                                const augmentedFinds = [
                                    ...pasFinds,
                                    ...Array.from({ length: romanRoadCount }, (_, i) => ({
                                        id: `route-roman-${i}`,
                                        broadperiod: 'Roman',
                                        objectType: 'Roman Road',
                                        lat: 0, lon: 0,
                                        internalId: '',
                                        county: '',
                                        workflow: 'PAS' as const,
                                        isApprox: false,
                                        osmType: 'way' as const,
                                    })),
                                ];
                                return augmentedFinds.length > 0 && (
                                <div className="space-y-2">
                                    <p className="text-[8px] font-black text-blue-400/60 uppercase tracking-widest">Period Signals</p>
                                    <div className="grid grid-cols-2 gap-2">
                                        {Object.entries(augmentedFinds.reduce((acc, f) => { const p = f.broadperiod || 'Unknown'; acc[p] = (acc[p] || 0) + 1; return acc; }, {} as Record<string, number>)).sort((a, b) => b[1] - a[1]).map(([period, count]) => (
                                            <div key={period} className="bg-blue-500/5 border border-blue-500/10 p-3 rounded-xl flex justify-between items-center">
                                                <span className="text-[9px] font-black text-slate-300 uppercase truncate pr-2">{period}</span>
                                                <span className="text-sm font-black text-blue-400">{count}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                                );
                            })()}
                            {nearbyProjectFinds.length > 0 && (
                                <div className="space-y-2">
                                    <p className="text-[8px] font-black text-emerald-400/60 uppercase tracking-widest">Your Recorded Finds</p>
                                    <div className="space-y-1.5">
                                        {nearbyProjectFinds.map(f => (
                                            <div key={f.id} className="bg-emerald-500/5 border border-emerald-500/10 px-3 py-2 rounded-xl flex justify-between items-center">
                                                <span className="text-[10px] font-black text-white uppercase truncate pr-3">{f.objectType || 'Unknown'}</span>
                                                <span className="text-[9px] font-bold text-emerald-400/70 uppercase shrink-0">{f.period}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                            {pasFinds.length > 0 && (
                                <div className="space-y-2">
                                    <p className="text-[8px] font-black text-blue-400/60 uppercase tracking-widest">Historic Findings</p>
                                    <div className="space-y-2">
                                        {pasFinds.map(f => (
                                            <div key={f.id} onClick={() => { clearMapItemSelections('pasFind'); setSelectedPASFind(f); setIsIntelOpen(false); mapRef.current?.flyTo({ center: [f.lon, f.lat], zoom: 17 }); }} className="bg-blue-500/5 p-3 rounded-xl border border-blue-500/10 flex justify-between items-center active:bg-blue-500/20 transition-all">
                                                <div className="flex-1 min-w-0 pr-3">
                                                    <p className="text-xs font-black text-white uppercase truncate">{f.objectType}</p>
                                                    <p className="text-[9px] font-bold text-blue-400 uppercase">{f.broadperiod}</p>
                                                </div>
                                                <div className="text-right shrink-0">
                                                    <p className="text-[9px] font-black text-slate-500 font-mono tracking-tighter mb-0.5">{f.id}</p>
                                                    <p className="text-[8px] font-bold text-slate-400 uppercase italic leading-none">{f.county}</p>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                            {sortedHotspots.some(h => h.isHighConfidenceCrossing) && (
                                <div className="bg-blue-500/10 border border-blue-500/25 p-3 rounded-xl space-y-1">
                                    <p className="text-[9px] font-black text-blue-300 uppercase tracking-widest">Possible crossing point in scan area</p>
                                    <p className="text-[10px] font-bold text-slate-300 leading-tight">A route and water signal overlap here. Historic crossing points concentrate activity from multiple periods — they are high-value targets.</p>
                                </div>
                            )}
                            {historicRoutes.length > 0 && (
                                <div className="space-y-2">
                                    <p className="text-[8px] font-black text-amber-400/60 uppercase tracking-widest">Movement Corridors & Roads</p>
                                    <div className="space-y-2">
                                        {dedupedRoutes.map((r, i) => {
                                            const isRoman = r.type === 'roman_road';
                                            const isHolloway = r.type === 'holloway';
                                            const typeLabel = isRoman ? 'Roman Road' : isHolloway ? 'Holloway' : 'Historic Trackway';
                                            const confidenceLabel = r.confidenceClass === 'A' ? 'High confidence' : r.confidenceClass === 'B' ? 'Moderate confidence' : 'Possible alignment';
                                            const sourceName = r.source === 'itinere' ? 'Itiner-e dataset' : 'OpenStreetMap';
                                            return (
                                                <div key={i} className="bg-amber-500/5 border border-amber-500/15 p-3 rounded-xl">
                                                    <div className="flex items-start justify-between gap-2 mb-1">
                                                        <p className="text-xs font-black text-white uppercase truncate">{r.name ?? typeLabel}</p>
                                                        <span className="text-[8px] font-black text-amber-400/70 uppercase tracking-widest shrink-0">{typeLabel}</span>
                                                    </div>
                                                    <p className="text-[9px] font-bold text-slate-400 uppercase">{confidenceLabel} · {sourceName}</p>
                                                    {isRoman && (
                                                        <p className="text-[10px] font-bold text-amber-300/70 leading-tight mt-1.5">Focus detection along the road edge, not on the road surface — coin scatter concentrates in the zone of activity beside the road.</p>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                    {historicRoutes.some(r => r.type === 'roman_road') && (
                                        <p className="text-[9px] font-bold text-amber-400/60 leading-tight px-1">Roman roads are the strongest single predictor of coin scatter in England.</p>
                                    )}
                                </div>
                            )}
                            {placeSignals.length > 0 && (
                                <div className="space-y-2">
                                    <p className="text-[8px] font-black text-emerald-500/60 uppercase tracking-widest">Etymological Signals</p>
                                    <div className="space-y-2">
                                        {placeSignals.map((s, i) => (
                                            <div key={i} className="bg-emerald-500/5 border border-emerald-500/10 p-3 rounded-xl">
                                                <div className="flex justify-between items-start mb-1">
                                                    <span className="text-xs font-black text-white uppercase italic tracking-tight truncate pr-2">"{s.name}"</span>
                                                    <span className="text-[9px] font-bold text-emerald-500/60 uppercase shrink-0">{s.distance.toFixed(1)} km</span>
                                                </div>
                                                <p className="text-[8px] font-black text-emerald-500/40 uppercase mb-1 tracking-widest">{s.type}</p>
                                                <p className="text-[10px] font-bold text-slate-300 leading-tight">{s.meaning}</p>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}
            <div className="px-1 text-center text-[9px] font-medium leading-snug text-slate-400">
                {FIELDGUIDE_SHORT_NOTICE}
            </div>
        </div>
    );
}

// ─── ALIE Section (inner component, avoids hook-in-conditional issue) ─────────

interface AlieSectionProps {
    historicScanComplete: boolean;
    loadingPAS: boolean;
    nhleDataRef: React.RefObject<{ features: any[] } | null>;
    aimDataRef: React.RefObject<{ features: any[] } | null>;
    historicRoutes: import('../../pages/fieldGuideTypes').HistoricRoute[];
    geologyContext: import('../../engines/geologyContext').GeologyContext | null;
    sortedHotspots: import('../../pages/fieldGuideTypes').Hotspot[];
    terrainClusters: import('../../pages/fieldGuideTypes').Cluster[];
    potentialScoreBreakdown: { terrain: number; hydro: number; historic: number; signals: number } | null;
    mapRef: React.RefObject<import('maplibre-gl').Map | null>;
    workerRef: React.MutableRefObject<Worker | null>;
    landscapeInterpretation: LandscapeInterpretation | null;
    setLandscapeInterpretation: React.Dispatch<React.SetStateAction<LandscapeInterpretation | null>>;
    alieLoading: boolean;
    setAlieLoading: React.Dispatch<React.SetStateAction<boolean>>;
}

function AlieSection({
    historicScanComplete,
    loadingPAS,
    nhleDataRef,
    aimDataRef,
    historicRoutes,
    geologyContext,
    sortedHotspots,
    terrainClusters,
    potentialScoreBreakdown,
    mapRef,
    workerRef,
    landscapeInterpretation,
    setLandscapeInterpretation,
    alieLoading,
    setAlieLoading,
}: AlieSectionProps) {
    // ── On scan complete: load cached result then fire worker ─────────────────
    useEffect(() => {
        if (!historicScanComplete || loadingPAS) return;

        const center = mapRef.current?.getCenter();
        if (!center) return;

        const geohash6 = geohashEncode(center.lat, center.lng, 6);
        const nhleFeatures = nhleDataRef.current?.features ?? [];
        const aimFeatures  = aimDataRef.current?.features ?? [];

        const primaryHotspot = sortedHotspots[0] ?? null;
        const hotspotMetrics = primaryHotspot?.metrics ?? null;
        const hotspotContext = {
            hasCrossingHotspot: sortedHotspots.some(h =>
                h.isHighConfidenceCrossing ||
                h.classification === 'Crossing Point Candidate'
            ),
            hasMovementHotspot: sortedHotspots.some(h =>
                h.isOnCorridor ||
                h.classification === 'Route-Side Activity Zone' ||
                h.classification === 'Route-Influenced Area' ||
                h.classification === 'Crossing Point Candidate'
            ),
            hasRouteConvergenceHotspot: sortedHotspots.some(h =>
                h.classification === 'Junction / Convergence Zone' ||
                h.classification === 'Crossing Point Candidate' ||
                (h.linkedCount ?? 0) > 0
            ),
        };
        const terrainProxy = deriveTerrainProxy(terrainClusters, primaryHotspot);
        const geologyTileKey = geologyContext?.tileKey ?? 'nogeology';
        const inputSignature = [
            ALIE_ENGINE_VERSION,
            geologyTileKey,
            nhleFeatures.length,
            aimFeatures.length,
            historicRoutes.length,
            primaryHotspot?.id ?? 'nohotspot',
            hotspotContext.hasCrossingHotspot ? 'crossing' : 'nocrossing',
            hotspotContext.hasMovementHotspot ? 'movement' : 'nomovement',
            hotspotContext.hasRouteConvergenceHotspot ? 'converge' : 'noconverge',
            terrainProxy.elevationM,
            terrainProxy.slopePercent,
            terrainProxy.aspectDegrees,
        ].join('|');

        db.landscapeInterpretations.get(geohash6).then(cached => {
            const cachedInterpretation = cached?.interpretation as LandscapeInterpretation | undefined;
            if (
                cachedInterpretation?.engineVersion === ALIE_ENGINE_VERSION &&
                cached?.inputSignature === inputSignature
            ) {
                setLandscapeInterpretation(cachedInterpretation);
            }
        }).catch(() => { /* cache read failure is non-fatal */ });

        if (workerRef.current) {
            workerRef.current.terminate();
            workerRef.current = null;
        }

        const input: LandscapeInterpretationWorkerInput = {
            geohash6,
            nhleFeatures,
            aimFeatures,
            routeFeatures: historicRoutes,
            geologyContext,
            hotspotMetrics,
            hotspotContext,
            centerLat: center.lat,
            centerLon: center.lng,
            potentialBreakdown: potentialScoreBreakdown,
            ...terrainProxy,
        };

        console.log('[ALIE] worker input counts', {
            nhle: nhleFeatures.length,
            aim: aimFeatures.length,
            routes: historicRoutes.length,
        });

        setAlieLoading(true);

        try {
            const worker = new Worker(
                new URL('../../workers/landscapeInterpretation.worker.ts', import.meta.url),
                { type: 'module' }
            );
            workerRef.current = worker;

            worker.onmessage = (event: MessageEvent<LandscapeInterpretationWorkerOutput>) => {
                setAlieLoading(false);
                if (event.data.result) {
                    const result = event.data.result;
                    console.log('[ALIE] result', {
                        recordSparsity: result.recordSparsity,
                        temporalPersistence: result.temporalPersistence,
                        engineVersion: result.engineVersion,
                    });
                    setLandscapeInterpretation(result);
                    // Persist to Dexie (last-write-wins)
                    db.landscapeInterpretations.put({
                        geohash6: result.geohash6,
                        generatedAt: result.generatedAt,
                        engineVersion: result.engineVersion,
                        geologyTileKey,
                        inputSignature,
                        interpretation: result,
                    }).catch(() => { /* write failure non-fatal */ });
                }
                worker.terminate();
                workerRef.current = null;
            };

            worker.onerror = () => {
                setAlieLoading(false);
                worker.terminate();
                workerRef.current = null;
            };

            worker.postMessage(input);
        } catch {
            setAlieLoading(false);
        }

        // Cleanup on unmount
        return () => {
            if (workerRef.current) {
                workerRef.current.terminate();
                workerRef.current = null;
            }
        };
    }, [
        historicScanComplete,
        loadingPAS,
        geologyContext?.tileKey,
        historicRoutes,
        sortedHotspots,
        terrainClusters,
    ]); // eslint-disable-line react-hooks/exhaustive-deps

    if (!historicScanComplete && !landscapeInterpretation) return null;

    return (
        <LandscapeInterpretationBlock
            interpretation={landscapeInterpretation}
            loading={alieLoading}
        />
    );
}
