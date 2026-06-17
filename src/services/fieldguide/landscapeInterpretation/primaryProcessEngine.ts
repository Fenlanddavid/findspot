// ─── Primary Process Engine ───────────────────────────────────────────────────
// Computes the six PrimaryProcessScore objects.
//
// IMPORTANT: All weights are UNVALIDATED provisional values.
// A real-data tuning pass is required before these scores should be
// used in any consequential decision-making context.
//
// All scores 0–100. Each process applies a regional multiplier before returning.

import type { PrimaryProcessScore, PrimaryProcessId } from '../../../types/landscapeInterpretation';
import type { AdaptedSignals } from './signalAdapters';
import type { TerrainRegionType } from './regionalCalibration';
import { getRegionalMultiplier } from './regionalCalibration';
import type { GeologyContext } from '../../../engines/geologyContext';

// UNVALIDATED convergence threshold — tune after real-data pass
export const PROCESS_CONVERGENCE_THRESHOLD = 50;

// ─── Geology helpers ──────────────────────────────────────────────────────────

function geologyContains(gc: GeologyContext | null, terms: string[]): boolean {
    if (!gc) return false;
    const text = [gc.raw.bedrockName, gc.raw.bedrockLithology, gc.raw.superficialName, gc.raw.superficialLithology]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
    return terms.some(t => text.includes(t));
}

function isFreeDraining(gc: GeologyContext | null): boolean {
    return geologyContains(gc, ['sand', 'gravel', 'chalk', 'limestone', 'sandstone']);
}

function isFertileGeology(gc: GeologyContext | null): boolean {
    return geologyContains(gc, ['alluvium', 'clay', 'loam', 'marl', 'mudstone']);
}

function isExtractiveGeology(gc: GeologyContext | null): boolean {
    return geologyContains(gc, ['clay', 'ironstone', 'iron', 'peat', 'coal', 'tin', 'copper', 'lead', 'limestone']);
}

function isStableGeology(gc: GeologyContext | null): boolean {
    return !geologyContains(gc, ['peat', 'alluvium', 'made ground', 'disturbed', 'fill']);
}

// ─── Aspect helpers ───────────────────────────────────────────────────────────

function isSouthFacingAspect(aspectDegrees: number): boolean {
    // South, SE, SW — 112.5° to 247.5°
    return aspectDegrees >= 112.5 && aspectDegrees <= 247.5;
}

// ─── Cap helper ───────────────────────────────────────────────────────────────

function cap(value: number, max = 100): number {
    return Math.min(max, Math.max(0, value));
}

// ─── Compute all six processes ────────────────────────────────────────────────

