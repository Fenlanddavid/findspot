// ─── Secondary Interpretation Engine ─────────────────────────────────────────
// Derives SecondaryInterpretationScore from primary process scores, burial
// behaviour, and defensive behaviour results.
//
// IMPORTANT: All weights are UNVALIDATED provisional values.

import type {
    SecondaryInterpretationId,
    SecondaryInterpretationScore,
    PrimaryProcessScore,
    PeriodAffinityScore,
    ArchaeologicalPeriod,
    ConfidenceTier,
} from '../../../types/landscapeInterpretation';
import type { BurialBehaviourResult } from './burialBehaviour';
import type { DefensiveBehaviourResult } from './defensiveBehaviour';

// ─── Confidence ceilings ──────────────────────────────────────────────────────
// Hard caps — not just display hints. Applied before returning scores.

export const CONFIDENCE_CEILINGS: Record<SecondaryInterpretationId, ConfidenceTier> = {
    movement_corridor:          'very_high',
    settlement_activity_area:   'very_high',
    agricultural_landscape:     'high',
    industrial_landscape:       'high',
    riverine_activity:          'moderate',
    transition_zone:            'moderate',
    burial_landscape:           'moderate',   // bumped to 'high' if NHLE burial record present
    defensive_landscape:        'moderate',   // bumped to 'high' if NHLE defence record present
    ceremonial_ritual:          'very_high',
};

// ─── Period affinity static weights ──────────────────────────────────────────
// UNVALIDATED provisional weights. Sums approximate 1.0 per interpretation.

const PERIOD_AFFINITIES: Record<SecondaryInterpretationId, Record<ArchaeologicalPeriod, number>> = {
    settlement_activity_area: {
        prehistoric_bronze_age: 0.15, iron_age: 0.15, romano_british: 0.20,
        early_medieval: 0.15, medieval: 0.20, post_medieval: 0.10, modern_industrial: 0.05,
    },
    agricultural_landscape: {
        medieval: 0.30, romano_british: 0.20, prehistoric_bronze_age: 0.20,
        iron_age: 0.15, post_medieval: 0.10, early_medieval: 0.05, modern_industrial: 0.0,
    },
    movement_corridor: {
        romano_british: 0.30, medieval: 0.20, prehistoric_bronze_age: 0.20,
        iron_age: 0.15, post_medieval: 0.10, early_medieval: 0.05, modern_industrial: 0.0,
    },
    riverine_activity: {
        prehistoric_bronze_age: 0.14, iron_age: 0.14, romano_british: 0.14,
        early_medieval: 0.14, medieval: 0.14, post_medieval: 0.15, modern_industrial: 0.15,
    },
    industrial_landscape: {
        medieval: 0.25, post_medieval: 0.30, romano_british: 0.20,
        iron_age: 0.15, modern_industrial: 0.10, prehistoric_bronze_age: 0.0, early_medieval: 0.0,
    },
    transition_zone: {
        prehistoric_bronze_age: 0.14, iron_age: 0.14, romano_british: 0.14,
        early_medieval: 0.14, medieval: 0.14, post_medieval: 0.15, modern_industrial: 0.15,
    },
    burial_landscape: {
        prehistoric_bronze_age: 0.35, iron_age: 0.15, romano_british: 0.15,
        early_medieval: 0.20, medieval: 0.10, post_medieval: 0.05, modern_industrial: 0.0,
    },
    defensive_landscape: {
        prehistoric_bronze_age: 0.20, iron_age: 0.25, romano_british: 0.20,
        early_medieval: 0.10, medieval: 0.20, post_medieval: 0.05, modern_industrial: 0.0,
    },
    ceremonial_ritual: {
        prehistoric_bronze_age: 0.60, iron_age: 0.15, romano_british: 0.10,
        early_medieval: 0.05, medieval: 0.05, post_medieval: 0.05, modern_industrial: 0.0,
    },
};

// ─── Tier ordering ────────────────────────────────────────────────────────────

const TIER_ORDER: ConfidenceTier[] = ['very_high', 'high', 'moderate', 'lower'];

function capTier(tier: ConfidenceTier, ceiling: ConfidenceTier): ConfidenceTier {
    const tierIdx    = TIER_ORDER.indexOf(tier);
    const ceilingIdx = TIER_ORDER.indexOf(ceiling);
    // Lower index = higher confidence; cap to ceiling index (worse or equal)
    return TIER_ORDER[Math.max(tierIdx, ceilingIdx)];
}

// ─── Helper ───────────────────────────────────────────────────────────────────

function getProcessScore(scores: PrimaryProcessScore[], id: string): number {
    return scores.find(p => p.processId === id)?.finalScore ?? 0;
}

function getSubScore(scores: PrimaryProcessScore[], processId: string, subId: string): number {
    const proc = scores.find(p => p.processId === processId);
    return proc?.subComponents?.find(s => s.id === subId)?.score ?? 0;
}

