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
import type { MeasuredTerrain }                                        from '../../src/services/fieldguide/landscapeInterpretation/primaryProcessEngine';
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
import type { LandscapeInterpretationWorkerInput, PrimaryProcessScore } from '../../src/types/landscapeInterpretation';

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
  const measuredTerrain = input.terrainMeasured
    ? { relativeReliefNorm: input.relativeReliefNorm ?? 0, slopeGradient: input.slopeGradient ?? 0, terrainMeasured: true as const }
    : undefined;
  const processScores = computePrimaryProcesses(
    signals, input.geologyContext, input.elevationM, input.slopePercent,
    input.aspectDegrees, region, input.potentialBreakdown, lieHints, measuredTerrain,
  );

  const { label: temporalPersistence } = computeTemporalPersistence(signals.periodAggregates);
  const recordSparsity = signals.recordSparsity;

  const burialResult    = computeBurialBehaviour(processScores, signals.periodAggregates, temporalPersistence, signals.hasNHLEBurialRecord);
  const defensiveResult = computeDefensiveBehaviour(processScores, signals.periodAggregates, signals.nhleDescriptions, input.slopePercent, signals.hasNHLEDefenceRecord);

  const interpretationScores = computeSecondaryInterpretations(processScores, burialResult, defensiveResult, signals.hasNHLEIndustrialRecord, signals.ceremonialRecordCount);
  const { primaryId: primaryInterpretationId, secondaryId: secondaryInterpretationId } = selectPrimaryAndSecondary(interpretationScores);
  const depositionAffinity = computeDepositionAffinity(processScores, interpretationScores, signals);

  const evidenceAssessment = computeEvidenceAssessment(
    processScores, interpretationScores, primaryInterpretationId,
    signals, input.geologyContext, input.slopePercent, input.aspectDegrees,
    input.potentialBreakdown, temporalPersistence,
  );

  const { tier: confidenceTier, uncertainty, contributions: confidenceContributions } = computeConfidence(
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
    confidenceContributions,
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
    // Realistic SM property shape: Name (capital N) is the asset name, never
    // contains "scheduled". This would have defeated the old name-matching gate.
    const smFeature = {
      id: 'nhle-sm-1',
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [-1.5, 52.5] },
      properties: {
        Name: 'Roman fort 500m NE of test village',
        ListEntry: '1234567',
      },
    };
    const result = runAliePipeline(makeAlieInput({ nhleFeatures: [smFeature as any] }));
    expect(result.scheduledMonumentOverlap).toBe(true);
    expect(result).toMatchSnapshot();
  });
});

// ─── P3 fallback invariant ────────────────────────────────────────────────────
// Guards that the no-measured-terrain path is IDENTICAL to omitting the param.
// If these fail, P3 changes leaked into the proxy/fallback path.

// Shared helper: builds the 8 positional args that computePrimaryProcesses
// already receives in runAliePipeline, so tests mirror the real call exactly.
function buildProcessArgs(input = makeAlieInput()) {
  const ex = extractSignals(
    input.nhleFeatures, input.aimFeatures, input.routeFeatures, input.potentialBreakdown,
  );
  const signals = {
    ...ex,
    routeConvergence:  ex.routeConvergence  || !!input.hotspotContext?.hasRouteConvergenceHotspot,
    confluencePresent: ex.confluencePresent || !!input.hotspotContext?.hasCrossingHotspot,
    wetlandPresent:    ex.wetlandPresent    || !!input.hotspotContext?.hasWetlandContext,
  };
  const region   = deriveTerrainRegion(input.geologyContext);
  const lieHints = input.hotspotContext ? {
    hasBoundaryTransition: input.hotspotContext.hasBoundaryTransition,
    hasLandformProminence: input.hotspotContext.hasLandformProminence,
    hasOccupationSignal:   input.hotspotContext.hasOccupationSignal,
  } : undefined;
  return {
    signals,
    geologyContext:    input.geologyContext,
    elevationM:        input.elevationM,
    slopePercent:      input.slopePercent,
    aspectDegrees:     input.aspectDegrees,
    region,
    potentialBreakdown: input.potentialBreakdown,
    lieHints,
  };
}

