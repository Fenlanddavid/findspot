// ─── Deposition Affinity ──────────────────────────────────────────────────────
// Computes whether a landscape shows characteristics associated with structured
// deposition of metalwork and other objects.
//
// This is a comparative note — not a prediction about any specific location.
// Suppression rules prevent this note from appearing in highly-occupied or
// high-movement landscapes where it would be misleading.

import type { PrimaryProcessScore, SecondaryInterpretationScore, DepositionAffinityResult } from '../../../types/landscapeInterpretation';
import type { AdaptedSignals } from './signalAdapters';

// ─── Helper ───────────────────────────────────────────────────────────────────

function getProcessScore(scores: PrimaryProcessScore[], id: string): number {
    return scores.find(p => p.processId === id)?.finalScore ?? 0;
}

function getInterpretationScore(scores: SecondaryInterpretationScore[], id: string): number {
    return scores.find(s => s.interpretationId === id)?.derivedScore ?? 0;
}

// ─── Main function ────────────────────────────────────────────────────────────

export function computeDepositionAffinity(
    processScores: PrimaryProcessScore[],
    interpretationScores: SecondaryInterpretationScore[],
    signals: AdaptedSignals,
): DepositionAffinityResult {
    const waterScore      = getProcessScore(processScores, 'water_relationships');
    const boundaryScore   = getProcessScore(processScores, 'boundary_relationships');
    const movementScore   = getProcessScore(processScores, 'movement');
    const occupationScore = getProcessScore(processScores, 'occupation_potential');

    const settlementScore  = getInterpretationScore(interpretationScores, 'settlement_activity_area');
    const movementCorridor = getInterpretationScore(interpretationScores, 'movement_corridor');

    // ── Suppression rules (checked first) ────────────────────────────────────
    // High settlement or movement activity suppresses the deposition note — it
    // would be misleading in obviously-habitation or route-dominated landscapes.
    if (settlementScore > 60 || movementCorridor > 65) {
        return { convergenceMet: false, noteTemplateId: null };
    }

    // ── Minimum-N rule (need ≥ 3 of 5 criteria) ───────────────────────────────
    let criteriaCount = 0;

    if (waterScore > 45)        criteriaCount++;    // 1. Water proximity
    if (boundaryScore > 40)     criteriaCount++;    // 2. Boundary context
    // 3. Isolated position: low movement AND low occupation
    if (movementScore < 30 && occupationScore < 40) criteriaCount++;
    if (settlementScore < 35)   criteriaCount++;    // 4. Not a settlement area
    if (signals.confluencePresent) criteriaCount++; // 5. Confluence present

    if (criteriaCount >= 3) {
        return { convergenceMet: true, noteTemplateId: 'deposition_affinity_note' };
    }

    return { convergenceMet: false, noteTemplateId: null };
}
