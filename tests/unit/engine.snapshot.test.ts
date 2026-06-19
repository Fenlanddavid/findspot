// ─── Engine characterization snapshots ───────────────────────────────────────
// PURPOSE: regression fences, NOT correctness assertions.
// These snapshots scream when an "additive wrapper" silently changes engine
// output. They are not expected to be human-readable.
//
// Do NOT change snapshot values to make tests pass — investigate why the
// output changed. Only update snapshots when the engine is intentionally
// upgraded (version bump + session memory entry).
//
// Cases covered:
//   (a) Hotspot engine — terrain cluster with a hotspot
//   (b) Hotspot engine — no clusters (empty output path)
//   (c) Hotspot engine — scheduled monument (protected cluster)
//   (d) ALIE pipeline — minimal signals (low-confidence path)
//   (e) ALIE pipeline — record-rich signals (higher-confidence path)

import { describe, it, expect } from 'vitest';
import { generateHotspots } from '../../src/utils/hotspotEngine';

import { extractSignals }                                              from '../../src/services/fieldguide/landscapeInterpretation/signalAdapters';
import { deriveTerrainRegion }                                         from '../../src/services/fieldguide/landscapeInterpretation/regionalCalibration';
import { computePrimaryProcesses }                                     from '../../src/services/fieldguide/landscapeInterpretation/primaryProcessEngine';
import { computeBurialBehaviour }                                      from '../../src/services/fieldguide/landscapeInterpretation/burialBehaviour';
import { computeDefensiveBehaviour }                                   from '../../src/services/fieldguide/landscapeInterpretation/defensiveBehaviour';
import { computeSecondaryInterpretations, selectPrimaryAndSecondary }  from '../../src/services/fieldguide/landscapeInterpretation/secondaryInterpretationEngine';
import { computeDepositionAffinity }                                   from '../../src/services/fieldguide/landscapeInterpretation/depositionAffinity';
import { computeTemporalPersistence }                                  from '../../src/services/fieldguide/landscapeInterpretation/temporalPersistence';
import { computeConfidence }                                           from '../../src/services/fieldguide/landscapeInterpretation/confidenceModel';
import { isScheduledMonumentOverlap }                                  from '../../src/services/fieldguide/landscapeInterpretation/scheduledMonumentGate';
import { generateHedgedNarrative }                                     from '../../src/services/fieldguide/landscapeInterpretation/narrativeGenerator';
import { computeEvidenceAssessment }                                   from '../../src/services/fieldguide/landscapeInterpretation/evidenceModel';

import type { Cluster } from '../../src/pages/fieldGuideTypes';
import type { LandscapeInterpretationWorkerInput } from '../../src/types/landscapeInterpretation';

// ─── Fixture builders ──────────────────────────────────────────────────────────

function makeCluster(overrides: Partial<Cluster> = {}): Cluster {
  return {
    id: 'c1',
    // Pixel coordinates in the centre of a 768×768 canvas — avoids the isEdgeOfScan
    // confidence downgrade (edge = within 10% of canvas edge = < 77px).
    points: [{ x: 350, y: 350 }, { x: 400, y: 400 }, { x: 380, y: 370 }],
    minX: 350, maxX: 400, minY: 350, maxY: 400,
    type: 'Roundhouse',
    score: 72,
    number: 1,
    isProtected: false,
    confidence: 'High',
    findPotential: 0.75,
    center: [52.5, -1.5] as [number, number],
    source: 'terrain',
    // LiDAR + hydrology + multi-season satellite → anomaly ≥ 27, score ≥ 29
    // (engine filters < 25; need multiple sources to pass the gate).
    sources: ['terrain', 'hydrology', 'satellite_spring', 'satellite_summer'],
    metrics: { circularity: 0.8, density: 0.6, ratio: 1.1, area: 4200 },
    explanationLines: ['Reliable LiDAR', 'Raised dry margin'],
    ...overrides,
  };
}

/**
 * Runs the ALIE pipeline the same way the worker does, but synchronously
 * in process. Excludes generatedAt (timestamp) from the result for stable
 * snapshot comparisons.
 */