function callProcessEngine(
  args: ReturnType<typeof buildProcessArgs>,
  measuredTerrain?: MeasuredTerrain,
): PrimaryProcessScore[] {
  return computePrimaryProcesses(
    args.signals, args.geologyContext, args.elevationM, args.slopePercent,
    args.aspectDegrees, args.region, args.potentialBreakdown, args.lieHints,
    measuredTerrain,
  );
}

describe('P3 fallback invariant — no measured terrain does not drift processScores', () => {
  it('omitting measuredTerrain === passing terrainMeasured:false', () => {
    const args    = buildProcessArgs();
    const without = callProcessEngine(args);
    const falsey  = callProcessEngine(args, { terrainMeasured: false, relativeReliefNorm: 0, slopeGradient: 0 });
    expect(falsey).toEqual(without);
  });

  it('zero values with terrainMeasured:false do not alter any score', () => {
    const args    = buildProcessArgs();
    const base    = callProcessEngine(args);
    const zeroed  = callProcessEngine(args, { terrainMeasured: false, relativeReliefNorm: 0.99, slopeGradient: 0.99 });
    // Even with extreme values, terrainMeasured:false must not change output
    expect(zeroed).toEqual(base);
  });

  it('the existing (d)/(e) snapshot tests are the regression fence', () => {
    // (d) and (e) pass NO measured terrain. After P3 they must stay green — if
    // they moved, the measured path leaked into the fallback path.
    // This test is a documentation marker: the snapshots do the real assertion.
    expect(true).toBe(true);
  });
});

// ─── P3 measured delta ────────────────────────────────────────────────────────
// Verifies that measured terrain boosts the right processes in the right
// direction, and leaves unrelated processes untouched.

describe('P3 measured delta — applied only when terrainMeasured:true, correct direction', () => {
  const getScore = (scores: PrimaryProcessScore[], id: string) =>
    scores.find(p => p.processId === id)?.finalScore ?? 0;

  it('raised + low-gradient lifts settlement and prominence', () => {
    const args = buildProcessArgs();
    const base = callProcessEngine(args);
    const meas = callProcessEngine(args, {
      terrainMeasured:    true,
      relativeReliefNorm: 0.6,   // clearly raised
      slopeGradient:      0.05,  // low gradient → good for settlement
    });
    expect(getScore(meas, 'occupation_potential')).toBeGreaterThan(getScore(base, 'occupation_potential'));
    expect(getScore(meas, 'landscape_prominence')).toBeGreaterThan(getScore(base, 'landscape_prominence'));
  });

  it('low gradient lifts movement', () => {
    const args = buildProcessArgs();
    const base = callProcessEngine(args);
    const meas = callProcessEngine(args, {
      terrainMeasured:    true,
      relativeReliefNorm: 0,
      slopeGradient:      0.05, // below 0.12 threshold
    });
    expect(getScore(meas, 'movement')).toBeGreaterThanOrEqual(getScore(base, 'movement'));
  });

  it('boundary_relationships is unaffected by measured terrain (no P3 contribution)', () => {
    const args = buildProcessArgs();
    const base = callProcessEngine(args);
    const meas = callProcessEngine(args, {
      terrainMeasured:    true,
      relativeReliefNorm: 0.8,
      slopeGradient:      0.02,
    });
    expect(getScore(meas, 'boundary_relationships')).toBe(getScore(base, 'boundary_relationships'));
  });

  it('resource_exploitation is unaffected by measured terrain', () => {
    const args = buildProcessArgs();
    const base = callProcessEngine(args);
    const meas = callProcessEngine(args, {
      terrainMeasured:    true,
      relativeReliefNorm: 0.8,
      slopeGradient:      0.02,
    });
    expect(getScore(meas, 'resource_exploitation')).toBe(getScore(base, 'resource_exploitation'));
  });

  it('measured signals appear in contributingSignals only when terrainMeasured:true', () => {
    const args = buildProcessArgs();
    const base = callProcessEngine(args);
    const meas = callProcessEngine(args, {
      terrainMeasured:    true,
      relativeReliefNorm: 0.6,
      slopeGradient:      0.05,
    });

    const baseSignals = base.flatMap(p => p.contributingSignals);
    const measSignals = meas.flatMap(p => p.contributingSignals);

    // Measured signals absent from base
    expect(baseSignals).not.toContain('raised_relief_measured');
    expect(baseSignals).not.toContain('low_gradient_measured');
    // Present in measured path
    expect(measSignals).toContain('raised_relief_measured');
    expect(measSignals).toContain('low_gradient_measured');
  });

  it('sub-threshold relief does NOT push raised_relief_measured', () => {
    const args = buildProcessArgs();
    const meas = callProcessEngine(args, {
      terrainMeasured:    true,
      relativeReliefNorm: 0.01, // below 0.05 threshold
      slopeGradient:      0.05,
    });
    const signals = meas.flatMap(p => p.contributingSignals);
    expect(signals).not.toContain('raised_relief_measured');
  });
});