export function computePrimaryProcesses(
    signals: AdaptedSignals,
    geologyContext: GeologyContext | null,
    elevationM: number,
    slopePercent: number,
    aspectDegrees: number,
    region: TerrainRegionType,
    potentialBreakdown: { terrain: number; hydro: number; historic: number; signals: number } | null,
): PrimaryProcessScore[] {
    const results: PrimaryProcessScore[] = [];

    // ── 1. Occupation Potential ───────────────────────────────────────────────
    {
        const processId: PrimaryProcessId = 'occupation_potential';
        let settlementScore = 0;
        const settlementSignals: string[] = [];

        // Slope < 10%: suitable for settlement
        if (slopePercent < 10) { settlementScore += 15; }
        // South/SE/SW aspect
        if (isSouthFacingAspect(aspectDegrees)) { settlementScore += 10; settlementSignals.push('slight_elevation'); }
        // Elevation 5–50m above sea level (broad proxy for terrace/dry ground)
        if (elevationM >= 5 && elevationM <= 50) { settlementScore += 10; settlementSignals.push('terrace_edge'); }
        // Water proximity — use hydro score as fallback when no feature-based signal
        const hydroScore = potentialBreakdown?.hydro ?? 0;
        if (signals.waterProximity || hydroScore > 25) {
            settlementScore += 15;
            settlementSignals.push('water_proximity');
        }
        // Route access
        if (signals.romanRoadPresent || signals.historicTrackwayPresent) { settlementScore += 12; settlementSignals.push('route_adjacent'); }
        // Stable geology
        if (isStableGeology(geologyContext)) { settlementScore += 8; }
        // Dry ground near water
        if ((signals.waterProximity || hydroScore > 25) && slopePercent < 5) { settlementScore += 10; settlementSignals.push('dry_ground_water_proximity'); }

        settlementScore = cap(settlementScore);

        // Agricultural suitability (used to reduce settlement overclaiming)
        let agriScore = 0;
        if (isFertileGeology(geologyContext)) agriScore += 30;
        if (slopePercent < 5) agriScore += 20;
        if (isFreeDraining(geologyContext))   agriScore += 20;
        agriScore = cap(agriScore);

        // UNVALIDATED weights: settlement 70%, agricultural reduction 30%
        const rawScore = cap(settlementScore * 0.7 + agriScore * 0.3);
        const multiplier = getRegionalMultiplier(processId, region);

        results.push({
            processId,
            rawScore,
            regionalMultiplier: multiplier,
            finalScore: cap(rawScore * multiplier),
            contributingSignals: [...new Set(settlementSignals)],
            subComponents: [
                { id: 'settlement_suitability', score: settlementScore },
                { id: 'agricultural_suitability', score: agriScore },
            ],
        });
    }

    // ── 2. Movement ───────────────────────────────────────────────────────────
    {
        const processId: PrimaryProcessId = 'movement';
        let score = 0;
        const contributingSignals: string[] = [];

        // UNVALIDATED additive weights
        if (signals.romanRoadPresent)         { score += 40; contributingSignals.push('roman_road_proximity'); }
        if (signals.historicTrackwayPresent)  { score += 20; contributingSignals.push('route_adjacent'); }
        if (signals.routeConvergence)         { score += 25; contributingSignals.push('route_convergence'); }
        if (signals.confluencePresent)        { score += 20; contributingSignals.push('crossing_point'); }

        // Saddle/col heuristic: moderate elevation + moderate slope
        if (elevationM > 20 && elevationM < 150 && slopePercent > 2 && slopePercent < 15) {
            score += 15;
        }

        const rawScore = cap(score);
        const multiplier = getRegionalMultiplier(processId, region);

        results.push({
            processId,
            rawScore,
            regionalMultiplier: multiplier,
            finalScore: cap(rawScore * multiplier),
            contributingSignals: [...new Set(contributingSignals)],
        });
    }

    // ── 3. Resource Exploitation ──────────────────────────────────────────────
    {
        const processId: PrimaryProcessId = 'resource_exploitation';
        const contributingSignals: string[] = [];

        // Sub-component A: agricultural resource
        let agriScore = 0;
        if (isFertileGeology(geologyContext)) { agriScore += 18; }
        if (slopePercent < 5)                 { agriScore += 12; }
        if (signals.ridgeAndFurrowPresent)    { agriScore += 42; contributingSignals.push('ridge_and_furrow'); }
        if (isFreeDraining(geologyContext))   { agriScore += 18; }
        if (region === 'fen_peat' && !signals.ridgeAndFurrowPresent) {
            agriScore = Math.min(agriScore, 30);
        }
        agriScore = cap(agriScore);

        // Sub-component B: extractive resource
        let extractScore = 0;
        if (geologyContains(geologyContext, ['clay']))               extractScore += 25;
        if (geologyContains(geologyContext, ['ironstone', 'iron']))  extractScore += 30;
        if (geologyContains(geologyContext, ['peat']))               extractScore += 20;
        if (geologyContains(geologyContext, ['coal']))               extractScore += 25;
        if (geologyContains(geologyContext, ['tin', 'copper', 'lead'])) extractScore += 35;
        if (geologyContains(geologyContext, ['limestone', 'sandstone', 'slate'])) extractScore += 15; // building stone
        if (isExtractiveGeology(geologyContext)) { contributingSignals.push('industrial_resource'); }
        extractScore = cap(extractScore);

        // Combined — agricultural weighted slightly higher as more common
        const rawScore = cap(agriScore * 0.6 + extractScore * 0.4);
        const multiplier = getRegionalMultiplier(processId, region);

        results.push({
            processId,
            rawScore,
            regionalMultiplier: multiplier,
            finalScore: cap(rawScore * multiplier),
            contributingSignals: [...new Set(contributingSignals)],
            subComponents: [
                { id: 'agricultural_resource', score: agriScore },
                { id: 'extractive_resource', score: extractScore },
            ],
        });
    }

    // ── 4. Water Relationships ────────────────────────────────────────────────
    {
        const processId: PrimaryProcessId = 'water_relationships';
        let score = 0;
        const contributingSignals: string[] = [];

        // Use hydro score from potentialBreakdown as the primary water signal —
        // it is derived from real DEM/hydrology analysis. Feature-based signals
        // (NHLE names, AIM types) add on top. hydro is 0–100.
        const hydroScore = potentialBreakdown?.hydro ?? 0;
        if (hydroScore > 0) {
            // Scale: hydro 100 → +50 base contribution; hydro 50 → +25
            score += Math.round(hydroScore * 0.5);
            if (hydroScore > 30) contributingSignals.push('water_proximity');
        }

        // Feature-based additions
        if (signals.waterProximity)   { score += 20; if (!contributingSignals.includes('water_proximity')) contributingSignals.push('water_proximity'); }
        if (signals.confluencePresent){ score += 25; contributingSignals.push('confluence'); }
        if (signals.wetlandPresent)   { score += 15; }
        if (region === 'fen_peat')     { score += 30; contributingSignals.push('water_proximity'); }

        // Fordable crossing: roman road + water proximity = likely crossing
        if (signals.romanRoadPresent && (signals.waterProximity || hydroScore > 30)) {
            score += 15;
            contributingSignals.push('crossing_point');
        }

        // Combined water evidence bonus
        if ((signals.waterProximity || hydroScore > 30) && signals.confluencePresent) {
            score += 5;
        }

        const rawScore = cap(score);
        const multiplier = getRegionalMultiplier(processId, region);

        results.push({
            processId,
            rawScore,
            regionalMultiplier: multiplier,
            finalScore: cap(rawScore * multiplier),
            contributingSignals: [...new Set(contributingSignals)],
        });
    }

    // ── 5. Landscape Prominence ───────────────────────────────────────────────
    {
        const processId: PrimaryProcessId = 'landscape_prominence';
        const contributingSignals: string[] = [];

        // Heuristic: higher elevation + steeper slope = more prominent.
        // When elevationM is 0 (not yet available from scan), fall back to the
        // terrain score from potentialBreakdown — it is computed from real DEM
        // data and reliably reflects terrain relief. Map 0–100 terrain score
        // to a proportional prominence score.
        let score = 0;
        const terrainScore = potentialBreakdown?.terrain ?? 0;

        if (elevationM > 0) {
            // Real elevation data available — use it
            if (elevationM > 100) { score = 85; contributingSignals.push('high_ground_restricted_approach'); }
            else if (elevationM > 50 && slopePercent > 5)  { score = 70; contributingSignals.push('slight_elevation'); }
            else if (elevationM > 30 && slopePercent > 3)  { score = 55; contributingSignals.push('slight_elevation'); }
            else if (elevationM > 15 && slopePercent > 2)  { score = 40; contributingSignals.push('slight_elevation'); }
            else if (elevationM > 5  && slopePercent >= 1) { score = 25; }
            else { score = 10; }
        } else {
            // No elevation — use terrain score as prominence proxy
            // terrain score reflects DEM relief/anomaly: high = varied, interesting terrain
            score = Math.round(terrainScore * 0.85); // scale: terrain 100 → prominence 85
            if (terrainScore > 60) contributingSignals.push('slight_elevation');
            if (terrainScore > 80) contributingSignals.push('high_ground_restricted_approach');
        }

        // Restricted approach bonus: steep slope suggests defended/prominent ground
        if (slopePercent > 15) { score = Math.min(100, score + 15); contributingSignals.push('high_ground_restricted_approach'); }

        const rawScore = cap(score);
        const multiplier = getRegionalMultiplier(processId, region);

        results.push({
            processId,
            rawScore,
            regionalMultiplier: multiplier,
            finalScore: cap(rawScore * multiplier),
            contributingSignals: [...new Set(contributingSignals)],
        });
    }

    // ── 6. Boundary Relationships ─────────────────────────────────────────────
    {
        const processId: PrimaryProcessId = 'boundary_relationships';
        let score = 0;
        const contributingSignals: string[] = [];

        // UNVALIDATED additive weights
        // Geology transition: present when both bedrock and superficial are described
        // (proxy for a transitional geology zone)
        if (geologyContext?.raw.bedrockName && geologyContext?.raw.superficialName) {
            score += 30;
            contributingSignals.push('geology_transition');
        }

        // Terrace break: slope discontinuity proxy (moderate slope suggests terrace edge)
        if (slopePercent > 2 && slopePercent < 8 && elevationM > 5) {
            score += 25;
            contributingSignals.push('terrace_edge');
        }

        if (signals.woodlandEdgePresent) {
            score += 25;
            contributingSignals.push('woodland_edge');
        }

        // Valley head: low elevation + moderate slope suggests valley-head position
        if (elevationM < 30 && slopePercent > 3 && slopePercent < 10) {
            score += 20;
            contributingSignals.push('valley_head');
        }

        // Marginal ground: water + geology transition
        if (signals.waterProximity && geologyContext?.raw.superficialName) {
            score += 10;
            contributingSignals.push('marginal_ground');
        }

        if (region === 'fen_peat') {
            score += 20;
            contributingSignals.push('marginal_ground');
        }

        const rawScore = cap(score);
        const multiplier = getRegionalMultiplier(processId, region);

        results.push({
            processId,
            rawScore,
            regionalMultiplier: multiplier,
            finalScore: cap(rawScore * multiplier),
            contributingSignals: [...new Set(contributingSignals)],
        });
    }

    return results;
}
