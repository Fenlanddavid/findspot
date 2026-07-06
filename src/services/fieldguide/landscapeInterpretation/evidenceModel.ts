// ─── Evidence Model ──────────────────────────────────────────────────────────
// Converts process scores and adapted signals into explicit archaeological
// reasoning: supporting evidence, contradicting evidence, confidence balance,
// period likelihood, landscape opportunity/constraint/memory, and interactions.

import type {
    AdaptedSignals,
} from './signalAdapters';
import type { PASAdapterOutput } from './signalAdapters';
import type {
    ArchaeologicalEvidenceAssessment,
    ArchaeologicalPeriod,
    BehaviourInteraction,
    BehaviourInteractionId,
    EvidenceItem,
    EvidenceSource,
    EvidenceStrength,
    LandscapeEngineAssessment,
    LandscapeEngineId,
    LikelihoodTier,
    PeriodLikelihood,
    PrimaryProcessId,
    PrimaryProcessScore,
    SecondaryInterpretationId,
    SecondaryInterpretationScore,
    TemporalPersistenceLabel,
} from '../../../types/landscapeInterpretation';
import type { GeologyContext } from '../../../engines/geologyContext';

const PERIOD_LABELS: Record<ArchaeologicalPeriod, string> = {
    prehistoric_bronze_age: 'Prehistoric / Bronze Age',
    iron_age:               'Iron Age',
    romano_british:         'Romano-British',
    early_medieval:         'Early Medieval',
    medieval:               'Medieval',
    post_medieval:          'Post-Medieval',
    modern_industrial:      'Modern / Industrial',
};

const INTERPRETATION_LABELS: Record<SecondaryInterpretationId, string> = {
    settlement_activity_area:   'settlement activity',
    agricultural_landscape:     'agricultural use',
    movement_corridor:          'movement through the landscape',
    riverine_activity:          'water-related activity',
    industrial_landscape:       'resource or industrial activity',
    transition_zone:            'boundary or edge-zone use',
    burial_landscape:           'burial or commemorative use',
    defensive_landscape:        'defensive or controlling use',
    ceremonial_ritual:          'Ceremonial / Ritual Landscape',
};

const SIGNAL_EVIDENCE: Record<string, { label: string; source: EvidenceSource }> = {
    roman_road_proximity:              { label: 'Roman road alignment nearby', source: 'historic_routes' },
    route_convergence:                 { label: 'Movement routes converge here', source: 'historic_routes' },
    crossing_point:                    { label: 'Potential natural crossing point', source: 'hydrology' },
    terrace_edge:                      { label: 'Terrace or dry edge position', source: 'terrain' },
    geology_transition:                { label: 'Geology transition present', source: 'geology' },
    route_adjacent:                    { label: 'Historic route or trackway nearby', source: 'historic_routes' },
    dry_ground_water_proximity:        { label: 'Dry ground close to water', source: 'terrain' },
    slight_elevation:                  { label: 'Slightly elevated or overlooking ground', source: 'terrain' },
    water_proximity:                   { label: 'Freshwater or wetland proximity', source: 'hydrology' },
    ridge_and_furrow:                  { label: 'Ridge-and-furrow or field-system evidence', source: 'historic_records' },
    woodland_edge:                     { label: 'Woodland or historic edge position', source: 'historic_records' },
    valley_head:                       { label: 'Valley-head or dry-valley position', source: 'terrain' },
    high_ground_restricted_approach:   { label: 'Prominent ground with restricted approach', source: 'terrain' },
    confluence:                        { label: 'River confluence or water meeting point', source: 'hydrology' },
    industrial_resource:               { label: 'Resource geology suitable for extraction', source: 'geology' },
    marginal_ground:                   { label: 'Marginal ground between landscape types', source: 'derived_model' },
    raised_relief_measured:            { label: 'Measured local rise above surrounding ground', source: 'terrain' },
    low_gradient_measured:             { label: 'Measured low-gradient accessible ground', source: 'terrain' },
};

function cap(value: number, max = 100): number {
    return Math.min(max, Math.max(0, value));
}

function tierFromScore(score: number): LikelihoodTier {
    if (score >= 78) return 'very_high';
    if (score >= 58) return 'high';
    if (score >= 35) return 'moderate';
    if (score >= 15) return 'low';
    return 'very_low';
}

