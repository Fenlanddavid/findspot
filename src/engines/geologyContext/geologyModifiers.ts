// GEOLOGY_RULE:
// Geology is modifier-only.
// It must never create hotspots or targets.
// It must never elevate a location above threshold without support from existing primary signals.

// Ownership boundary — what this module owns vs Soil Mechanics:
//
//   Geology Context Engine owns:
//     - Bedrock lithology
//     - Superficial deposits
//     - Artificial Ground
//     - Mass Movement
//     - Broad landscape classification
//
//   Soil Mechanics Engine owns:
//     - Slope
//     - Relative elevation
//     - Downslope movement
//     - Accumulation interpretation
//     - Erosion interpretation
//
// Do NOT allow both systems to independently boost the same physical behaviour.

// Combined cap (enforced in applyGeologyModifiers):
//   Max geology boost:   +12 across all modifier slots combined
//   Max geology penalty: -15 across all modifier slots combined

import type { GeologyLandscapeClass, GeologyContext, RawGeologyData } from './geologyContextTypes';

export type GeologyModifiers = GeologyContext['modifiers'];

const MODIFIER_TABLE: Record<GeologyLandscapeClass, GeologyModifiers> = {
    chalk_downland: {
        hydrology:     3,   // spring line / dry valley signal amplified
        terrain:       2,   // ridge end emphasis
        route:         2,   // ridge trackway context
        preservation:  0,
        soilMechanics: 0,
        spectral:      0,
        movementRisk:  0,
    },
    river_gravel_terrace: {
        hydrology:     4,   // crossing/ford potential amplified
        route:         3,   // terrace favoured for settlement and routes
        preservation:  2,   // well-drained, good metal preservation
        soilMechanics: 0,
        terrain:       0,
        spectral:      0,
        movementRisk:  0,
    },
    alluvial_floodplain: {
        hydrology:     3,   // wet margin settlement signal amplified
        route:         2,   // river crossing context
        movementRisk: -4,   // artefacts may have moved laterally
        soilMechanics:-2,   // signal reliability reduced in wet clay
        preservation:  0,
        terrain:       0,
        spectral:      0,
    },
    peat_fen: {
        preservation:  4,   // high organic preservation — bone, leather
        hydrology:     2,   // fen edge settlement potential
        soilMechanics:-3,   // variable signal depth and reliability
        movementRisk: -2,   // waterlogged movement risk
        terrain:       0,
        route:         0,
        spectral:      0,
    },
    heavy_clay: {
        soilMechanics:-4,   // surface signal less reliable
        spectral:     -2,   // clay mineralogy affects spectral reads
        route:         3,   // route corridors carry more weight on clay
        movementRisk: -2,   // compaction can shift artefact depth
        hydrology:     0,
        terrain:       0,
        preservation:  0,
    },
    sand_gravel: {
        movementRisk: -5,   // artefact scatter and migration risk
        soilMechanics:-2,   // loose matrix, inconsistent depth
        preservation: -2,   // acidic sandy soils, poorer metal survival
        hydrology:     0,
        terrain:       0,
        route:         0,
        spectral:      0,
    },
    foreshore: {
        // Phase 2 provisional values — calibrate against real foreshore session data.
        movementRisk: -3,   // tidal dispersal risk
        soilMechanics:-2,   // variable intertidal matrix
        preservation:  0,   // exposure can expose OR scatter finds, net unclear
        hydrology:     0,
        terrain:       0,
        route:         0,
        spectral:      0,
    },
    mixed_uncertain: {
        hydrology:     0,
        terrain:       0,
        spectral:      0,
        route:         0,
        soilMechanics: 0,
        preservation:  0,
        movementRisk:  0,
    },
    unknown: {
        hydrology:     0,
        terrain:       0,
        spectral:      0,
        route:         0,
        soilMechanics: 0,
        preservation:  0,
        movementRisk:  0,
    },
};

/**
 * Compute geology-derived score modifiers for a landscape class.
 * Combined cap: +12 max boost / -15 max penalty (enforced in applyGeologyModifiers).
 * At least one primary non-geology signal must exist before modifiers apply —
 * that gate is enforced in applyGeologyModifiers, not here.
 */
export function computeGeologyModifiers(
    landscapeClass: GeologyLandscapeClass,
    _raw: RawGeologyData,
): GeologyModifiers {
    return { ...MODIFIER_TABLE[landscapeClass] };
}

/** Sum of all modifier slots — used for audit logging and cap enforcement. */
export function netGeologyScore(modifiers: GeologyModifiers): number {
    return (
        modifiers.hydrology +
        modifiers.terrain +
        modifiers.spectral +
        modifiers.route +
        modifiers.soilMechanics +
        modifiers.preservation +
        modifiers.movementRisk
    );
}
