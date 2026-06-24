// ─── Shared landscape label maps ──────────────────────────────────────────────
// Single source of truth for display labels used across LandscapeInterpretationBlock,
// LandscapeBehaviourBars, and GlanceCard.

import type {
    SecondaryInterpretationId,
    ConfidenceTier,
    PrimaryProcessId,
} from '../types/landscapeInterpretation';

export const INTERPRETATION_LABELS: Record<SecondaryInterpretationId, string> = {
    settlement_activity_area:   'Settlement Activity Area',
    agricultural_landscape:     'Agricultural Landscape',
    movement_corridor:          'Movement Corridor',
    riverine_activity:          'Riverine Activity Area',
    industrial_landscape:       'Industrial Landscape',
    transition_zone:            'Transition Zone',
    burial_landscape:           'Burial Landscape',
    defensive_landscape:        'Defensive Landscape',
    ceremonial_ritual:          'Ceremonial / Ritual Landscape',
};

export const CONFIDENCE_LABELS: Record<ConfidenceTier, string> = {
    very_high: 'Strong signal',
    high:      'Good signal',
    moderate:  'Moderate signal',
    lower:     'Weak signal',
};

export const PROCESS_LABELS: Record<PrimaryProcessId, string> = {
    occupation_potential:   'Occupation',
    movement:               'Movement',
    resource_exploitation:  'Resources',
    water_relationships:    'Water',
    landscape_prominence:   'Prominence',
    boundary_relationships: 'Boundaries',
};

export const PROCESS_ORDER: PrimaryProcessId[] = [
    'occupation_potential',
    'movement',
    'resource_exploitation',
    'water_relationships',
    'landscape_prominence',
    'boundary_relationships',
];
