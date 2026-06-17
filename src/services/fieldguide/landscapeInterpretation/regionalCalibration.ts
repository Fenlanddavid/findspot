// ─── Regional Calibration ─────────────────────────────────────────────────────
// Derives a coarse terrain-type multiplier from BGS geology description.
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

const LOWLAND_RIVER_PATTERNS  = ['alluvium', 'river terrace', 'glacial outwash', 'sand and gravel', 'gravel terrace', 'fluvial', 'outwash'];
const CHALK_LIMESTONE_PATTERNS = ['chalk', 'limestone', 'oolite', 'jurassic', 'cretaceous'];
const FEN_PEAT_PATTERNS        = [
    'peat',
    'fenland',
    'fen',
    'marsh',
    'estuarine',
    'tidal flat',
    'tidal-flat',
    'marine',
    'lacustrine',
    'saltmarsh',
    'salt marsh',
    'warp',
];
const UPLAND_MOORLAND_PATTERNS = ['millstone grit', 'carboniferous', 'moorland', 'gritstone', 'granite', 'basalt', 'gabbro', 'schist'];

function matchesAny(text: string, patterns: string[]): boolean {
    const lower = text.toLowerCase();
    return patterns.some(p => lower.includes(p));
}

export function deriveTerrainRegion(geologyContext: GeologyContext | null): TerrainRegionType {
    if (!geologyContext) return 'unknown';

    const { raw } = geologyContext;
    const descriptions = [
        raw.superficialName       ?? '',
        raw.superficialLithology  ?? '',
        raw.bedrockName           ?? '',
        raw.bedrockLithology      ?? '',
    ].join(' ');

    if (matchesAny(descriptions, FEN_PEAT_PATTERNS))        return 'fen_peat';
    if (matchesAny(descriptions, LOWLAND_RIVER_PATTERNS))   return 'lowland_river_valley';
    if (matchesAny(descriptions, CHALK_LIMESTONE_PATTERNS)) return 'chalk_limestone_upland';
    if (matchesAny(descriptions, UPLAND_MOORLAND_PATTERNS)) return 'upland_moorland';
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
