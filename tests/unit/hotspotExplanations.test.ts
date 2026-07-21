import { describe, expect, it } from 'vitest';
import {
    HOTSPOT_EXPLANATION_WEIGHTS,
    hotspotExplanation,
    prioritiseHotspotExplanations,
} from '../../src/engines/hotspot/hotspotExplanations';

describe('structured hotspot explanations', () => {
    it('has one central weight for every stable tag', () => {
        expect(HOTSPOT_EXPLANATION_WEIGHTS.roman_proximity).toBeGreaterThan(
            HOTSPOT_EXPLANATION_WEIGHTS.historic_movement,
        );
    });

    it('deduplicates by tag and qualifier rather than display text', () => {
        const result = prioritiseHotspotExplanations([
            hotspotExplanation('historic_overlap', 'Old display copy', 'roman'),
            hotspotExplanation('historic_overlap', 'New display copy', 'roman'),
            hotspotExplanation('historic_overlap', 'Different evidence', 'medieval'),
        ], 5);
        expect(result).toHaveLength(2);
        expect(result[0].text).toBe('Old display copy');
    });

    it('preserves a positive reason when IGNORE explanations fill the limit', () => {
        const result = prioritiseHotspotExplanations([
            hotspotExplanation('ignore_modern_disturbance', 'IGNORE modern'),
            hotspotExplanation('ignore_featureless', 'IGNORE featureless'),
            hotspotExplanation('raised_footing', 'Raised footing'),
        ], 2);
        expect(result.some(item => !item.tag.startsWith('ignore_'))).toBe(true);
    });
});
