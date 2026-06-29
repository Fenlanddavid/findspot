import React, { useEffect, useState, useCallback } from 'react';
import { db } from '../../db';
import { useFieldGuideContext } from './FieldGuideContext';
import {
    buildPack, deletePack, getPackMeta, isPackStale,
    estimatePack, PackMeta, BuildProgress,
} from '../../services/offlinePack';

function formatRelativeDate(isoStr: string): string {
    const diff = Date.now() - new Date(isoStr).getTime();
    const days = Math.floor(diff / 86400000);
    if (days === 0) return 'Today';
    if (days === 1) return 'Yesterday';
    if (days < 7) return `${days} days ago`;
    const weeks = Math.floor(days / 7);
    if (weeks === 1) return '1 week ago';
    if (weeks < 5) return `${weeks} weeks ago`;
    const months = Math.floor(days / 30);
    if (months === 1) return '1 month ago';
    return `${months} months ago`;
}

function formatMB(bytes: number): string {
    return `${(bytes / 1_000_000).toFixed(0)} MB`;
}

type PointPackStatus =
    | { kind: 'checking' }
    | { kind: 'none'; estMB: string }
    | { kind: 'building'; pct: number }
    | { kind: 'done'; meta: PackMeta; stale: boolean }
    | { kind: 'error' };

