// ─── Evidence Slot Formatters ────────────────────────────────────────────────
// Authored observation phrases for the GlanceCard evidence clause.
// Same discipline as narrative templates: every rendered string is
// deliberately written; slots carry facts, never interpretive claims.
//
// S1: Observation-only — describe what datasets show, not what they mean.
// S2: Same evidence, told twice — consumes selectSalientEvidence output.
// S3: Absence = silence — unformatted ids are silently skipped.
// S4: Authored skeletons, authored fragments.

import type { EvidenceItem } from '../../../types/landscapeInterpretation';
import type { SalientEvidence } from './evidenceSalience';

// ── Strip leading capital for mid-sentence insertion ─────────────────────────
export function stripLeadCap(s: string): string {
    if (s.length === 0) return s;
    return s[0].toLowerCase() + s.slice(1);
}

// ── Observation phrase per evidence id ───────────────────────────────────────
// Lowercase fragments that read naturally after "Standing out here:".
// AUTHORED — additions are reviewed strings, same discipline as templates.
export const OBSERVATION_FORMATTERS: Record<string, string | ((item: EvidenceItem) => string)> = {
    // -- contradicting (all four true contradictions) --
    wet_ground_or_floodplain: 'wet ground or floodplain influence',
    steep_slope_constraint:   'steep slopes constraining the area',
    heavy_clay_drainage:      'heavy clay with poor drainage',
    not_south_facing:         'a mainly north-facing aspect',

    // -- signal evidence (terrain) --
    terrace_edge:                    'a dry terrace or edge position',
    dry_ground_water_proximity:      'dry ground close to water',
    slight_elevation:                'slightly elevated or overlooking ground',
    valley_head:                     'a valley-head or dry-valley position',
    high_ground_restricted_approach: 'prominent ground with restricted approach',
    raised_relief_measured:          'a measured local rise above surrounding ground',
    low_gradient_measured:           'measured low-gradient accessible ground',

    // -- signal evidence (hydrology) --
    crossing_point:   'a potential natural crossing point',
    water_proximity:  'freshwater or wetland proximity',
    confluence:       'a river confluence or water meeting point',

    // -- signal evidence (historic routes) --
    roman_road_proximity: 'a Roman road alignment nearby',
    route_convergence:    'movement routes converging here',
    route_adjacent:       'a historic route or trackway nearby',

    // -- signal evidence (geology) --
    geology_transition:  'a geology transition',
    industrial_resource: 'resource geology suitable for extraction',

    // -- signal evidence (historic records) --
    ridge_and_furrow:             'ridge-and-furrow or field-system evidence',
    woodland_edge:                'a woodland or historic edge position',
    recorded_ceremonial_monument: 'a recorded ceremonial or ritual monument nearby',

    // -- signal evidence (derived model) --
    marginal_ground: 'marginal ground between landscape types',

    // -- PAS / personal finds (dynamic — labels carry counts) --
    pas_regional_density:      i => stripLeadCap(i.label),
    personal_period_dominant:  i => stripLeadCap(i.label),
    personal_period_presence:  i => stripLeadCap(i.label),
    personal_base_rate_anomaly: i => stripLeadCap(i.label),
};

// ── Compose the evidence clause ─────────────────────────────────────────────

export interface EvidenceClause {
    clause: string | null;   // supporting sentence, or null
    rider:  string | null;   // contradiction sentence, or null
}

export function composeEvidenceClause(s: SalientEvidence): EvidenceClause {
    // Partition bullets by polarity
    const supporting: string[] = [];
    let contradictionFragment: string | null = null;

    for (const item of s.bullets) {
        const formatter = OBSERVATION_FORMATTERS[item.id];
        if (!formatter) continue;

        const fragment = typeof formatter === 'function' ? formatter(item) : formatter;

        if (item.polarity === 'contradicting') {
            // Take the first contradicting (there's at most one in salient bullets)
            if (contradictionFragment === null) {
                contradictionFragment = fragment;
            }
        } else {
            supporting.push(fragment);
        }
    }

    // Build supporting clause using authored skeletons
    let clause: string | null = null;
    if (supporting.length === 1) {
        clause = `Standing out here: ${supporting[0]}.`;
    } else if (supporting.length === 2) {
        clause = `Standing out here: ${supporting[0]}, and ${supporting[1]}.`;
    } else if (supporting.length >= 3) {
        const allButLast = supporting.slice(0, -1).join(', ');
        clause = `Standing out here: ${allButLast}, and ${supporting[supporting.length - 1]}.`;
    }

    // Build rider — renders even when clause is null (lone-contradiction path)
    let rider: string | null = null;
    if (s.includesContradiction && contradictionFragment !== null) {
        rider = `Weighing against it: ${contradictionFragment}.`;
    }

    return { clause, rider };
}
