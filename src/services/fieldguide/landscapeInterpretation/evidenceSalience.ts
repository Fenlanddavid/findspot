// ─── Evidence Salience — deterministic bullet selection ─────────────────────
// Picks up to 3 evidence bullets for the ten-second scan view.
// Pure functions, no engine imports — types only.
//
// Contradicting weight table (must be checked when new ids are added
// to evidenceModel.ts):
//   wet_ground_or_floodplain  26 | 18 (hydroScore >= 65 gate)
//   steep_slope_constraint    22
//   heavy_clay_drainage       16
//   not_south_facing           8
// Threshold CONTRADICTION_WEIGHT_OVERRIDE = 20 → weight override fires
// only for wet@26 and steep@22. Moderate variants reach bullets only
// via the percent trigger.
// NOTE: pas_* and personal_* ids are supporting-only by their own
// tested invariants — they can never appear in this table.

import type { EvidenceItem } from '../../../types/landscapeInterpretation';

export const SALIENCE_MAX_BULLETS = 3;
export const CONTRADICTION_PERCENT_OVERRIDE = 35;
export const CONTRADICTION_WEIGHT_OVERRIDE = 20;

// Optional communicative boost per evidence id. Deterministic, sparse.
// Ships EMPTY. Tuning later is data-only — no logic changes.
export const SALIENCE_BOOST: Record<string, number> = {};

export interface SalientEvidence {
    bullets: EvidenceItem[];
    includesContradiction: boolean;
}

export function selectSalientEvidence(a: {
    supportingEvidence: EvidenceItem[];
    contradictingEvidence: EvidenceItem[];
    supportingPercent: number;
    contradictingPercent: number;
}): SalientEvidence {
    // 1. Override check — evaluate BEFORE support selection
    const overrideFires =
        a.contradictingPercent >= CONTRADICTION_PERCENT_OVERRIDE ||
        a.contradictingEvidence.some(e => e.weight >= CONTRADICTION_WEIGHT_OVERRIDE);

    // 2. Slot budget
    const slotsForSupport = overrideFires
        ? SALIENCE_MAX_BULLETS - 1
        : SALIENCE_MAX_BULLETS;

    // 3. Score and rank supporting evidence
    const scored = a.supportingEvidence.map(item => ({
        item,
        score: item.weight + (SALIENCE_BOOST[item.id] ?? 0),
    }));
    scored.sort((a, b) => b.score - a.score || a.item.id.localeCompare(b.item.id));

    // 5. Source diversity: greedy pick, skip if source already appears twice
    const picks: EvidenceItem[] = [];
    const sourceCounts = new Map<string, number>();

    for (const { item } of scored) {
        if (picks.length >= slotsForSupport) break;
        const count = sourceCounts.get(item.source) ?? 0;
        if (count >= 2) continue;
        picks.push(item);
        sourceCounts.set(item.source, count + 1);
    }

    // Relax diversity if we didn't fill all slots
    if (picks.length < slotsForSupport) {
        const pickIds = new Set(picks.map(p => p.id));
        for (const { item } of scored) {
            if (picks.length >= slotsForSupport) break;
            if (pickIds.has(item.id)) continue;
            picks.push(item);
            pickIds.add(item.id);
        }
    }

    // 6. Append contradicting bullet (highest weight, tie-break id asc)
    let includesContradiction = false;
    if (overrideFires) {
        const sorted = [...a.contradictingEvidence].sort(
            (a, b) => b.weight - a.weight || a.id.localeCompare(b.id),
        );
        const topContradiction = sorted[0];
        if (topContradiction) {
            picks.push(topContradiction);
            includesContradiction = true;
        }
    }

    // 7. Never include 'missing' polarity (none should reach here via
    //    supportingEvidence or contradictingEvidence, but guard anyway)
    const bullets = picks.filter(item => item.polarity !== 'missing');

    // 8. No supports and no override → empty
    return { bullets, includesContradiction };
}
