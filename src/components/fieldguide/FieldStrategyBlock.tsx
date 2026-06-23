// ─── Field Strategy Block ─────────────────────────────────────────────────────
// Renders the FSE (Field Strategy Engine) output as the §4 Targets section.
// Advisory language only — see wording constraints in fieldStrategy.ts.

import React, { useState } from 'react';
import type { FieldStrategy, SearchStep, AvoidZone, BehaviourPriority } from '../../services/fieldguide/fieldStrategy';
import type { Cluster } from '../../pages/fieldGuideTypes';

// ─── Behaviour priority row ───────────────────────────────────────────────────

function BehaviourRow({ b }: { b: BehaviourPriority }) {
    const emphColour =
        b.emphasis === 'Primary'    ? 'text-emerald-300' :
        b.emphasis === 'Strong'     ? 'text-blue-300' :
        b.emphasis === 'Secondary'  ? 'text-white/75' :
                                      'text-white/45';
    return (
        <div className="flex items-center gap-2">
            <span className={`text-[10px] font-black uppercase tracking-wide shrink-0 w-20 ${emphColour}`}>
                {b.label}
            </span>
            <span className="text-[11px] text-white/55 tracking-wide">{b.stars}</span>
            <span className={`text-[9px] font-bold uppercase tracking-widest shrink-0 ${emphColour}`}>
                {b.emphasis}
            </span>
        </div>
    );
}

// ─── Search step card ─────────────────────────────────────────────────────────

function SearchStepCard({
    step,
    target,
    onFocusTarget,
}: {
    step: SearchStep;
    target?: Cluster;
    onFocusTarget?: (target: Cluster) => void;
}) {
    const [open, setOpen] = useState(false);
    return (
        <div className="rounded-xl border border-white/10 bg-white/[0.035] p-2.5 space-y-1.5">
            <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1 space-y-0.5">
                    <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[8px] font-black text-white/45 uppercase tracking-widest">
                            #{step.rank}
                        </span>
                        <span className="text-[11px] font-black text-white/90 leading-tight">
                            {step.title}
                        </span>
                        <span className="text-[10px] text-white/50">{step.stars}</span>
                        {target && !target.isProtected && (
                            <span className="text-[8px] font-black text-emerald-300/80 uppercase tracking-widest">
                                Map target {target.number}
                            </span>
                        )}
                    </div>
                    {step.focus && (
                        <p className="text-[10px] font-bold text-white/70 leading-snug">
                            {step.focus}
                        </p>
                    )}
                </div>
            </div>

            <p className="text-[10px] font-bold text-white/80 leading-snug">
                {step.technique}
            </p>

            {step.approach && (
                <p className="text-[10px] font-bold text-white/65 leading-snug italic">
                    {step.approach}
                </p>
            )}

            {step.caution && (
                <p className="text-[11px] font-bold text-amber-300/90 leading-snug">
                    {step.caution}
                </p>
            )}

            {target && !target.isProtected ? (
                <button
                    type="button"
                    onClick={() => onFocusTarget?.(target)}
                    className="rounded-lg border border-emerald-400/25 bg-emerald-400/10 px-2 py-1 text-[9px] font-black uppercase tracking-widest text-emerald-200 transition-colors hover:bg-emerald-400/15"
                >
                    Show on map
                </button>
            ) : (
                <p className="text-[9px] font-bold text-white/45 leading-snug">
                    No single map pin was isolated for this wider context area.
                </p>
            )}

            {step.reasoning.length > 0 && (
                <button
                    onClick={() => setOpen(v => !v)}
                    className="flex items-center gap-1 text-[9px] font-black text-white/45 uppercase tracking-widest hover:text-white/65 transition-colors"
                >
                    <span>{open ? '−' : '+'}</span>
                    Signal basis
                </button>
            )}
            {open && (
                <div className="space-y-1 animate-in fade-in duration-200">
                    {step.reasoning.map((r, i) => (
                        <p key={i} className="text-[9px] font-bold text-white/55 leading-snug">
                            · {r}
                        </p>
                    ))}
                </div>
            )}
        </div>
    );
}

// ─── Avoid zone card ──────────────────────────────────────────────────────────

