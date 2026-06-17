// ─── ALIE v5 Web Worker ───────────────────────────────────────────────────────
// Receives LandscapeInterpretationWorkerInput via postMessage.
// Runs the full pipeline and postMessages LandscapeInterpretationWorkerOutput.

import type {
    LandscapeInterpretationWorkerInput,
    LandscapeInterpretationWorkerOutput,
    LandscapeInterpretation,
} from '../types/landscapeInterpretation';

import { extractSignals }                                              from '../services/fieldguide/landscapeInterpretation/signalAdapters';
import { deriveTerrainRegion }                                         from '../services/fieldguide/landscapeInterpretation/regionalCalibration';
import { computePrimaryProcesses }                                     from '../services/fieldguide/landscapeInterpretation/primaryProcessEngine';
import { computeBurialBehaviour }                                      from '../services/fieldguide/landscapeInterpretation/burialBehaviour';
import { computeDefensiveBehaviour }                                   from '../services/fieldguide/landscapeInterpretation/defensiveBehaviour';
import { computeSecondaryInterpretations, selectPrimaryAndSecondary }  from '../services/fieldguide/landscapeInterpretation/secondaryInterpretationEngine';
import { computeDepositionAffinity }                                   from '../services/fieldguide/landscapeInterpretation/depositionAffinity';
import { computeTemporalPersistence }                                  from '../services/fieldguide/landscapeInterpretation/temporalPersistence';
import { computeConfidence }                                           from '../services/fieldguide/landscapeInterpretation/confidenceModel';
import { isScheduledMonumentOverlap }                                  from '../services/fieldguide/landscapeInterpretation/scheduledMonumentGate';
import { generateHedgedNarrative }                                     from '../services/fieldguide/landscapeInterpretation/narrativeGenerator';
import { computeEvidenceAssessment }                                   from '../services/fieldguide/landscapeInterpretation/evidenceModel';

const ENGINE_VERSION = 'ALIE-2026.06.17h';

self.onmessage = (event: MessageEvent<LandscapeInterpretationWorkerInput>) => {
    try {
        const input = event.data;
        const {
            geohash6,
            nhleFeatures,
            aimFeatures,
            routeFeatures,
            geologyContext,
            hotspotMetrics,
            hotspotContext,
            centerLat,
            centerLon,
            elevationM,
            slopePercent,
            aspectDegrees,
            potentialBreakdown,
        } = input;

        // ── 1. Extract adapted signals ────────────────────────────────────────
        const extractedSignals = extractSignals(nhleFeatures, aimFeatures, routeFeatures, potentialBreakdown);
        const signals = {
            ...extractedSignals,
            routeConvergence: extractedSignals.routeConvergence || hotspotContext?.hasRouteConvergenceHotspot === true,
            confluencePresent: extractedSignals.confluencePresent || hotspotContext?.hasCrossingHotspot === true,
        };

        // ── 2. Derive terrain region + regional multiplier ────────────────────
        const region = deriveTerrainRegion(geologyContext);

        // ── 3. Compute six primary process scores ─────────────────────────────
        const processScores = computePrimaryProcesses(
            signals, geologyContext, elevationM, slopePercent, aspectDegrees, region, potentialBreakdown,
        );

        // ── 4. Temporal persistence ───────────────────────────────────────────
        // recordSparsity comes from the adapter (total nhle+aim count < 3),
        // NOT from temporalPersistence which only counts period-tagged records
        // and will falsely flag sparsity when NHLE names lack period keywords.
        const { label: temporalPersistence } =
            computeTemporalPersistence(signals.periodAggregates);
        const recordSparsity = signals.recordSparsity;

        // ── 5. Burial behaviour ───────────────────────────────────────────────
        const burialResult = computeBurialBehaviour(
            processScores,
            signals.periodAggregates,
            temporalPersistence,
            signals.hasNHLEBurialRecord,
        );

        // ── 6. Defensive behaviour ────────────────────────────────────────────
        const defensiveResult = computeDefensiveBehaviour(
            processScores,
            signals.periodAggregates,
            signals.nhleDescriptions,
            slopePercent,
            signals.hasNHLEDefenceRecord,
        );

        // ── 7. Secondary interpretations ──────────────────────────────────────
        const interpretationScores = computeSecondaryInterpretations(
            processScores,
            burialResult,
            defensiveResult,
            signals.hasNHLEIndustrialRecord,
        );

        // ── 8. Primary / secondary selection ─────────────────────────────────
        const { primaryId: primaryInterpretationId, secondaryId: secondaryInterpretationId } =
            selectPrimaryAndSecondary(interpretationScores);

        // ── 9. Deposition affinity ─────────────────────────────────────────────
        const depositionAffinity = computeDepositionAffinity(processScores, interpretationScores, signals);

        // ── 10. Evidence assessment ───────────────────────────────────────────
        const evidenceAssessment = computeEvidenceAssessment(
            processScores,
            interpretationScores,
            primaryInterpretationId,
            signals,
            geologyContext,
            slopePercent,
            aspectDegrees,
            potentialBreakdown,
            temporalPersistence,
        );

        // ── 11. Confidence model ──────────────────────────────────────────────
        const { tier: confidenceTier, uncertainty } = computeConfidence(
            processScores,
            interpretationScores,
            primaryInterpretationId,
            hotspotMetrics,
            recordSparsity,
            {
                supportingPercent: evidenceAssessment.supportingPercent,
                contradictingPercent: evidenceAssessment.contradictingPercent,
                missingCount: evidenceAssessment.missingEvidence.length,
            },
        );

        // ── 12. Scheduled monument gate ───────────────────────────────────────
        const scheduledMonumentOverlap = isScheduledMonumentOverlap(geohash6, nhleFeatures);

        // ── 13. Narrative generation ──────────────────────────────────────────
        const primaryInterpretation = interpretationScores.find(
            s => s.interpretationId === primaryInterpretationId
        );
        const primaryPeriodAffinities = primaryInterpretation?.periodAffinity ?? [];

        const narrative = generateHedgedNarrative(
            primaryInterpretationId,
            confidenceTier,
            scheduledMonumentOverlap,
            processScores,
            burialResult,
            defensiveResult.periodBranch,
            primaryPeriodAffinities,
        );

        // ── 14. Assemble result ───────────────────────────────────────────────
        const result: LandscapeInterpretation = {
            geohash6,
            processScores,
            interpretationScores,
            evidenceAssessment,
            primaryInterpretationId,
            secondaryInterpretationId,
            depositionAffinity,
            temporalPersistence,
            recordSparsity,
            uncertainty,
            scheduledMonumentOverlap,
            narrative,
            engineVersion: ENGINE_VERSION,
            generatedAt: Date.now(),
        };

        const output: LandscapeInterpretationWorkerOutput = { result };
        (self as unknown as Worker).postMessage(output);

    } catch (e) {
        const output: LandscapeInterpretationWorkerOutput = {
            error: e instanceof Error ? e.message : String(e),
        };
        (self as unknown as Worker).postMessage(output);
    }
};

export {};
