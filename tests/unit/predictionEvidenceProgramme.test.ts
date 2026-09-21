import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db, type HotspotPrediction } from '../../src/db';
import type { Hotspot } from '../../src/pages/fieldGuideTypes';
import { recordHotspotPredictions, aggregateAndSweepHotspotPredictions } from '../../src/services/hotspotPredictionService';
import { summarizePredictionEvidence, loadPredictionEvidenceDiagnostics } from '../../src/services/predictionCalibration';
import { PREDICTION_EVIDENCE_VERSION, countPrediction } from '../../src/shared/predictionEvidence';
import { applyGeologyModifier, applyPASDensityModifiers, enhanceHotspotsWithHistoric } from '../../src/engines/hotspot/hotspotEngine';
import { assertPredictionCapture, assertFrozenPredictionEvidence } from '../../src/services/persistenceValidation/predictionEvidence';
import { validateBackupData } from '../../src/services/backup/validation';
import { applyValidatedBackup } from '../../src/services/backup/atomicRestore';
import { createBackupRecoveryReport } from '../../src/services/backup/recoveryReport';
import { deletePermissionCascade } from '../../src/services/permissionMutations';

const NOW = Date.parse('2026-09-20T10:00:00Z');
function hotspot(overrides: Partial<Hotspot> = {}): Hotspot {
  return {
    id: 'target-a', number: 1, score: 65, confidence: 'Developing Signal',
    classification: 'Settlement Edge Candidate', classificationReason: 'Candidate',
    type: 'General Activity Zone', memberIds: ['cluster-a'], center: [-1, 52],
    bounds: [[-1.001, 51.999], [-0.999, 52.001]],
    explanation: [{ tag: 'lidar_relief', text: 'Visible reason' }],
    evidenceCapture: {
      scoring: { 'anomaly.lidar_relief': 18, 'context.raised_footing': 8 },
      suppression: ['scan_edge'], context: [], tags: ['lidar_relief', 'raised_footing', 'scan_edge'],
    },
    confidenceSuppressors: ['scan_edge'],
    metrics: { anomaly: 25, context: 15, behaviour: 12, convergence: 13, penalty: 0, signalCount: 3, signalClassCount: 3 },
    ...overrides,
  };
}
function prediction(overrides: Partial<HotspotPrediction> = {}): HotspotPrediction {
  return {
    id: 'p1', engineVersion: 'test-engine', evidenceVersion: PREDICTION_EVIDENCE_VERSION,
    confidence: 'Strong Signal', classification: 'Candidate', surfacedAt: NOW - 1000,
    permissionId: 'permission-1', sessionId: null, center: [-1, 52],
    bounds: [[-1.001, 51.999], [-0.999, 52.001]], geohash6: 'gcpuuz', outcome: 'unvisited', ...overrides,
  };
}

beforeEach(async () => { await db.open(); });
afterEach(async () => { await db.delete(); });

