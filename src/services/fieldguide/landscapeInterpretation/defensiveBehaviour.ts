// ─── Defensive Behaviour Sub-Engine ──────────────────────────────────────────
// Computes defensive landscape affinity from process scores, NHLE features,
// and terrain.
//
// IMPORTANT: All weights are UNVALIDATED provisional values.

import type { PrimaryProcessScore, PeriodSignalAggregate } from '../../../types/landscapeInterpretation';

// ─── Output types ─────────────────────────────────────────────────────────────

export type DefencePeriodBranch =
    | 'prehistoric_enclosure'
    | 'roman_military'
    | 'medieval_fortification'
    | 'civil_war'
    | 'twentieth_century_military'
    | 'pre_modern_unassigned';

export interface DefensiveBehaviourResult {
    naturalDefensibility: number;    // 0–100
    constructedDefence: number;      // 0–100
    periodBranch: DefencePeriodBranch;
    nhleRecordPresent: boolean;
}

// ─── Defence monument type keywords ──────────────────────────────────────────

const DEFENCE_KEYWORDS = [
    'hillfort', 'hill fort', 'castle', 'fort', 'fortification', 'motte', 'bailey',
    'pillbox', 'anti-tank', 'military', 'battery', 'redoubt', 'earthwork',
];

function matchesDefence(desc: string): boolean {
    const lower = desc.toLowerCase();
    return DEFENCE_KEYWORDS.some(kw => lower.includes(kw));
}

// ─── Period branch mapping ────────────────────────────────────────────────────

function inferPeriodBranch(
    nhleDescriptions: string[],
    periodAggregates: PeriodSignalAggregate[],
): DefencePeriodBranch {
    const allDesc = nhleDescriptions.join(' ').toLowerCase();

    if (allDesc.includes('pillbox') || allDesc.includes('anti-tank') || allDesc.includes('world war') ||
        allDesc.includes('twentieth century') || allDesc.includes('20th')) {
        return 'twentieth_century_military';
    }

    if (allDesc.includes('motte') || allDesc.includes('bailey') || allDesc.includes('castle') ||
        allDesc.includes('medieval fort')) {
        return 'medieval_fortification';
    }

    if (allDesc.includes('roman') || allDesc.includes('roman fort') || allDesc.includes('roman military')) {
        return 'roman_military';
    }

    if (allDesc.includes('hillfort') || allDesc.includes('hill fort') || allDesc.includes('enclosure')) {
        return 'prehistoric_enclosure';
    }

    if (allDesc.includes('redoubt') || allDesc.includes('battery') || allDesc.includes('civil war')) {
        return 'civil_war';
    }

    // Fall back to period aggregates
    const hasMedieval = periodAggregates.some(a => a.period === 'medieval' && a.certaintyWeightedCount > 0.3);
    if (hasMedieval) return 'medieval_fortification';

    const hasRoman = periodAggregates.some(a => a.period === 'romano_british' && a.certaintyWeightedCount > 0.3);
    if (hasRoman) return 'roman_military';

    const hasPrehistoric = periodAggregates.some(a => a.period === 'prehistoric_bronze_age' && a.certaintyWeightedCount > 0.3);
    if (hasPrehistoric) return 'prehistoric_enclosure';

    return 'pre_modern_unassigned';
}

// ─── Helper ───────────────────────────────────────────────────────────────────

function getScore(scores: PrimaryProcessScore[], id: string): number {
    return scores.find(p => p.processId === id)?.finalScore ?? 0;
}

// ─── Main function ────────────────────────────────────────────────────────────

export function computeDefensiveBehaviour(
    processScores: PrimaryProcessScore[],
    periodAggregates: PeriodSignalAggregate[],
    nhleDescriptions: string[],
    slopePercent: number,
    hasNHLEDefenceRecord: boolean,
): DefensiveBehaviourResult {
    const prominenceScore = getScore(processScores, 'landscape_prominence');
    const waterScore      = getScore(processScores, 'water_relationships');
    const routeScore      = getScore(processScores, 'movement');

    // ── Natural defensibility ─────────────────────────────────────────────────
    // UNVALIDATED provisional: high ground + steep slopes = defensible
    let naturalDefensibility = 0;
    naturalDefensibility += prominenceScore * 0.6;           // prominence is the primary driver
    if (slopePercent > 15) naturalDefensibility += 25;        // restricted approach
    else if (slopePercent > 8) naturalDefensibility += 15;
    naturalDefensibility = Math.min(100, Math.max(0, naturalDefensibility));

    // ── Constructed defence ───────────────────────────────────────────────────
    let constructedDefence = 0;
    const nhleDefenceMatch = nhleDescriptions.some(d => matchesDefence(d));

    if (nhleDefenceMatch) {
        constructedDefence = 70;  // Strong NHLE evidence
        if (prominenceScore > 50) constructedDefence += 20;  // Corroborated by terrain
        constructedDefence = Math.min(100, constructedDefence);
    }

    // Period branch — determines which narrative template is used
    const periodBranch = inferPeriodBranch(nhleDescriptions, periodAggregates);

    // 20th-century branch: low-lying ground along route/river lines
    if (periodBranch === 'twentieth_century_military') {
        // Re-weight: route + water logic instead of height
        constructedDefence = nhleDefenceMatch
            ? Math.min(100, 60 + (waterScore > 40 ? 20 : 0) + (routeScore > 40 ? 20 : 0))
            : constructedDefence;
        naturalDefensibility = Math.min(50, naturalDefensibility); // Height matters less for 20C
    }

    return {
        naturalDefensibility,
        constructedDefence,
        periodBranch,
        nhleRecordPresent: hasNHLEDefenceRecord || nhleDefenceMatch,
    };
}
