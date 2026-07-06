// ─── PAS Interpretation Tests (Phase B) ──────────────────────────────────────
// Covers P1–P4 design principles: regional context only, supporting polarity,
// null-neutral, and authored templates with factual slots.

import { describe, it, expect } from 'vitest';
import {
    extractPASSignals,
    TIER_NOTABLE,
    PAS_PERIOD_CAP,
} from '../../src/services/fieldguide/landscapeInterpretation/signalAdapters';
import { computeEvidenceAssessment } from '../../src/services/fieldguide/landscapeInterpretation/evidenceModel';
import type { PASInterpretationInput, LandscapeInterpretationWorkerInput } from '../../src/types/landscapeInterpretation';
import type { PASAdapterOutput } from '../../src/services/fieldguide/landscapeInterpretation/signalAdapters';

// Re-use the snapshot test's ALIE pipeline runner for the invariance test
import { extractSignals } from '../../src/services/fieldguide/landscapeInterpretation/signalAdapters';
import { deriveTerrainRegion } from '../../src/services/fieldguide/landscapeInterpretation/regionalCalibration';
import { computePrimaryProcesses } from '../../src/services/fieldguide/landscapeInterpretation/primaryProcessEngine';
import { computeBurialBehaviour } from '../../src/services/fieldguide/landscapeInterpretation/burialBehaviour';
import { computeDefensiveBehaviour } from '../../src/services/fieldguide/landscapeInterpretation/defensiveBehaviour';
import { computeSecondaryInterpretations, selectPrimaryAndSecondary } from '../../src/services/fieldguide/landscapeInterpretation/secondaryInterpretationEngine';
import { computeDepositionAffinity } from '../../src/services/fieldguide/landscapeInterpretation/depositionAffinity';
import { computeTemporalPersistence } from '../../src/services/fieldguide/landscapeInterpretation/temporalPersistence';
import { computeConfidence } from '../../src/services/fieldguide/landscapeInterpretation/confidenceModel';
import { isScheduledMonumentOverlap } from '../../src/services/fieldguide/landscapeInterpretation/scheduledMonumentGate';
import { generateHedgedNarrative } from '../../src/services/fieldguide/landscapeInterpretation/narrativeGenerator';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makePAS(overrides: Partial<PASInterpretationInput> = {}): PASInterpretationInput {
    return {
        cellCount: 50,
        periodCounts: [
            ['ROMAN', 20],
            ['MEDIEVAL', 15],
            ['POST MEDIEVAL', 10],
            ['EARLY MEDIEVAL', 5],
        ],
        ...overrides,
    };
}

function makeAlieInput(overrides: Partial<LandscapeInterpretationWorkerInput> = {}): LandscapeInterpretationWorkerInput {
    return {
        geohash6: 'gcpvhp',
        nhleFeatures: [],
        aimFeatures: [],
        routeFeatures: [],
        geologyContext: null,
        hotspotMetrics: null,
        hotspotContext: {
            hasCrossingHotspot: false,
            hasMovementHotspot: false,
            hasRouteConvergenceHotspot: false,
            hasWetlandContext: false,
            hasBoundaryTransition: false,
            hasLandformProminence: false,
            hasOccupationSignal: false,
        },
        centerLat: 52.5,
        centerLon: -1.5,
        elevationM: 50,
        slopePercent: 5,
        aspectDegrees: 180,
        potentialBreakdown: null,
        ...overrides,
    };
}

