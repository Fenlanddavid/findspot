// ─── Confidence Model ─────────────────────────────────────────────────────────
// Derives a ConfidenceTier and UncertaintyLevel from process scores,
// hotspot metrics, and interpretation margins.
//
// IMPORTANT: All weights are UNVALIDATED provisional values.

import type {
    PrimaryProcessScore,
    SecondaryInterpretationScore,
    ConfidenceTier,
    UncertaintyLevel,
    SecondaryInterpretationId,
} from '../../../types/landscapeInterpretation';
import { CONFIDENCE_CEILINGS } from './secondaryInterpretationEngine';

// UNVALIDATED convergence threshold — tune after real-data pass
export const PROCESS_CONVERGENCE_THRESHOLD = 50;

// ─── Main function ────────────────────────────────────────────────────────────

export interface ConfidenceContribution {
    label:  string;
    sign:   '+' | '−';
    weight: number;  // approximate impact on final score (0–100 scale)
}

export interface ConfidenceResult {
    tier:          ConfidenceTier;
    uncertainty:   UncertaintyLevel;
    // Transparent breakdown of what raised or lowered this confidence level.
    // Ordered by weight descending. Powers the "why" list in the UI (P6).
    contributions: ConfidenceContribution[];
}

export function computeConfidence(
    processScores: PrimaryProcessScore[],
    interpretationScores: SecondaryInterpretationScore[],
    primaryInterpretationId: SecondaryInterpretationId | null,
    hotspotMetrics: {
        anomaly: number; context: number; convergence: number;
        behaviour: number; penalty: number; signalCount: number; signalClassCount: number;
    } | null,
    recordSparsity: boolean,
    evidenceBalance?: {
        supportingPercent: number;
        contradictingPercent: number;
        missingCount: number;
    },
): ConfidenceResult {
    // ── Process convergence ───────────────────────────────────────────────────
    const processesAboveThreshold = processScores.filter(
        p => p.finalScore > PROCESS_CONVERGENCE_THRESHOLD
    ).length;
    const processConvergence = (processesAboveThreshold / 6) * 100;

    // ── Hotspot convergence normalisation ─────────────────────────────────────
    // Hotspot.metrics.convergence — assumed 0–100 based on fieldGuideTypes.ts structure.
    // If value is ≤ 1, treat as 0–1 scale and multiply by 100.
    let hotspotConvergenceNormalised = 0;
    if (hotspotMetrics !== null) {
        const raw = hotspotMetrics.convergence;
        hotspotConvergenceNormalised = raw <= 1 ? raw * 100 : raw;
    }

    // ── Final confidence score ────────────────────────────────────────────────
    let finalConfidenceScore: number;
    if (hotspotMetrics !== null) {
        // UNVALIDATED weights: process convergence 70%, hotspot 30%
        finalConfidenceScore = processConvergence * 0.7 + hotspotConvergenceNormalised * 0.3;
    } else {
        finalConfidenceScore = processConvergence;
    }

    // Contradictory and missing evidence reduce confidence directly. This is
    // separate from behavioural scores so negative evidence can say "less
    // certain" rather than simply hiding the interpretation.
    if (evidenceBalance) {
        const supportBonus = Math.max(0, evidenceBalance.supportingPercent - 50) * 0.12;
        const contradictionPenalty = evidenceBalance.contradictingPercent * 0.42;
        const missingPenalty = Math.min(14, evidenceBalance.missingCount * 5);
        finalConfidenceScore = Math.max(
            0,
            Math.min(100, finalConfidenceScore + supportBonus - contradictionPenalty - missingPenalty),
        );
    }

    // ── Bucket to tier ────────────────────────────────────────────────────────
    let tier: ConfidenceTier;
    if (finalConfidenceScore >= 75) tier = 'very_high';
    else if (finalConfidenceScore >= 55) tier = 'high';
    else if (finalConfidenceScore >= 35) tier = 'moderate';
    else tier = 'lower';

    // ── Apply CONFIDENCE_CEILING for primary interpretation ───────────────────
    if (primaryInterpretationId) {
        const ceiling = CONFIDENCE_CEILINGS[primaryInterpretationId];
        const tierOrder: ConfidenceTier[] = ['very_high', 'high', 'moderate', 'lower'];
        const tierIdx    = tierOrder.indexOf(tier);
        const ceilingIdx = tierOrder.indexOf(ceiling);
        if (ceilingIdx > tierIdx) {
            // Ceiling is worse than current tier — cap it
            tier = tierOrder[ceilingIdx];
        }
    }

    // ── Uncertainty from score margin ─────────────────────────────────────────
    const sorted = [...interpretationScores].sort((a, b) => b.derivedScore - a.derivedScore);
    const topScore    = sorted[0]?.derivedScore ?? 0;
    const secondScore = sorted[1]?.derivedScore ?? 0;
    const margin = topScore - secondScore;

    let uncertainty: UncertaintyLevel;
    if (margin < 15)       uncertainty = 'high';
    else if (margin <= 35) uncertainty = 'moderate';
    else                   uncertainty = 'low';

    // Bump uncertainty one tier if record sparsity is true
    if (recordSparsity) {
        if (uncertainty === 'low')      uncertainty = 'moderate';
        else if (uncertainty === 'moderate') uncertainty = 'high';
    }

    // ── Transparent contributions (P4) ───────────────────────────────────────
    // Build a human-readable breakdown of what raised / lowered confidence.
    // Weights are approximate contributions to finalConfidenceScore.
    const contributions: ConfidenceContribution[] = [];

    // Process convergence component
    if (processesAboveThreshold > 0) {
        contributions.push({
            label: `${processesAboveThreshold} of 6 landscape processes above threshold`,
            sign:  processesAboveThreshold >= 2 ? '+' : '−',
            weight: Math.round(processConvergence * 0.7),
        });
    } else {
        contributions.push({ label: 'No landscape processes above threshold', sign: '−', weight: 30 });
    }

    // Hotspot convergence component
    if (hotspotMetrics !== null) {
        const hc = hotspotConvergenceNormalised;
        contributions.push({
            label: hc > 40 ? 'Strong hotspot signal convergence' : hc > 15 ? 'Moderate hotspot convergence' : 'Weak hotspot convergence',
            sign:  hc > 20 ? '+' : '−',
            weight: Math.round(hc * 0.3),
        });
    }

    // Evidence balance components
    if (evidenceBalance) {
        if (evidenceBalance.supportingPercent > 50) {
            contributions.push({
                label: `${Math.round(evidenceBalance.supportingPercent)}% supporting evidence`,
                sign:  '+',
                weight: Math.round(Math.max(0, evidenceBalance.supportingPercent - 50) * 0.12),
            });
        }
        if (evidenceBalance.contradictingPercent > 0) {
            contributions.push({
                label: `${Math.round(evidenceBalance.contradictingPercent)}% contradicting evidence`,
                sign:  '−',
                weight: Math.round(evidenceBalance.contradictingPercent * 0.42),
            });
        }
        if (evidenceBalance.missingCount > 0) {
            contributions.push({
                label: `${evidenceBalance.missingCount} evidence type${evidenceBalance.missingCount !== 1 ? 's' : ''} missing`,
                sign:  '−',
                weight: Math.min(14, evidenceBalance.missingCount * 5),
            });
        }
    }

    // Record sparsity
    if (recordSparsity) {
        contributions.push({ label: 'Limited heritage record coverage', sign: '−', weight: 5 });
    }

    // Sort by weight descending
    contributions.sort((a, b) => b.weight - a.weight);

    return { tier, uncertainty, contributions };
}
