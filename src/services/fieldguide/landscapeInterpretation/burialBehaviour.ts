// ─── Burial Behaviour Sub-Engine ─────────────────────────────────────────────
// Computes burial landscape affinity from process scores and period signals.
//
// IMPORTANT: All weights are UNVALIDATED provisional values.
// Two internal sub-scores are produced; the dominant one determines the period
// bias fed to secondaryInterpretationEngine.

import type { PrimaryProcessScore, PeriodSignalAggregate } from '../../../types/landscapeInterpretation';

// ─── Output type ──────────────────────────────────────────────────────────────

export interface BurialBehaviourResult {
    barrowLandscape: number;    // 0–100
    cemeteryLandscape: number;  // 0–100
    mortuaryComplex: boolean;   // barrow_landscape > 65 AND persistent temporal label
    dominantSubScore: 'barrow' | 'cemetery';
    nhleRecordPresent: boolean;
}

// ─── Helper ───────────────────────────────────────────────────────────────────

function getScore(scores: PrimaryProcessScore[], id: string): number {
    return scores.find(p => p.processId === id)?.finalScore ?? 0;
}

function hasPeriodSignal(aggregates: PeriodSignalAggregate[], period: string, threshold = 0.3): boolean {
    const entry = aggregates.find(a => a.period === period);
    return (entry?.certaintyWeightedCount ?? 0) >= threshold;
}

// ─── Main function ────────────────────────────────────────────────────────────

export function computeBurialBehaviour(
    processScores: PrimaryProcessScore[],
    periodAggregates: PeriodSignalAggregate[],
    temporalPersistenceLabel: 'transient' | 'recurrent' | 'persistent' | 'persistent_strategic_focus',
    hasNHLEBurialRecord: boolean,
): BurialBehaviourResult {
    const prominenceScore   = getScore(processScores, 'landscape_prominence');
    const movementScore     = getScore(processScores, 'movement');
    const occupationScore   = getScore(processScores, 'occupation_potential');
    const boundaryScore     = getScore(processScores, 'boundary_relationships');

    // ── Sub-score A: barrow landscape ─────────────────────────────────────────
    // UNVALIDATED provisional weights
    let barrowScore = 0;
    if (prominenceScore > 50)                                    barrowScore += 40;
    if (movementScore > 40)                                      barrowScore += 25;
    if (hasPeriodSignal(periodAggregates, 'prehistoric_bronze_age')) barrowScore += 15;
    // Isolated elevated position: high prominence, low occupation
    if (prominenceScore > 50 && occupationScore < 40)           barrowScore += 20;
    // NHLE burial record strengthens confidence
    if (hasNHLEBurialRecord)                                    barrowScore = Math.min(100, barrowScore + 20);

    barrowScore = Math.min(100, Math.max(0, barrowScore));

    // ── Sub-score B: cemetery landscape ──────────────────────────────────────
    // UNVALIDATED provisional weights
    let cemeteryScore = 0;
    if (occupationScore > 40)                                   cemeteryScore += 30;
    if (boundaryScore > 35)                                     cemeteryScore += 25;
    // Low prominence is acceptable for cemetery placement
    if (prominenceScore < 50)                                   cemeteryScore += 10;
    if (hasPeriodSignal(periodAggregates, 'early_medieval'))    cemeteryScore += 20;
    if (hasNHLEBurialRecord)                                    cemeteryScore = Math.min(100, cemeteryScore + 20);

    cemeteryScore = Math.min(100, Math.max(0, cemeteryScore));

    // ── Mortuary complex compound state ───────────────────────────────────────
    const mortuaryComplex =
        barrowScore > 65 &&
        (temporalPersistenceLabel === 'persistent' || temporalPersistenceLabel === 'persistent_strategic_focus');

    const dominantSubScore: 'barrow' | 'cemetery' = barrowScore >= cemeteryScore ? 'barrow' : 'cemetery';

    return {
        barrowLandscape:   barrowScore,
        cemeteryLandscape: cemeteryScore,
        mortuaryComplex,
        dominantSubScore,
        nhleRecordPresent: hasNHLEBurialRecord,
    };
}
