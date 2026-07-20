import React, { useRef, useState, useEffect, useMemo } from 'react';
import { diagLog } from '../../services/diagLog';
import { getDistance } from '../../utils/fieldGuideAnalysis';
import { FIELDGUIDE_SHORT_NOTICE } from '../../utils/legalCopy';
import { useFieldGuideContext } from './FieldGuideContext';
import { HISTORIC_LAYER_OPTIONS } from './FieldGuideContext';
import { LandscapeInterpretationBlock } from './LandscapeInterpretationBlock';
import { GlanceCard } from './GlanceCard';
import { SMUnavailableBanner } from './SMUnavailableBanner';
import { db } from '../../db';
import type { Find } from '../../db';
import { buildLandscapeEvidence } from '../../services/fieldguide/landscapeEvidence';
import type { LandscapeEvidence } from '../../services/fieldguide/landscapeEvidence';
import { buildFieldStrategy } from '../../services/fieldguide/fieldStrategy';
import { deriveTerrainSignals } from '../../services/fieldguide/terrainSignals';
import { pasPeriodEntries, pasTypeEntries } from '../../services/pasDensityService';
import { heritageGatewayUrl } from '../../lib/heritageGatewayLink';
import type { LandscapeInterpretation, LandscapeInterpretationWorkerInput, LandscapeInterpretationWorkerOutput, PersonalFindsInput } from '../../types/landscapeInterpretation';
import type { Cluster, HistoricFind, Hotspot, LandscapeIntelligence } from '../../pages/fieldGuideTypes';

const ALIE_ENGINE_VERSION = 'ALIE-2026.06.22a';

// ─── Haversine distance in metres ───────────────────────────────────────────
function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6_371_000;
    const toRad = (d: number) => d * Math.PI / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

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

