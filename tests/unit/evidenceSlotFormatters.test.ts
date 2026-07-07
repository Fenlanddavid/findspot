// ─── Evidence Slot Formatters Tests ──────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import {
    stripLeadCap,
    composeEvidenceClause,
    OBSERVATION_FORMATTERS,
} from '../../src/services/fieldguide/landscapeInterpretation/evidenceSlotFormatters';
import type { EvidenceItem, EvidenceSource } from '../../src/types/landscapeInterpretation';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function item(
    id: string,
    weight: number,
    source: EvidenceSource = 'terrain',
    polarity: 'supporting' | 'contradicting' = 'supporting',
    label = `Label for ${id}`,
): EvidenceItem {
    return { id, label, source, weight, polarity, strength: weight >= 22 ? 'strong' : weight >= 12 ? 'moderate' : 'weak' };
}

// ─── stripLeadCap ────────────────────────────────────────────────────────────

describe('stripLeadCap', () => {
    it('lowercases first character only', () => {
        expect(stripLeadCap('Recorded finds are notably dense')).toBe('recorded finds are notably dense');
    });

    it('preserves already lowercase', () => {
        expect(stripLeadCap('already lower')).toBe('already lower');
    });

    it('handles empty string', () => {
        expect(stripLeadCap('')).toBe('');
    });

    it('handles single character', () => {
        expect(stripLeadCap('A')).toBe('a');
    });
});

// ─── Skeleton grammar ───────────────────────────────────────────────────────

describe('composeEvidenceClause — skeleton grammar', () => {
    it('1 formatted supporting item', () => {
        const result = composeEvidenceClause({
            bullets: [item('terrace_edge', 20)],
            includesContradiction: false,
        });
        expect(result.clause).toBe('Standing out here: a dry terrace or edge position.');
        expect(result.rider).toBeNull();
    });

    it('2 formatted supporting items', () => {
        const result = composeEvidenceClause({
            bullets: [
                item('terrace_edge', 20),
                item('route_convergence', 18, 'historic_routes'),
            ],
            includesContradiction: false,
        });
        expect(result.clause).toBe('Standing out here: a dry terrace or edge position, and movement routes converging here.');
        expect(result.rider).toBeNull();
    });

    it('3 formatted supporting items', () => {
        const result = composeEvidenceClause({
            bullets: [
                item('terrace_edge', 20),
                item('route_convergence', 18, 'historic_routes'),
                item('water_proximity', 14, 'hydrology'),
            ],
            includesContradiction: false,
        });
        expect(result.clause).toBe(
            'Standing out here: a dry terrace or edge position, movement routes converging here, and freshwater or wetland proximity.',
        );
        expect(result.rider).toBeNull();
    });
});

// ─── Unformatted ids silently skipped ────────────────────────────────────────

describe('composeEvidenceClause — unformatted ids', () => {
    it('unformatted supporting id silently skipped; order preserved', () => {
        const result = composeEvidenceClause({
            bullets: [
                item('terrace_edge', 20),
                item('totally_unknown_id', 18),
                item('water_proximity', 14, 'hydrology'),
            ],
            includesContradiction: false,
        });
        expect(result.clause).toBe('Standing out here: a dry terrace or edge position, and freshwater or wetland proximity.');
    });

    it('all supporting ids unformatted -> clause null', () => {
        const result = composeEvidenceClause({
            bullets: [
                item('unknown_a', 20),
                item('unknown_b', 18),
            ],
            includesContradiction: false,
        });
        expect(result.clause).toBeNull();
        expect(result.rider).toBeNull();
    });
});

// ─── Contradiction / rider ───────────────────────────────────────────────────