/** Run the full ALIE pipeline synchronously (mirrors engine.snapshot.test.ts) */
function runAliePipeline(input: LandscapeInterpretationWorkerInput, pasOutput?: PASAdapterOutput | null) {
    const extractedSignals = extractSignals(
        input.nhleFeatures, input.aimFeatures, input.routeFeatures, input.potentialBreakdown,
    );
    const signals = {
        ...extractedSignals,
        routeConvergence: extractedSignals.routeConvergence || input.hotspotContext?.hasRouteConvergenceHotspot === true,
        confluencePresent: extractedSignals.confluencePresent || input.hotspotContext?.hasCrossingHotspot === true,
        wetlandPresent: extractedSignals.wetlandPresent || input.hotspotContext?.hasWetlandContext === true,
    };

    // Merge PAS period signals (mirrors worker logic)
    if (pasOutput && pasOutput.periodSignals.length > 0) {
        for (const ps of pasOutput.periodSignals) {
            const existing = signals.periodAggregates.find(a => a.period === ps.period);
            if (existing) {
                existing.certaintyWeightedCount += ps.certaintyWeightedCount;
            } else {
                signals.periodAggregates.push({ ...ps });
            }
        }
    }

    const region = deriveTerrainRegion(input.geologyContext);
    const lieHints = input.hotspotContext ? {
        hasBoundaryTransition: input.hotspotContext.hasBoundaryTransition,
        hasLandformProminence: input.hotspotContext.hasLandformProminence,
        hasOccupationSignal: input.hotspotContext.hasOccupationSignal,
    } : undefined;
    const processScores = computePrimaryProcesses(
        signals, input.geologyContext, input.elevationM, input.slopePercent,
        input.aspectDegrees, region, input.potentialBreakdown, lieHints,
    );

    const { label: temporalPersistence } = computeTemporalPersistence(signals.periodAggregates);
    const recordSparsity = signals.recordSparsity;

    const burialResult = computeBurialBehaviour(processScores, signals.periodAggregates, temporalPersistence, signals.hasNHLEBurialRecord);
    const defensiveResult = computeDefensiveBehaviour(processScores, signals.periodAggregates, signals.nhleDescriptions, input.slopePercent, signals.hasNHLEDefenceRecord);

    const interpretationScores = computeSecondaryInterpretations(processScores, burialResult, defensiveResult, signals.hasNHLEIndustrialRecord, signals.ceremonialRecordCount);
    const { primaryId: primaryInterpretationId, secondaryId: secondaryInterpretationId } = selectPrimaryAndSecondary(interpretationScores);
    const depositionAffinity = computeDepositionAffinity(processScores, interpretationScores, signals);

    const evidenceAssessment = computeEvidenceAssessment(
        processScores, interpretationScores, primaryInterpretationId,
        signals, input.geologyContext, input.slopePercent, input.aspectDegrees,
        input.potentialBreakdown, temporalPersistence, pasOutput,
    );

    const { tier: confidenceTier, uncertainty, contributions: confidenceContributions } = computeConfidence(
        processScores, interpretationScores, primaryInterpretationId, input.hotspotMetrics,
        recordSparsity, {
            supportingPercent: evidenceAssessment.supportingPercent,
            contradictingPercent: evidenceAssessment.contradictingPercent,
            missingCount: evidenceAssessment.missingEvidence.length,
        },
    );

    const scheduledMonumentOverlap = isScheduledMonumentOverlap(input.geohash6, input.nhleFeatures);

    const primaryInterpretation = interpretationScores.find(s => s.interpretationId === primaryInterpretationId);
    const narrative = generateHedgedNarrative(
        primaryInterpretationId, confidenceTier, scheduledMonumentOverlap,
        processScores, burialResult, defensiveResult.periodBranch,
        primaryInterpretation?.periodAffinity ?? [],
    );

    return {
        geohash6: input.geohash6,
        processScores,
        interpretationScores,
        evidenceAssessment,
        primaryInterpretationId,
        secondaryInterpretationId,
        depositionAffinity,
        temporalPersistence,
        recordSparsity,
        uncertainty,
        confidenceContributions,
        scheduledMonumentOverlap,
        narrative,
    };
}

// ─── Period mapping ──────────────────────────────────────────────────────────

