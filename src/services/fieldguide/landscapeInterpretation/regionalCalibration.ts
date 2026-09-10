// ─── Regional Calibration ─────────────────────────────────────────────────────
// Derives a coarse deposit context from explicit superficial deposits.
// Bedrock age, lithology and ancient depositional environments do not establish
// present-day relief, moorland cover or wetness. Measured terrain is scored by
// primaryProcessEngine independently; unsupported regional context is neutral.
//
// IMPORTANT: All multipliers here are UNVALIDATED provisional weights.
// They represent a first-pass regional adjustment and must be tuned against
// real-data validation before being used in any consequential interpretation.

import type { PrimaryProcessId } from '../../../types/landscapeInterpretation';
import type { GeologyContext } from '../../../engines/geologyContext';

export type TerrainRegionType =
    | 'lowland_river_valley'
    | 'chalk_limestone_upland'
    | 'fen_peat'
    | 'upland_moorland'
    | 'unknown';

// ─── Geology description → region ─────────────────────────────────────────────

export function deriveTerrainRegion(geologyContext: GeologyContext | null): TerrainRegionType {
    if (!geologyContext) return 'unknown';

    const { raw } = geologyContext;
    const descriptions = [
        raw.superficialName       ?? '',
        raw.superficialLithology  ?? '',
    ].join(' ');

    const peat = /\bpeat\b/i.test(descriptions);
    const river = /\balluvium\b|\briver terrace\b/i.test(descriptions);
    // Mixed deposits do not justify choosing one region by keyword order.
    if (peat && river) return 'unknown';
    if (peat) return 'fen_peat';
    if (river) return 'lowland_river_valley';
    // Chalk is not proof of upland; granite is not proof of moorland.
    return 'unknown';
}

// ─── Regional multipliers ─────────────────────────────────────────────────────
// Modest ±20% maximum. All values UNVALIDATED — provisional first-pass weights.
// Apply symmetrically so no region is unfairly penalised without evidence.

const MULTIPLIERS: Record<TerrainRegionType, Partial<Record<PrimaryProcessId, number>>> = {
    lowland_river_valley: {
        water_relationships:    1.2,  // Water proximity is a strong signal in river valleys
        occupation_potential:   1.1,  // Terrace edges were preferred settlement ground
        resource_exploitation:  1.1,  // Alluvial soils are productive
        movement:               1.0,
        landscape_prominence:   0.85, // Lower ground reduces topographic prominence
        boundary_relationships: 1.1,
    },
    chalk_limestone_upland: {
        landscape_prominence:   1.2,  // Upland geology often produces prominent terrain
        movement:               1.1,  // Ridgeways and drove roads follow chalk ridges
        occupation_potential:   1.0,
        resource_exploitation:  0.9,  // Thinner soils, less productive
        water_relationships:    0.85, // Fewer surface water features
        boundary_relationships: 1.1,  // Chalk dry valleys create natural boundaries
    },
    fen_peat: {
        water_relationships:    1.2,  // Water dominates fen landscapes
        boundary_relationships: 1.15, // Fen islands and edges are boundary-defining
        occupation_potential:   0.8,  // Wet ground restricts occupation
        movement:               0.9,  // Movement restricted to routes and causeways
        landscape_prominence:   0.8,  // Flat terrain reduces prominence
        resource_exploitation:  1.05, // Peat cutting, wildfowl, fish
    },
    upland_moorland: {
        landscape_prominence:   1.2,  // Upland positions are inherently prominent
        occupation_potential:   0.85, // Harsh conditions restrict settlement
        resource_exploitation:  0.9,
        water_relationships:    1.0,
        movement:               0.9,  // Limited route options
        boundary_relationships: 1.1,  // Upland ridges are natural boundaries
    },
    unknown: {
        // No adjustment — neutral across all processes
    },
};

export function getRegionalMultiplier(processId: PrimaryProcessId, region: TerrainRegionType): number {
    return MULTIPLIERS[region]?.[processId] ?? 1.0;
}