function buildPeriodAffinity(id: SecondaryInterpretationId): PeriodAffinityScore[] {
    const weights = PERIOD_AFFINITIES[id];
    return (Object.entries(weights) as [ArchaeologicalPeriod, number][])
        .map(([period, weight]) => ({ period, weight }))
        .sort((a, b) => b.weight - a.weight);
}

function scoreToTier(score: number): ConfidenceTier {
    if (score >= 75) return 'very_high';
    if (score >= 55) return 'high';
    if (score >= 35) return 'moderate';
    return 'lower';
}

// ─── Main function ────────────────────────────────────────────────────────────

export function computeSecondaryInterpretations(
    processScores: PrimaryProcessScore[],
    burial: BurialBehaviourResult,
    defensive: DefensiveBehaviourResult,
    hasNHLEIndustrialRecord: boolean,
    ceremonialRecordCount: number,
): SecondaryInterpretationScore[] {
    const results: SecondaryInterpretationScore[] = [];

    // ── settlement_activity_area ──────────────────────────────────────────────
    {
        const id: SecondaryInterpretationId = 'settlement_activity_area';
        const occupationScore = getProcessScore(processScores, 'occupation_potential');
        const settlementSuitability = getSubScore(processScores, 'occupation_potential', 'settlement_suitability');
        // UNVALIDATED: occupation_potential × 0.7 weighted by settlement_suitability sub-component
        const derivedScore = occupationScore * 0.7 + (settlementSuitability * 0.3);
        const tier = capTier(scoreToTier(derivedScore), CONFIDENCE_CEILINGS[id]);
        results.push({
            interpretationId: id,
            derivedScore: Math.min(100, Math.max(0, derivedScore)),
            periodAffinity: buildPeriodAffinity(id),
            confidenceTier: tier,
        });
    }

    // ── agricultural_landscape ────────────────────────────────────────────────
    {
        const id: SecondaryInterpretationId = 'agricultural_landscape';
        let derivedScore = getSubScore(processScores, 'resource_exploitation', 'agricultural_resource');
        const resourceProc = processScores.find(p => p.processId === 'resource_exploitation');
        const ridgeFurrowFired = resourceProc?.contributingSignals?.includes('ridge_and_furrow') ?? false;
        let ceiling = CONFIDENCE_CEILINGS[id];
        if (!ridgeFurrowFired) {
            derivedScore = Math.min(derivedScore, 34); // geology-only inference cannot headline
            ceiling = 'lower';
        }
        const tier = capTier(scoreToTier(derivedScore), ceiling);
        results.push({
            interpretationId: id,
            derivedScore: Math.min(100, Math.max(0, derivedScore)),
            periodAffinity: buildPeriodAffinity(id),
            confidenceTier: tier,
        });
    }

    // ── movement_corridor ─────────────────────────────────────────────────────
    {
        const id: SecondaryInterpretationId = 'movement_corridor';
        const derivedScore = getProcessScore(processScores, 'movement');
        const tier = capTier(scoreToTier(derivedScore), CONFIDENCE_CEILINGS[id]);
        results.push({
            interpretationId: id,
            derivedScore: Math.min(100, Math.max(0, derivedScore)),
            periodAffinity: buildPeriodAffinity(id),
            confidenceTier: tier,
        });
    }

    // ── riverine_activity ─────────────────────────────────────────────────────
    {
        const id: SecondaryInterpretationId = 'riverine_activity';
        const derivedScore = getProcessScore(processScores, 'water_relationships');
        const tier = capTier(scoreToTier(derivedScore), CONFIDENCE_CEILINGS[id]);
        results.push({
            interpretationId: id,
            derivedScore: Math.min(100, Math.max(0, derivedScore)),
            periodAffinity: buildPeriodAffinity(id),
            confidenceTier: tier,
        });
    }

    // ── industrial_landscape ──────────────────────────────────────────────────
    {
        const id: SecondaryInterpretationId = 'industrial_landscape';
        const extractScore = getSubScore(processScores, 'resource_exploitation', 'extractive_resource');
        const derivedScore = Math.min(100, extractScore + (hasNHLEIndustrialRecord ? 15 : 0));
        const tier = capTier(scoreToTier(derivedScore), CONFIDENCE_CEILINGS[id]);
        results.push({
            interpretationId: id,
            derivedScore: Math.min(100, Math.max(0, derivedScore)),
            periodAffinity: buildPeriodAffinity(id),
            confidenceTier: tier,
        });
    }

    // ── transition_zone ───────────────────────────────────────────────────────
    {
        const id: SecondaryInterpretationId = 'transition_zone';
        const derivedScore = getProcessScore(processScores, 'boundary_relationships');
        const tier = capTier(scoreToTier(derivedScore), CONFIDENCE_CEILINGS[id]);
        results.push({
            interpretationId: id,
            derivedScore: Math.min(100, Math.max(0, derivedScore)),
            periodAffinity: buildPeriodAffinity(id),
            confidenceTier: tier,
        });
    }

    // ── burial_landscape ──────────────────────────────────────────────────────
    {
        const id: SecondaryInterpretationId = 'burial_landscape';
        const derivedScore = Math.max(burial.barrowLandscape, burial.cemeteryLandscape);
        const ceiling = burial.nhleRecordPresent ? 'high' : CONFIDENCE_CEILINGS[id];

        // Override period affinity based on dominant sub-score
        let affinities = buildPeriodAffinity(id);
        if (burial.dominantSubScore === 'cemetery') {
            // Cemetery branch: bias toward early_medieval
            affinities = affinities.map(a => ({
                ...a,
                weight: a.period === 'early_medieval' ? 0.40 : a.weight * 0.7,
            }));
        } else {
            // Barrow branch: bias toward prehistoric_bronze_age
            affinities = affinities.map(a => ({
                ...a,
                weight: a.period === 'prehistoric_bronze_age' ? 0.50 : a.weight * 0.6,
            }));
        }

        const tier = capTier(scoreToTier(derivedScore), ceiling as ConfidenceTier);
        results.push({
            interpretationId: id,
            derivedScore: Math.min(100, Math.max(0, derivedScore)),
            periodAffinity: affinities,
            confidenceTier: tier,
        });
    }

    // ── defensive_landscape ───────────────────────────────────────────────────
    {
        const id: SecondaryInterpretationId = 'defensive_landscape';
        const derivedScore = Math.max(defensive.naturalDefensibility, defensive.constructedDefence);
        const ceiling = defensive.nhleRecordPresent ? 'high' : CONFIDENCE_CEILINGS[id];
        const tier = capTier(scoreToTier(derivedScore), ceiling as ConfidenceTier);
        results.push({
            interpretationId: id,
            derivedScore: Math.min(100, Math.max(0, derivedScore)),
            periodAffinity: buildPeriodAffinity(id),
            confidenceTier: tier,
        });
    }

    // ── ceremonial_ritual ─────────────────────────────────────────────────────
    {
        const id: SecondaryInterpretationId = 'ceremonial_ritual';
        // Record-led — no score at all without at least one matched record
        const derivedScore = ceremonialRecordCount === 0 ? 0 : (() => {
            const prominence = getProcessScore(processScores, 'landscape_prominence');
            const water = getProcessScore(processScores, 'water_relationships');
            const base = 58;
            const countBump = Math.min(Math.max(ceremonialRecordCount - 1, 0), 4) * 8;
            return Math.min(100, base + countBump + prominence * 0.15 + water * 0.10);
        })();
        const tier = capTier(scoreToTier(derivedScore), CONFIDENCE_CEILINGS[id]);
        results.push({
            interpretationId: id,
            derivedScore: Math.min(100, Math.max(0, derivedScore)),
            periodAffinity: buildPeriodAffinity(id),
            confidenceTier: tier,
        });
    }

    return results;
}