function strengthFromWeight(weight: number): EvidenceStrength {
    if (weight >= 22) return 'strong';
    if (weight >= 12) return 'moderate';
    return 'weak';
}

function evidence(
    id: string,
    label: string,
    source: EvidenceSource,
    weight: number,
    polarity: EvidenceItem['polarity'] = 'supporting',
): EvidenceItem {
    return {
        id,
        label,
        source,
        weight: cap(Math.round(weight)),
        polarity,
        strength: strengthFromWeight(weight),
    };
}

function dedupeEvidence(items: EvidenceItem[]): EvidenceItem[] {
    const byId = new Map<string, EvidenceItem>();
    for (const item of items) {
        const existing = byId.get(item.id);
        if (!existing || item.weight > existing.weight) byId.set(item.id, item);
    }
    return [...byId.values()].sort((a, b) => b.weight - a.weight);
}

function processScore(processScores: PrimaryProcessScore[], id: PrimaryProcessId): number {
    return processScores.find(p => p.processId === id)?.finalScore ?? 0;
}

function subScore(processScores: PrimaryProcessScore[], processId: PrimaryProcessId, subId: string): number {
    return processScores.find(p => p.processId === processId)?.subComponents?.find(s => s.id === subId)?.score ?? 0;
}

function geologyText(geologyContext: GeologyContext | null): string {
    if (!geologyContext) return '';
    return [
        geologyContext.raw.bedrockName,
        geologyContext.raw.bedrockLithology,
        geologyContext.raw.superficialName,
        geologyContext.raw.superficialLithology,
    ].filter(Boolean).join(' ').toLowerCase();
}

function geologyContains(geologyContext: GeologyContext | null, terms: string[]): boolean {
    const text = geologyText(geologyContext);
    return terms.some(term => text.includes(term));
}

function buildSignalEvidence(processScores: PrimaryProcessScore[]): EvidenceItem[] {
    const signalWeights = new Map<string, number>();
    for (const process of processScores) {
        for (const signalId of process.contributingSignals) {
            signalWeights.set(signalId, (signalWeights.get(signalId) ?? 0) + process.finalScore * 0.22);
        }
    }

    return dedupeEvidence(
        [...signalWeights.entries()]
            .map(([signalId, weight]) => {
                const mapped = SIGNAL_EVIDENCE[signalId];
                if (!mapped) return null;
                return evidence(signalId, mapped.label, mapped.source, weight);
            })
            .filter((item): item is EvidenceItem => item !== null),
    );
}

function buildContradictingEvidence(
    signals: AdaptedSignals,
    geologyContext: GeologyContext | null,
    slopePercent: number,
    aspectDegrees: number,
    potentialBreakdown: { terrain: number; hydro: number; historic: number; signals: number } | null,
): EvidenceItem[] {
    const items: EvidenceItem[] = [];
    const hydroScore = potentialBreakdown?.hydro ?? 0;

    if (signals.wetlandPresent || hydroScore >= 65 || geologyContains(geologyContext, ['peat', 'alluvium'])) {
        items.push(evidence('wet_ground_or_floodplain', 'Wet ground or floodplain influence reduces certainty', 'hydrology', hydroScore >= 65 ? 26 : 18, 'contradicting'));
    }

    if (geologyContains(geologyContext, ['clay', 'mudstone'])) {
        items.push(evidence('heavy_clay_drainage', 'Heavy clay or mudstone may indicate poorer drainage', 'geology', 16, 'contradicting'));
    }

    if (slopePercent >= 12) {
        items.push(evidence('steep_slope_constraint', 'Steep slope constrains occupation and cultivation', 'terrain', 22, 'contradicting'));
    }

    if (aspectDegrees < 112.5 || aspectDegrees > 247.5) {
        items.push(evidence('not_south_facing', 'Aspect is not strongly south-facing', 'terrain', 8, 'contradicting'));
    }

    if ((potentialBreakdown?.historic ?? 0) < 20 && signals.recordSparsity) {
        items.push(evidence('sparse_records', 'Few recorded historic datasets agree here', 'historic_records', 16, 'missing'));
    }

    if ((potentialBreakdown?.terrain ?? 0) < 20) {
        items.push(evidence('limited_terrain_expression', 'Terrain expression is limited in available scan data', 'remote_sensing', 10, 'missing'));
    }

    return dedupeEvidence(items);
}

