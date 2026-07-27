// GEOLOGY_RULE:
// Geology is modifier-only.
// It must never create hotspots or targets.
// It must never elevate a location above threshold without support from
// existing primary signals.

import type {
    GeologyLandscapeClass,
    RawGeologyData,
} from './geologyContextTypes';

// These scalars preserve the exact net effect of the former slot table. The
// engine intentionally makes no unsupported claim that it routes separate
// geological effects to individual hotspot signal types.
const MODIFIER_BY_CLASS: Record<GeologyLandscapeClass, number> = {
    chalk_downland:       7,
    river_gravel_terrace: 9,
    alluvial_floodplain: -1,
    peat_fen:             1,
    heavy_clay:          -5,
    sand_gravel:         -9,
    foreshore:           -5,
    mixed_uncertain:      0,
    unknown:              0,
};

/**
 * Computes one bounded geology score adjustment for the classified landscape.
 * Raw data remains in the signature because future class-level calibration may
 * refine a scalar without reintroducing decorative per-signal precision.
 */
export function computeGeologyModifier(
    landscapeClass: GeologyLandscapeClass,
    _raw: RawGeologyData,
): number {
    return MODIFIER_BY_CLASS[landscapeClass];
}
