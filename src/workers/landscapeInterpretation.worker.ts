// ─── ALIE v5 Web Worker ───────────────────────────────────────────────────────
// Receives a versioned LandscapeInterpretationWorkerInput request.
// Runs the full pipeline and posts a correlated protocol response.

import type {
    LandscapeInterpretationWorkerInput,
    LandscapeInterpretation,
} from '../types/landscapeInterpretation';
import { dispatchWorkerRequest } from './protocol';

import { extractSignals, extractPASSignals, extractPersonalFindsSignals } from '../services/fieldguide/landscapeInterpretation/signalAdapters';
import { deriveTerrainRegion }                                         from '../services/fieldguide/landscapeInterpretation/regionalCalibration';
import { computePrimaryProcesses }                                     from '../services/fieldguide/landscapeInterpretation/primaryProcessEngine';
import type { LIEHints, MeasuredTerrain }                              from '../services/fieldguide/landscapeInterpretation/primaryProcessEngine';
import { computeBurialBehaviour }                                      from '../services/fieldguide/landscapeInterpretation/burialBehaviour';
import { computeDefensiveBehaviour }                                   from '../services/fieldguide/landscapeInterpretation/defensiveBehaviour';
import { computeSecondaryInterpretations, selectPrimaryAndSecondary }  from '../services/fieldguide/landscapeInterpretation/secondaryInterpretationEngine';
import { computeDepositionAffinity }                                   from '../services/fieldguide/landscapeInterpretation/depositionAffinity';
import { computeTemporalPersistence }                                  from '../services/fieldguide/landscapeInterpretation/temporalPersistence';
import { computeConfidence }                                           from '../services/fieldguide/landscapeInterpretation/confidenceModel';
import { isScheduledMonumentOverlap }                                  from '../services/fieldguide/landscapeInterpretation/scheduledMonumentGate';
import { generateHedgedNarrative }                                     from '../services/fieldguide/landscapeInterpretation/narrativeGenerator';
import { computeEvidenceAssessment }                                   from '../services/fieldguide/landscapeInterpretation/evidenceModel';

const ENGINE_VERSION = 'ALIE-2026.06.22a';

export function runLandscapeInterpretation(
    input: LandscapeInterpretationWorkerInput,
): LandscapeInterpretation {
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
            relativeReliefNorm,
            slopeGradient,
            terrainMeasured,
            pas,
            personalFinds,
        } = input;

        // ── 1. Extract adapted signals ────────────────────────────────────────
        const extractedSignals = extractSignals(nhleFeatures, aimFeatures, routeFeatures, potentialBreakdown);
        const signals = {
            ...extractedSignals,
            routeConvergence:  extractedSignals.routeConvergence  || hotspotContext?.hasRouteConvergenceHotspot === true,
            confluencePresent: extractedSignals.confluencePresent || hotspotContext?.hasCrossingHotspot === true,
            // Merge LIE terrain classification signals — these are terrain-scan-derived
            // so they are trustworthy corroboration even when historic records are sparse.
            wetlandPresent: extractedSignals.wetlandPresent || hotspotContext?.hasWetlandContext === true,
        };

        // ── 1b. Extract PAS signals (Phase B — additive only) ─────────────────
        const pasOutput = extractPASSignals(pas);

        // Merge PAS period signals into adapted signals' periodAggregates.
        // PAS signals have recordCount 0 and capped certaintyWeightedCount,
        // so they contribute to temporal persistence and period likelihood
        // without inflating monument record counts.
        if (pasOutput.periodSignals.length > 0) {
            for (const ps of pasOutput.periodSignals) {
                const existing = signals.periodAggregates.find(a => a.period === ps.period);
                if (existing) {
                    existing.certaintyWeightedCount += ps.certaintyWeightedCount;
                } else {
                    // PAS introduces a new period only into the aggregate — but P1
                    // guarantees pas_period_alignment won't fire without monument
                    // corroboration. The period signal is still capped at PAS_PERIOD_CAP.
                    signals.periodAggregates.push({ ...ps });
                }
            }
        }

        // ── 1c. Extract personal finds signals ─────────────────────────────────
        const personalFindsOutput = extractPersonalFindsSignals(personalFinds, pas);

        // Merge personal finds period signals into aggregates (same pattern as PAS).
        // Personal finds signals have recordCount 0 and capped certaintyWeightedCount.
        if (personalFindsOutput.periodSignals.length > 0) {
            for (const ps of personalFindsOutput.periodSignals) {
                const existing = signals.periodAggregates.find(a => a.period === ps.period);
                if (existing) {
                    existing.certaintyWeightedCount += ps.certaintyWeightedCount;
                } else {
                    // Personal finds MAY introduce a period (L1 — no corroboration gate).
                    signals.periodAggregates.push({ ...ps });
                }
            }
        }

        // ── 2. Derive terrain region + regional multiplier ────────────────────
        const region = deriveTerrainRegion(geologyContext);

        // ── 3. Compute six primary process scores ─────────────────────────────
        const lieHints = hotspotContext ? {
            hasBoundaryTransition: hotspotContext.hasBoundaryTransition,
            hasLandformProminence: hotspotContext.hasLandformProminence,
            hasOccupationSignal:   hotspotContext.hasOccupationSignal,
        } : undefined;

        // Measured terrain (vNext-P3): pass through when present
        const measuredTerrain: MeasuredTerrain | undefined = terrainMeasured
            ? { relativeReliefNorm: relativeReliefNorm ?? 0, slopeGradient: slopeGradient ?? 0, terrainMeasured: true }
            : undefined;

        const processScores = computePrimaryProcesses(
            signals, geologyContext, elevationM, slopePercent, aspectDegrees, region, potentialBreakdown, lieHints, measuredTerrain,
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
            signals.ceremonialRecordCount,
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
            pasOutput,
            personalFindsOutput,
        );

        // ── 11. Confidence model ──────────────────────────────────────────────
        const { tier: confidenceTier, uncertainty, contributions: confidenceContributions } = computeConfidence(
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

        // The NHLE query reports scheduled monuments in the scan context, not
        // a precise active-card overlap. Keep that as a UI safety banner and do
        // not let it replace the actual landscape interpretation narrative.
        const narrative = generateHedgedNarrative(
            primaryInterpretationId,
            confidenceTier,
            false,
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
            confidenceContributions,
            scheduledMonumentOverlap,
            narrative,
            engineVersion: ENGINE_VERSION,
            generatedAt: Date.now(),
        };

        return result;
}

if (typeof self !== 'undefined') {
    self.onmessage = async (event: MessageEvent<unknown>) => {
        const response = await dispatchWorkerRequest<
            LandscapeInterpretationWorkerInput,
            LandscapeInterpretation
        >(event.data, runLandscapeInterpretation);
        (self as unknown as Worker).postMessage(response);
    };
}

export {};
