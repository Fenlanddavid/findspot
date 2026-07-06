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
import type { LandscapeEvidence } from '../../services/fieldguide/landscapeEvidence';
import type { FieldStrategy } from '../../services/fieldguide/fieldStrategy';
import type { Cluster } from '../../pages/fieldGuideTypes';
import { getTemplateText } from '../../services/fieldguide/landscapeInterpretation/narrativeGenerator';
import { LandscapeBehaviourBars } from './LandscapeBehaviourBars';
import { FieldStrategyBlock } from './FieldStrategyBlock';
import { INTERPRETATION_LABELS, CONFIDENCE_LABELS } from '../../utils/landscapeLabels';
import { selectSalientEvidence } from '../../services/fieldguide/landscapeInterpretation/evidenceSalience';

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
            <p className="text-[0.6875rem] font-bold text-white/70 leading-snug">
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
        <span className={`text-xs font-black uppercase tracking-widest px-2 py-0.5 rounded-lg border ${colours[tier]}`}>
            {CONFIDENCE_LABELS[tier]}
        </span>
    );
}

function TierBadge({ tier, compact = false }: { tier: LikelihoodTier; compact?: boolean }) {
    return (
        <span
            className={`inline-flex items-center justify-center whitespace-nowrap border font-black uppercase ${
                compact
                    ? 'text-[0.5rem] tracking-[0.08em] px-1.5 py-0.5 rounded-md leading-none'
                    : 'text-[0.5625rem] tracking-widest px-2 py-0.5 rounded-lg'
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
            <p className={`text-[0.5625rem] font-black uppercase tracking-widest ${titleColour}`}>{title}</p>
            <div className="space-y-1.5">
                {items.slice(0, 5).map(item => (
                    <div key={item.id} className="flex items-start gap-2">
                        <span className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${dot}`} />
                        <p className="text-[0.6875rem] font-bold text-white/76 leading-snug">
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
            <div className="flex justify-between gap-2 text-[0.5625rem] font-black uppercase tracking-widest">
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
                    className="text-[0.5625rem] font-black uppercase tracking-wider px-2 py-0.5 rounded-lg bg-blue-500/10 border border-blue-500/25 text-blue-200"
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
        <p className="text-[0.625rem] font-bold text-white/58 italic leading-snug">
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
    evidence?: LandscapeEvidence;
    fieldStrategy?: FieldStrategy;
    targetFeatures?: Cluster[];
    onFocusTarget?: (target: Cluster) => void;
    onGlance?: () => void;
}

export function LandscapeInterpretationBlock({
    interpretation,
    loading = false,
    evidence,
    fieldStrategy,
    targetFeatures,
    onFocusTarget,
    onGlance,
}: Props) {
    const [scheduledOpen, setScheduledOpen] = useState(false);
    const [detailsOpen, setDetailsOpen] = useState(false);

    if (loading && !interpretation) {
        return (
            <div className="border border-blue-500/15 bg-blue-500/5 rounded-xl p-3">
                <p className="text-[0.5625rem] font-black text-blue-300/60 uppercase tracking-[0.2em] mb-2">
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

    const salient = selectSalientEvidence(evidenceAssessment);

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
            <div className="flex items-center justify-between gap-2">
                <p className="text-[0.5625rem] font-black text-blue-300/70 uppercase tracking-[0.2em]">
                    Landscape Read
                </p>
                {onGlance && (
                    <button
                        type="button"
                        onClick={onGlance}
                        className="text-[0.5625rem] font-black text-white/40 uppercase tracking-widest hover:text-white/70 transition-colors"
                    >
                        ↑ At a glance
                    </button>
                )}
            </div>

            {scheduledMonumentOverlap && (
                <button
                    type="button"
                    onClick={() => setScheduledOpen(v => !v)}
                    className="w-full text-left rounded-xl border border-amber-500/35 bg-amber-500/10 px-3 py-2"
                >
                    <div className="flex items-center justify-between gap-3">
                        <p className="text-[0.625rem] font-black text-amber-300 uppercase tracking-[0.18em]">
                            Scheduled Monument Nearby
                        </p>
                        <span className="text-sm font-black text-amber-300/80">
                            {scheduledOpen ? '-' : '+'}
                        </span>
                    </div>
                    {scheduledOpen && (
                        <p className="mt-1.5 text-[0.6875rem] font-bold text-amber-100/85 leading-snug">
                            A scheduled monument is returned in this scan context. It may be outside the current visible map area; check the official record and avoid protected ground before detecting.
                        </p>
                    )}
                </button>
            )}

            {/* Field action comes first; model interpretation follows below. */}
            {fieldStrategy && (
                <FieldStrategyBlock
                    strategy={fieldStrategy}
                    targetFeatures={targetFeatures}
                    onFocusTarget={onFocusTarget}
                />
            )}

            {/* 1. Landscape assessment summary */}
            <div className="space-y-2">
                    {primaryInterpretationId && primaryScore ? (
                        <div className="space-y-1.5">
                            <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-sm font-black text-white">
                                    {INTERPRETATION_LABELS[primaryInterpretationId]}
                                </span>
                                <ConfidenceBadge tier={primaryScore.confidenceTier} />
                            </div>
                            <PeriodChips affinities={primaryScore.periodAffinity} />
                            <p className="text-[0.6875rem] font-bold text-white/84 leading-snug">
                                {evidenceAssessment.archaeologicalReasoning || narrativeText}
                            </p>
                        </div>
                    ) : (
                        <p className="text-[0.6875rem] font-bold text-white/70 leading-snug italic">
                            {narrativeText || getTemplateText('mixed_indeterminate')}
                        </p>
                    )}

                    {/* Salient evidence bullets — always visible when a primary interpretation exists */}
                    {primaryInterpretationId && salient.bullets.length > 0 && (
                        <div className="space-y-1 pt-1">
                            <p className="text-3xs font-black text-white/45 uppercase tracking-[0.2em]">Why this stands out</p>
                            {salient.bullets.map(b => (
                                <p key={b.id} className={`text-2xs font-bold leading-snug ${b.polarity === 'contradicting' ? 'text-amber-300/90' : 'text-white/80'}`}>
                                    {b.polarity === 'contradicting' ? '▲ ' : '• '}{b.label}
                                </p>
                            ))}
                        </div>
                    )}

                    {/* Evidence meter — always visible when a primary interpretation exists */}
                    {primaryInterpretationId && (
                        <EvidenceMeter
                            support={evidenceAssessment.supportingPercent}
                            contradiction={evidenceAssessment.contradictingPercent}
                        />
                    )}

                    {/* Secondary interpretation */}
                    {secondaryInterpretationId && secondaryScore && (
                        <div className="border-t border-white/8 pt-2 space-y-1">
                            <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-[0.6875rem] font-black text-white/82">
                                    {INTERPRETATION_LABELS[secondaryInterpretationId]}
                                </span>
                                <span className="text-[0.5625rem] font-black text-white/55 uppercase tracking-widest">
                                    also present
                                </span>
                                <ConfidenceBadge tier={secondaryScore.confidenceTier} />
                            </div>
                        </div>
                    )}
            </div>

            <div className="border-t border-white/8 pt-2">
                <p className="text-[0.625rem] font-bold text-white/68 leading-snug">{temporalLabel}</p>
            </div>

            <div className="border-t border-white/8 pt-2">
                <button
                    onClick={() => setDetailsOpen(v => !v)}
                    className="flex items-center gap-1.5 text-[0.625rem] font-black text-white/55 uppercase tracking-widest hover:text-white/82 transition-colors"
                >
                    <span>{detailsOpen ? '-' : '+'}</span>
                    Model details
                </button>
                {detailsOpen && (
                    <div className="mt-2 grid gap-3 animate-in fade-in duration-200">
                        <p className="text-[0.625rem] font-bold text-white/56 leading-snug">
                            {evidenceAssessment.confidenceSummary}
                        </p>

                        {depositionAffinity.convergenceMet && depositionAffinity.noteTemplateId && (
                            <p className="text-[0.625rem] font-bold text-white/62 italic leading-snug">
                                {getTemplateText(depositionAffinity.noteTemplateId)}
                            </p>
                        )}

                        {evidenceAssessment.landscapeEngines.length > 0 && (
                            <div className="grid grid-cols-3 gap-1.5">
                                {evidenceAssessment.landscapeEngines.map(engine => (
                                    <div key={engine.engineId} className="rounded-lg bg-white/[0.035] border border-white/10 px-2 py-1.5 min-w-0">
                                        <p className="text-[0.5rem] font-black text-white/45 uppercase tracking-[0.08em] leading-tight truncate">
                                            {engine.label.replace('Landscape ', '')}
                                        </p>
                                        <div className="mt-1">
                                            <TierBadge tier={engine.tier} compact />
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}

                        <EvidenceList title="Supporting Evidence" items={evidenceAssessment.supportingEvidence} tone="support" />
                        <EvidenceList title="Contradicting Evidence" items={evidenceAssessment.contradictingEvidence} tone="against" />
                        <EvidenceList title="Missing or Weak Evidence" items={evidenceAssessment.missingEvidence} tone="missing" />

                        {evidenceAssessment.periodLikelihood.length > 0 && (
                            <div className="space-y-1.5 border-t border-white/8 pt-2">
                                <p className="text-[0.5625rem] font-black text-blue-300/70 uppercase tracking-widest">
                                    Period likelihood
                                </p>
                                <div className="flex flex-wrap gap-1">
                                    {evidenceAssessment.periodLikelihood.slice(0, 4).map(period => (
                                        <span
                                            key={period.period}
                                            className="text-[0.5625rem] font-black uppercase tracking-wider px-2 py-0.5 rounded-lg bg-blue-500/10 border border-blue-500/25 text-blue-200"
                                        >
                                            {PERIOD_LABELS[period.period]} · {TIER_LABELS[period.tier]}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        )}

                        {evidenceAssessment.behaviourInteractions.length > 0 && (
                            <div className="space-y-1.5 border-t border-white/8 pt-2">
                                <p className="text-[0.5625rem] font-black text-white/45 uppercase tracking-widest">
                                    Behaviour interactions
                                </p>
                                {evidenceAssessment.behaviourInteractions.slice(0, 3).map(interaction => (
                                    <div key={interaction.interactionId} className="flex items-start justify-between gap-2">
                                        <p className="text-[0.6875rem] font-black text-white/78 leading-tight">{interaction.label}</p>
                                        <TierBadge tier={interaction.tier} />
                                    </div>
                                ))}
                            </div>
                        )}

                        {evidence?.hydrology.hydrologicalContext != null && (
                            <div className="space-y-1.5 border-t border-white/8 pt-2">
                                <p className="text-[0.5625rem] font-black uppercase tracking-widest text-white/50">
                                    Hydrology
                                </p>
                                {evidence.hydrology.dryMarginScore != null && evidence.hydrology.dryMarginScore > 0.2 && (
                                    <p className="text-[0.6875rem] font-bold text-white/68 leading-snug">
                                        Dry margin {(evidence.hydrology.dryMarginScore * 100).toFixed(0)}% — raised usable ground beside local wet terrain.
                                    </p>
                                )}
                                {evidence.hydrology.flowConvergence != null && evidence.hydrology.flowConvergence > 0.2 && (
                                    <p className="text-[0.6875rem] font-bold text-white/68 leading-snug">
                                        Flow convergence {(evidence.hydrology.flowConvergence * 100).toFixed(0)}% — water routes converge here.
                                    </p>
                                )}
                            </div>
                        )}

                        {interpretation.confidenceContributions && interpretation.confidenceContributions.length > 0 && (
                            <div className="space-y-1.5 border-t border-white/8 pt-2">
                                <p className="text-[0.5625rem] font-black uppercase tracking-widest text-white/50">
                                    Why this confidence
                                </p>
                                {interpretation.confidenceContributions.map((c, i) => (
                                    <div key={i} className="flex items-center gap-2">
                                        <span className={`text-xs font-black shrink-0 ${c.sign === '+' ? 'text-emerald-300' : 'text-amber-300'}`}>
                                            {c.sign}
                                        </span>
                                        <span className="text-[0.6875rem] font-bold text-white/68 leading-snug">
                                            {c.label}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        )}

                        {evidence && (evidence.historic.routes.length > 0 || evidence.historic.nhle.length > 0 || evidence.historic.aim.length > 0 || evidence.user.findPeriods.length > 0) && (
                            <div className="space-y-1 border-t border-white/8 pt-2">
                                <p className="text-[0.5625rem] font-black uppercase tracking-widest text-white/50">
                                    Dataset counts
                                </p>
                                {evidence.historic.routes.length > 0 && (
                                    <p className="text-[0.6875rem] font-bold text-white/56 leading-snug">
                                        {evidence.historic.routes.length} historic route{evidence.historic.routes.length !== 1 ? 's' : ''} in scan
                                    </p>
                                )}
                                {evidence.historic.nhle.length > 0 && (
                                    <p className="text-[0.6875rem] font-bold text-white/56 leading-snug">
                                        {evidence.historic.nhle.length} scheduled monument{evidence.historic.nhle.length !== 1 ? 's' : ''} recorded
                                    </p>
                                )}
                                {evidence.historic.aim.length > 0 && (
                                    <p className="text-[0.6875rem] font-bold text-white/56 leading-snug">
                                        {evidence.historic.aim.length} aerial intelligence feature{evidence.historic.aim.length !== 1 ? 's' : ''}
                                    </p>
                                )}
                                {evidence.user.findPeriods.length > 0 && (
                                    <p className="text-[0.6875rem] font-bold text-white/56 leading-snug">
                                        Your finds: {evidence.user.findPeriods.join(', ')}
                                    </p>
                                )}
                            </div>
                        )}

                        <div className="border-t border-white/8 pt-2">
                            <LandscapeBehaviourBars processScores={processScores} />
                        </div>

                        {uncertainty !== 'low' && (
                            <UncertaintyNote uncertainty={uncertainty} />
                        )}

                        {findTypeText && (
                            <div className="bg-white/[0.03] border border-white/8 rounded-xl p-2">
                                <p className="text-[0.5625rem] font-black text-white/45 uppercase tracking-widest mb-1">
                                    Typical find types
                                </p>
                                <p className="text-[0.625rem] font-bold text-white/68 leading-snug">
                                    {findTypeText}
                                </p>
                            </div>
                        )}

                        {/* PAS attribution — CC-BY required when PAS-derived evidence renders (P4) */}
                        {[
                            ...evidenceAssessment.supportingEvidence,
                            ...evidenceAssessment.contradictingEvidence,
                            ...evidenceAssessment.missingEvidence,
                        ].some(e => e.id.startsWith('pas_')) && (
                            <p className="text-[0.5rem] font-bold text-white/35 leading-snug">
                                Includes Portable Antiquities Scheme data (CC-BY).
                            </p>
                        )}
                    </div>
                )}
            </div>

            <ModelNotice />
        </div>
    );
}