export function SavedPointsPanel() {
    const {
        showSavedPoints,
        selectedId,
        selectedHotspotId,
        selectedUserFind,
        selectedPASFind,
        selectedMonument,
        savedPoints,
        mapRef,
        setShowSavedPoints,
        pendingDeleteId,
        setPendingDeleteId,
    } = useFieldGuideContext();

    const [packStatus, setPackStatus] = useState<Record<string, PointPackStatus>>({});
    const [pendingEvictId, setPendingEvictId] = useState<string | null>(null);

    // Load pack status for all saved points on mount and when points change
    useEffect(() => {
        if (!savedPoints.length) return;
        savedPoints.forEach(async (sp) => {
            setPackStatus(prev => ({ ...prev, [sp.id]: { kind: 'checking' } }));
            try {
                const [meta, est] = await Promise.all([
                    getPackMeta({ ownerType: 'savedPoint', ownerId: sp.id }),
                    estimatePack({ ownerType: 'savedPoint', ownerId: sp.id }),
                ]);
                if (meta) {
                    setPackStatus(prev => ({ ...prev, [sp.id]: { kind: 'done', meta, stale: isPackStale(meta) } }));
                } else {
                    setPackStatus(prev => ({ ...prev, [sp.id]: { kind: 'none', estMB: formatMB(est.estBytes) } }));
                }
            } catch {
                setPackStatus(prev => ({ ...prev, [sp.id]: { kind: 'none', estMB: '~5 MB' } }));
            }
        });
    }, [savedPoints]);

    const handlePrepare = useCallback(async (spId: string) => {
        setPackStatus(prev => ({ ...prev, [spId]: { kind: 'building', pct: 0 } }));
        try {
            await buildPack(
                { ownerType: 'savedPoint', ownerId: spId },
                (p: BuildProgress) => {
                    const pct = p.total > 0 ? Math.round((p.done / p.total) * 100) : 0;
                    setPackStatus(prev => ({ ...prev, [spId]: { kind: 'building', pct } }));
                },
                true,
            );
            const meta = await getPackMeta({ ownerType: 'savedPoint', ownerId: spId });
            if (meta) {
                setPackStatus(prev => ({ ...prev, [spId]: { kind: 'done', meta, stale: false } }));
            }
        } catch {
            setPackStatus(prev => ({ ...prev, [spId]: { kind: 'error' } }));
        }
    }, []);

    const handleEvict = useCallback(async (spId: string) => {
        await deletePack({ ownerType: 'savedPoint', ownerId: spId });
        const est = await estimatePack({ ownerType: 'savedPoint', ownerId: spId }).catch(() => ({ estBytes: 5_000_000 }));
        setPackStatus(prev => ({ ...prev, [spId]: { kind: 'none', estMB: formatMB(est.estBytes) } }));
        setPendingEvictId(null);
    }, []);

    if (!showSavedPoints || selectedId || selectedHotspotId || selectedUserFind || selectedPASFind || selectedMonument !== undefined) {
        return null;
    }

    return (
        <div className="space-y-2" onClick={e => e.stopPropagation()}>
            {savedPoints.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-8 text-center">
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-white/15"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
                    <p className="text-[0.6875rem] text-white/30">No saved points yet.<br/>Use the layers menu to save a map position.</p>
                </div>
            ) : savedPoints.map(sp => {
                const status = packStatus[sp.id] ?? { kind: 'checking' };
                return (
                    <div key={sp.id} className="rounded-xl bg-white/[0.03] border border-white/8 px-3 py-2.5 flex items-center gap-3">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="#10b981" stroke="#34d399" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
                        <div className="flex-1 min-w-0">
                            <p className="text-sm font-black text-white truncate leading-tight">{sp.label}</p>
                            <p className="text-[0.5625rem] text-white/35 mt-0.5">{formatRelativeDate(sp.createdAt)}</p>
                            {sp.scanSnapshot && (
                                <p className="text-[0.5625rem] text-emerald-400/70 mt-0.5">{sp.scanSnapshot.hotspotCount} hotspot{sp.scanSnapshot.hotspotCount !== 1 ? 's' : ''} · {sp.scanSnapshot.topHotspotTitle}</p>
                            )}
                            {/* Pack status line */}
                            {status.kind === 'building' && (
                                <div className="mt-1.5 flex items-center gap-1.5">
                                    <div className="flex-1 h-1 bg-white/10 rounded-full overflow-hidden">
                                        <div className="h-full bg-emerald-400 rounded-full transition-all" style={{ width: `${status.pct}%` }} />
                                    </div>
                                    <span className="text-[0.5rem] text-white/30 shrink-0">{status.pct}%</span>
                                </div>
                            )}
                            {status.kind === 'done' && status.stale && (
                                <p className="text-[0.5rem] text-amber-400/70 mt-0.5">Pack is old — re-prepare?</p>
                            )}
                        </div>

                        {/* Fly-to */}
                        <button
                            onClick={() => { mapRef.current?.flyTo({ center: [sp.lon, sp.lat], zoom: sp.zoom }); setShowSavedPoints(false); }}
                            className="text-[0.5625rem] font-black text-emerald-300 uppercase tracking-widest shrink-0 px-2 py-1 rounded-lg hover:bg-emerald-500/10 transition-colors"
                        >
                            Fly to
                        </button>

                        {/* Offline pack button */}
                        {status.kind === 'checking' && (
                            <div className="shrink-0 w-6 h-6 flex items-center justify-center">
                                <div className="w-3 h-3 rounded-full border border-white/20 border-t-white/5 animate-spin" />
                            </div>
                        )}
                        {status.kind === 'none' && (
                            <button
                                onClick={() => handlePrepare(sp.id)}
                                className="shrink-0 p-1.5 rounded-lg text-white/25 hover:text-emerald-300 hover:bg-emerald-500/10 transition-colors"
                                title={`Download for offline (~${status.estMB})`}
                            >
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="8 17 12 21 16 17"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.88 18.09A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.29"/></svg>
                            </button>
                        )}
                        {status.kind === 'building' && (
                            <div className="shrink-0 w-6 h-6 flex items-center justify-center">
                                <div className="w-3 h-3 rounded-full border border-emerald-400/40 border-t-emerald-400 animate-spin" />
                            </div>
                        )}
                        {status.kind === 'done' && (
                            <button
                                onClick={() => {
                                    if (pendingEvictId === sp.id) {
                                        handleEvict(sp.id);
                                    } else {
                                        setPendingEvictId(sp.id);
                                        setTimeout(() => setPendingEvictId(prev => prev === sp.id ? null : prev), 3000);
                                    }
                                }}
                                className={`shrink-0 p-1.5 rounded-lg transition-colors ${pendingEvictId === sp.id ? 'text-amber-400 bg-amber-500/15' : status.stale ? 'text-amber-400/60 hover:text-amber-400' : 'text-emerald-400 hover:text-amber-400'}`}
                                title={pendingEvictId === sp.id ? 'Tap again to remove offline data' : `Downloaded ${formatMB(status.meta.sizeBytesApprox)} · tap to remove`}
                            >
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                    {pendingEvictId === sp.id
                                        ? <><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></>
                                        : <><polyline points="8 17 12 21 16 17"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.88 18.09A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.29"/></>
                                    }
                                </svg>
                            </button>
                        )}
                        {status.kind === 'error' && (
                            <button
                                onClick={() => handlePrepare(sp.id)}
                                className="shrink-0 p-1.5 rounded-lg text-red-400/60 hover:text-red-400 transition-colors"
                                title="Download failed — tap to retry"
                            >
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                            </button>
                        )}

                        {/* Delete */}
                        <button
                            onClick={async () => {
                                if (pendingDeleteId === sp.id) {
                                    await deletePack({ ownerType: 'savedPoint', ownerId: sp.id });
                                    await db.savedPoints.delete(sp.id);
                                    setPendingDeleteId(null);
                                } else {
                                    setPendingDeleteId(sp.id);
                                    setTimeout(() => setPendingDeleteId(prev => prev === sp.id ? null : prev), 3000);
                                }
                            }}
                            className={`shrink-0 p-1.5 rounded-lg transition-colors ${pendingDeleteId === sp.id ? 'text-red-400 bg-red-500/15 scale-110' : 'text-white/25 hover:text-red-400'}`}
                            title={pendingDeleteId === sp.id ? 'Tap again to confirm delete' : 'Delete'}
                        >
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                        </button>
                    </div>
                );
            })}
        </div>
    );
}