function buildLandscapeEngine(
    engineId: LandscapeEngineId,
    label: string,
    score: number,
    supportingEvidence: EvidenceItem[],
    contradictingEvidence: EvidenceItem[],
    reasoning: string,
): LandscapeEngineAssessment {
    return {
        engineId,
        label,
        score: cap(Math.round(score)),
        tier: tierFromScore(score),
        supportingEvidence: dedupeEvidence(supportingEvidence).slice(0, 5),
        contradictingEvidence: dedupeEvidence(contradictingEvidence).slice(0, 4),
        reasoning,
    };
}

function computeLandscapeEngines(
    processScores: PrimaryProcessScore[],
    signals: AdaptedSignals,
    signalEvidence: EvidenceItem[],
    contradiction: EvidenceItem[],
    temporalPersistence: TemporalPersistenceLabel,
    potentialBreakdown: { terrain: number; hydro: number; historic: number; signals: number } | null,
): LandscapeEngineAssessment[] {
    const opportunityScore = cap(
        processScore(processScores, 'occupation_potential') * 0.23 +
        processScore(processScores, 'movement') * 0.18 +
        processScore(processScores, 'resource_exploitation') * 0.18 +
        processScore(processScores, 'water_relationships') * 0.16 +
        processScore(processScores, 'landscape_prominence') * 0.12 +
        processScore(processScores, 'boundary_relationships') * 0.13,
    );

    const wetConstraint = contradiction.filter(e => e.polarity === 'contradicting').reduce((sum, e) => sum + e.weight, 0);
    const constraintScore = cap(wetConstraint + ((potentialBreakdown?.hydro ?? 0) > 70 ? 12 : 0));

    const temporalBase: Record<TemporalPersistenceLabel, number> = {
        transient: 12,
        recurrent: 42,
        persistent: 66,
        persistent_strategic_focus: 84,
    };
    const memoryScore = cap(
        temporalBase[temporalPersistence] +
        (signals.romanRoadPresent ? 10 : 0) +
        (signals.routeConvergence ? 10 : 0) +
        (signals.hasNHLEBurialRecord ? 8 : 0),
    );

    const routeEvidence = signalEvidence.filter(e => e.source === 'historic_routes');
    const waterEvidence = signalEvidence.filter(e => e.source === 'hydrology');
    const terrainEvidence = signalEvidence.filter(e => e.source === 'terrain');
    const resourceEvidence = signalEvidence.filter(e => e.source === 'geology' || e.id === 'ridge_and_furrow');

    const memoryEvidence = [
        ...routeEvidence,
        ...signalEvidence.filter(e => ['ridge_and_furrow', 'water_proximity', 'high_ground_restricted_approach'].includes(e.id)),
    ];
    if (temporalPersistence !== 'transient') {
        memoryEvidence.push(evidence('multi_period_record_signal', 'Recorded evidence spans more than one period', 'historic_records', memoryScore * 0.25));
    }

    return [
        buildLandscapeEngine(
            'landscape_opportunity',
            'Landscape Opportunity',
            opportunityScore,
            [...terrainEvidence, ...waterEvidence, ...routeEvidence, ...resourceEvidence],
            contradiction.filter(e => e.polarity === 'contradicting'),
            'Opportunity measures the features that would have attracted repeated activity, including water, route access, resources, shelter and visibility.',
        ),
        buildLandscapeEngine(
            'landscape_constraint',
            'Landscape Constraint',
            constraintScore,
            contradiction.filter(e => e.polarity === 'contradicting'),
            signalEvidence.filter(e => ['dry_ground_water_proximity', 'terrace_edge', 'slight_elevation'].includes(e.id)),
            'Constraint measures evidence that discourages or complicates activity, such as wet ground, floodplain influence, steep slope or poor drainage.',
        ),
        buildLandscapeEngine(
            'landscape_memory',
            'Landscape Memory',
            memoryScore,
            memoryEvidence,
            contradiction.filter(e => e.polarity === 'missing'),
            'Memory measures whether the same landscape appears suitable for reuse through time, especially where routes, dry ground, monuments or multi-period records persist.',
        ),
    ];
}