function HeritageGatewayLink({ lat, lng }: { lat: number; lng: number }) {
    return (
        <a
            href={heritageGatewayUrl({ lat, lng })}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-center text-xs font-black uppercase tracking-wider text-blue-300 transition-colors hover:border-blue-400/35 hover:bg-blue-500/10 hover:text-blue-200"
        >
            <span>Historic environment records near here — Heritage Gateway (beta)</span>
            <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                className="shrink-0"
            >
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                <polyline points="15 3 21 3 21 9" />
                <line x1="10" y1="14" x2="21" y2="3" />
            </svg>
        </a>
    );
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
        hasScanned,
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
        displayTargets,
        sortedHotspots,
        terrainClusters,
        placeSignals,
        projectFinds,
        mapRef,
        sourceAvailability,
        sourceUsability,
        scanFromCache,
        scheduledMonumentCheckFailed,
        scheduledMonumentUnavailableReason,
        clearMapItemSelections,
        focusTarget,
        setSelectedPASFind,
        setIsIntelOpen,
        nhleDataRef,
        aimDataRef,
        terrainScanCenterRef,
        geologyContext,
        pasDensityCell,
        landscapeIntelligenceMap,
    } = useFieldGuideContext();

    // ── ALIE state ────────────────────────────────────────────────────────────
    const [landscapeInterpretation, setLandscapeInterpretation] = useState<LandscapeInterpretation | null>(null);
    const [alieLoading, setAlieLoading] = useState(false);
    const [heritageGatewayCenter, setHeritageGatewayCenter] = useState<{ lat: number; lng: number } | null>(null);
    const workerRef = useRef<Worker | null>(null);

    useEffect(() => {
        if (!historicScanComplete) {
            setHeritageGatewayCenter(null);
            return;
        }

        const scanCenter = terrainScanCenterRef.current;
        if (scanCenter) {
            setHeritageGatewayCenter(scanCenter);
            return;
        }

        const center = mapRef.current?.getCenter();
        if (center) setHeritageGatewayCenter({ lat: center.lat, lng: center.lng });
    }, [historicScanComplete, terrainScanCenterRef, mapRef]);

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
    ])].slice(0, 4);
    const hasData = pasFinds.length > 0 || historicRoutes.length > 0 || placeSignals.length > 0;
    const mc = mapRef.current?.getCenter();
    const nearbyProjectFinds = mc ? projectFinds.filter(f => f.lat !== null && f.lon !== null && getDistance([f.lon!, f.lat!], [mc.lng, mc.lat]) <= 500) : [];

    return (
        <div className="space-y-3">
            <AlieSection
                historicScanComplete={historicScanComplete || (hasScanned && !loadingPAS)}
                loadingPAS={loadingPAS}
                nhleDataRef={nhleDataRef}
                aimDataRef={aimDataRef}
                historicRoutes={historicRoutes}
                geologyContext={geologyContext}
                sortedHotspots={sortedHotspots}
                displayTargets={displayTargets}
                terrainClusters={terrainClusters}
                potentialScoreBreakdown={potentialScore?.breakdown ?? null}
                mapRef={mapRef}
                workerRef={workerRef}
                landscapeInterpretation={landscapeInterpretation}
                setLandscapeInterpretation={setLandscapeInterpretation}
                alieLoading={alieLoading}
                setAlieLoading={setAlieLoading}
                landscapeIntelligenceMap={landscapeIntelligenceMap}
                projectFinds={projectFinds}
                pasFinds={pasFinds}
                pasDensityCell={pasDensityCell}
                focusTarget={focusTarget}
                scheduledMonumentCheckFailed={scheduledMonumentCheckFailed}
                scheduledMonumentUnavailableReason={scheduledMonumentUnavailableReason}
            />
            {scheduledMonumentCheckFailed && (
                <SMUnavailableBanner
                    reason={scheduledMonumentUnavailableReason}
                    fallbackBody="Protected monument data could not be confirmed for this landscape review. Use official records before treating the area as clear."
                />
            )}
            {/* PAS Record Density — shows after scan completes, sourced from git-bundled density index */}
            {historicScanComplete && pasDensityCell !== null && (() => {
                const c = pasDensityCell.c;
                const tier = c >= 500 ? 'very-high' : c >= 200 ? 'high' : c >= 60 ? 'moderate' : c >= 15 ? 'low' : 'none';
                const tierLabel = tier === 'very-high' ? 'Very high density' : tier === 'high' ? 'High density' : tier === 'moderate' ? 'Moderate density' : tier === 'low' ? 'Low density' : null;
                const tierColour = tier === 'very-high' ? 'bg-violet-500/15 border-violet-500/30 text-violet-300' : tier === 'high' ? 'bg-blue-500/15 border-blue-500/30 text-blue-300' : tier === 'moderate' ? 'bg-cyan-500/15 border-cyan-500/30 text-cyan-300' : 'bg-white/8 border-white/18 text-white/55';
                const toTitle = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
                const periodEntries = pasPeriodEntries(pasDensityCell).slice(0, 3);
                return (
                    <div className="border border-blue-500/20 bg-blue-500/[0.06] rounded-xl px-3 py-2.5 space-y-2">
                        <p className="text-[0.5625rem] font-black text-blue-300/70 uppercase tracking-[0.2em]">PAS Record Density</p>
                        {c > 0 && tierLabel ? (
                            <>
                                <div className="flex items-center gap-1.5 flex-wrap">
                                    <span className={`text-[0.625rem] font-black px-2 py-0.5 rounded-full border ${tierColour}`}>
                                        {tierLabel} · {c.toLocaleString()} records
                                    </span>
                                    {periodEntries.map(([period, count]) => (
                                        <span key={period} className="text-[0.5625rem] font-bold text-blue-200/65 bg-blue-500/10 border border-blue-500/15 px-1.5 py-0.5 rounded-full">
                                            {toTitle(period)}{count > 0 ? ` · ${count.toLocaleString()}` : ''}
                                        </span>
                                    ))}
                                </div>
                                <p className="text-[0.625rem] font-bold text-white/45 leading-snug">Public PAS records within the wider landscape cell (~36 km²). Density reflects recording activity and does not directly map the full archaeological resource.</p>
                            </>
                        ) : (
                            <p className="text-[0.625rem] font-bold text-white/45 leading-snug">No public PAS records in this landscape cell. May reflect low recording or detecting activity rather than archaeological absence.</p>
                        )}
                    </div>
                );
            })()}
            <div>
                <p className="text-[0.5625rem] font-black text-white/62 uppercase tracking-[0.2em] mb-1">Supporting Context</p>
                <h3 className="text-base font-black text-white tracking-tight leading-tight">{loadingPAS ? 'Reading historic layers' : interp.title}</h3>
                <p className="text-xs font-bold text-white/65 leading-snug mt-1">{loadingPAS ? 'Checking records, route context and wider landscape signals.' : interp.subtitle}</p>
            </div>
            {(routeLines.length > 0 || sigLines.length > 0) && (
                <div className="border-t border-white/8 pt-3">
                    <p className="text-[0.5625rem] font-black text-white/62 uppercase tracking-widest mb-2">Why this stands out</p>
                    <div className="space-y-2">
                        {routeLines.map((line, i) => (
                            <div key={`r-${i}`} className="flex items-start gap-2">
                                <div className="w-1 h-1 rounded-full bg-amber-400 mt-1.5 shrink-0 shadow-[0_0_6px_rgba(251,191,36,0.7)]" />
                                <p className="text-sm font-bold text-white/85 leading-tight">{line}</p>
                            </div>
                        ))}
                        {sigLines.slice(0, 4).map((line, i) => (
                            <div key={`s-${i}`} className="flex items-start gap-2">
                                <div className="w-1 h-1 rounded-full bg-blue-400 mt-1.5 shrink-0 shadow-[0_0_6px_rgba(96,165,250,0.7)]" />
                                <p className="text-sm font-bold text-white/85 leading-tight">{line}</p>
                            </div>
                        ))}
                    </div>
                </div>
            )}
            {hasData && (
                <div className="grid grid-cols-3 gap-2">
                    <div className="rounded-xl bg-blue-500/10 border border-blue-500/20 p-2 text-center">
                        <span className="block text-base font-black text-blue-300">{pasFinds.length}</span>
                        <span className="text-[0.5rem] font-black text-white/65 uppercase tracking-widest">Sites</span>
                    </div>
                    <div className="rounded-xl bg-blue-500/10 border border-blue-500/20 p-2 text-center">
                        <span className="block text-base font-black text-blue-300">{historicRoutes.length}</span>
                        <span className="text-[0.5rem] font-black text-white/65 uppercase tracking-widest">Routes</span>
                        {historicRoutes.some(r => r.type === 'roman_road') && (
                            <span className="block text-[0.5rem] font-black text-amber-400/70 uppercase tracking-widest mt-0.5">inc. Roman</span>
                        )}
                    </div>
                    <div className="rounded-xl bg-blue-500/10 border border-blue-500/20 p-2 text-center">
                        <span className="block text-base font-black text-blue-300">{placeSignals.length}</span>
                        <span className="text-[0.5rem] font-black text-white/65 uppercase tracking-widest">Names</span>
                    </div>
                </div>
            )}
            {nearbyProjectFinds.length > 0 && (
                <p className="text-[0.625rem] font-black text-emerald-400/80 uppercase tracking-widest">{nearbyProjectFinds.length} find{nearbyProjectFinds.length !== 1 ? 's' : ''} recorded nearby</p>
            )}
            {sourceAvailability && (
                <div className="border-t border-white/8 pt-3">
                    <p className="text-[0.5625rem] font-black text-white/62 uppercase tracking-widest mb-2">Scan Source Coverage</p>
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
                                    <span className={`text-[0.5rem] font-black uppercase tracking-wide leading-tight ${usability === 'usable' ? 'text-emerald-300' : usability === 'loaded' ? 'text-slate-400' : 'text-slate-600'}`}>{label}</span>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}
            {!loadingPAS && !hasData && (
                <p className="text-center text-[0.6875rem] font-bold text-white/55 uppercase tracking-widest italic py-4">No historic context found here</p>
            )}
            {(hasData || potentialScore) && (
                <div className="border-t border-white/8 pt-3">
                    {historicScanComplete ? (
                        <div className="grid grid-cols-2 gap-2">
                            <button
                                onClick={() => setIntelDetailsOpen(v => !v)}
                                className={`rounded-xl border px-3 py-2 text-[0.625rem] font-black uppercase tracking-widest transition-colors ${intelDetailsOpen ? 'bg-amber-500/20 border-amber-400/40 text-amber-200' : 'bg-white/[0.04] border-white/10 text-amber-400'}`}
                            >
                                Details
                            </button>
                            <div aria-hidden="true" />
                        </div>
                    ) : (
                        <div className="grid grid-cols-2 gap-2">
                            <button
                                onClick={() => setIntelDetailsOpen(v => !v)}
                                className={`rounded-xl border px-3 py-2 text-[0.625rem] font-black uppercase tracking-widest transition-colors ${intelDetailsOpen ? 'bg-amber-500/20 border-amber-400/40 text-amber-200' : 'bg-white/[0.04] border-white/10 text-amber-400'}`}
                            >
                                Details
                            </button>
                            <button
                                onClick={() => setIntelLayersOpen(v => !v)}
                                className={`rounded-xl border px-3 py-2 text-[0.625rem] font-black uppercase tracking-widest transition-colors ${intelLayersOpen ? 'bg-amber-500/20 border-amber-400/40 text-amber-200' : 'bg-white/[0.04] border-white/10 text-amber-400'}`}
                            >
                                Layers
                            </button>
                        </div>
                    )}
                    {intelLayersOpen && !historicScanComplete && (
                        <div className="mt-3 flex flex-wrap gap-2 animate-in fade-in duration-200">
                            {HISTORIC_LAYER_OPTIONS.map(({ key, label }) => (
                                <button key={key} onClick={() => setHistoricLayerVisibility(p => ({ ...p, [key]: !p[key as keyof typeof p] }))} className={`px-3 py-1.5 rounded-xl border text-[0.625rem] font-black uppercase tracking-wider transition-all active:scale-95 ${historicLayerVisibility[key as keyof typeof historicLayerVisibility] ? 'bg-blue-500/20 border-blue-500/50 text-blue-300' : 'bg-white/5 border-white/10 text-slate-500'}`}>
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
                                const pasLandscapePeriods = pasDensityCell && pasDensityCell.c >= 15
                                    ? pasPeriodEntries(pasDensityCell).filter(([, count]) => count > 0)
                                    : [];
                                return (augmentedFinds.length > 0 || pasLandscapePeriods.length > 0) && (
                                <div className="space-y-2">
                                    <p className="text-[0.5625rem] font-black text-blue-400/60 uppercase tracking-widest">Period Signals</p>
                                    {augmentedFinds.length > 0 && (
                                        <div className="grid grid-cols-2 gap-2">
                                            {Object.entries(augmentedFinds.reduce((acc, f) => { const p = f.broadperiod || 'Unknown'; acc[p] = (acc[p] || 0) + 1; return acc; }, {} as Record<string, number>)).sort((a, b) => b[1] - a[1]).map(([period, count]) => (
                                                <div key={period} className="bg-blue-500/5 border border-blue-500/10 p-3 rounded-xl flex justify-between items-center">
                                                    <span className="text-[0.625rem] font-black text-slate-300 uppercase truncate pr-2">{period}</span>
                                                    <span className="text-base font-black text-blue-400">{count}</span>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                    {pasLandscapePeriods.length > 0 && (
                                        <div className="space-y-1.5 pt-1">
                                            <p className="text-[0.5rem] font-black text-blue-300/40 uppercase tracking-widest">PAS landscape periods</p>
                                            <div className="grid grid-cols-2 gap-2">
                                                {pasLandscapePeriods.map(([period, count]) => (
                                                    <div key={period} className="bg-cyan-500/5 border border-cyan-500/10 p-3 rounded-xl flex justify-between items-center">
                                                        <span className="text-[0.625rem] font-black text-slate-300 uppercase truncate pr-2">{period}</span>
                                                        <span className="text-base font-black text-cyan-400">{count.toLocaleString()}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                                );
                            })()}
                            {nearbyProjectFinds.length > 0 && (
                                <div className="space-y-2">
                                    <p className="text-[0.5625rem] font-black text-emerald-400/60 uppercase tracking-widest">Your Recorded Finds</p>
                                    <div className="space-y-1.5">
                                        {nearbyProjectFinds.map(f => (
                                            <div key={f.id} className="bg-emerald-500/5 border border-emerald-500/10 px-3 py-2 rounded-xl flex justify-between items-center">
                                                <span className="text-[0.6875rem] font-black text-white uppercase truncate pr-3">{f.objectType || 'Unknown'}</span>
                                                <span className="text-[0.625rem] font-bold text-emerald-400/70 uppercase shrink-0">{f.period}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                            {pasFinds.length > 0 && (
                                <div className="space-y-2">
                                    <p className="text-[0.5625rem] font-black text-blue-400/60 uppercase tracking-widest">Historic Findings</p>
                                    <div className="space-y-2">
                                        {pasFinds.map(f => (
                                            <div key={f.id} onClick={() => { clearMapItemSelections('pasFind'); setSelectedPASFind(f); setIsIntelOpen(false); mapRef.current?.flyTo({ center: [f.lon, f.lat], zoom: 17 }); }} className="bg-blue-500/5 p-3 rounded-xl border border-blue-500/10 flex justify-between items-center active:bg-blue-500/20 transition-all">
                                                <div className="flex-1 min-w-0 pr-3">
                                                    <p className="text-sm font-black text-white uppercase truncate">{f.objectType}</p>
                                                    <p className="text-[0.625rem] font-bold text-blue-400 uppercase">{f.broadperiod}</p>
                                                </div>
                                                <div className="text-right shrink-0">
                                                    <p className="text-[0.625rem] font-black text-slate-500 font-mono tracking-tighter mb-0.5">{f.id}</p>
                                                    <p className="text-[0.5625rem] font-bold text-slate-400 uppercase italic leading-none">{f.county}</p>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                            {pasDensityCell !== null && (
                                <div className="space-y-2">
                                    <p className="text-[0.5625rem] font-black text-blue-400/60 uppercase tracking-widest">Portable Antiquities (Landscape)</p>
                                    {pasDensityCell.c > 0 ? (
                                        <>
                                            <div className="bg-blue-500/5 border border-blue-500/10 p-3 rounded-xl space-y-2">
                                                <div className="flex justify-between items-center">
                                                    <span className="text-[0.625rem] font-black text-slate-300 uppercase">Public PAS records</span>
                                                    <span className="text-base font-black text-blue-400">{pasDensityCell.c.toLocaleString()}</span>
                                                </div>
                                                {pasPeriodEntries(pasDensityCell).length > 0 && (
                                                    <div>
                                                        <p className="text-[0.5rem] font-black text-blue-300/50 uppercase tracking-widest mb-1">Top periods</p>
                                                        <div className="flex flex-wrap gap-1">
                                                            {pasPeriodEntries(pasDensityCell).map(([period, count]) => (
                                                                <span key={period} className="text-[0.5625rem] font-bold text-blue-200/70 bg-blue-500/10 border border-blue-500/15 px-1.5 py-0.5 rounded-full uppercase">
                                                                    {period}{count > 0 ? ` · ${count.toLocaleString()}` : ''}
                                                                </span>
                                                            ))}
                                                        </div>
                                                    </div>
                                                )}
                                                {pasTypeEntries(pasDensityCell).length > 0 && (
                                                    <div>
                                                        <p className="text-[0.5rem] font-black text-blue-300/50 uppercase tracking-widest mb-1">Top object types</p>
                                                        <div className="flex flex-wrap gap-1">
                                                            {pasTypeEntries(pasDensityCell).map(([type, count]) => (
                                                                <span key={type} className="text-[0.5625rem] font-bold text-slate-400 bg-white/5 border border-white/10 px-1.5 py-0.5 rounded-full uppercase">
                                                                    {type}{count > 0 ? ` · ${count.toLocaleString()}` : ''}
                                                                </span>
                                                            ))}
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                            <p className="text-[0.5625rem] font-bold text-white/35 leading-snug px-1">Records in the wider ~36 km² landscape cell. Reflects reporting activity — not a complete record of archaeology.</p>
                                        </>
                                    ) : (
                                        <div className="bg-white/[0.03] border border-white/8 p-3 rounded-xl">
                                            <p className="text-[0.625rem] font-bold text-white/40 leading-snug">No public PAS records in this landscape cell. May reflect low recording or detecting activity.</p>
                                        </div>
                                    )}
                                </div>
                            )}
                            {sortedHotspots.some(h => h.isHighConfidenceCrossing) && (
                                <div className="bg-blue-500/10 border border-blue-500/25 p-3 rounded-xl space-y-1">
                                    <p className="text-[0.625rem] font-black text-blue-300 uppercase tracking-widest">Possible crossing point in scan area</p>
                                    <p className="text-[0.6875rem] font-bold text-slate-300 leading-tight">A route and water signal overlap here. Historic crossing points concentrate activity from multiple periods — they are high-value targets.</p>
                                </div>
                            )}
                            {historicRoutes.length > 0 && (
                                <div className="space-y-2">
                                    <p className="text-[0.5625rem] font-black text-amber-400/60 uppercase tracking-widest">Movement Corridors & Roads</p>
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
                                                        <p className="text-sm font-black text-white uppercase truncate">{r.name ?? typeLabel}</p>
                                                        <span className="text-[0.5625rem] font-black text-amber-400/70 uppercase tracking-widest shrink-0">{typeLabel}</span>
                                                    </div>
                                                    <p className="text-[0.625rem] font-bold text-slate-400 uppercase">{confidenceLabel} · {sourceName}</p>
                                                    {isRoman && (
                                                        <p className="text-[0.6875rem] font-bold text-amber-300/70 leading-tight mt-1.5">Focus detection along the road edge, not on the road surface — coin scatter concentrates in the zone of activity beside the road.</p>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                    {historicRoutes.some(r => r.type === 'roman_road') && (
                                        <p className="text-[0.625rem] font-bold text-amber-400/60 leading-tight px-1">Roman roads are the strongest single predictor of coin scatter in England.</p>
                                    )}
                                </div>
                            )}
                            {placeSignals.length > 0 && (
                                <div className="space-y-2">
                                    <p className="text-[0.5625rem] font-black text-emerald-500/60 uppercase tracking-widest">Etymological Signals</p>
                                    <div className="space-y-2">
                                        {placeSignals.map((s, i) => (
                                            <div key={i} className="bg-emerald-500/5 border border-emerald-500/10 p-3 rounded-xl">
                                                <div className="flex justify-between items-start mb-1">
                                                    <span className="text-sm font-black text-white uppercase italic tracking-tight truncate pr-2">"{s.name}"</span>
                                                    <span className="text-[0.625rem] font-bold text-emerald-500/60 uppercase shrink-0">{s.distance.toFixed(1)} km</span>
                                                </div>
                                                <p className="text-[0.5625rem] font-black text-emerald-500/40 uppercase mb-1 tracking-widest">{s.type}</p>
                                                <p className="text-[0.6875rem] font-bold text-slate-300 leading-tight">{s.meaning}</p>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}
            <div className="px-1 text-center text-[0.625rem] font-medium leading-snug text-slate-400">
                {FIELDGUIDE_SHORT_NOTICE}
            </div>
            {historicScanComplete && heritageGatewayCenter && (
                <HeritageGatewayLink lat={heritageGatewayCenter.lat} lng={heritageGatewayCenter.lng} />
            )}
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
    displayTargets: Cluster[];
    terrainClusters: import('../../pages/fieldGuideTypes').Cluster[];
    potentialScoreBreakdown: { terrain: number; hydro: number; historic: number; signals: number } | null;
    mapRef: React.RefObject<import('maplibre-gl').Map | null>;
    workerRef: React.MutableRefObject<Worker | null>;
    landscapeInterpretation: LandscapeInterpretation | null;
    setLandscapeInterpretation: React.Dispatch<React.SetStateAction<LandscapeInterpretation | null>>;
    alieLoading: boolean;
    setAlieLoading: React.Dispatch<React.SetStateAction<boolean>>;
    landscapeIntelligenceMap: Map<string, LandscapeIntelligence>;
    projectFinds: Find[];
    pasFinds: HistoricFind[];
    focusTarget: (target: Cluster) => void;
    pasDensityCell: import('../../services/pasDensityService').PASCellLookup | null;
    scheduledMonumentCheckFailed: boolean;
    scheduledMonumentUnavailableReason: import('../../services/historicScanService').SMUnavailableReason | null;
}

function AlieSection({
    historicScanComplete,
    loadingPAS,
    nhleDataRef,
    aimDataRef,
    historicRoutes,
    geologyContext,
    sortedHotspots,
    displayTargets,
    terrainClusters,
    potentialScoreBreakdown,
    mapRef,
    workerRef,
    landscapeInterpretation,
    setLandscapeInterpretation,
    alieLoading,
    setAlieLoading,
    landscapeIntelligenceMap,
    projectFinds,
    pasFinds,
    pasDensityCell,
    focusTarget,
    scheduledMonumentCheckFailed,
    scheduledMonumentUnavailableReason,
}: AlieSectionProps) {
    // Sequence counter — mirrors geologyRequestSeqRef in FieldGuide.tsx.
    // Prevents a stale cache read or slow worker result from clobbering a
    // newer cell's state when the user pans quickly between geohash6 cells.
    const alieRequestSeqRef = useRef(0);
    const [landscapeEvidence, setLandscapeEvidence] = useState<LandscapeEvidence | null>(null);

    // ── View mode state ───────────────────────────────────────────────────────────
    const [viewMode, setViewMode] = useState<'glance' | 'detail'>('glance');
    const [showPreferDetailPrompt, setShowPreferDetailPrompt] = useState(false);
    const tapThroughCountRef = useRef(0);
    const hasShownPromptRef  = useRef(false);
    const expandedCurrentScanRef = useRef(false);
    const detailRootRef = useRef<HTMLDivElement>(null);

    // Load stored preference once on mount
    useEffect(() => {
        db.settings.get('fieldGuideViewMode').then(s => {
            const v = s?.value;
            if (v === 'detail' || v === 'glance') setViewMode(v as 'glance' | 'detail');
        }).catch(() => {});
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // Reset tap-through streak when a new scan completes (Path B)
    const prevScanCompleteRef = useRef(false);
    useEffect(() => {
        if (historicScanComplete && !prevScanCompleteRef.current) {
            if (!expandedCurrentScanRef.current) tapThroughCountRef.current = 0;
            expandedCurrentScanRef.current = false;
            prevScanCompleteRef.current = true;
        } else if (!historicScanComplete) {
            prevScanCompleteRef.current = false;
        }
    }, [historicScanComplete]);

    function handleReadFull() {
        expandedCurrentScanRef.current = true;
        tapThroughCountRef.current++;
        if (tapThroughCountRef.current >= 3 && !hasShownPromptRef.current) {
            hasShownPromptRef.current = true;
            setShowPreferDetailPrompt(true);
        }
        setViewMode('detail');
        requestAnimationFrame(() => {
            const el = detailRootRef.current;
            if (!el) return;
            // Nearest scrollable ancestor — the bottom sheet's inner
            // scroller on mobile, a side panel on desktop.
            let scroller: HTMLElement | null = el.parentElement;
            while (scroller && scroller !== document.body) {
                const oy = getComputedStyle(scroller).overflowY;
                if ((oy === 'auto' || oy === 'scroll') &&
                    scroller.scrollHeight > scroller.clientHeight) break;
                scroller = scroller.parentElement;
            }
            if (!scroller || scroller === document.body) return;
            const top = el.getBoundingClientRect().top
                      - scroller.getBoundingClientRect().top
                      + scroller.scrollTop;
            scroller.scrollTo({ top: Math.max(0, top - 8) });
        });
    }

    function handlePersistDetail() {
        setViewMode('detail');
        db.settings.put({ key: 'fieldGuideViewMode', value: 'detail' }).catch(() => {});
    }

    function handleGlance() {
        setViewMode('glance');
        db.settings.put({ key: 'fieldGuideViewMode', value: 'glance' }).catch(() => {});
    }

    const fieldStrategy = useMemo(() =>
        landscapeInterpretation || sortedHotspots.length
            ? buildFieldStrategy(sortedHotspots, landscapeInterpretation?.processScores ?? [], {
                historicRoutes,
                pasFindPeriods: pasFinds.map(f => f.broadperiod || 'Unknown'),
                potentialBreakdown: potentialScoreBreakdown,
            })
            : null,
        [sortedHotspots, landscapeInterpretation, historicRoutes, pasFinds, potentialScoreBreakdown],
    );

    // ── On scan complete: load cached result then fire worker ─────────────────
    useEffect(() => {
        if (!historicScanComplete || loadingPAS) return;

        const center = mapRef.current?.getCenter();
        if (!center) return;

        const geohash6 = geohashEncode(center.lat, center.lng, 6);
        const requestSeq = ++alieRequestSeqRef.current;

        const nhleFeatures = nhleDataRef.current?.features ?? [];
        const aimFeatures  = aimDataRef.current?.features ?? [];

        const primaryHotspot = sortedHotspots[0] ?? null;
        const hotspotMetrics = primaryHotspot?.metrics ?? null;

        // Derive LIE classification signals from sorted (scored) hotspots only —
        // landscapeIntelligenceMap also contains weak/suppressed hotspots so
        // we restrict to sortedHotspots which have already passed the score gate.
        const sortedLI = sortedHotspots
            .map(h => landscapeIntelligenceMap.get(h.id))
            .filter((li): li is LandscapeIntelligence => li !== undefined);
        const lieHasWetland    = sortedLI.some(li => li.wetlandContext !== null);
        const lieHasBoundary   = sortedLI.some(li => li.transitionType !== null);
        const lieHasProminence = sortedLI.some(li => li.landformType !== null);
        const lieHasOccupation = sortedLI.some(li => li.occupationPotential !== null);

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
            hasWetlandContext:    lieHasWetland,
            hasBoundaryTransition: lieHasBoundary,
            hasLandformProminence: lieHasProminence,
            hasOccupationSignal:   lieHasOccupation,
        };
        const terrainSignals = deriveTerrainSignals(terrainClusters, primaryHotspot);
        const geologyTileKey = geologyContext?.tileKey ?? 'nogeology';

        // ── P5: terrain signature — cache cell varies when measured terrain differs ──
        const terrainSig = terrainSignals.terrainMeasured
            ? [
                Math.round((terrainSignals.relativeReliefNorm ?? 0) / 0.1),
                Math.round((terrainSignals.slopeGradient     ?? 0) / 0.1),
                Math.round((terrainSignals.aspectDegrees     ?? 0) / 45),
              ].join(':')
            : 'proxy';

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
            lieHasWetland    ? 'liewet' : 'noliewet',
            lieHasBoundary   ? 'liebnd' : 'noliebnd',
            lieHasProminence ? 'lieprom' : 'nolieprom',
            lieHasOccupation ? 'lieocc' : 'nolieocc',
            terrainSig,
        ].join('|');

        db.landscapeInterpretations.get(geohash6).then(cached => {
            // Guard: bail if the user has panned to a different cell while the
            // cache read was in flight. Same-cell re-requests still update
            // because requestSeq will match alieRequestSeqRef.current.
            if (alieRequestSeqRef.current !== requestSeq) return;
            const cachedInterpretation = cached?.interpretation as LandscapeInterpretation | undefined;
            if (
                cachedInterpretation?.engineVersion === ALIE_ENGINE_VERSION &&
                cached?.inputSignature === inputSignature
            ) {
                setLandscapeInterpretation(cachedInterpretation);
            }
        }).catch((e: unknown) => diagLog.warn('alie', 'Cache read failed', String(e)));

        if (workerRef.current) {
            workerRef.current.terminate();
            workerRef.current = null;
        }

        // ── P2: assemble unified evidence object ─────────────────────────────
        const nearbyFinds = projectFinds.filter(
            f => f.lat !== null && f.lon !== null &&
                 getDistance([f.lon!, f.lat!], [center.lng, center.lat]) <= 750,
        );
        const nearbyFindPeriods = [...new Set(nearbyFinds.map(f => f.period))];
        // Approximate density: geohash6 cell ≈ 0.72 km²
        const nearbyFindDensity = nearbyFinds.length / 0.72;

        const evidence = buildLandscapeEvidence(
            terrainClusters,
            primaryHotspot,
            sortedHotspots,
            historicRoutes,
            nhleFeatures,
            aimFeatures,
            {
                relativeReliefNorm: terrainSignals.relativeReliefNorm,
                slopeGradient:      terrainSignals.slopeGradient,
                aspectDegrees:      terrainSignals.aspectDegrees,
                terrainMeasured:    terrainSignals.terrainMeasured ?? false,
            },
            nearbyFindPeriods,
            nearbyFindDensity,
        );
        setLandscapeEvidence(evidence);

        // ── PAS interpretation input (Phase B — additive, null-neutral) ────
        const pas = pasDensityCell && pasDensityCell.c > 0
            ? {
                cellCount: pasDensityCell.c,
                periodCounts: Array.isArray(pasDensityCell.pc) ? pasDensityCell.pc : [],
            }
            : null;

        // ── Personal finds interpretation input (L3 null-neutral) ──────────
        // Async query wrapped in .then() — failure must never fail or delay a scan.
        const personalFindsPromise: Promise<PersonalFindsInput | null> = (async () => {
            try {
                const PERSONAL_RADIUS_M = 800;
                const allFinds = await db.finds.toArray();
                const nearby = allFinds.filter(f => {
                    if (f.lat == null || f.lon == null) return false;
                    if (f.gpsAccuracyM != null && f.gpsAccuracyM > 150) return false;
                    return haversineM(center.lat, center.lng, f.lat, f.lon) <= PERSONAL_RADIUS_M;
                });
                if (nearby.length > 0) {
                    const periodMap = new Map<string, number>();
                    for (const f of nearby) {
                        periodMap.set(f.period, (periodMap.get(f.period) ?? 0) + 1);
                    }
                    return {
                        totalWithCoords: nearby.length,
                        periodCounts: [...periodMap.entries()],
                    };
                }
                return null;
            } catch {
                return null;
            }
        })();

        personalFindsPromise.then(personalFinds => {
            // Guard: bail if user panned to a different cell while query ran
            if (alieRequestSeqRef.current !== requestSeq) return;

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
            pas,
            personalFinds,
            ...terrainSignals,
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
                // Guard: discard result if the user panned to a newer cell.
                if (alieRequestSeqRef.current !== requestSeq) {
                    worker.terminate();
                    workerRef.current = null;
                    return;
                }
                setAlieLoading(false);
                if (event.data.error) {
                    diagLog.error('alie', 'Worker pipeline error', event.data.error);
                } else if (event.data.result) {
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
                    }).catch((e: unknown) => diagLog.warn('alie', 'Cache write failed', String(e)));
                }
                worker.terminate();
                workerRef.current = null;
            };

            worker.onerror = (e: ErrorEvent) => {
                diagLog.error('alie', 'Worker error', e.message ?? 'unknown');
                setAlieLoading(false);
                worker.terminate();
                workerRef.current = null;
            };

            worker.postMessage(input);
        } catch (e) {
            diagLog.error('alie', 'Failed to start worker', String(e));
            setAlieLoading(false);
        }

        }).catch(() => {}); // L3: personal finds query failure is non-fatal

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

    // Glance view
    if (viewMode === 'glance' && landscapeInterpretation && !alieLoading) {
        return (
            <GlanceCard
                interpretation={landscapeInterpretation}
                scheduledMonumentCheckFailed={scheduledMonumentCheckFailed}
                scheduledMonumentUnavailableReason={scheduledMonumentUnavailableReason}
                onReadFull={handleReadFull}
                onPersistDetail={handlePersistDetail}
            />
        );
    }

    // Detail view (loading skeleton + full block)
    return (
        <div ref={detailRootRef} className="space-y-3">
            {showPreferDetailPrompt && (
                <div className="rounded-xl border border-blue-500/25 bg-blue-500/[0.07] px-3 py-2.5 space-y-2">
                    <p className="text-[0.625rem] font-black text-blue-200 leading-snug">
                        You usually open the full view — make that the default?
                    </p>
                    <div className="flex gap-2">
                        <button
                            type="button"
                            onClick={() => { setShowPreferDetailPrompt(false); handlePersistDetail(); }}
                            className="px-3 py-1 rounded-lg bg-blue-500/20 border border-blue-500/35 text-[0.625rem] font-black text-blue-300 uppercase tracking-widest"
                        >
                            Yes
                        </button>
                        <button
                            type="button"
                            onClick={() => setShowPreferDetailPrompt(false)}
                            className="px-3 py-1 rounded-lg bg-white/5 border border-white/12 text-[0.625rem] font-black text-white/55 uppercase tracking-widest"
                        >
                            Keep showing the summary
                        </button>
                    </div>
                </div>
            )}
            <LandscapeInterpretationBlock
                interpretation={landscapeInterpretation}
                loading={alieLoading}
                evidence={landscapeEvidence ?? undefined}
                fieldStrategy={fieldStrategy ?? undefined}
                targetFeatures={displayTargets}
                onFocusTarget={focusTarget}
                onGlance={handleGlance}
            />
        </div>
    );
}
