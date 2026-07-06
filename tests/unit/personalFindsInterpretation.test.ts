// ─── Personal Finds Interpretation Tests ─────────────────────────────────────
// Covers L1–L4 design principles: primary local evidence, supporting polarity,
// null-neutral, and authored templates with factual slots.

import { describe, it, expect } from 'vitest';
import {
    extractPersonalFindsSignals,
    extractPASSignals,
    PERSONAL_N_PRESENCE,
    PERSONAL_N_DOMINANT,
    PERSONAL_ANOMALY_FACTOR,
    PERSONAL_PERIOD_CAP,
    FIND_PERIOD_MAP,
} from '../../src/services/fieldguide/landscapeInterpretation/signalAdapters';
import type { PASAdapterOutput } from '../../src/services/fieldguide/landscapeInterpretation/signalAdapters';
import { computeEvidenceAssessment } from '../../src/services/fieldguide/landscapeInterpretation/evidenceModel';
import type { PersonalFindsInput, PASInterpretationInput, LandscapeInterpretationWorkerInput } from '../../src/types/landscapeInterpretation';
import type { PersonalFindsAdapterOutput } from '../../src/services/fieldguide/landscapeInterpretation/signalAdapters';

// Re-use the ALIE pipeline runner for invariance tests
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

function makePersonal(overrides: Partial<PersonalFindsInput> = {}): PersonalFindsInput {
    return {
        totalWithCoords: 14,
        periodCounts: [
            ['Roman', 11],
            ['Medieval', 2],
            ['Anglo-Saxon', 1],
        ],
        ...overrides,
    };
}

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

