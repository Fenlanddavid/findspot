// ─── Narrative Generator ──────────────────────────────────────────────────────
// Selects the appropriate hedged narrative template and maps signal IDs to
// controlled signal phrases.
//
// All template strings are defined here. CONTROLLED_SIGNAL_VOCABULARY is
// imported from the types file — never redefined locally.
//
// IMPORTANT: All user-facing text must be hedged. No statements about what
// WAS there — only about what characteristics are consistent with past use.

import { CONTROLLED_SIGNAL_VOCABULARY } from '../../../types/landscapeInterpretation';
import type {
    ControlledSignalPhrase,
    SecondaryInterpretationId,
    ConfidenceTier,
    HedgedNarrative,
    ArchaeologicalPeriod,
    PrimaryProcessScore,
} from '../../../types/landscapeInterpretation';
import type { DefencePeriodBranch } from './defensiveBehaviour';
import type { BurialBehaviourResult } from './burialBehaviour';

// ─── Template strings ─────────────────────────────────────────────────────────
// Hedging is mandatory — no statements about what was there.

export const TEMPLATES: Record<string, string> = {
    settlement_activity_area_confident:
        'This area displays terrain and landscape characteristics consistent with past settlement activity — dry, accessible ground near water, with route connections, is typical of the locations people repeatedly chose to live and work.',
    settlement_activity_area_tentative:
        'Some landscape features here are consistent with past settlement activity, though the signal is not strong. Accessible dry ground near water remains a useful context for understanding past land use in this area.',
    agricultural_landscape_confident:
        'The land here shows characteristics strongly associated with agricultural use across multiple periods — fertile soils, gentle slopes, and good drainage are the consistent signature of productive farming landscapes.',
    agricultural_landscape_tentative:
        'Some features here suggest a history of agricultural use, though evidence is limited. Fertile ground and gentle slopes remain worth noting as part of the landscape context.',
    movement_corridor_confident:
        'This area lies along a landscape corridor that would have supported movement — route evidence and terrain geometry together suggest this was a regularly used line of travel, likely across multiple periods.',
    movement_corridor_tentative:
        'The terrain here has some characteristics of a movement corridor, though the signal is not strong. Route alignments, crossing points, and passable dry ground through wet or low-lying landscapes are relevant context for understanding past use.',
    riverine_activity_confident:
        'This landscape shows a clear water relationship — proximity to rivers, springs, or wetland edges is consistently associated with past human activity for water access, crossing, and resource use.',
    riverine_activity_tentative:
        'Water proximity here may have influenced past activity, though the connection is not strongly evidenced. Watercourses and wetland edges are worth noting as part of the landscape context.',
    industrial_landscape_confident:
        'The geology and resource profile here is consistent with past extractive or industrial activity — clay, ironstone, building stone, and similar resources were exploited across many periods wherever they occurred.',
    industrial_landscape_tentative:
        'Some resource indicators here may have supported past extractive activity, though evidence is limited. The presence of relevant geology is noted as landscape context.',
    transition_zone_confident:
        'This area sits at a landscape boundary — geology transitions, terrace breaks, or woodland edges create the kind of edge environment that has been repeatedly significant in past human land use, for settlement, markets, and movement.',
    transition_zone_tentative:
        'Some boundary characteristics are present here. Edge environments between different landscape types were often significant, though the signal in this area is not strong.',
    burial_landscape_barrow_confident:
        'The prominent, elevated position here is consistent with a barrow landscape — high, visible ground overlooking lower terrain is the characteristic location for Bronze Age round barrow placement across Britain.',
    burial_landscape_barrow_tentative:
        'This elevated position has some characteristics associated with barrow placement, though the signal is not strong. Prominence and visibility were important factors in Bronze Age monument placement.',
    burial_landscape_cemetery_confident:
        'The landscape character here — near settlement, boundary-associated — is consistent with early medieval cemetery placement. Furnished burial sites of this period were typically located at the edge of settled areas.',
    burial_landscape_cemetery_tentative:
        'Some landscape features here are loosely consistent with early medieval cemetery placement, though evidence is very limited.',
    defensive_landscape_pre_modern_confident:
        'The terrain here shows strong natural defensive characteristics — high ground, restricted approach, and commanding position are the consistent locational logic for defended places from the Iron Age through the medieval period.',
    defensive_landscape_pre_modern_tentative:
        'Some naturally defensible characteristics are present here, though they are not strongly evidenced. High ground and restricted approach are noted as landscape context.',
    defensive_landscape_twentieth_century_confident:
        'The landscape here has characteristics consistent with 20th-century military use — low-lying ground along route lines and river corridors is the typical positioning for defensive infrastructure of this period.',
    defensive_landscape_twentieth_century_tentative:
        'Some features here are loosely consistent with 20th-century military landscape use, though evidence is limited.',
    mixed_indeterminate:
        'This landscape shows mixed signals across multiple processes without a dominant character. This may reflect genuine complexity in past land use, limited heritage record coverage, or both.',
    deposition_affinity_note:
        'Comparable wetland and boundary landscapes elsewhere have been associated with structured deposition of metalwork and other objects. This is a comparative note, not a prediction about this specific location.',
    mortuary_complex_addendum:
        'The persistent prominence of this location, combined with a strong barrow landscape signature, is consistent with locations used repeatedly as mortuary monuments across generations.',
    temporal_persistence_sparsity:
        'Recorded heritage data for this area is limited. How long this landscape remained in active use cannot be assessed from available records alone.',
    ceremonial_ritual_confident:
        'This area shows characteristics of a ceremonial or ritual landscape — recorded monuments of ceremonial type, often with prominence and structured placement, mark locations used for gathering, observance and commemoration, predominantly in the Neolithic and Bronze Age.',
    ceremonial_ritual_tentative:
        'Some features here are consistent with a ceremonial or ritual landscape, though the signal is limited. Recorded monument context and landscape setting are noted as relevant.',
    scheduled_monument_notice:
        'One or more Scheduled Monuments are recorded within or near this area. Under the Ancient Monuments and Archaeological Areas Act 1979, searching on or within a Scheduled Monument without consent from Historic England is a criminal offence. Check the Historic Environment Record and the National Heritage List before any fieldwork.',
};

