import { describe, expect, it } from 'vitest';
import { geology, regionalDevelopmentCases } from '../fixtures/regionalBenchmark';
import { deriveTerrainRegion, getRegionalMultiplier } from '../../src/services/fieldguide/landscapeInterpretation/regionalCalibration';
import { computePrimaryProcesses } from '../../src/services/fieldguide/landscapeInterpretation/primaryProcessEngine';
import { extractSignals } from '../../src/services/fieldguide/landscapeInterpretation/signalAdapters';
import { computeConfidence } from '../../src/services/fieldguide/landscapeInterpretation/confidenceModel';
import { computeEvidenceAssessment } from '../../src/services/fieldguide/landscapeInterpretation/evidenceModel';

describe('regional evidence development benchmark', () => {
  it.each(regionalDevelopmentCases)('$name', ({ raw, expected }) => {
    expect(deriveTerrainRegion(geology(raw))).toBe(expected);
  });
  it('uses neutral multipliers without supported regional evidence', () => {
    expect(deriveTerrainRegion(null)).toBe('unknown');
    expect(getRegionalMultiplier('water_relationships', 'unknown')).toBe(1);
  });
  it.each(regionalDevelopmentCases)('$name does not manufacture water or landscape-edge observations', ({ raw }) => {
    const context = geology(raw);
    const scores = computePrimaryProcesses(extractSignals([], [], [], null), context, null, null, null, deriveTerrainRegion(context), null);
    expect(scores.find(score => score.processId === 'water_relationships')?.finalScore).toBe(0);
    expect(scores.flatMap(score => score.contributingSignals)).not.toContain('water_proximity');
    expect(scores.flatMap(score => score.contributingSignals)).not.toContain('marginal_ground');
    expect(computeConfidence(scores, [], null, null, true).tier).toBe('lower');
    const explanation = computeEvidenceAssessment(scores, [], null, extractSignals([], [], [], null), context,
      null, null, null, 'insufficient_chronological_evidence');
    expect(explanation.contradictingEvidence.map(item => item.id)).not.toContain('wet_ground_or_floodplain');
  });
  it('retains wet-ground caution when hydrology supports it', () => {
    const breakdown = { terrain: 0, hydro: 80, historic: 0, placeNames: 0, imagery: 0 };
    const explanation = computeEvidenceAssessment([], [], null, extractSignals([], [], [], breakdown), null,
      null, null, breakdown, 'insufficient_chronological_evidence');
    expect(explanation.contradictingEvidence.map(item => item.id)).toContain('wet_ground_or_floodplain');
  });
  it('counts a hydrology observation once despite its derived flags', () => {
    const breakdown = { terrain: 0, hydro: 80, historic: 0, placeNames: 0, imagery: 0 };
    const scores = computePrimaryProcesses(extractSignals([], [], [], breakdown), null, null, null, null, 'unknown', breakdown);
    expect(scores.find(score => score.processId === 'water_relationships')).toMatchObject({ rawScore: 40, contributingSignals: ['water_proximity'] });
  });
  it('missing and contradictory evidence cannot raise confidence', () => {
    const metrics = { anomaly: 0, context: 0, convergence: 0, behaviour: 0, penalty: 0, signalCount: 0, signalClassCount: 0, dataQuality: 90, observationAgreement: 90, interpretationStrength: 90 };
    const tiers = ['lower', 'moderate', 'high', 'very_high'];
    const complete = computeConfidence([], [], null, metrics, false, { supportingPercent: 60, contradictingPercent: 0, missingCount: 0 });
    const incomplete = computeConfidence([], [], null, metrics, true, { supportingPercent: 60, contradictingPercent: 50, missingCount: 4 });
    expect(tiers.indexOf(incomplete.tier)).toBeLessThanOrEqual(tiers.indexOf(complete.tier));
  });
});
