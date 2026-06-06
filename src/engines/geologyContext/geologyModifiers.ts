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

import type { GeologyLandscapeClass, GeologyContext, RawGeologyData } from './geologyContextTypes';

export type GeologyModifiers = GeologyContext['modifiers'];

/**
 * Compute geology-derived score modifiers.
 *
 * Phase 1: Returns zero modifiers — geology context is display-only.
 * Phase 2 will introduce bounded adjustments:
 *   - Max geology boost:   +12
 *   - Max geology penalty: -15
 *   - Geology alone must never push a hotspot above threshold.
 *   - At least one primary non-geology signal must exist before any modifier applies.
 */
export function computeGeologyModifiers(
    _landscapeClass: GeologyLandscapeClass,
    _raw: RawGeologyData,
): GeologyModifiers {
    // Phase 1: No scoring modifications. All modifiers are zero.
    // Phase 2 audit entry will be: "Geology modifier not applied: Phase 1 — display only."
    return {
        hydrology:     0,
        terrain:       0,
        spectral:      0,
        route:         0,
        soilMechanics: 0,
        preservation:  0,
        movementRisk:  0,
    };
}