function interaction(
    interactionId: BehaviourInteractionId,
    label: string,
    score: number,
    drivers: PrimaryProcessId[],
    supportingEvidence: EvidenceItem[],
    contradictingEvidence: EvidenceItem[],
    reasoning: string,
): BehaviourInteraction {
    return {
        interactionId,
        label,
        score: cap(Math.round(score)),
        tier: tierFromScore(score),
        drivers,
        supportingEvidence: dedupeEvidence(supportingEvidence).slice(0, 4),
        contradictingEvidence: dedupeEvidence(contradictingEvidence).slice(0, 3),
        reasoning,
    };
}

function computeInteractions(
    processScores: PrimaryProcessScore[],
    signalEvidence: EvidenceItem[],
    contradiction: EvidenceItem[],
): BehaviourInteraction[] {
    const score = (a: PrimaryProcessId, b: PrimaryProcessId) =>
        Math.min(processScore(processScores, a), processScore(processScores, b));

    const byIds = (ids: string[]) => signalEvidence.filter(e => ids.includes(e.id));
    const broadContradiction = contradiction.filter(e => e.polarity === 'contradicting');

    const results: BehaviourInteraction[] = [
        interaction('river_crossing', 'River Crossing', score('movement', 'water_relationships'), ['movement', 'water_relationships'], byIds(['crossing_point', 'confluence', 'route_convergence', 'water_proximity', 'roman_road_proximity']), broadContradiction, 'Movement and water signals combine to suggest a possible crossing or water-side route focus.'),
        interaction('settlement_focus', 'Settlement Focus', score('occupation_potential', 'water_relationships'), ['occupation_potential', 'water_relationships'], byIds(['dry_ground_water_proximity', 'water_proximity', 'route_adjacent', 'terrace_edge']), broadContradiction, 'Occupation and water signals combine where dry accessible ground lies close to freshwater.'),
        interaction('hilltop_settlement', 'Hilltop Settlement', score('occupation_potential', 'landscape_prominence'), ['occupation_potential', 'landscape_prominence'], byIds(['slight_elevation', 'high_ground_restricted_approach', 'terrace_edge']), broadContradiction, 'Occupation and prominence signals combine where higher ground could have offered visibility and defensibility.'),
        interaction('market_activity', 'Market Activity', score('movement', 'resource_exploitation'), ['movement', 'resource_exploitation'], byIds(['route_adjacent', 'route_convergence', 'ridge_and_furrow', 'industrial_resource']), broadContradiction, 'Movement and resource signals combine where productive land or resources sit beside route access.'),
        interaction('gateway', 'Gateway', score('movement', 'boundary_relationships'), ['movement', 'boundary_relationships'], byIds(['route_convergence', 'geology_transition', 'woodland_edge', 'marginal_ground']), broadContradiction, 'Movement and boundary signals combine where routes pass through an edge, transition or pinch point.'),
        interaction('industrial_activity', 'Industrial Activity', score('resource_exploitation', 'water_relationships'), ['resource_exploitation', 'water_relationships'], byIds(['industrial_resource', 'water_proximity', 'confluence']), broadContradiction, 'Resource and water signals combine where geology and water access could support extractive or processing activity.'),
        interaction('ritual_landscape', 'Ritual Landscape', score('landscape_prominence', 'water_relationships'), ['landscape_prominence', 'water_relationships'], byIds(['high_ground_restricted_approach', 'slight_elevation', 'water_proximity', 'confluence']), broadContradiction, 'Prominence and water signals combine in a way seen in some ritual or commemorative landscapes.'),
        interaction('control_point', 'Control Point', score('movement', 'landscape_prominence'), ['movement', 'landscape_prominence'], byIds(['route_convergence', 'high_ground_restricted_approach', 'roman_road_proximity']), broadContradiction, 'Movement and prominence signals combine where elevated ground overlooks a route or crossing.'),
    ];

    return results.filter(r => r.score >= 30).sort((a, b) => b.score - a.score).slice(0, 4);
}

