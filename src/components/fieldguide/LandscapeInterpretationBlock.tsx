// ─── Landscape Interpretation Block ──────────────────────────────────────────
// Renders the ALIE v5 interpretation output inside HistoricLayerManager.
// All text must be hedged — no statements about what was there.

import React, { useState } from 'react';
import type {
    LandscapeInterpretation,
    SecondaryInterpretationId,
    ArchaeologicalPeriod,
    ConfidenceTier,
    UncertaintyLevel,
    EvidenceItem,
    LikelihoodTier,
} from '../../types/landscapeInterpretation';
import { getTemplateText } from '../../services/fieldguide/landscapeInterpretation/narrativeGenerator';
import { LandscapeBehaviourBars } from './LandscapeBehaviourBars';

// ─── Label maps ───────────────────────────────────────────────────────────────

const INTERPRETATION_LABELS: Record<SecondaryInterpretationId, string> = {
    settlement_activity_area:   'Settlement Activity Area',
    agricultural_landscape:     'Agricultural Landscape',
    movement_corridor:          'Movement Corridor',
    riverine_activity:          'Riverine Activity Area',
    industrial_landscape:       'Industrial Landscape',
    transition_zone:            'Transition Zone',
    burial_landscape:           'Burial Landscape',
    defensive_landscape:        'Defensive Landscape',
    ceremonial_ritual:          'Ceremonial / Ritual Landscape',
};

const CONFIDENCE_LABELS: Record<ConfidenceTier, string> = {
    very_high: 'Strong signal',
    high:      'Good signal',
    moderate:  'Moderate signal',
    lower:     'Weak signal',
};

const PERIOD_LABELS: Record<ArchaeologicalPeriod, string> = {
    prehistoric_bronze_age: 'Prehistoric / Bronze Age',
    iron_age:               'Iron Age',
    romano_british:         'Romano-British',
    early_medieval:         'Early Medieval',
    medieval:               'Medieval',
    post_medieval:          'Post-Medieval',
    modern_industrial:      'Modern / Industrial',
};

const TIER_LABELS: Record<LikelihoodTier, string> = {
    very_high: 'Very High',
    high:      'High',
    moderate:  'Moderate',
    low:       'Low',
    very_low:  'Very Low',
};

const TIER_COLOURS: Record<LikelihoodTier, string> = {
    very_high: 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300',
    high:      'bg-blue-500/15 border-blue-500/30 text-blue-300',
    moderate:  'bg-amber-500/15 border-amber-500/30 text-amber-300',
    low:       'bg-white/8 border-white/18 text-white/65',
    very_low:  'bg-white/5 border-white/12 text-white/45',
};

const MAX_DISPLAY_SUPPORT = 95;

// ─── Find-type panel text ─────────────────────────────────────────────────────
// burial_landscape is intentionally omitted — find-type panel is not shown for burials.

const FIND_TYPE_TEXT: Partial<Record<SecondaryInterpretationId, string>> = {
    settlement_activity_area:
        'Brooches, dress fittings, hairpins, strap ends, lead weights, seal matrices, casual coin loss',
    agricultural_landscape:
        'Plough and horse furniture, casual coin loss, tool fragments',
    movement_corridor:
        'In-transit coin loss, harness fittings, strap fittings, occasional militaria',
    riverine_activity:
        'Crossing-related loss, occasional votive metalwork',
    industrial_landscape:
        'Tool fragments, ironworking waste, smithing-related fittings',
    transition_zone:
        'Boundary-adjacent loss, occasional market-related items, jettons',
    ceremonial_ritual:
        'Votive deposits, structured deposition, occasional prestige metalwork; context is archaeologically sensitive',
};

// Defensive variants depend on period branch — handled in template logic
const DEFENSIVE_FIND_TEXT_PRE_MODERN = 'Weaponry fragments, sling shot, refuge-context coinage';
const DEFENSIVE_FIND_TEXT_20C = 'Buttons, badges, ammunition components, equipment fittings';

// ─── Sub-components ───────────────────────────────────────────────────────────

