// ─── Evidence Salience Tests ─────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import {
    selectSalientEvidence,
    SALIENCE_MAX_BULLETS,
    CONTRADICTION_PERCENT_OVERRIDE,
    CONTRADICTION_WEIGHT_OVERRIDE,
    SALIENCE_BOOST,
} from '../../src/services/fieldguide/landscapeInterpretation/evidenceSalience';
import type { EvidenceItem, EvidenceSource } from '../../src/types/landscapeInterpretation';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function item(
    id: string,
    weight: number,
    source: EvidenceSource = 'terrain',
    polarity: 'supporting' | 'contradicting' | 'missing' = 'supporting',
): EvidenceItem {
    return {
        id,
        label: `Label for ${id}`,
        source,
        strength: weight >= 22 ? 'strong' : weight >= 12 ? 'moderate' : 'weak',
        polarity,
        weight,
    };
}

// ─── Ranking ─────────────────────────────────────────────────────────────────

describe('ranking', () => {
    it('ranks by weight desc', () => {
        const result = selectSalientEvidence({
            supportingEvidence: [item('a', 10), item('b', 20), item('c', 15)],
            contradictingEvidence: [],
            supportingPercent: 80,
            contradictingPercent: 20,
        });
        expect(result.bullets.map(b => b.id)).toEqual(['b', 'c', 'a']);
    });

    it('applies SALIENCE_BOOST', () => {
        // Temporarily set a boost
        (SALIENCE_BOOST as Record<string, number>)['a'] = 50;
        try {
            const result = selectSalientEvidence({
                supportingEvidence: [item('a', 5), item('b', 20)],
                contradictingEvidence: [],
                supportingPercent: 80,
                contradictingPercent: 20,
            });
            // a (5 + 50 = 55) should rank above b (20)
            expect(result.bullets[0].id).toBe('a');
        } finally {
            delete (SALIENCE_BOOST as Record<string, number>)['a'];
        }
    });

    it('tie-breaks by id asc (stable)', () => {
        const result = selectSalientEvidence({
            supportingEvidence: [item('z_item', 15), item('a_item', 15), item('m_item', 15)],
            contradictingEvidence: [],
            supportingPercent: 80,
            contradictingPercent: 20,
        });
        expect(result.bullets.map(b => b.id)).toEqual(['a_item', 'm_item', 'z_item']);
    });
});

// ─── Source diversity ────────────────────────────────────────────────────────

describe('source diversity', () => {
    it('4 same-source items → max 2 in bullets when alternatives exist', () => {
        const result = selectSalientEvidence({
            supportingEvidence: [
                item('t1', 30, 'terrain'),
                item('t2', 25, 'terrain'),
                item('t3', 20, 'terrain'),
                item('t4', 15, 'terrain'),
                item('h1', 10, 'hydrology'),
            ],
            contradictingEvidence: [],
            supportingPercent: 80,
            contradictingPercent: 20,
        });
        const terrainCount = result.bullets.filter(b => b.source === 'terrain').length;
        expect(terrainCount).toBe(2);
        expect(result.bullets.some(b => b.source === 'hydrology')).toBe(true);
        expect(result.bullets).toHaveLength(3);
    });

    it('relaxes diversity when no alternatives exist', () => {
        const result = selectSalientEvidence({
            supportingEvidence: [
                item('t1', 30, 'terrain'),
                item('t2', 25, 'terrain'),
                item('t3', 20, 'terrain'),
            ],
            contradictingEvidence: [],
            supportingPercent: 80,
            contradictingPercent: 20,
        });
        const terrainCount = result.bullets.filter(b => b.source === 'terrain').length;
        expect(terrainCount).toBe(3);
    });
});

// ─── Override: slotsForSupport = 2 with diversity ────────────────────────────

describe('override with diversity', () => {
    it('override fires → slotsForSupport = 2; diversity runs on 2 slots', () => {
        // With 3 slots: diversity picks t1(30), h1(22), t2(20) — 2 terrain, 1 hydro
        // With 2 slots: diversity picks t1(30), h1(22) — 1 terrain, 1 hydro
        // Then contradiction appended. So the difference is visible:
        // 2-slot picks t1 + h1 (not t2)
        const result = selectSalientEvidence({
            supportingEvidence: [
                item('t1', 30, 'terrain'),
                item('h1', 22, 'hydrology'),
                item('t2', 20, 'terrain'),
            ],
            contradictingEvidence: [item('c1', 26, 'hydrology', 'contradicting')],
            supportingPercent: 60,
            contradictingPercent: 40,
        });
        // Override fires (contradictingPercent 40 >= 35)
        expect(result.includesContradiction).toBe(true);
        expect(result.bullets).toHaveLength(3);
        // First two are supports, third is contradiction
        expect(result.bullets[0].id).toBe('t1');
        expect(result.bullets[1].id).toBe('h1');
        expect(result.bullets[2].id).toBe('c1');
    });
});

// ─── Weight override ────────────────────────────────────────────────────────

describe('weight override', () => {
    it('single contradicting item weight 20 fires even at contradictingPercent 10', () => {
        const result = selectSalientEvidence({
            supportingEvidence: [item('s1', 15), item('s2', 12)],
            contradictingEvidence: [item('c1', 20, 'terrain', 'contradicting')],
            supportingPercent: 90,
            contradictingPercent: 10,
        });
        expect(result.includesContradiction).toBe(true);
        expect(result.bullets[result.bullets.length - 1].polarity).toBe('contradicting');
    });
});

// ─── No override: just below thresholds ──────────────────────────────────────

