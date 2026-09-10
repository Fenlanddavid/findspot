import { expect, it } from 'vitest';
import { regionalEvaluationCases } from '../fixtures/regionalEvaluation';
import { geology } from '../fixtures/regionalBenchmark';
import { deriveTerrainRegion } from '../../src/services/fieldguide/landscapeInterpretation/regionalCalibration';
import { extractSignals } from '../../src/services/fieldguide/landscapeInterpretation/signalAdapters';
import { computePrimaryProcesses } from '../../src/services/fieldguide/landscapeInterpretation/primaryProcessEngine';

it.each(regionalEvaluationCases)('frozen evaluation $id abstains from unsupported terrain and water evidence', ({ raw }) => {
  const context = geology(raw);
  const region = deriveTerrainRegion(context);
  expect(region).toBe('unknown');
  const scores = computePrimaryProcesses(extractSignals([], [], [], null), context, null, null, null, region, null);
  expect(scores.find(score => score.processId === 'water_relationships')?.finalScore).toBe(0);
  expect(scores.flatMap(score => score.contributingSignals)).not.toContain('water_proximity');
});
