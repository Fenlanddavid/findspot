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
    components: {
        dataQuality: number;
        observationAgreement: number;
        interpretationStrength: number;
    };
}

export interface HotspotConfidenceMetrics {
    anomaly: number;
    context: number;
    /** Explicit hotspot convergence points, range 0–20. */
    convergence: number;
    behaviour: number;
    penalty: number;
    signalCount: number;
    signalClassCount: number;
    /** Percent, range 0–100. */
    dataQuality?: number;
    deliveryCompleteness?: number | null;
    dataQualityReasons?: string[];
    /** Percent agreement between distinct parent observations, range 0–100. */
    observationAgreement?: number;
    observationAgreementReasons?: string[];
    /** Heuristic interpretation strength, range 0–100; not a probability. */
    interpretationStrength?: number;
}

function percent(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value)
        ? Math.max(0, Math.min(100, value))
        : 0;
}

export function normaliseConvergencePoints(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value)
        ? Math.max(0, Math.min(20, value)) * 5
        : 0;
}

export function computeConfidence(
    processScores: PrimaryProcessScore[],
    interpretationScores: SecondaryInterpretationScore[],
    primaryInterpretationId: SecondaryInterpretationId | null,
    hotspotMetrics: HotspotConfidenceMetrics | null,
    recordSparsity: boolean,
    evidenceBalance?: {
        supportingPercent: number;
        contradictingPercent: number;
        missingCount: number;
    },
): ConfidenceResult {
    void processScores;
    const primaryScore = primaryInterpretationId
        ? interpretationScores.find(score => score.interpretationId === primaryInterpretationId)?.derivedScore
        : undefined;
    const dataQuality = percent(hotspotMetrics?.dataQuality);
    const observationAgreement = percent(hotspotMetrics?.observationAgreement);
    const interpretationStrength = percent(hotspotMetrics?.interpretationStrength ?? primaryScore);

    // These are deliberately separate concepts. The combined value is an
    // unvalidated heuristic rank, not a calibrated probability.
    let finalConfidenceScore = dataQuality * 0.35 + observationAgreement * 0.35 + interpretationStrength * 0.30;

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

    if (hotspotMetrics?.deliveryCompleteness != null) {
        contributions.push({ label: `Data delivery completeness ${Math.round(hotspotMetrics.deliveryCompleteness)}%`, sign: hotspotMetrics.deliveryCompleteness >= 75 ? '+' : '−', weight: 0 });
    } else {
        contributions.push({ label: 'Data delivery completeness unknown', sign: '−', weight: 0 });
    }
    contributions.push({ label: `Analytical data suitability ${Math.round(dataQuality)}% (heuristic)`, sign: dataQuality >= 50 ? '+' : '−', weight: Math.round(dataQuality * 0.35) });
    contributions.push({ label: `Distinct-observation agreement ${Math.round(observationAgreement)}%`, sign: observationAgreement >= 50 ? '+' : '−', weight: Math.round(observationAgreement * 0.35) });
    contributions.push({ label: `Interpretation strength ${Math.round(interpretationStrength)}% (unvalidated heuristic)`, sign: interpretationStrength >= 50 ? '+' : '−', weight: Math.round(interpretationStrength * 0.30) });
    for (const reason of hotspotMetrics?.dataQualityReasons ?? []) {
        contributions.push({ label: reason, sign: '−', weight: 0 });
    }
    for (const reason of hotspotMetrics?.observationAgreementReasons ?? []) {
        contributions.push({ label: reason, sign: observationAgreement >= 50 ? '+' : '−', weight: 0 });
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

    return { tier, uncertainty, contributions, components: { dataQuality, observationAgreement, interpretationStrength } };
}