// ─── P4 confidence contributions ─────────────────────────────────────────────
// Verifies the contributions[] output is well-formed and the headline tier
// is preserved alongside it (extended, not replaced).

describe('P4 confidence — contributions array is well-formed, tier unchanged', () => {
  const minimalProcess: PrimaryProcessScore = {
    processId:          'movement',
    rawScore:           65,
    regionalMultiplier: 1,
    finalScore:         65,
    contributingSignals: [],
  };

  it('returns contributions[] with at least one entry', () => {
    const res = computeConfidence(
      [minimalProcess],
      [],
      null,
      null,
      false,
    );
    expect(Array.isArray(res.contributions)).toBe(true);
    expect(res.contributions.length).toBeGreaterThan(0);
  });

  it('every contribution has label (string), sign (+/−), weight (number ≥ 0)', () => {
    const res = computeConfidence(
      [minimalProcess],
      [],
      null,
      null,
      false,
      { supportingPercent: 60, contradictingPercent: 10, missingCount: 2 },
    );
    for (const ctr of res.contributions) {
      expect(typeof ctr.label).toBe('string');
      expect(ctr.label.length).toBeGreaterThan(0);
      expect(['+', '−']).toContain(ctr.sign);
      expect(typeof ctr.weight).toBe('number');
      expect(ctr.weight).toBeGreaterThanOrEqual(0);
    }
  });

  it('tier and uncertainty are still present in the return value', () => {
    const res = computeConfidence(
      [minimalProcess],
      [],
      null,
      null,
      false,
    );
    expect(res.tier).toBeDefined();
    expect(['very_high', 'high', 'moderate', 'lower']).toContain(res.tier);
    expect(res.uncertainty).toBeDefined();
    expect(['low', 'moderate', 'high']).toContain(res.uncertainty);
  });

  it('record sparsity produces a − contribution labelled for coverage', () => {
    const res = computeConfidence(
      [minimalProcess],
      [],
      null,
      null,
      true, // recordSparsity = true
    );
    const labels = res.contributions.map(c => c.label);
    expect(labels.some(l => l.toLowerCase().includes('heritage') || l.toLowerCase().includes('coverage') || l.toLowerCase().includes('record'))).toBe(true);
  });

  it('contradicting evidence produces a − contribution', () => {
    const res = computeConfidence(
      [minimalProcess],
      [],
      null,
      null,
      false,
      { supportingPercent: 20, contradictingPercent: 40, missingCount: 0 },
    );
    const minus = res.contributions.filter(c => c.sign === '−');
    expect(minus.length).toBeGreaterThan(0);
    expect(minus.some(c => c.label.toLowerCase().includes('contradict'))).toBe(true);
  });

  it('contributions are ordered by weight descending', () => {
    const res = computeConfidence(
      [minimalProcess],
      [],
      null,
      null,
      true,
      { supportingPercent: 70, contradictingPercent: 20, missingCount: 3 },
    );
    for (let i = 1; i < res.contributions.length; i++) {
      expect(res.contributions[i - 1].weight).toBeGreaterThanOrEqual(res.contributions[i].weight);
    }
  });
});