describe('PAS period mapping', () => {
    it('maps all 7 supported labels to correct periods', () => {
        const input: PASInterpretationInput = {
            cellCount: 100,
            periodCounts: [
                ['BRONZE AGE', 10],
                ['IRON AGE', 10],
                ['ROMAN', 10],
                ['EARLY MEDIEVAL', 10],
                ['MEDIEVAL', 10],
                ['POST MEDIEVAL', 10],
                ['MODERN', 10],
            ],
        };
        const result = extractPASSignals(input);
        const periods = result.periodSignals.map(s => s.period).sort();
        expect(periods).toEqual([
            'early_medieval',
            'iron_age',
            'medieval',
            'modern_industrial',
            'post_medieval',
            'prehistoric_bronze_age',
            'romano_british',
        ]);
    });

    it('NEOLITHIC is skipped — no period signal, no throw', () => {
        const result = extractPASSignals({
            cellCount: 50,
            periodCounts: [['NEOLITHIC', 20]],
        });
        expect(result.periodSignals).toHaveLength(0);
        expect(result.densityTier).not.toBe('none');
    });

    it('UNKNOWN is skipped — no period signal, no throw', () => {
        const result = extractPASSignals({
            cellCount: 50,
            periodCounts: [['UNKNOWN', 20]],
        });
        expect(result.periodSignals).toHaveLength(0);
    });

    it('unrecognised labels are silently skipped', () => {
        const result = extractPASSignals({
            cellCount: 50,
            periodCounts: [['GARBAGE', 20], ['SOMETHING ELSE', 10]],
        });
        expect(result.periodSignals).toHaveLength(0);
    });

    it('case and trim tolerance', () => {
        const result = extractPASSignals({
            cellCount: 50,
            periodCounts: [
                ['  roman  ', 10],
                ['medieval', 10],
                ['Iron Age', 10],
            ],
        });
        const periods = result.periodSignals.map(s => s.period).sort();
        expect(periods).toContain('romano_british');
        expect(periods).toContain('medieval');
        expect(periods).toContain('iron_age');
    });
});

// ─── Null / zero / undefined → no signals, no evidence ──────────────────────

describe('PAS null-neutral (P3)', () => {
    it('null input → no signals, no evidence', () => {
        const result = extractPASSignals(null);
        expect(result.periodSignals).toHaveLength(0);
        expect(result.densityTier).toBe('none');
        expect(result.cellCount).toBe(0);
    });

    it('undefined input → no signals, no evidence', () => {
        const result = extractPASSignals(undefined);
        expect(result.periodSignals).toHaveLength(0);
        expect(result.densityTier).toBe('none');
    });

    it('cellCount 0 → no signals, no evidence', () => {
        const result = extractPASSignals({
            cellCount: 0,
            periodCounts: [['ROMAN', 50]],
        });
        expect(result.periodSignals).toHaveLength(0);
        expect(result.densityTier).toBe('none');
    });
});

// ─── Tier boundaries ────────────────────────────────────────────────────────

describe('PAS density tier boundaries', () => {
    it(`cellCount ${TIER_NOTABLE - 1} → present`, () => {
        const result = extractPASSignals({
            cellCount: TIER_NOTABLE - 1,
            periodCounts: [['ROMAN', 10]],
        });
        expect(result.densityTier).toBe('present');
    });

    it(`cellCount ${TIER_NOTABLE} → notable`, () => {
        const result = extractPASSignals({
            cellCount: TIER_NOTABLE,
            periodCounts: [['ROMAN', 10]],
        });
        expect(result.densityTier).toBe('notable');
    });

    it(`cellCount ${TIER_NOTABLE + 1} → notable`, () => {
        const result = extractPASSignals({
            cellCount: TIER_NOTABLE + 1,
            periodCounts: [['ROMAN', 10]],
        });
        expect(result.densityTier).toBe('notable');
    });

    it('cellCount 1 → present', () => {
        const result = extractPASSignals({
            cellCount: 1,
            periodCounts: [],
        });
        expect(result.densityTier).toBe('present');
    });
});

// ─── Period cap ─────────────────────────────────────────────────────────────