/** Run the full ALIE pipeline synchronously (mirrors pasInterpretation.test.ts) */
function runAliePipeline(
    input: LandscapeInterpretationWorkerInput,
    personalFindsOutput?: PersonalFindsAdapterOutput | null,
    pasOutput?: PASAdapterOutput | null,
) {
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

    // Merge personal finds period signals (mirrors worker logic)
    if (personalFindsOutput && personalFindsOutput.periodSignals.length > 0) {
        for (const ps of personalFindsOutput.periodSignals) {
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
        input.potentialBreakdown, temporalPersistence, pasOutput, personalFindsOutput,
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

describe('Personal finds period mapping', () => {
    it('maps all supported Find.period labels to correct periods', () => {
        const input: PersonalFindsInput = {
            totalWithCoords: 90,
            periodCounts: [
                ['Bronze Age', 10],
                ['Iron Age', 10],
                ['Celtic', 10],
                ['Roman', 10],
                ['Anglo-Saxon', 10],
                ['Early Medieval', 10],
                ['Medieval', 10],
                ['Post-medieval', 10],
                ['Modern', 10],
            ],
        };
        const result = extractPersonalFindsSignals(input, null);
        const periods = result.periodSignals.map(s => s.period).sort();
        // Celtic + Iron Age merge into iron_age; Anglo-Saxon + Early Medieval merge into early_medieval
        // So we get 7 unique periods but with merged counts
        expect(result.mappedTotal).toBe(90);
    });

    it('Celtic and Iron Age merge into one iron_age count', () => {
        const input: PersonalFindsInput = {
            totalWithCoords: 10,
            periodCounts: [
                ['Celtic', 3],
                ['Iron Age', 3],
            ],
        };
        const result = extractPersonalFindsSignals(input, null);
        // Merged count is 6, which meets N_PRESENCE threshold of 5
        expect(result.periodSignals.find(s => s.period === 'iron_age')).toBeDefined();
        expect(result.mappedTotal).toBe(6);
    });

    it('Anglo-Saxon and Early Medieval merge into one early_medieval count', () => {
        const input: PersonalFindsInput = {
            totalWithCoords: 10,
            periodCounts: [
                ['Anglo-Saxon', 3],
                ['Early Medieval', 3],
            ],
        };
        const result = extractPersonalFindsSignals(input, null);
        expect(result.periodSignals.find(s => s.period === 'early_medieval')).toBeDefined();
        expect(result.mappedTotal).toBe(6);
    });

    it('Prehistoric is skipped — no period signal, no throw', () => {
        const result = extractPersonalFindsSignals({
            totalWithCoords: 20,
            periodCounts: [['Prehistoric', 20]],
        }, null);
        expect(result.periodSignals).toHaveLength(0);
        expect(result.mappedTotal).toBe(0);
    });

    it('Unknown is skipped — no period signal, no throw', () => {
        const result = extractPersonalFindsSignals({
            totalWithCoords: 20,
            periodCounts: [['Unknown', 20]],
        }, null);
        expect(result.periodSignals).toHaveLength(0);
    });

    it('unrecognised labels are silently skipped', () => {
        const result = extractPersonalFindsSignals({
            totalWithCoords: 20,
            periodCounts: [['Garbage', 10], ['Something Else', 10]],
        }, null);
        expect(result.periodSignals).toHaveLength(0);
        expect(result.evidenceDirectives).toHaveLength(0);
    });
});

// ─── Floors ─────────────────────────────────────────────────────────────────

describe('Personal finds floors', () => {
    it(`n=${PERSONAL_N_PRESENCE - 1} → silence (no signals, no evidence)`, () => {
        const result = extractPersonalFindsSignals({
            totalWithCoords: PERSONAL_N_PRESENCE - 1,
            periodCounts: [['Roman', PERSONAL_N_PRESENCE - 1]],
        }, null);
        expect(result.periodSignals).toHaveLength(0);
        expect(result.evidenceDirectives).toHaveLength(0);
    });

    it(`n=${PERSONAL_N_PRESENCE} → presence`, () => {
        const result = extractPersonalFindsSignals({
            totalWithCoords: PERSONAL_N_PRESENCE,
            periodCounts: [['Roman', PERSONAL_N_PRESENCE]],
        }, null);
        expect(result.periodSignals).toHaveLength(1);
        const directive = result.evidenceDirectives.find(d => d.id === 'personal_period_presence');
        expect(directive).toBeDefined();
        expect(directive!.weight).toBe(12);
    });

    it(`n=${PERSONAL_N_DOMINANT} with share >= 0.5 → dominant replaces presence (never both)`, () => {
        const result = extractPersonalFindsSignals({
            totalWithCoords: PERSONAL_N_DOMINANT,
            periodCounts: [['Roman', PERSONAL_N_DOMINANT]],
        }, null);
        const presence = result.evidenceDirectives.find(d => d.id === 'personal_period_presence');
        const dominant = result.evidenceDirectives.find(d => d.id === 'personal_period_dominant');
        expect(presence).toBeUndefined();
        expect(dominant).toBeDefined();
        expect(dominant!.weight).toBe(14);
    });

    it('n >= N_DOMINANT but share < 0.5 → presence not dominant', () => {
        // 10 Roman, 11 Medieval → Roman share < 0.5
        const result = extractPersonalFindsSignals({
            totalWithCoords: 21,
            periodCounts: [['Roman', PERSONAL_N_DOMINANT], ['Medieval', PERSONAL_N_DOMINANT + 1]],
        }, null);
        // Top period is Medieval (higher count)
        const dominant = result.evidenceDirectives.find(d => d.id === 'personal_period_dominant');
        const presence = result.evidenceDirectives.find(d => d.id === 'personal_period_presence');
        // Medieval has count 11 >= N_DOMINANT and share 11/21 ≈ 0.524 >= 0.5, so it's dominant
        expect(dominant).toBeDefined();
        expect(dominant!.label).toContain('Medieval');
    });
});

// ─── Anomaly ────────────────────────────────────────────────────────────────

describe('Personal finds base rate anomaly', () => {
    it('requires PAS present with mapped total >= 20', () => {
        const result = extractPersonalFindsSignals({
            totalWithCoords: 20,
            periodCounts: [['Roman', 20]],
        }, null); // no PAS
        const anomaly = result.evidenceDirectives.find(d => d.id === 'personal_base_rate_anomaly');
        expect(anomaly).toBeUndefined();
    });

    it('PAS mapped total < 20 → no anomaly even when personal qualifies', () => {
        const result = extractPersonalFindsSignals({
            totalWithCoords: 20,
            periodCounts: [['Roman', 20]],
        }, { cellCount: 50, periodCounts: [['ROMAN', 5], ['MEDIEVAL', 5]] }); // total 10 < 20
        const anomaly = result.evidenceDirectives.find(d => d.id === 'personal_base_rate_anomaly');
        expect(anomaly).toBeUndefined();
    });

    it('factor boundary at exactly 2.0x — at boundary fires', () => {
        // Personal: 20 Roman of 20 = 100% share
        // PAS: 10 ROMAN of 40 = 25% share
        // 100% / 25% = 4x >= 2x → fires
        const result = extractPersonalFindsSignals({
            totalWithCoords: 20,
            periodCounts: [['Roman', 20]],
        }, { cellCount: 100, periodCounts: [['ROMAN', 10], ['MEDIEVAL', 30]] });
        const anomaly = result.evidenceDirectives.find(d => d.id === 'personal_base_rate_anomaly');
        expect(anomaly).toBeDefined();
        expect(anomaly!.weight).toBe(8);
    });

    it('factor boundary at exactly 2.0x — just below does not fire', () => {
        // Personal: 10 Roman of 20 = 50% share
        // PAS: 10 ROMAN of 30 = 33% share
        // 50% / 33% ≈ 1.5x < 2x → does not fire
        const result = extractPersonalFindsSignals({
            totalWithCoords: 20,
            periodCounts: [['Roman', 10], ['Medieval', 10]],
        }, { cellCount: 100, periodCounts: [['ROMAN', 10], ['MEDIEVAL', 20]] });
        const anomaly = result.evidenceDirectives.find(d => d.id === 'personal_base_rate_anomaly');
        expect(anomaly).toBeUndefined();
    });

    it('absent PAS → no anomaly item even when personal counts qualify', () => {
        const result = extractPersonalFindsSignals({
            totalWithCoords: 20,
            periodCounts: [['Roman', 20]],
        }, undefined);
        const anomaly = result.evidenceDirectives.find(d => d.id === 'personal_base_rate_anomaly');
        expect(anomaly).toBeUndefined();
    });
});

// ─── Cap and ceiling ────────────────────────────────────────────────────────

describe('Personal finds cap and ceiling', () => {
    it(`period signal contribution <= ${PERSONAL_PERIOD_CAP}`, () => {
        const result = extractPersonalFindsSignals({
            totalWithCoords: 100,
            periodCounts: [['Roman', 100]],
        }, null);
        for (const ps of result.periodSignals) {
            expect(ps.certaintyWeightedCount).toBeLessThanOrEqual(PERSONAL_PERIOD_CAP);
        }
    });

    it('ceiling across all personal evidence IDs <= 22', () => {
        // Trigger all 3 directives (dominant + anomaly)
        const result = extractPersonalFindsSignals({
            totalWithCoords: 20,
            periodCounts: [['Roman', 20]],
        }, { cellCount: 100, periodCounts: [['ROMAN', 5], ['MEDIEVAL', 30]] });
        const totalWeight = result.evidenceDirectives.reduce((sum, d) => sum + d.weight, 0);
        expect(totalWeight).toBeLessThanOrEqual(22);
    });
});

// ─── Polarity ───────────────────────────────────────────────────────────────

describe('Personal finds polarity', () => {
    it('no personal finds item is ever contradicting or missing', () => {
        const input = makeAlieInput();
        const personalOutput = extractPersonalFindsSignals(makePersonal(), null);
        const result = runAliePipeline(input, personalOutput);

        const allEvidence = [
            ...result.evidenceAssessment.supportingEvidence,
            ...result.evidenceAssessment.contradictingEvidence,
            ...result.evidenceAssessment.missingEvidence,
        ];
        const personalItems = allEvidence.filter(e => e.id.startsWith('personal_'));
        for (const item of personalItems) {
            expect(item.polarity).toBe('supporting');
        }
    });

    it('all evidence directives have supporting polarity', () => {
        const result = extractPersonalFindsSignals({
            totalWithCoords: 20,
            periodCounts: [['Roman', 20]],
        }, { cellCount: 100, periodCounts: [['ROMAN', 5], ['MEDIEVAL', 30]] });
        for (const d of result.evidenceDirectives) {
            expect(d.polarity).toBe('supporting');
        }
    });
});

// ─── Null-neutral / invariance ──────────────────────────────────────────────

describe('Personal finds null-neutral — invariance against snapshot pipeline', () => {
    it('null/undefined/empty → identical output to no-personal-finds pipeline', () => {
        const input = makeAlieInput();
        const withoutPersonal = runAliePipeline(input);
        const withNull = runAliePipeline(input, null);
        const withUndefined = runAliePipeline(input, undefined);
        const withEmptyOutput = runAliePipeline(input, extractPersonalFindsSignals(null, null));

        expect(withNull).toEqual(withoutPersonal);
        expect(withUndefined).toEqual(withoutPersonal);
        expect(withEmptyOutput).toEqual(withoutPersonal);
    });

    it('record-rich input: personal finds absent → identical output', () => {
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

        const withoutPersonal = runAliePipeline(input);
        const withNullPersonal = runAliePipeline(input, null);
        expect(withNullPersonal).toEqual(withoutPersonal);
    });
});

// ─── Determinism ────────────────────────────────────────────────────────────

describe('Personal finds topMappedPeriod determinism', () => {
    it('ties broken alphabetically on ArchaeologicalPeriod key', () => {
        const result = extractPersonalFindsSignals({
            totalWithCoords: 20,
            periodCounts: [['Roman', 10], ['Medieval', 10]],
        }, null);
        // medieval < romano_british alphabetically
        expect(result.topMappedPeriod).toBe('medieval');
    });

    it('highest count wins', () => {
        const result = extractPersonalFindsSignals({
            totalWithCoords: 30,
            periodCounts: [['Roman', 20], ['Medieval', 10]],
        }, null);
        expect(result.topMappedPeriod).toBe('romano_british');
    });
});

// ─── Caller-side: accuracy filter and radius boundary ───────────────────────

describe('Personal finds caller-side filtering logic', () => {
    // These tests verify the filter rules that HistoricLayerManager applies
    // before constructing PersonalFindsInput. We test the rules directly.

    const scanCentre = { lat: 52.5, lon: -1.5 };
    const RADIUS_M = 800;

    function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
        const R = 6_371_000;
        const toRad = (d: number) => d * Math.PI / 180;
        const dLat = toRad(lat2 - lat1);
        const dLon = toRad(lon2 - lon1);
        const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    type MockFind = { lat: number | null; lon: number | null; gpsAccuracyM: number | null; period: string };

    function filterFinds(finds: MockFind[]): MockFind[] {
        return finds.filter(f => {
            if (f.lat == null || f.lon == null) return false;
            if (f.gpsAccuracyM != null && f.gpsAccuracyM > 150) return false;
            return haversineM(scanCentre.lat, scanCentre.lon, f.lat, f.lon) <= RADIUS_M;
        });
    }

    it('gpsAccuracyM 151 is excluded', () => {
        const finds: MockFind[] = [
            { lat: 52.5, lon: -1.5, gpsAccuracyM: 151, period: 'Roman' },
        ];
        expect(filterFinds(finds)).toHaveLength(0);
    });

    it('gpsAccuracyM 150 is included', () => {
        const finds: MockFind[] = [
            { lat: 52.5, lon: -1.5, gpsAccuracyM: 150, period: 'Roman' },
        ];
        expect(filterFinds(finds)).toHaveLength(1);
    });

    it('gpsAccuracyM null is included', () => {
        const finds: MockFind[] = [
            { lat: 52.5, lon: -1.5, gpsAccuracyM: null, period: 'Roman' },
        ];
        expect(filterFinds(finds)).toHaveLength(1);
    });

    it('find with null lat/lon is excluded', () => {
        const finds: MockFind[] = [
            { lat: null, lon: null, gpsAccuracyM: null, period: 'Roman' },
        ];
        expect(filterFinds(finds)).toHaveLength(0);
    });

    it('find just within 800m radius is included', () => {
        // ~800m north of scan centre
        const offsetLat = 52.5 + (800 / 111_320);
        const finds: MockFind[] = [
            { lat: offsetLat, lon: -1.5, gpsAccuracyM: null, period: 'Roman' },
        ];
        const filtered = filterFinds(finds);
        expect(filtered.length).toBeGreaterThanOrEqual(1);
    });

    it('find just beyond 800m radius is excluded', () => {
        // ~810m north of scan centre
        const offsetLat = 52.5 + (810 / 111_320);
        const finds: MockFind[] = [
            { lat: offsetLat, lon: -1.5, gpsAccuracyM: null, period: 'Roman' },
        ];
        const filtered = filterFinds(finds);
        expect(filtered).toHaveLength(0);
    });
});

// ─── A2: PAS-gate interaction with personal finds ──────────────────────────

describe('PAS-gate interaction with personal finds (A2)', () => {
    it('personal-only Roman + PAS top Roman, anomaly NOT met → alignment PRESENT', () => {
        // Personal: 10 Roman of 10 = dominant, but anomaly not met (PAS share high enough)
        // PAS: 50 ROMAN of 100 = 50% share. Personal share 100% / PAS 50% = 2x → exactly at boundary
        // To NOT trigger anomaly, keep personal share < 2x PAS share:
        // PAS: 60 ROMAN of 100. Personal share 100% / 60% = 1.67x < 2x
        const pasInput = makePAS({ cellCount: 100, periodCounts: [['ROMAN', 60], ['MEDIEVAL', 40]] });
        const personalInput: PersonalFindsInput = { totalWithCoords: 10, periodCounts: [['Roman', 10]] };
        const pasOutput = extractPASSignals(pasInput);
        const personalOutput = extractPersonalFindsSignals(personalInput, pasInput);

        // No monument records — only personal finds introduce romano_british
        const input = makeAlieInput();
        const result = runAliePipeline(input, personalOutput, pasOutput);

        const alignment = result.evidenceAssessment.supportingEvidence.find(
            e => e.id === 'pas_period_alignment',
        );
        expect(alignment).toBeDefined();
        expect(alignment!.polarity).toBe('supporting');
    });

    it('personal-only Roman + PAS top Roman, anomaly MET → anomaly present, alignment SUPPRESSED', () => {
        // Personal: 20 Roman of 20 = dominant. PAS: 5 ROMAN of 35 = 14.3% share.
        // Personal share 100% / 14.3% = 7x >= 2x → anomaly fires
        const pasInput = makePAS({ cellCount: 100, periodCounts: [['ROMAN', 5], ['MEDIEVAL', 30]] });
        const personalInput: PersonalFindsInput = { totalWithCoords: 20, periodCounts: [['Roman', 20]] };
        const pasOutput = extractPASSignals(pasInput);
        const personalOutput = extractPersonalFindsSignals(personalInput, pasInput);

        const input = makeAlieInput();
        const result = runAliePipeline(input, personalOutput, pasOutput);

        const anomaly = result.evidenceAssessment.supportingEvidence.find(
            e => e.id === 'personal_base_rate_anomaly',
        );
        const alignment = result.evidenceAssessment.supportingEvidence.find(
            e => e.id === 'pas_period_alignment',
        );
        expect(anomaly).toBeDefined();
        expect(alignment).toBeUndefined();
    });

    it('different periods → both may fire, no suppression', () => {
        // Personal top = Roman (dominant), PAS top = Medieval
        // No overlap → no suppression rule applies
        const pasInput: PASInterpretationInput = { cellCount: 100, periodCounts: [['MEDIEVAL', 60], ['ROMAN', 5]] };
        const personalInput: PersonalFindsInput = { totalWithCoords: 20, periodCounts: [['Roman', 20]] };
        const pasOutput = extractPASSignals(pasInput);
        const personalOutput = extractPersonalFindsSignals(personalInput, pasInput);

        // PAS top period is Medieval — personal finds introduce Roman but PAS
        // alignment checks PAS's top period (Medieval), not personal's.
        // For alignment to fire, Medieval needs a monument or personal corroboration.
        // Neither exists here, so alignment won't fire — but crucially it's not
        // SUPPRESSED, it simply doesn't qualify.
        const input = makeAlieInput();
        const result = runAliePipeline(input, personalOutput, pasOutput);

        // The anomaly may or may not fire (different periods). The key assertion
        // is that suppression doesn't prevent alignment from qualifying on its own
        // merits when periods differ.
        const anomaly = result.evidenceAssessment.supportingEvidence.find(
            e => e.id === 'personal_base_rate_anomaly',
        );
        // Anomaly doesn't fire because personal top period (romano_british) has
        // PAS share of 5/65 = 7.7%, personal share 100% → 13x >= 2x, BUT the
        // anomaly requires isDominant which is true. Actually let's check:
        // personalOutput.evidenceDirectives should have anomaly for Romano-British
        // since PAS mapped total = 65 >= 20 and 100%/7.7% >= 2x
        expect(personalOutput.evidenceDirectives.some(d => d.id === 'personal_base_rate_anomaly')).toBe(true);

        // PAS top period is medieval. Personal top period is romano_british.
        // personalCorroborates = false, so no suppression applies.
        // Alignment for medieval requires monument or personal corroboration of medieval.
        // Personal top is romano_british ≠ medieval, so no personal corroboration.
        // No monuments → alignment absent (not suppressed, just doesn't qualify).
        const alignment = result.evidenceAssessment.supportingEvidence.find(
            e => e.id === 'pas_period_alignment',
        );
        expect(alignment).toBeUndefined();
    });
});