function computePeriodLikelihood(
    interpretationScores: SecondaryInterpretationScore[],
    signals: AdaptedSignals,
    signalEvidence: EvidenceItem[],
    contradiction: EvidenceItem[],
): PeriodLikelihood[] {
    const periodScores = new Map<ArchaeologicalPeriod, number>();

    for (const interp of interpretationScores) {
        for (const affinity of interp.periodAffinity) {
            periodScores.set(
                affinity.period,
                (periodScores.get(affinity.period) ?? 0) + interp.derivedScore * affinity.weight,
            );
        }
    }

    for (const aggregate of signals.periodAggregates) {
        periodScores.set(
            aggregate.period,
            (periodScores.get(aggregate.period) ?? 0) + Math.min(28, aggregate.certaintyWeightedCount * 12),
        );
    }

    const recordEvidence = signals.periodAggregates.map(a =>
        evidence(
            `period_record_${a.period}`,
            `${PERIOD_LABELS[a.period]} records nearby`,
            'historic_records',
            Math.min(30, a.certaintyWeightedCount * 10),
        )
    );

    return ([...periodScores.entries()] as [ArchaeologicalPeriod, number][])
        .map(([period, score]) => {
            const supportingEvidence = dedupeEvidence([
                ...signalEvidence.slice(0, 4),
                ...recordEvidence.filter(e => e.id === `period_record_${period}`),
            ]);
            const periodContradiction = contradiction.filter(e => e.polarity === 'contradicting');
            const finalScore = cap(score - periodContradiction.reduce((sum, e) => sum + e.weight, 0) * 0.12);

            return {
                period,
                score: Math.round(finalScore),
                tier: tierFromScore(finalScore),
                supportingEvidence: supportingEvidence.slice(0, 4),
                contradictingEvidence: periodContradiction.slice(0, 3),
                reasoning: `${PERIOD_LABELS[period]} likelihood reflects period-specific landscape weighting, nearby records, and the current contradiction level.`,
            };
        })
        .filter(p => p.score >= 15)
        .sort((a, b) => b.score - a.score)
        .slice(0, 5);
}

function buildSummary(
    primaryInterpretationId: SecondaryInterpretationId | null,
    supportPercent: number,
    contradictingPercent: number,
    topEvidence: EvidenceItem[],
): { suggested: string; reasoning: string; summary: string; confidence: string; factors: string[] } {
    const primaryLabel = primaryInterpretationId
        ? INTERPRETATION_LABELS[primaryInterpretationId]
        : 'mixed landscape use';

    const evidenceText = topEvidence.slice(0, 3).map(e => e.label.toLowerCase()).join(', ');
    const caveat = contradictingPercent >= 30
        ? ' Substantial contradictory evidence means this should be treated cautiously.'
        : contradictingPercent >= 15
            ? ' Some contradictory evidence reduces certainty.'
            : '';

    return {
        suggested: `Possible ${primaryLabel}`,
        reasoning: evidenceText
            ? `This area exhibits characteristics commonly associated with ${primaryLabel}, including ${evidenceText}.${caveat}`
            : `This area has mixed archaeological signals without one strong line of supporting evidence.${caveat}`,
        summary: `Supporting evidence accounts for ${supportPercent}% of the weighted model evidence; contradictory evidence accounts for ${contradictingPercent}%.`,
        confidence: supportPercent >= 70 && contradictingPercent < 20
            ? 'High confidence: multiple datasets broadly agree with limited contradiction.'
            : supportPercent >= 50 && contradictingPercent < 35
                ? 'Moderate confidence: useful agreement is present, but contradiction or missing data remains material.'
                : 'Lower confidence: evidence is limited, mixed, or strongly contradicted.',
        factors: topEvidence.slice(0, 5).map(e => e.label),
    };
}

