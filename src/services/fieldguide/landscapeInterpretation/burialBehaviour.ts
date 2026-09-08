// ─── Burial Behaviour Sub-Engine ─────────────────────────────────────────────
// Computes burial landscape affinity from process scores and period signals.
//
// IMPORTANT: All weights are UNVALIDATED provisional values.
// Two internal sub-scores are produced; the dominant one determines the period
// bias fed to secondaryInterpretationEngine.

import type { PrimaryProcessScore, PeriodSignalAggregate, TemporalPersistenceLabel } from '../../../types/landscapeInterpretation';

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
    temporalPersistenceLabel: TemporalPersistenceLabel,
    hasNHLEBurialRecord: boolean,
): BurialBehaviourResult {
    const prominenceScore   = getScore(processScores, 'landscape_prominence');
    const movementScore     = getScore(processScores, 'movement');
    const occupationScore   = getScore(processScores, 'occupation_potential');
    const boundaryScore     = getScore(processScores, 'boundary_relationships');

    const hasBronzeAgeEvidence = hasPeriodSignal(periodAggregates, 'prehistoric_bronze_age');
    const hasEarlyMedievalEvidence = hasPeriodSignal(periodAggregates, 'early_medieval');
    const hasRelevantDatedOrRecordedEvidence =
        hasNHLEBurialRecord || hasBronzeAgeEvidence || hasEarlyMedievalEvidence;

    // Terrain context cannot create a funerary interpretation by itself. These
    // provisional contextual weights are only evaluated after relevant dated or
    // recorded evidence is present.
    let barrowScore = 0;
    if (hasRelevantDatedOrRecordedEvidence) {
        if (prominenceScore > 50)                            barrowScore += 25;
        if (movementScore > 40)                              barrowScore += 15;
        if (hasBronzeAgeEvidence)                            barrowScore += 35;
        if (prominenceScore > 50 && occupationScore < 40)   barrowScore += 10;
        if (hasNHLEBurialRecord)                             barrowScore += 30;
    }

    barrowScore = Math.min(100, Math.max(0, barrowScore));

    // ── Sub-score B: cemetery landscape ──────────────────────────────────────
    // UNVALIDATED provisional weights
    let cemeteryScore = 0;
    if (hasRelevantDatedOrRecordedEvidence) {
        if (occupationScore > 40)                           cemeteryScore += 20;
        if (boundaryScore > 35)                             cemeteryScore += 15;
        if (prominenceScore < 50)                           cemeteryScore += 5;
        if (hasEarlyMedievalEvidence)                        cemeteryScore += 40;
        if (hasNHLEBurialRecord)                             cemeteryScore += 30;
    }

    cemeteryScore = Math.min(100, Math.max(0, cemeteryScore));

    // ── Mortuary complex compound state ───────────────────────────────────────
    const mortuaryComplex =
        hasRelevantDatedOrRecordedEvidence &&
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