export function getTemplateText(templateId: string): string {
    return TEMPLATES[templateId] ?? '';
}

// ─── Signal ID → controlled phrase ───────────────────────────────────────────
// Mapping from signal IDs (used in primaryProcessEngine contributing signals)
// to the controlled vocabulary. Returns null if no mapping exists.

const SIGNAL_ID_MAP: Record<string, ControlledSignalPhrase> = {
    roman_road_proximity:   'lies on or near a Roman road alignment',
    route_convergence:      'sits at a route convergence point',
    crossing_point:         'overlooks a natural crossing point',
    terrace_edge:           'occupies a terrace edge',
    geology_transition:     'sits on a geology transition',
    route_adjacent:         'lies adjacent to a historic movement corridor',
    dry_ground_water_proximity: 'shows elevated dry ground near water',
    slight_elevation:       'sits on a slight elevation overlooking lower ground',
    water_proximity:        'lies close to a documented spring or watercourse',
    ridge_and_furrow:       'shows ridge-and-furrow earthwork evidence',
    woodland_edge:          'lies along a woodland boundary',
    valley_head:            'sits at a valley head or dry valley terminus',
    high_ground_restricted_approach: 'occupies high ground with restricted approach',
    confluence:             'lies at or near a river confluence',
    industrial_resource:    'shows evidence of historic industrial resource proximity',
    marginal_ground:        'occupies marginal ground between two landscape types',
};

export function signalIdToControlledPhrase(signalId: string): ControlledSignalPhrase | null {
    const phrase = SIGNAL_ID_MAP[signalId];
    if (!phrase) return null;
    // Type guard: verify it's actually in the vocabulary
    if ((CONTROLLED_SIGNAL_VOCABULARY as readonly string[]).includes(phrase)) {
        return phrase as ControlledSignalPhrase;
    }
    return null;
}

// ─── Template selection ───────────────────────────────────────────────────────

function isConfident(tier: ConfidenceTier): boolean {
    return tier === 'very_high' || tier === 'high';
}

