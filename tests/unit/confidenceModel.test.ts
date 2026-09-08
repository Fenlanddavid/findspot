import { describe, expect, it } from 'vitest';
import {
  computeConfidence,
  normaliseConvergencePoints,
  type HotspotConfidenceMetrics,
} from '../../src/services/fieldguide/landscapeInterpretation/confidenceModel';

const metrics = (convergence: number): HotspotConfidenceMetrics => ({
  anomaly: 0,
  context: 0,
  convergence,
  behaviour: 0,
  penalty: 0,
  signalCount: 1,
  signalClassCount: 1,
  dataQuality: 60,
  interpretationStrength: 40,
});

describe('confidence metric units', () => {
  it('uses an explicit 0–20 convergence-points scale without a discontinuity at one', () => {
    expect(normaliseConvergencePoints(0.99)).toBeCloseTo(4.95);
    expect(normaliseConvergencePoints(1)).toBe(5);
    expect(normaliseConvergencePoints(1.01)).toBeCloseTo(5.05);
  });

  it('does not mislabel generic convergence as observation agreement', () => {
    const low = computeConfidence([], [], null, metrics(0.99), false);
    const high = computeConfidence([], [], null, metrics(1.01), false);
    expect(low.components.observationAgreement).toBe(0);
    expect(high.components.observationAgreement).toBe(0);
  });

  it('is monotonic when deduplicated observation agreement itself increases', () => {
    const low = computeConfidence([], [], null, { ...metrics(1), observationAgreement: 25 }, false);
    const high = computeConfidence([], [], null, { ...metrics(1), observationAgreement: 75 }, false);
    expect(high.components.observationAgreement).toBeGreaterThan(low.components.observationAgreement);
  });

  it('turns invalid and non-finite inputs into absent evidence', () => {
    const result = computeConfidence([], [], null, {
      ...metrics(Number.NaN),
      dataQuality: Number.POSITIVE_INFINITY,
      observationAgreement: Number.NaN,
      interpretationStrength: Number.NEGATIVE_INFINITY,
    }, false);
    expect(result.components).toEqual({ dataQuality: 0, observationAgreement: 0, interpretationStrength: 0 });
    expect(result.tier).toBe('lower');
  });
});
