import { describe, it, expect } from 'vitest';
import { glanceReasons, glanceHeadline } from '../../src/services/fieldguide/glanceReading';
import type {
    ArchaeologicalEvidenceAssessment,
    LandscapeInterpretation,
    EvidenceItem,
} from '../../src/types/landscapeInterpretation';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const evidenceItem = (source: EvidenceItem['source'], weight = 1): EvidenceItem => ({
    id: `${source}-test`,
    label: `${source} label`,
    source,
    strength: 'strong',
    polarity: 'supporting',
    weight,
});

const minAssessment = (items: EvidenceItem[] = []): ArchaeologicalEvidenceAssessment => ({
    supportingEvidence: items,
    contradictingEvidence: [],
    missingEvidence: [],
    supportingPercent: 0,
    contradictingPercent: 0,
    confidenceSummary: '',
    primaryInfluencingFactors: [],
    suggestedInterpretation: '',
    archaeologicalReasoning: '',
    landscapeSummary: '',
    landscapeEngines: [],
    periodLikelihood: [],
    behaviourInteractions: [],
});

const minInterp = (overrides: Partial<LandscapeInterpretation> = {}): LandscapeInterpretation => ({
    geohash6: 'gcpvhm',
    processScores: [],
    interpretationScores: [],
    evidenceAssessment: minAssessment(),
    primaryInterpretationId: null,
    secondaryInterpretationId: null,
    depositionAffinity: { convergenceMet: false, noteTemplateId: null },
    temporalPersistence: 'transient',
    recordSparsity: false,
    uncertainty: 'low',
    scheduledMonumentOverlap: false,
    narrative: { templateId: 'mixed_indeterminate', periodSubstitution: null, signalSubstitutions: [] },
    engineVersion: 'test',
    generatedAt: 0,
    ...overrides,
});

// ─── glanceReasons ────────────────────────────────────────────────────────────

describe('glanceReasons', () => {
    it('returns empty array for zero supporting evidence', () => {
        expect(glanceReasons(minAssessment())).toEqual([]);
    });

    it('returns up to 3 source-distinct reasons', () => {
        const items = [
            evidenceItem('terrain', 10),
            evidenceItem('hydrology', 9),
            evidenceItem('geology', 8),
            evidenceItem('historic_routes', 7), // 4th — should be excluded
        ];
        const result = glanceReasons(minAssessment(items));
        expect(result).toHaveLength(3);
        expect(new Set(result.map(r => r.source)).size).toBe(3);
    });

    it('dedupes multiple items with the same source', () => {
        const items = [
            evidenceItem('terrain', 10),
            evidenceItem('terrain', 8), // duplicate source
            evidenceItem('hydrology', 7),
        ];
        const result = glanceReasons(minAssessment(items));
        const terrainChips = result.filter(r => r.source === 'terrain');
        expect(terrainChips).toHaveLength(1);
        expect(result).toHaveLength(2);
    });

    it('returns fewer than max when fewer distinct sources exist', () => {
        const items = [evidenceItem('terrain'), evidenceItem('hydrology')];
        expect(glanceReasons(minAssessment(items))).toHaveLength(2);
    });

    it('respects custom max parameter', () => {
        const items = [
            evidenceItem('terrain'),
            evidenceItem('hydrology'),
            evidenceItem('geology'),
        ];
        expect(glanceReasons(minAssessment(items), 2)).toHaveLength(2);
    });

    it('never includes a contradicting item (items already filtered upstream)', () => {
        // supportingEvidence only contains supporting items — we just verify
        // glanceReasons does not reach outside supportingEvidence
        const supportItem = evidenceItem('terrain');
        const result = glanceReasons(minAssessment([supportItem]));
        expect(result[0].source).toBe('terrain');
    });
});

// ─── glanceHeadline ───────────────────────────────────────────────────────────

describe('glanceHeadline', () => {
    it('returns mixed-signals headline when primaryInterpretationId is null', () => {
        const { title } = glanceHeadline(minInterp({ primaryInterpretationId: null }));
        expect(title).toBe('Mixed signals — no single dominant reading');
    });

    it('returns hedged headline for a known interpretation', () => {
        const interp = minInterp({
            primaryInterpretationId: 'movement_corridor',
            interpretationScores: [
                {
                    interpretationId: 'movement_corridor',
                    derivedScore: 0.8,
                    periodAffinity: [],
                    confidenceTier: 'high',
                },
            ],
        });
        const { title, strengthLabel } = glanceHeadline(interp);
        expect(title).toBe('This area reads as Movement Corridor');
        expect(strengthLabel).toBe('Good signal');
    });

    it('falls back to Weak signal when no matching score found', () => {
        const interp = minInterp({
            primaryInterpretationId: 'agricultural_landscape',
            interpretationScores: [], // no matching score
        });
        const { strengthLabel } = glanceHeadline(interp);
        expect(strengthLabel).toBe('Weak signal');
    });

    it('maps very_high tier to Strong signal', () => {
        const interp = minInterp({
            primaryInterpretationId: 'settlement_activity_area',
            interpretationScores: [
                {
                    interpretationId: 'settlement_activity_area',
                    derivedScore: 0.95,
                    periodAffinity: [],
                    confidenceTier: 'very_high',
                },
            ],
        });
        expect(glanceHeadline(interp).strengthLabel).toBe('Strong signal');
    });

    it('never returns bald "High" or "Low" — always uses softened labels', () => {
        (['very_high', 'high', 'moderate', 'lower'] as const).forEach(tier => {
            const interp = minInterp({
                primaryInterpretationId: 'burial_landscape',
                interpretationScores: [
                    { interpretationId: 'burial_landscape', derivedScore: 0.5, periodAffinity: [], confidenceTier: tier },
                ],
            });
            const { strengthLabel } = glanceHeadline(interp);
            expect(strengthLabel).not.toMatch(/^(High|Low|Very High|Very Low)$/i);
            expect(['Strong signal', 'Good signal', 'Moderate signal', 'Weak signal']).toContain(strengthLabel);
        });
    });
});