// ─── Primary / secondary selection ───────────────────────────────────────────

export function selectPrimaryAndSecondary(
    interpretations: SecondaryInterpretationScore[],
): { primaryId: SecondaryInterpretationId | null; secondaryId: SecondaryInterpretationId | null } {
    const sorted = [...interpretations].sort((a, b) => b.derivedScore - a.derivedScore);

    // Recorded ceremonial monuments outrank inferred land use
    const ceremonial = interpretations.find(i => i.interpretationId === 'ceremonial_ritual');
    if (ceremonial && ceremonial.derivedScore >= 50) {
        const burial = interpretations.find(i => i.interpretationId === 'burial_landscape');
        let secondaryId: SecondaryInterpretationId | null = null;
        if (burial && burial.derivedScore >= 30) {
            secondaryId = 'burial_landscape';
        } else {
            const nextBest = sorted.find(i =>
                i.interpretationId !== 'ceremonial_ritual' && i.derivedScore >= 30,
            );
            secondaryId = nextBest?.interpretationId ?? null;
        }
        return { primaryId: 'ceremonial_ritual', secondaryId };
    }

    const agricultural = interpretations.find(i => i.interpretationId === 'agricultural_landscape');
    const movement = interpretations.find(i => i.interpretationId === 'movement_corridor');
    if (
        agricultural &&
        movement &&
        sorted[0]?.interpretationId === 'agricultural_landscape' &&
        movement.derivedScore >= 40 &&
        agricultural.derivedScore - movement.derivedScore <= 15
    ) {
        return {
            primaryId: 'movement_corridor',
            secondaryId: agricultural.derivedScore >= 35 ? 'agricultural_landscape' : null,
        };
    }

    const primary   = sorted[0]?.derivedScore >= 35 ? sorted[0] : null;
    const secondary = sorted[1]?.derivedScore >= 30 ? sorted[1] : null;

    return {
        primaryId:   primary?.interpretationId ?? null,
        secondaryId: secondary?.interpretationId ?? null,
    };
}