export function selectTemplateId(
    primaryId: SecondaryInterpretationId | null,
    confidenceTier: ConfidenceTier,
    scheduledMonumentOverlap: boolean,
    burialResult: BurialBehaviourResult | null,
    defencePeriodBranch: DefencePeriodBranch | null,
): string {
    // Scheduled monument notice takes absolute priority
    if (scheduledMonumentOverlap) return 'scheduled_monument_notice';

    if (!primaryId) return 'mixed_indeterminate';

    const confident = isConfident(confidenceTier);

    switch (primaryId) {
        case 'settlement_activity_area':
            return confident ? 'settlement_activity_area_confident' : 'settlement_activity_area_tentative';

        case 'agricultural_landscape':
            return confident ? 'agricultural_landscape_confident' : 'agricultural_landscape_tentative';

        case 'movement_corridor':
            return confident ? 'movement_corridor_confident' : 'movement_corridor_tentative';

        case 'riverine_activity':
            return confident ? 'riverine_activity_confident' : 'riverine_activity_tentative';

        case 'industrial_landscape':
            return confident ? 'industrial_landscape_confident' : 'industrial_landscape_tentative';

        case 'transition_zone':
            return confident ? 'transition_zone_confident' : 'transition_zone_tentative';

        case 'burial_landscape': {
            const sub = burialResult?.dominantSubScore ?? 'barrow';
            if (sub === 'cemetery') {
                return confident ? 'burial_landscape_cemetery_confident' : 'burial_landscape_cemetery_tentative';
            }
            return confident ? 'burial_landscape_barrow_confident' : 'burial_landscape_barrow_tentative';
        }

        case 'defensive_landscape': {
            const branch = defencePeriodBranch ?? 'pre_modern_unassigned';
            if (branch === 'twentieth_century_military') {
                return confident ? 'defensive_landscape_twentieth_century_confident' : 'defensive_landscape_twentieth_century_tentative';
            }
            return confident ? 'defensive_landscape_pre_modern_confident' : 'defensive_landscape_pre_modern_tentative';
        }

        case 'ceremonial_ritual':
            return confident ? 'ceremonial_ritual_confident' : 'ceremonial_ritual_tentative';

        default:
            return 'mixed_indeterminate';
    }
}

// ─── Top contributing signals ─────────────────────────────────────────────────

function getTopSignals(processScores: PrimaryProcessScore[], maxCount = 3): ControlledSignalPhrase[] {
    // Gather all contributing signal IDs across all processes, weighted by finalScore
    const signalScores = new Map<string, number>();
    for (const p of processScores) {
        for (const sig of p.contributingSignals) {
            const existing = signalScores.get(sig) ?? 0;
            signalScores.set(sig, existing + p.finalScore);
        }
    }

    // Sort by total weight, map to controlled phrases
    const sorted = Array.from(signalScores.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([id]) => signalIdToControlledPhrase(id))
        .filter((p): p is ControlledSignalPhrase => p !== null);

    // Deduplicate
    const seen = new Set<string>();
    return sorted.filter(p => {
        if (seen.has(p)) return false;
        seen.add(p);
        return true;
    }).slice(0, maxCount);
}

// ─── Main generator ───────────────────────────────────────────────────────────

export function generateHedgedNarrative(
    primaryId: SecondaryInterpretationId | null,
    confidenceTier: ConfidenceTier,
    scheduledMonumentOverlap: boolean,
    processScores: PrimaryProcessScore[],
    burialResult: BurialBehaviourResult | null,
    defencePeriodBranch: DefencePeriodBranch | null,
    primaryPeriodAffinities: Array<{ period: ArchaeologicalPeriod; weight: number }>,
): HedgedNarrative {
    const templateId = selectTemplateId(
        primaryId,
        confidenceTier,
        scheduledMonumentOverlap,
        burialResult,
        defencePeriodBranch,
    );

    // Period substitution: top period by affinity weight (> 0.35)
    const topPeriod = primaryPeriodAffinities
        .filter(a => a.weight > 0.35)
        .sort((a, b) => b.weight - a.weight)[0]?.period ?? null;

    // Signal substitutions: top 3 controlled phrases
    const signalSubstitutions = getTopSignals(processScores, 3);

    return {
        templateId,
        periodSubstitution: topPeriod,
        signalSubstitutions,
    };
}