describe('PAS period cap', () => {
    it('500 ROMAN records → summed contribution to romano_british <= PAS_PERIOD_CAP', () => {
        const result = extractPASSignals({
            cellCount: 600,
            periodCounts: [['ROMAN', 500]],
        });
        const romanSignal = result.periodSignals.find(s => s.period === 'romano_british');
        expect(romanSignal).toBeDefined();
        expect(romanSignal!.certaintyWeightedCount).toBeLessThanOrEqual(PAS_PERIOD_CAP);
    });

    it('multi-period: no single period exceeds PAS_PERIOD_CAP', () => {
        const result = extractPASSignals({
            cellCount: 1000,
            periodCounts: [
                ['ROMAN', 400],
                ['MEDIEVAL', 300],
                ['POST MEDIEVAL', 200],
                ['IRON AGE', 100],
            ],
        });
        for (const ps of result.periodSignals) {
            expect(ps.certaintyWeightedCount).toBeLessThanOrEqual(PAS_PERIOD_CAP);
        }
    });
});

// ─── Count >= 3 floor ───────────────────────────────────────────────────────

describe('PAS period count floor', () => {
    it('period with count 2 is excluded from period signals', () => {
        const result = extractPASSignals({
            cellCount: 50,
            periodCounts: [['ROMAN', 2], ['MEDIEVAL', 20]],
        });
        const periods = result.periodSignals.map(s => s.period);
        expect(periods).not.toContain('romano_british');
        expect(periods).toContain('medieval');
    });

    it('period with count 3 is included', () => {
        const result = extractPASSignals({
            cellCount: 50,
            periodCounts: [['ROMAN', 3]],
        });
        const periods = result.periodSignals.map(s => s.period);
        expect(periods).toContain('romano_british');
    });
});

// ─── Corroboration gate (P1) ────────────────────────────────────────────────

describe('PAS period alignment — corroboration gate (P1)', () => {
    it('top PAS period with NO matching monument signal → pas_period_alignment absent', () => {
        const input = makeAlieInput();  // no NHLE/AIM features → no monument period signals
        const pasInput = makePAS({ periodCounts: [['ROMAN', 50], ['MEDIEVAL', 10]] });
        const pasOutput = extractPASSignals(pasInput);

        const result = runAliePipeline(input, pasOutput);
        const alignmentItem = result.evidenceAssessment.supportingEvidence.find(
            e => e.id === 'pas_period_alignment',
        );
        expect(alignmentItem).toBeUndefined();
    });

    it('top PAS period WITH matching monument signal → pas_period_alignment present', () => {
        // Create an AIM feature with ROMAN period to provide monument corroboration
        const aimFeature = {
            id: 'aim-1',
            type: 'Feature' as const,
            geometry: { type: 'Point' as const, coordinates: [-1.5, 52.5] },
            properties: { PERIOD: 'ROMAN', MONUMENT_TYPE: 'VILLA', CERTAINTY: 'probable' },
        };
        const input = makeAlieInput({ aimFeatures: [aimFeature as any] });
        const pasInput = makePAS({
            cellCount: 200,
            periodCounts: [['ROMAN', 100], ['MEDIEVAL', 20]],
        });
        const pasOutput = extractPASSignals(pasInput);

        const result = runAliePipeline(input, pasOutput);
        const alignmentItem = result.evidenceAssessment.supportingEvidence.find(
            e => e.id === 'pas_period_alignment',
        );
        expect(alignmentItem).toBeDefined();
        expect(alignmentItem!.polarity).toBe('supporting');
        expect(alignmentItem!.label).toContain('Romano-British');
    });
});

// ─── Weight ceiling ─────────────────────────────────────────────────────────