export function computeEvidenceAssessment(
    processScores: PrimaryProcessScore[],
    interpretationScores: SecondaryInterpretationScore[],
    primaryInterpretationId: SecondaryInterpretationId | null,
    signals: AdaptedSignals,
    geologyContext: GeologyContext | null,
    slopePercent: number,
    aspectDegrees: number,
    potentialBreakdown: { terrain: number; hydro: number; historic: number; signals: number } | null,
    temporalPersistence: TemporalPersistenceLabel,
    pasOutput?: PASAdapterOutput | null,
): ArchaeologicalEvidenceAssessment {
    const signalEvidence = buildSignalEvidence(processScores);

    if (signals.hasNHLECeremonialRecord) {
        signalEvidence.push(evidence(
            'recorded_ceremonial_monument',
            'Recorded ceremonial or ritual monument in area',
            'historic_records', 16));
    }

    const processEvidence = processScores
        .filter(p => p.finalScore >= 35)
        .map(p => evidence(
            `process_${p.processId}`,
            `${p.processId.replace(/_/g, ' ')} signal is ${p.finalScore >= 60 ? 'strong' : 'moderate'}`,
            'derived_model',
            p.finalScore * 0.18,
        ));

    // ── PAS evidence (Phase B) — supporting-only, never contradicting (P2) ──
    const pasEvidence: EvidenceItem[] = [];
    if (pasOutput && pasOutput.densityTier !== 'none') {
        // pas_regional_density: weight depends on tier
        const densityWeight = pasOutput.densityTier === 'notable' ? 10 : 6;
        // cellCount is not directly on pasOutput — we derive from the tier
        // label template uses {count} but we don't have the raw count here,
        // so we store a generic label. The caller fills in count via the
        // worker's input.pas.cellCount if needed. For now, use the density
        // tier wording directly.
        const countStr = pasOutput.cellCount.toLocaleString();
        pasEvidence.push(evidence(
            'pas_regional_density',
            pasOutput.densityTier === 'notable'
                ? `Recorded finds are notably dense in the wider landscape (${countStr} PAS records within the surrounding area)`
                : `Recorded finds are present in the wider landscape (${countStr} PAS records within the surrounding area)`,
            'historic_records',
            densityWeight,
        ));

        // pas_period_alignment: only when top PAS period matches an existing
        // monument/AIM period signal (P1 — PAS corroborates, never introduces).
        // Monument-derived aggregates have recordCount > 0; PAS-injected ones
        // have recordCount 0, so we filter on recordCount to avoid self-corroboration.
        if (pasOutput.topMappedPeriod) {
            const monumentPeriods = new Set(
                signals.periodAggregates.filter(a => a.recordCount > 0).map(a => a.period),
            );
            if (monumentPeriods.has(pasOutput.topMappedPeriod)) {
                pasEvidence.push(evidence(
                    'pas_period_alignment',
                    `Recorded finds in the wider landscape are predominantly ${PERIOD_LABELS[pasOutput.topMappedPeriod]}, consistent with other evidence here`,
                    'historic_records',
                    8,
                ));
            }
        }
    }

    const contradictionAndMissing = buildContradictingEvidence(
        signals,
        geologyContext,
        slopePercent,
        aspectDegrees,
        potentialBreakdown,
    );

    const supportingEvidence = dedupeEvidence([...signalEvidence, ...processEvidence, ...pasEvidence]).slice(0, 10);
    const contradictingEvidence = contradictionAndMissing.filter(e => e.polarity === 'contradicting');
    const missingEvidence = contradictionAndMissing.filter(e => e.polarity === 'missing');

    const supportWeight = supportingEvidence.reduce((sum, e) => sum + e.weight, 0);
    const contradictionWeight = contradictingEvidence.reduce((sum, e) => sum + e.weight, 0);
    const totalWeight = Math.max(1, supportWeight + contradictionWeight);
    const supportingPercent = Math.round((supportWeight / totalWeight) * 100);
    const contradictingPercent = Math.round((contradictionWeight / totalWeight) * 100);

    const landscapeEngines = computeLandscapeEngines(
        processScores,
        signals,
        signalEvidence,
        contradictionAndMissing,
        temporalPersistence,
        potentialBreakdown,
    );

    const behaviourInteractions = computeInteractions(processScores, signalEvidence, contradictionAndMissing);
    const periodLikelihood = computePeriodLikelihood(
        interpretationScores,
        signals,
        signalEvidence,
        contradictionAndMissing,
    );

    const summary = buildSummary(
        primaryInterpretationId,
        supportingPercent,
        contradictingPercent,
        supportingEvidence,
    );

    return {
        supportingEvidence,
        contradictingEvidence,
        missingEvidence,
        supportingPercent,
        contradictingPercent,
        confidenceSummary: summary.confidence,
        primaryInfluencingFactors: summary.factors,
        suggestedInterpretation: summary.suggested,
        archaeologicalReasoning: summary.reasoning,
        landscapeSummary: summary.summary,
        landscapeEngines,
        periodLikelihood,
        behaviourInteractions,
    };
}
