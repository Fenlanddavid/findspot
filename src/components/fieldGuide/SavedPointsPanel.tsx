import React from 'react';
import { db } from '../../db';
import { useFieldGuideContext } from './FieldGuideContext';

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

    if (!showSavedPoints || selectedId || selectedHotspotId || selectedUserFind || selectedPASFind || selectedMonument !== undefined) {
        return null;
    }

    return (
        <div className="space-y-2" onClick={e => e.stopPropagation()}>
            {savedPoints.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-8 text-center">
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-white/15"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
                    <p className="text-[11px] text-white/30">No saved points yet.<br/>Use the layers menu to save a map position.</p>
                </div>
            ) : savedPoints.map(sp => (
                <div key={sp.id} className="rounded-xl bg-white/[0.03] border border-white/8 px-3 py-2.5 flex items-center gap-3">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="#10b981" stroke="#34d399" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
                    <div className="flex-1 min-w-0">
                        <p className="text-sm font-black text-white truncate leading-tight">{sp.label}</p>
                        <p className="text-[9px] text-white/35 mt-0.5">{formatRelativeDate(sp.createdAt)}</p>
                        {sp.scanSnapshot && (
                            <p className="text-[9px] text-emerald-400/70 mt-0.5">{sp.scanSnapshot.hotspotCount} hotspot{sp.scanSnapshot.hotspotCount !== 1 ? 's' : ''} · {sp.scanSnapshot.topHotspotTitle}</p>
                        )}
                    </div>
                    <button
                        onClick={() => { mapRef.current?.flyTo({ center: [sp.lon, sp.lat], zoom: sp.zoom }); setShowSavedPoints(false); }}
                        className="text-[9px] font-black text-emerald-300 uppercase tracking-widest shrink-0 px-2 py-1 rounded-lg hover:bg-emerald-500/10 transition-colors"
                    >
                        Fly to
                    </button>
                    <button
                        onClick={async () => {
                            if (pendingDeleteId === sp.id) {
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
            ))}
        </div>
    );
}