function ModelNotice() {
    return (
        <div className="bg-white/[0.05] border border-white/12 rounded-xl px-3 py-2">
            <p className="text-[10px] font-bold text-white/70 leading-snug">
                This is a model interpretation based on terrain and historic data — not a record of what's actually there.
            </p>
        </div>
    );
}

function ConfidenceBadge({ tier }: { tier: ConfidenceTier }) {
    const colours: Record<ConfidenceTier, string> = {
        very_high: 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300',
        high:      'bg-blue-500/15 border-blue-500/30 text-blue-300',
        moderate:  'bg-amber-500/15 border-amber-500/30 text-amber-300',
        lower:     'bg-white/8 border-white/20 text-white/65',
    };
    return (
        <span className={`text-[8px] font-black uppercase tracking-widest px-2 py-0.5 rounded-lg border ${colours[tier]}`}>
            {CONFIDENCE_LABELS[tier]}
        </span>
    );
}

function TierBadge({ tier, compact = false }: { tier: LikelihoodTier; compact?: boolean }) {
    return (
        <span
            className={`inline-flex items-center justify-center whitespace-nowrap border font-black uppercase ${
                compact
                    ? 'text-[7px] tracking-[0.08em] px-1.5 py-0.5 rounded-md leading-none'
                    : 'text-[8px] tracking-widest px-2 py-0.5 rounded-lg'
            } ${TIER_COLOURS[tier]}`}
        >
            {TIER_LABELS[tier]}
        </span>
    );
}