describe('prediction evidence programme', () => {
  it('records the complete snapshot once, preserves outcomes on replay, and distinguishes a new scan', async () => {
    const context = { scanId: 'scan-a', surfacedAt: NOW, permissionId: 'permission-1' };
    await Promise.all([recordHotspotPredictions([hotspot()], context), recordHotspotPredictions([hotspot()], context)]);
    const row = (await db.hotspotPredictions.toArray())[0];
    expect(await db.hotspotPredictions.count()).toBe(1);
    expect(row).toMatchObject({ score: 65, confidence: 'Developing Signal', captureVersion: 1,
      explanationTags: ['lidar_relief'], evidenceCapture: { tags: ['lidar_relief', 'raised_footing', 'scan_edge'] } });
    await db.hotspotPredictions.update(row.id, { outcome: 'find_recorded', associatedFindIds: ['find-a'], resolutionEvidence: 'reported' });
    await recordHotspotPredictions([hotspot({ score: 90 })], { ...context, surfacedAt: NOW + 500 });
    expect(await db.hotspotPredictions.get(row.id)).toMatchObject({ score: 65, surfacedAt: NOW, outcome: 'find_recorded' });
    await recordHotspotPredictions([hotspot()], { ...context, scanId: 'scan-b' });
    expect(await db.hotspotPredictions.count()).toBe(2);
  });

  it('preserves tags, score, overlap geometry and find identity through sweep and actual backup restore', async () => {
    const context = { scanId: 'scan-a', surfacedAt: NOW, permissionId: null };
    await recordHotspotPredictions([hotspot()], context);
    const row = (await db.hotspotPredictions.toArray())[0];
    await db.hotspotPredictions.update(row.id, { sessionId: 'historical-session', outcome: 'find_recorded', associatedFindIds: ['shared-find'], resolutionEvidence: 'find' });
    const before = await loadPredictionEvidenceDiagnostics();
    expect(before.live.cohorts[0].counts.findOnlyHitCount).toBe(1);
    expect(await aggregateAndSweepHotspotPredictions(NOW + 2000, 1000)).toBe(1);
    expect(await aggregateAndSweepHotspotPredictions(NOW + 2000, 1000)).toBe(0);
    const archived = (await db.hotspotPredictionAggregates.toArray())[0];
    expect(archived.snapshot).toMatchObject({ score: 65, evidenceCapture: hotspot().evidenceCapture,
      bounds: hotspot().bounds, associatedFindIds: ['shared-find'], scanId: 'scan-a' });
    assertFrozenPredictionEvidence(archived);
    const backup = validateBackupData({ projects: [], hotspotPredictionAggregates: [archived] });
    await applyValidatedBackup(backup, null, [], createBackupRecoveryReport(backup, 'drill', new Date(NOW + 3000).toISOString()), db);
    expect(await db.hotspotPredictionAggregates.get(archived.id)).toEqual(archived);
    const after = await loadPredictionEvidenceDiagnostics();
    expect(after.live.cohorts).toEqual([]);
    expect(after.frozen.cohorts[0].counts).toEqual(before.live.cohorts[0].counts);
    await recordHotspotPredictions([hotspot()], context);
    expect(await db.hotspotPredictions.count()).toBe(0);
    expect(await db.hotspotPredictionAggregates.count()).toBe(1);
  });

  it('keeps refresh/sweep permission scope aligned and removes archived snapshots on permission deletion', async () => {
    await db.hotspotPredictions.bulkPut([prediction({ id: 'one' }), prediction({ id: 'two', permissionId: 'permission-2' })]);
    expect(await aggregateAndSweepHotspotPredictions(NOW + 1000, 1000, 'permission-1')).toBe(1);
    expect((await db.hotspotPredictions.toArray()).map(row => row.id)).toEqual(['two']);
    await deletePermissionCascade('permission-1');
    expect(await db.hotspotPredictionAggregates.count()).toBe(0);
    expect(await db.hotspotPredictions.count()).toBe(1);
  });

  it('does not treat unknown capture as an empty observed tag set, and rejects invalid evidence', () => {
    expect(() => assertPredictionCapture(prediction())).not.toThrow();
    expect(() => assertPredictionCapture({ score: Number.NaN })).toThrow();
    expect(() => assertPredictionCapture({ captureVersion: 1, score: 40 })).toThrow();
    expect(() => assertPredictionCapture({ evidenceCapture: { scoring: { bad: Infinity }, tags: [], suppression: [], context: [] } })).toThrow();
    const summary = summarizePredictionEvidence([prediction(), prediction({ id: 'old', legacyOutcome: 'hit', outcome: 'find_recorded' })]);
    expect(summary.legacyExcludedCount).toBe(1);
    expect(summary.cohorts[0].captureVersion).toBeUndefined();
  });

  it('counts reported, mixed, tracked-only, find-only and unresolved exposures without manufacturing misses', () => {
    const rows = [
      prediction({ id: 'reported', outcome: 'find_recorded', resolutionEvidence: 'reported', associatedFindIds: ['shared'] }),
      prediction({ id: 'mixed', outcome: 'find_recorded', resolutionEvidence: 'mixed', associatedFindIds: ['shared'] }),
      prediction({ id: 'search', outcome: 'search_reported', resolutionEvidence: 'reported' }),
      prediction({ id: 'negative', outcome: 'no_relevant_find_reported', resolutionEvidence: 'reported' }),
      prediction({ id: 'tracked', outcome: 'visited_tracked', resolutionEvidence: 'tracked' }),
      prediction({ id: 'tracked-find', outcome: 'find_recorded', resolutionEvidence: 'tracked' }),
      prediction({ id: 'find', outcome: 'find_recorded', resolutionEvidence: 'find' }),
      prediction(),
    ];
    const cohort = summarizePredictionEvidence(rows).cohorts[0];
    expect(cohort.counts).toMatchObject({ surfacedCount: 8, searchedCount: 4, hitCount: 2,
      trackedVisitCount: 3, trackedFindCount: 1, findOnlyHitCount: 1, explicitNoFindCount: 1, unresolvedCount: 2 });
    expect(cohort.sharedFindCount).toBe(1);
    expect(cohort.uniqueFindCount).toBe(1);
    expect(countPrediction(prediction({ permissionId: null }))).toMatchObject({ unscopedCount: 1, searchedCount: 0, hitCount: 0 });
    expect(summarizePredictionEvidence([...rows, prediction({ engineVersion: 'other' }), prediction({ evidenceVersion: 1 })]).cohorts).toHaveLength(3);
  });

  it('preserves bands and target ordering with contextual geology/PAS and reapplies local suppression after historic enrichment', () => {
    const inputs = [hotspot(), hotspot({ id: 'target-b', score: 63, number: 2 })];
    const context = { scoreModifier: 9 } as Parameters<typeof applyGeologyModifier>[1];
    expect(applyGeologyModifier(inputs, context).hotspots).toBe(inputs);
    const pas = applyPASDensityModifiers(inputs, { c: 600, p: ['ROMAN'], t: [] }, 'Roman');
    expect(pas.map(row => [row.id, row.score, row.confidence])).toEqual(inputs.map(row => [row.id, row.score, row.confidence]));
    expect(pas[0].evidenceCapture?.context).toContain('pas_density');
    const historic = enhanceHotspotsWithHistoric([hotspot()], [], [[-1, 52]], []);
    expect(historic[0].confidence).toBe('Developing Signal');
    expect(historic[0].evidenceCapture?.scoring['historic.scheduled_monument']).toBe(5);
    expect(historic[0].evidenceCapture?.tags).toContain('raised_footing');
  });
});