describe('PAS evidence weight ceiling', () => {
    it('both PAS items together <= 18', () => {
        const aimFeature = {
            id: 'aim-1',
            type: 'Feature' as const,
            geometry: { type: 'Point' as const, coordinates: [-1.5, 52.5] },
            properties: { PERIOD: 'ROMAN', MONUMENT_TYPE: 'VILLA', CERTAINTY: 'probable' },
        };
        const input = makeAlieInput({ aimFeatures: [aimFeature as any] });
        const pasInput = makePAS({
            cellCount: 500,
            periodCounts: [['ROMAN', 300], ['MEDIEVAL', 100]],
        });
        const pasOutput = extractPASSignals(pasInput);
        const result = runAliePipeline(input, pasOutput);

        const pasItems = result.evidenceAssessment.supportingEvidence.filter(
            e => e.id.startsWith('pas_'),
        );
        const totalPasWeight = pasItems.reduce((sum, e) => sum + e.weight, 0);
        expect(totalPasWeight).toBeLessThanOrEqual(18);
    });
});

// ─── Polarity: no PAS-sourced item is ever contradicting or missing (P2) ────

describe('PAS polarity (P2)', () => {
    it('no PAS-sourced item is ever contradicting or missing', () => {
        const input = makeAlieInput();
        const pasInput = makePAS({ cellCount: 500, periodCounts: [['ROMAN', 300]] });
        const pasOutput = extractPASSignals(pasInput);
        const result = runAliePipeline(input, pasOutput);

        const allEvidence = [
            ...result.evidenceAssessment.supportingEvidence,
            ...result.evidenceAssessment.contradictingEvidence,
            ...result.evidenceAssessment.missingEvidence,
        ];
        const pasItems = allEvidence.filter(e => e.id.startsWith('pas_'));
        for (const item of pasItems) {
            expect(item.polarity).toBe('supporting');
        }
    });

    it('cellCount 0 emits nothing — quiet cell (P2)', () => {
        const pasOutput = extractPASSignals({ cellCount: 0, periodCounts: [] });
        expect(pasOutput.periodSignals).toHaveLength(0);
        expect(pasOutput.densityTier).toBe('none');
    });
});

// ─── INVARIANCE: pas undefined → byte-identical to pre-PAS output ───────────

describe('PAS invariance — pas:undefined produces identical output to no-PAS pipeline', () => {
    it('minimal input: pas undefined vs null vs omitted → deep-equal', () => {
        const input = makeAlieInput();
        const withoutPAS = runAliePipeline(input);
        const withNull = runAliePipeline(input, null);
        const withUndefined = runAliePipeline(input, undefined);
        const withNoneOutput = runAliePipeline(input, extractPASSignals(null));

        expect(withNull).toEqual(withoutPAS);
        expect(withUndefined).toEqual(withoutPAS);
        expect(withNoneOutput).toEqual(withoutPAS);
    });

    it('record-rich input: pas absent → identical output', () => {
        const aimFeature = {
            id: 'aim-1',
            type: 'Feature' as const,
            geometry: { type: 'Point' as const, coordinates: [-1.5, 52.5] },
            properties: { PERIOD: 'ROMAN', MONUMENT_TYPE: 'VILLA', CERTAINTY: 'probable' },
        };
        const input = makeAlieInput({
            aimFeatures: [aimFeature as any],
            routeFeatures: [{ type: 'roman_road' as any, name: 'Watling Street', geometry: { type: 'LineString', coordinates: [] }, confidenceClass: 1, bufferedGeometry: null }],
        });

        const withoutPAS = runAliePipeline(input);
        const withNullPAS = runAliePipeline(input, null);
        expect(withNullPAS).toEqual(withoutPAS);
    });
});

// ─── topMappedPeriod determinism ────────────────────────────────────────────

describe('PAS topMappedPeriod determinism', () => {
    it('ties broken alphabetically', () => {
        const result = extractPASSignals({
            cellCount: 50,
            periodCounts: [['ROMAN', 20], ['MEDIEVAL', 20]],
        });
        // medieval < romano_british alphabetically
        expect(result.topMappedPeriod).toBe('medieval');
    });

    it('highest count wins', () => {
        const result = extractPASSignals({
            cellCount: 100,
            periodCounts: [['ROMAN', 50], ['MEDIEVAL', 30]],
        });
        expect(result.topMappedPeriod).toBe('romano_british');
    });
});