function EvidenceList({ title, items, tone }: { title: string; items: EvidenceItem[]; tone: 'support' | 'against' | 'missing' }) {
    if (!items.length) return null;
    const dot = tone === 'support' ? 'bg-emerald-400' : tone === 'against' ? 'bg-amber-400' : 'bg-white/45';
    const titleColour = tone === 'support' ? 'text-emerald-300/85' : tone === 'against' ? 'text-amber-300/85' : 'text-white/55';
    return (
        <div className="space-y-1.5">
            <p className={`text-[8px] font-black uppercase tracking-widest ${titleColour}`}>{title}</p>
            <div className="space-y-1.5">
                {items.slice(0, 5).map(item => (
                    <div key={item.id} className="flex items-start gap-2">
                        <span className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${dot}`} />
                        <p className="text-[10px] font-bold text-white/76 leading-snug">
                            {item.label}
                        </p>
                    </div>
                ))}
            </div>
        </div>
    );
}

function EvidenceMeter({ support, contradiction }: { support: number; contradiction: number }) {
    const displayedSupport = Math.min(MAX_DISPLAY_SUPPORT, Math.max(0, support));
    const displayedContradiction = Math.max(
        0,
        Math.min(100, Math.max(contradiction, 100 - displayedSupport)),
    );

    return (
        <div className="space-y-1">
            <div className="h-2 rounded-full bg-white/8 overflow-hidden flex">
                <div
                    className="h-full bg-emerald-400/75"
                    style={{ width: `${displayedSupport}%` }}
                />
                <div
                    className="h-full bg-amber-400/75"
                    style={{ width: `${displayedContradiction}%` }}
                />
            </div>
            <div className="flex justify-between gap-2 text-[8px] font-black uppercase tracking-widest">
                <span className="text-emerald-300/80">Support {displayedSupport}%</span>
                <span className="text-amber-300/80">Against {displayedContradiction}%</span>
            </div>
        </div>
    );
}

function PeriodChips({ affinities }: { affinities: Array<{ period: ArchaeologicalPeriod; weight: number }> }) {
    const topPeriods = affinities.filter(a => a.weight > 0.35).slice(0, 2);
    if (topPeriods.length === 0) return null;
    return (
        <div className="flex flex-wrap gap-1 mt-1">
            {topPeriods.map(a => (
                <span
                    key={a.period}
                    className="text-[8px] font-black uppercase tracking-wider px-2 py-0.5 rounded-lg bg-blue-500/10 border border-blue-500/25 text-blue-200"
                >
                    {PERIOD_LABELS[a.period]}
                </span>
            ))}
        </div>
    );
}

function UncertaintyNote({ uncertainty }: { uncertainty: UncertaintyLevel }) {
    if (uncertainty === 'low') return null;
    const text = uncertainty === 'high'
        ? 'Multiple interpretations equally plausible'
        : 'Some uncertainty in this reading';
    return (
        <p className="text-[9px] font-bold text-white/58 italic leading-snug">
            {text}
        </p>
    );
}

// ─── Skeleton loader ──────────────────────────────────────────────────────────

function LoadingSkeleton() {
    return (
        <div className="space-y-2 animate-pulse">
            <div className="h-3 w-24 bg-white/10 rounded-lg" />
            <div className="h-4 w-48 bg-white/8 rounded-lg" />
            <div className="h-3 w-full bg-white/5 rounded-lg" />
            <div className="h-3 w-3/4 bg-white/5 rounded-lg" />
        </div>
    );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface Props {
    interpretation: LandscapeInterpretation | null;
    loading?: boolean;
}

export function LandscapeInterpretationBlock({ interpretation, loading = false }: Props) {
    const [whyOpen, setWhyOpen] = useState(false);
    const [evidenceOpen, setEvidenceOpen] = useState(false);
    const [periodOpen, setPeriodOpen] = useState(false);
    const [interactionOpen, setInteractionOpen] = useState(false);
    const [findTypeOpen, setFindTypeOpen] = useState(false);

    if (loading && !interpretation) {
        return (
            <div className="border border-blue-500/15 bg-blue-500/5 rounded-xl p-3">
                <p className="text-[8px] font-black text-blue-300/60 uppercase tracking-[0.2em] mb-2">
                    Archaeological Interpretation
                </p>
                <LoadingSkeleton />
            </div>
        );
    }

    if (!interpretation) return null;

    const {
        primaryInterpretationId,
        secondaryInterpretationId,
        interpretationScores,
        processScores,
        narrative,
        depositionAffinity,
        temporalPersistence,
        recordSparsity,
        uncertainty,
        scheduledMonumentOverlap,
        evidenceAssessment,
    } = interpretation;

    const primaryScore = interpretationScores.find(s => s.interpretationId === primaryInterpretationId);
    const secondaryScore = interpretationScores.find(s => s.interpretationId === secondaryInterpretationId);

    const narrativeText = getTemplateText(narrative.templateId);

    // Find-type panel text
    let findTypeText: string | null = null;
    if (primaryInterpretationId && primaryInterpretationId !== 'burial_landscape') {
        if (primaryInterpretationId === 'defensive_landscape') {
            const isDefensive20C = narrative.templateId.includes('twentieth_century');
            findTypeText = isDefensive20C ? DEFENSIVE_FIND_TEXT_20C : DEFENSIVE_FIND_TEXT_PRE_MODERN;
        } else {
            findTypeText = FIND_TYPE_TEXT[primaryInterpretationId] ?? null;
        }
    }

    // Temporal persistence label
    let temporalLabel: string;
    if (recordSparsity && temporalPersistence === 'transient') {
        temporalLabel = getTemplateText('temporal_persistence_sparsity');
    } else if (temporalPersistence === 'persistent_strategic_focus') {
        temporalLabel = 'Evidence spans multiple periods — persistent use of this landscape';
    } else if (temporalPersistence === 'persistent') {
        temporalLabel = 'Evidence spans multiple periods';
    } else if (temporalPersistence === 'recurrent') {
        temporalLabel = 'Evidence from more than one period';
    } else {
        temporalLabel = 'Limited period evidence in records';
    }

    return (
        <div className="border border-blue-500/20 bg-blue-500/5 rounded-xl p-3 space-y-3">
            <p className="text-[8px] font-black text-blue-300/70 uppercase tracking-[0.2em]">
                Archaeological Interpretation
            </p>

            {scheduledMonumentOverlap && (
                <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-2.5">
                    <p className="text-[8px] font-black text-amber-300/80 uppercase tracking-[0.18em] mb-1">
                        Protected — Scheduled Monument
                    </p>
                    <p className="text-[10px] font-bold text-amber-100/90 leading-snug">
                        {getTemplateText('scheduled_monument_notice')}
                    </p>
                </div>
            )}

            {/* 1. Landscape assessment summary */}
            <div className="space-y-2">
                    {primaryInterpretationId && primaryScore ? (
                        <div className="space-y-1.5">
                            <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-xs font-black text-white">
                                    {INTERPRETATION_LABELS[primaryInterpretationId]}
                                </span>
                                <ConfidenceBadge tier={primaryScore.confidenceTier} />
                            </div>
                            <PeriodChips affinities={primaryScore.periodAffinity} />
                            <p className="text-[10px] font-bold text-white/84 leading-snug">
                                {evidenceAssessment.archaeologicalReasoning || narrativeText}
                            </p>
                            <EvidenceMeter
                                support={evidenceAssessment.supportingPercent}
                                contradiction={evidenceAssessment.contradictingPercent}
                            />
                        </div>
                    ) : (
                        <p className="text-[10px] font-bold text-white/70 leading-snug italic">
                            {narrativeText || getTemplateText('mixed_indeterminate')}
                        </p>
                    )}

                    {/* Secondary interpretation */}
                    {secondaryInterpretationId && secondaryScore && (
                        <div className="border-t border-white/8 pt-2 space-y-1">
                            <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-[10px] font-black text-white/82">
                                    {INTERPRETATION_LABELS[secondaryInterpretationId]}
                                </span>
                                <span className="text-[8px] font-black text-white/55 uppercase tracking-widest">
                                    also present
                                </span>
                                <ConfidenceBadge tier={secondaryScore.confidenceTier} />
                            </div>
                        </div>
                    )}
            </div>

            {evidenceAssessment.landscapeEngines
                .filter(engine => engine.engineId === 'landscape_opportunity')
                .map(engine => (
                    <div
                        key={engine.engineId}
                        className="rounded-xl bg-white/[0.035] border border-white/10 p-2 min-w-0 flex items-center justify-between gap-2"
                    >
                        <p className="min-w-0 text-[8px] font-black text-white/48 uppercase tracking-[0.08em] leading-tight truncate">
                            {engine.label.replace('Landscape ', '')}
                        </p>
                        <div className="shrink-0">
                            <TierBadge tier={engine.tier} compact />
                        </div>
                    </div>
                ))}

            {/* 3. Temporal persistence */}
            <div className="border-t border-white/8 pt-2">
                <p className="text-[9px] font-bold text-white/68 leading-snug">{temporalLabel}</p>
                <p className="text-[9px] font-bold text-white/56 leading-snug mt-1">
                    {evidenceAssessment.confidenceSummary}
                </p>
            </div>

            {/* 4. Deposition note */}
            {depositionAffinity.convergenceMet && depositionAffinity.noteTemplateId && (
                <div className="border-t border-white/8 pt-2">
                    <p className="text-[9px] font-bold text-white/62 italic leading-snug">
                        {getTemplateText(depositionAffinity.noteTemplateId)}
                    </p>
                </div>
            )}

            {/* 5. Evidence expander */}
            <div className="border-t border-white/8 pt-2">
                <button
                    onClick={() => setEvidenceOpen(v => !v)}
                    className="flex items-center gap-1.5 text-[9px] font-black text-white/62 uppercase tracking-widest hover:text-white/82 transition-colors"
                >
                    <span>{evidenceOpen ? '-' : '+'}</span>
                    Supporting and contradicting evidence
                </button>
                {evidenceOpen && (
                    <div className="mt-2 grid gap-3 animate-in fade-in duration-200">
                        <EvidenceList title="Supporting Evidence" items={evidenceAssessment.supportingEvidence} tone="support" />
                        <EvidenceList title="Contradicting Evidence" items={evidenceAssessment.contradictingEvidence} tone="against" />
                        <EvidenceList title="Missing or Weak Evidence" items={evidenceAssessment.missingEvidence} tone="missing" />
                    </div>
                )}
            </div>

            {/* 6. Period likelihood */}
            {evidenceAssessment.periodLikelihood.length > 0 && (
                <div className="border-t border-white/8 pt-2">
                    <button
                        onClick={() => setPeriodOpen(v => !v)}
                        className="flex items-center gap-1.5 text-[9px] font-black text-white/62 uppercase tracking-widest hover:text-white/82 transition-colors"
                    >
                        <span>{periodOpen ? '-' : '+'}</span>
                        Period likelihood
                    </button>
                    <div className="flex flex-wrap gap-1 mt-2">
                        {evidenceAssessment.periodLikelihood.slice(0, periodOpen ? 5 : 3).map(period => (
                            <span
                                key={period.period}
                                className="text-[8px] font-black uppercase tracking-wider px-2 py-0.5 rounded-lg bg-blue-500/10 border border-blue-500/25 text-blue-200"
                            >
                                {PERIOD_LABELS[period.period]} · {TIER_LABELS[period.tier]}
                            </span>
                        ))}
                    </div>
                    {periodOpen && (
                        <div className="mt-2 space-y-1.5 animate-in fade-in duration-200">
                            {evidenceAssessment.periodLikelihood.slice(0, 5).map(period => (
                                <p key={period.period} className="text-[9px] font-bold text-white/60 leading-snug">
                                    {period.reasoning}
                                </p>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* 7. Behaviour interactions */}
            {evidenceAssessment.behaviourInteractions.length > 0 && (
                <div className="border-t border-white/8 pt-2">
                    <button
                        onClick={() => setInteractionOpen(v => !v)}
                        className="flex items-center gap-1.5 text-[9px] font-black text-white/62 uppercase tracking-widest hover:text-white/82 transition-colors"
                    >
                        <span>{interactionOpen ? '-' : '+'}</span>
                        Behaviour interactions
                    </button>
                    <div className="mt-2 space-y-1.5">
                        {evidenceAssessment.behaviourInteractions.slice(0, interactionOpen ? 4 : 2).map(interaction => (
                            <div key={interaction.interactionId} className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                    <p className="text-[10px] font-black text-white/82 leading-tight">{interaction.label}</p>
                                    {interactionOpen && (
                                        <p className="text-[9px] font-bold text-white/56 leading-snug mt-0.5">{interaction.reasoning}</p>
                                    )}
                                </div>
                                <TierBadge tier={interaction.tier} />
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* 8. "Why this interpretation?" expander */}
            <div className="border-t border-white/8 pt-2">
                <button
                    onClick={() => setWhyOpen(v => !v)}
                    className="flex items-center gap-1.5 text-[9px] font-black text-white/62 uppercase tracking-widest hover:text-white/82 transition-colors"
                >
                    <span>{whyOpen ? '-' : '+'}</span>
                    Behaviour engines
                </button>
                {whyOpen && (
                    <div className="mt-2 animate-in fade-in duration-200">
                        <LandscapeBehaviourBars processScores={processScores} />
                    </div>
                )}
            </div>

            {/* 9. Uncertainty */}
            {uncertainty !== 'low' && (
                <UncertaintyNote uncertainty={uncertainty} />
            )}

            {/* 10. Find-type panel */}
            {findTypeText && (
                <div className="border-t border-white/8 pt-2">
                    <button
                        onClick={() => setFindTypeOpen(v => !v)}
                        className="flex items-center gap-1.5 text-[9px] font-black text-white/62 uppercase tracking-widest hover:text-white/82 transition-colors"
                    >
                        <span>{findTypeOpen ? '-' : '+'}</span>
                        Typical find types
                    </button>
                    {findTypeOpen && (
                        <div className="mt-2 bg-white/[0.03] border border-white/8 rounded-xl p-2 animate-in fade-in duration-200">
                            <p className="text-[9px] font-bold text-white/72 leading-snug">
                                {findTypeText}
                            </p>
                        </div>
                    )}
                </div>
            )}

            <ModelNotice />
        </div>
    );
}