function AvoidCard({ zone }: { zone: AvoidZone }) {
    return (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-2.5 space-y-1">
            <p className="text-[11px] font-black text-amber-300/90 leading-tight">
                {zone.title}
            </p>
            <p className="text-[10px] font-bold text-amber-100/70 leading-snug">
                {zone.reason}
            </p>
        </div>
    );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface Props {
    strategy: FieldStrategy;
    targetFeatures?: Cluster[];
    onFocusTarget?: (target: Cluster) => void;
}

export function FieldStrategyBlock({ strategy, targetFeatures = [], onFocusTarget }: Props) {
    const [avoidOpen, setAvoidOpen] = useState(false);
    const [whyOpen, setWhyOpen] = useState(false);

    if (!strategy.hasPlan && !strategy.landscapeNote) return null;

    const firstStep = strategy.searchOrder[0] ?? null;
    const nextSteps = strategy.searchOrder.slice(1, 2);
    const targetById = new Map(targetFeatures.map(target => [target.id, target]));
    const firstTarget = firstStep ? targetById.get(firstStep.hotspotId) : undefined;

    return (
        <div className="border border-white/12 bg-white/[0.035] rounded-xl p-3 space-y-3">
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <p className="text-[8px] font-black text-emerald-300/75 uppercase tracking-[0.2em]">
                        Suggested search order
                    </p>
                    {strategy.leadLine && (
                        <p className="mt-1 text-[11px] font-bold text-white/76 leading-snug">
                            {strategy.leadLine}
                        </p>
                    )}
                </div>
                <span className={`shrink-0 text-[10px] font-black px-2 py-0.5 rounded-lg border ${
                    strategy.confidenceLabel === 'Very High' ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300' :
                    strategy.confidenceLabel === 'High'     ? 'bg-blue-500/15 border-blue-500/30 text-blue-300' :
                    strategy.confidenceLabel === 'Moderate' ? 'bg-amber-500/15 border-amber-500/30 text-amber-300' :
                                                              'bg-white/8 border-white/20 text-white/65'
                }`}>
                    {strategy.confidenceLabel}
                </span>
            </div>

            {firstStep && (
                <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/[0.06] p-2.5 space-y-1.5">
                    <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-[8px] font-black text-emerald-300 uppercase tracking-widest">
                            Start here
                        </p>
                        <span className="text-[10px] text-white/45">{firstStep.stars}</span>
                        {firstTarget && !firstTarget.isProtected && (
                            <span className="text-[8px] font-black text-emerald-200/85 uppercase tracking-widest">
                                Map target {firstTarget.number}
                            </span>
                        )}
                    </div>
                    <p className="text-[12px] font-black text-white/92 leading-tight">
                        {firstStep.title}
                    </p>
                    {firstStep.focus && (
                        <p className="text-[10px] font-bold text-white/72 leading-snug">
                            {firstStep.focus}
                        </p>
                    )}
                    <p className="text-[10px] font-bold text-white/84 leading-snug">
                        {firstStep.technique}
                    </p>
                    {firstStep.approach && (
                        <p className="text-[10px] font-bold text-white/62 leading-snug">
                            {firstStep.approach}
                        </p>
                    )}
                    {firstStep.caution && (
                        <p className="text-[10px] font-bold text-amber-300/90 leading-snug">
                            {firstStep.caution}
                        </p>
                    )}
                    {firstTarget && !firstTarget.isProtected ? (
                        <button
                            type="button"
                            onClick={() => onFocusTarget?.(firstTarget)}
                            className="rounded-lg border border-emerald-300/30 bg-emerald-300/10 px-2 py-1 text-[9px] font-black uppercase tracking-widest text-emerald-100 transition-colors hover:bg-emerald-300/15"
                        >
                            Show start on map
                        </button>
                    ) : (
                        <p className="text-[9px] font-bold text-emerald-100/55 leading-snug">
                            This is a wider context area rather than one isolated map pin.
                        </p>
                    )}
                </div>
            )}

            {/* Search order */}
            {nextSteps.length > 0 && (
                <div className="space-y-2 border-t border-white/8 pt-2">
                    <p className="text-[8px] font-black text-white/45 uppercase tracking-widest">
                        Next area
                    </p>
                    <div className="space-y-2">
                        {nextSteps.map(step => (
                            <SearchStepCard
                                key={step.hotspotId}
                                step={step}
                                target={targetById.get(step.hotspotId)}
                                onFocusTarget={onFocusTarget}
                            />
                        ))}
                    </div>
                </div>
            )}

            {/* Leave until later */}
            {strategy.avoidZones.length > 0 && (
                <div className="border-t border-white/8 pt-2 space-y-2">
                    <button
                        onClick={() => setAvoidOpen(v => !v)}
                        className="flex items-center gap-1.5 text-[11px] font-black text-amber-300/75 hover:text-amber-300/95 transition-colors"
                    >
                        <span>{avoidOpen ? '−' : '+'}</span>
                        Leave until later ({strategy.avoidZones.length})
                    </button>
                    {avoidOpen && (
                        <div className="space-y-2 animate-in fade-in duration-200">
                            {strategy.avoidZones.map(z => (
                                <AvoidCard key={z.hotspotId} zone={z} />
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* Landscape note */}
            {strategy.landscapeNote && (
                <p className="text-[11px] font-bold text-white/60 leading-snug border-t border-white/8 pt-2">
                    {strategy.landscapeNote}
                </p>
            )}

            <div className="border-t border-white/8 pt-2">
                <button
                    onClick={() => setWhyOpen(v => !v)}
                    className="flex items-center gap-1.5 text-[9px] font-black text-white/50 uppercase tracking-widest hover:text-white/75 transition-colors"
                >
                    <span>{whyOpen ? '-' : '+'}</span>
                    Why this order
                </button>
                {whyOpen && (
                    <div className="mt-2 space-y-2 animate-in fade-in duration-200">
                        <p className="text-[10px] font-bold text-white/58 leading-snug">
                            {strategy.confidenceReason}
                        </p>

                        {strategy.behaviours.length > 0 && (
                            <div className="space-y-1">
                                {strategy.behaviours.slice(0, 4).map(b => (
                                    <BehaviourRow key={b.processId} b={b} />
                                ))}
                            </div>
                        )}

                        {strategy.surveyorNote && (
                            <p className="text-[10px] font-bold text-white/64 leading-snug italic">
                                {strategy.surveyorNote}
                            </p>
                        )}

                        {strategy.uncertaintyReasons.length > 0 && (
                            <div className="space-y-0.5">
                                <p className="text-[8px] font-black text-white/40 uppercase tracking-widest">
                                    Why this may be wrong
                                </p>
                                {strategy.uncertaintyReasons.map((r, i) => (
                                    <p key={i} className="text-[10px] font-bold text-white/48 leading-snug">
                                        · {r}
                                    </p>
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