function runAliePipeline(input: LandscapeInterpretationWorkerInput) {
  const extractedSignals = extractSignals(
    input.nhleFeatures, input.aimFeatures, input.routeFeatures, input.potentialBreakdown,
  );
  const signals = {
    ...extractedSignals,
    routeConvergence:  extractedSignals.routeConvergence  || input.hotspotContext?.hasRouteConvergenceHotspot === true,
    confluencePresent: extractedSignals.confluencePresent || input.hotspotContext?.hasCrossingHotspot === true,
    wetlandPresent:    extractedSignals.wetlandPresent    || input.hotspotContext?.hasWetlandContext === true,
  };

  const region       = deriveTerrainRegion(input.geologyContext);
  const lieHints     = input.hotspotContext ? {
    hasBoundaryTransition: input.hotspotContext.hasBoundaryTransition,
    hasLandformProminence: input.hotspotContext.hasLandformProminence,
    hasOccupationSignal:   input.hotspotContext.hasOccupationSignal,
  } : undefined;
  const processScores = computePrimaryProcesses(
    signals, input.geologyContext, input.elevationM, input.slopePercent,
    input.aspectDegrees, region, input.potentialBreakdown, lieHints,
  );

  const { label: temporalPersistence } = computeTemporalPersistence(signals.periodAggregates);
  const recordSparsity = signals.recordSparsity;

  const burialResult    = computeBurialBehaviour(processScores, signals.periodAggregates, temporalPersistence, signals.hasNHLEBurialRecord);
  const defensiveResult = computeDefensiveBehaviour(processScores, signals.periodAggregates, signals.nhleDescriptions, input.slopePercent, signals.hasNHLEDefenceRecord);

  const interpretationScores = computeSecondaryInterpretations(processScores, burialResult, defensiveResult, signals.hasNHLEIndustrialRecord);
  const { primaryId: primaryInterpretationId, secondaryId: secondaryInterpretationId } = selectPrimaryAndSecondary(interpretationScores);
  const depositionAffinity = computeDepositionAffinity(processScores, interpretationScores, signals);

  const evidenceAssessment = computeEvidenceAssessment(
    processScores, interpretationScores, primaryInterpretationId,
    signals, input.geologyContext, input.slopePercent, input.aspectDegrees,
    input.potentialBreakdown, temporalPersistence,
  );

  const { tier: confidenceTier, uncertainty } = computeConfidence(
    processScores, interpretationScores, primaryInterpretationId, input.hotspotMetrics,
    recordSparsity, {
      supportingPercent:    evidenceAssessment.supportingPercent,
      contradictingPercent: evidenceAssessment.contradictingPercent,
      missingCount:         evidenceAssessment.missingEvidence.length,
    },
  );

  const scheduledMonumentOverlap = isScheduledMonumentOverlap(input.geohash6, input.nhleFeatures);

  const primaryInterpretation = interpretationScores.find(s => s.interpretationId === primaryInterpretationId);
  const narrative = generateHedgedNarrative(
    primaryInterpretationId, confidenceTier, scheduledMonumentOverlap,
    processScores, burialResult, defensiveResult.periodBranch,
    primaryInterpretation?.periodAffinity ?? [],
  );

  // Omit generatedAt — timestamps break snapshot stability.
  return {
    geohash6:                  input.geohash6,
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
  };
}

function makeAlieInput(overrides: Partial<LandscapeInterpretationWorkerInput> = {}): LandscapeInterpretationWorkerInput {
  return {
    geohash6:         'gcpvhp',
    nhleFeatures:     [],
    aimFeatures:      [],
    routeFeatures:    [],
    geologyContext:   null,
    hotspotMetrics:   null,
    hotspotContext:   {
      hasCrossingHotspot:         false,
      hasMovementHotspot:         false,
      hasRouteConvergenceHotspot: false,
      hasWetlandContext:          false,
      hasBoundaryTransition:      false,
      hasLandformProminence:      false,
      hasOccupationSignal:        false,
    },
    centerLat:        52.5,
    centerLon:        -1.5,
    elevationM:       50,
    slopePercent:     5,
    aspectDegrees:    180,
    potentialBreakdown: null,
    ...overrides,
  };
}

// ─── (a) Hotspot engine — cluster with a hotspot ──────────────────────────────

describe('hotspotEngine — (a) terrain cluster produces a hotspot', () => {
  it('snapshot', () => {
    const cluster = makeCluster();
    const result = generateHotspots([cluster]);
    // Must produce at least one hotspot from a high-confidence cluster.
    expect(result.length).toBeGreaterThan(0);
    // Snapshot the full scored output. Update only on intentional engine change.
    expect(result).toMatchSnapshot();
  });
});

// ─── (b) Hotspot engine — no clusters ────────────────────────────────────────

describe('hotspotEngine — (b) no clusters produces empty output', () => {
  it('snapshot', () => {
    const result = generateHotspots([]);
    expect(result).toHaveLength(0);
    expect(result).toMatchSnapshot();
  });
});

// ─── (c) Hotspot engine — scheduled monument (protected cluster) ───────────────

describe('hotspotEngine — (c) protected cluster (scheduled monument)', () => {
  it('snapshot', () => {
    const cluster = makeCluster({
      id: 'c-protected',
      isProtected: true,
      monumentName: 'Test Scheduled Monument',
      monumentBufferM: 100,
      type: 'Enclosure',
      confidence: 'High',
      score: 85,
    });
    const result = generateHotspots([cluster]);
    expect(result).toMatchSnapshot();
  });
});

// ─── (d) ALIE pipeline — minimal signals (low-confidence / record-sparse path) ─

describe('ALIE pipeline — (d) minimal signals (no NHLE/AIM records)', () => {
  it('snapshot', () => {
    const result = runAliePipeline(makeAlieInput());
    // Record sparsity expected when no records present.
    expect(result.recordSparsity).toBe(true);
    expect(result).toMatchSnapshot();
  });
});

// ─── (e) ALIE pipeline — scheduled monument overlap gate ─────────────────────

describe('ALIE pipeline — (e) scheduled monument overlap flag', () => {
  it('snapshot', () => {
    // Inject a fake NHLE feature that looks like a scheduled monument at the test geohash.
    // The geohash6 'gcpvhp' covers ~52.5°N, -1.5°E (English Midlands).
    // isScheduledMonumentOverlap tests whether any NHLE feature nearby is a SM.
    const smFeature = {
      id: 'nhle-sm-1',
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [-1.5, 52.5] },
      properties: {
        name: 'Test Scheduled Monument',
        designation: 'Scheduled Monument',
        listEntry: '1234567',
        grade: null,
        hyperlink: null,
        period: 'Romano British',
      },
    };
    const result = runAliePipeline(makeAlieInput({ nhleFeatures: [smFeature as any] }));
    expect(result.scheduledMonumentOverlap).toBe(true);
    expect(result).toMatchSnapshot();
  });
});