describe('no override', () => {
    it('contradictingPercent 34, max weight 19 → 3 supports', () => {
        const result = selectSalientEvidence({
            supportingEvidence: [item('s1', 20), item('s2', 15), item('s3', 10)],
            contradictingEvidence: [item('c1', 19, 'terrain', 'contradicting')],
            supportingPercent: 66,
            contradictingPercent: 34,
        });
        expect(result.includesContradiction).toBe(false);
        expect(result.bullets).toHaveLength(3);
        expect(result.bullets.every(b => b.polarity === 'supporting')).toBe(true);
    });

    it('wet_ground_or_floodplain at weight 18, contradictingPercent below 35 → no override', () => {
        const result = selectSalientEvidence({
            supportingEvidence: [item('s1', 20), item('s2', 15), item('s3', 10)],
            contradictingEvidence: [item('wet_ground_or_floodplain', 18, 'hydrology', 'contradicting')],
            supportingPercent: 70,
            contradictingPercent: 30,
        });
        expect(result.includesContradiction).toBe(false);
        expect(result.bullets).toHaveLength(3);
    });
});

// ─── 0 supports + override ──────────────────────────────────────────────────

describe('0 supports + override', () => {
    it('exactly one amber bullet via append path', () => {
        const result = selectSalientEvidence({
            supportingEvidence: [],
            contradictingEvidence: [item('c1', 26, 'hydrology', 'contradicting')],
            supportingPercent: 40,
            contradictingPercent: 60,
        });
        expect(result.bullets).toHaveLength(1);
        expect(result.bullets[0].polarity).toBe('contradicting');
        expect(result.includesContradiction).toBe(true);
    });
});

// ─── Missing polarity ───────────────────────────────────────────────────────

describe('missing polarity', () => {
    it('never appears in bullets', () => {
        // Force a missing item into supporting (shouldn't happen, but guard)
        const missingItem: EvidenceItem = {
            id: 'missing_thing',
            label: 'Missing thing',
            source: 'terrain',
            strength: 'weak',
            polarity: 'missing',
            weight: 50,
        };
        const result = selectSalientEvidence({
            supportingEvidence: [missingItem],
            contradictingEvidence: [],
            supportingPercent: 80,
            contradictingPercent: 20,
        });
        expect(result.bullets).toHaveLength(0);
    });
});

// ─── Showcase: personal_period_dominant earns a bullet ───────────────────────
// The month's payoff sentence depends on a specific arithmetic relationship:
// dominant (14) beats every other historic_records item except the rare
// recorded_ceremonial_monument (16), diversity cap 2 keeps historic_records
// from filling all 3 slots, and the third bullet is cross-source landscape
// evidence. Pin it so constants-only follow-ups can't silently break it.

describe('showcase: finds-rich scan', () => {
    it('personal_period_dominant appears in bullets; at most 2 historic_records items', () => {
        const result = selectSalientEvidence({
            supportingEvidence: [
                item('personal_period_dominant', 14, 'historic_records'),
                item('pas_regional_density', 10, 'historic_records'),
                item('pas_period_alignment', 8, 'historic_records'),
                item('personal_base_rate_anomaly', 8, 'historic_records'),
                item('terrace_edge', 18, 'terrain'),
                item('roman_road_proximity', 16, 'historic_routes'),
            ],
            contradictingEvidence: [],
            supportingPercent: 82,
            contradictingPercent: 18,
        });
        const ids = result.bullets.map(b => b.id);
        expect(ids).toContain('personal_period_dominant');
        const hrCount = result.bullets.filter(b => b.source === 'historic_records').length;
        expect(hrCount).toBeLessThanOrEqual(2);
        // Third bullet must be cross-source (terrain or historic_routes)
        expect(result.bullets.some(b => b.source !== 'historic_records')).toBe(true);
        expect(result.bullets).toHaveLength(3);
    });

    it('ceremonial coexistence: both monument + dominant appear, third is cross-source', () => {
        const result = selectSalientEvidence({
            supportingEvidence: [
                item('recorded_ceremonial_monument', 16, 'historic_records'),
                item('personal_period_dominant', 14, 'historic_records'),
                item('pas_regional_density', 10, 'historic_records'),
                item('terrace_edge', 12, 'terrain'),
                item('water_proximity', 10, 'hydrology'),
            ],
            contradictingEvidence: [],
            supportingPercent: 85,
            contradictingPercent: 15,
        });
        const ids = result.bullets.map(b => b.id);
        // Both high-value historic_records items present
        expect(ids).toContain('recorded_ceremonial_monument');
        expect(ids).toContain('personal_period_dominant');
        // Diversity cap: only 2 historic_records, third is cross-source
        const hrCount = result.bullets.filter(b => b.source === 'historic_records').length;
        expect(hrCount).toBe(2);
        expect(result.bullets).toHaveLength(3);
        // Third bullet is the best non-historic_records item
        const crossSource = result.bullets.find(b => b.source !== 'historic_records');
        expect(crossSource).toBeDefined();
        expect(crossSource!.id).toBe('terrace_edge');
    });
});

// ─── Empty everything ───────────────────────────────────────────────────────

describe('empty input', () => {
    it('no supports, no contradictions → bullets []', () => {
        const result = selectSalientEvidence({
            supportingEvidence: [],
            contradictingEvidence: [],
            supportingPercent: 0,
            contradictingPercent: 0,
        });
        expect(result.bullets).toHaveLength(0);
        expect(result.includesContradiction).toBe(false);
    });
});