describe('composeEvidenceClause — contradiction rider', () => {
    it('includesContradiction + formatted contradiction -> rider', () => {
        const result = composeEvidenceClause({
            bullets: [
                item('terrace_edge', 20),
                item('route_convergence', 18, 'historic_routes'),
                item('wet_ground_or_floodplain', 26, 'hydrology', 'contradicting'),
            ],
            includesContradiction: true,
        });
        expect(result.clause).toBe('Standing out here: a dry terrace or edge position, and movement routes converging here.');
        expect(result.rider).toBe('Weighing against it: wet ground or floodplain influence.');
    });

    it('includesContradiction but contradicting id unformatted -> rider null', () => {
        const result = composeEvidenceClause({
            bullets: [
                item('terrace_edge', 20),
                item('unknown_contradiction', 22, 'terrain', 'contradicting'),
            ],
            includesContradiction: true,
        });
        expect(result.clause).toBe('Standing out here: a dry terrace or edge position.');
        expect(result.rider).toBeNull();
    });

    it('clause null + rider present (lone-contradiction path)', () => {
        const result = composeEvidenceClause({
            bullets: [
                item('steep_slope_constraint', 22, 'terrain', 'contradicting'),
            ],
            includesContradiction: true,
        });
        expect(result.clause).toBeNull();
        expect(result.rider).toBe('Weighing against it: steep slopes constraining the area.');
    });

    it('all four contradicting ids have formatters', () => {
        for (const id of ['wet_ground_or_floodplain', 'steep_slope_constraint', 'heavy_clay_drainage', 'not_south_facing']) {
            const result = composeEvidenceClause({
                bullets: [item(id, 20, 'terrain', 'contradicting')],
                includesContradiction: true,
            });
            expect(result.rider).not.toBeNull();
        }
    });
});

// ─── Dynamic formatters ─────────────────────────────────────────────────────

describe('composeEvidenceClause — dynamic formatters', () => {
    it('pas_regional_density passes through stripLeadCap; counts survive', () => {
        const pasItem = item('pas_regional_density', 10, 'historic_records');
        pasItem.label = 'Recorded finds are notably dense in the wider landscape (247 PAS records within the surrounding area)';

        const result = composeEvidenceClause({
            bullets: [pasItem],
            includesContradiction: false,
        });
        expect(result.clause).toBe(
            'Standing out here: recorded finds are notably dense in the wider landscape (247 PAS records within the surrounding area).',
        );
    });

    it('personal_period_dominant passes through stripLeadCap', () => {
        const personalItem = item('personal_period_dominant', 14, 'historic_records');
        personalItem.label = 'Your own finds here are predominantly Romano-British (8 of 12 recorded nearby)';

        const result = composeEvidenceClause({
            bullets: [personalItem],
            includesContradiction: false,
        });
        expect(result.clause).toBe(
            'Standing out here: your own finds here are predominantly Romano-British (8 of 12 recorded nearby).',
        );
    });
});

// ─── Determinism ─────────────────────────────────────────────────────────────

describe('composeEvidenceClause — determinism', () => {
    it('same input -> identical output', () => {
        const bullets = [
            item('terrace_edge', 20),
            item('route_convergence', 18, 'historic_routes'),
            item('wet_ground_or_floodplain', 26, 'hydrology', 'contradicting'),
        ];
        const input = { bullets, includesContradiction: true };

        const a = composeEvidenceClause(input);
        const b = composeEvidenceClause(input);
        expect(a).toEqual(b);
    });
});

// ─── Coverage assertion ─────────────────────────────────────────────────────
// Every contradicting id that can appear in salient bullets must have a
// formatter — the rider must never go silent because someone added a
// contradicting id without a fragment.

describe('OBSERVATION_FORMATTERS — coverage', () => {
    it('every contradicting id from evidenceModel has a formatter', () => {
        // These are all the contradicting-polarity ids emitted by
        // buildContradictingEvidence in evidenceModel.ts.
        // (sparse_records and limited_terrain_expression are 'missing' polarity,
        //  filtered out by selectSalientEvidence, so excluded here.)
        const contradictingIds = [
            'wet_ground_or_floodplain',
            'steep_slope_constraint',
            'heavy_clay_drainage',
            'not_south_facing',
        ];

        for (const id of contradictingIds) {
            expect(
                OBSERVATION_FORMATTERS[id],
                `Missing formatter for contradicting id "${id}"`,
            ).toBeDefined();
        }
    });
});
