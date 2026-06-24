import React from 'react';
import { buildGeologyDisplay } from '../../engines/geologyContext';
import type { GeologyContext } from '../../engines/geologyContext';

type GeologyContextCardProps = {
    context: GeologyContext | null;
    loading?: boolean;
    className?: string;
    title?: string;
    showUnavailable?: boolean;
};

export function GeologyContextCard({
    context,
    loading = false,
    className = '',
    title = 'Geology Context',
    showUnavailable = false,
}: GeologyContextCardProps) {
    if (!context && !loading && !showUnavailable) return null;

    return (
        <div className={`rounded-xl bg-stone-900/50 border border-white/8 p-3 ${className}`}>
            <p className="text-[0.5rem] font-black text-stone-300 uppercase tracking-[0.2em] mb-2">{title}</p>
            {loading && !context ? (
                <p className="text-[0.625rem] font-bold text-white/55 italic">Reading mapped geology...</p>
            ) : !context ? (
                <p className="text-[0.625rem] font-bold text-white/65 leading-snug">No mapped geology has been returned for this scan yet.</p>
            ) : (() => {
                const geo = buildGeologyDisplay(context);
                return (
                    <div className="space-y-2">
                        <div className="flex items-center justify-between gap-2">
                            <p className="text-xs font-black text-stone-100 leading-tight">{geo.landscapeLabel}</p>
                        </div>
                        <p className="text-[0.625rem] font-bold text-white/75 leading-snug">{geo.landscapeDetail}</p>
                        {geo.bedrockLabel && (
                            <div className="flex items-center gap-1.5">
                                <span className="text-[0.4375rem] font-black text-white/45 uppercase tracking-widest shrink-0">Bedrock</span>
                                <span className="text-[0.5625rem] font-bold text-stone-100/90 leading-tight">{geo.bedrockLabel}</span>
                            </div>
                        )}
                        {geo.superficialLabel && (
                            <div className="flex items-center gap-1.5">
                                <span className="text-[0.4375rem] font-black text-white/45 uppercase tracking-widest shrink-0">Surface</span>
                                <span className="text-[0.5625rem] font-bold text-stone-100/90 leading-tight">{geo.superficialLabel}</span>
                            </div>
                        )}
                        {geo.cautions.map((c, i) => (
                            <div key={i} className="flex items-start gap-1.5 bg-amber-500/8 border border-amber-500/20 rounded-lg px-2 py-1.5">
                                <span className="text-amber-300 text-[0.5625rem] shrink-0 mt-0.5">!</span>
                                <p className="text-[0.5625rem] font-bold text-amber-200/90 leading-snug">{c}</p>
                            </div>
                        ))}
                    </div>
                );
            })()}
        </div>
    );
}
