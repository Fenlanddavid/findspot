import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { HotspotPrediction } from '../../src/db';
import { summarizePredictionEvidence } from '../../src/services/predictionCalibration';
import { PREDICTION_EVIDENCE_VERSION } from '../../src/shared/predictionEvidence';
const state = vi.hoisted(() => ({ values: [] as unknown[] }));
vi.mock('dexie-react-hooks', () => ({ useLiveQuery: () => state.values.shift() }));
import { ScanAccuracyCard } from '../../src/components/ScanAccuracyCard';

function render(outcome?: HotspotPrediction['outcome'], resolutionEvidence?: HotspotPrediction['resolutionEvidence']) {
  const rows: HotspotPrediction[] = outcome ? [{
    id: 'p1', engineVersion: 'engine-1', evidenceVersion: PREDICTION_EVIDENCE_VERSION,
    confidence: 'Strong Signal', classification: 'candidate', surfacedAt: 1,
    permissionId: 'permission-1', sessionId: null, center: [0, 52],
    bounds: [[0, 52], [0.001, 52.001]], geohash6: 'gcpuuz', outcome, resolutionEvidence,
  }] : [];
  state.values = [summarizePredictionEvidence(rows), []];
  return renderToStaticMarkup(<ScanAccuracyCard permissionId="permission-1" />);
}

describe('prediction evidence presentation', () => {
  it('renders its own empty state without finds or undug signals', () => {
    expect(render()).toContain('No current prediction evidence');
    expect(render()).not.toContain('Engine Calibration');
  });
  it.each([
    ['visited_tracked', 'tracked'], ['find_recorded', 'find'], ['find_recorded', 'tracked'],
  ] as const)('renders %s / %s without suggesting a searched success rate', (outcome, evidence) => {
    const html = render(outcome, evidence);
    expect(html).toContain('No accepted search reports yet');
    expect(html).not.toContain('Well calibrated');
    expect(html).not.toContain('100%');
  });
  it('renders reported find counts without the legacy hit token', () => {
    const html = render('find_recorded', 'reported');
    expect(html).toContain('1 of 1');
    expect(html).not.toContain('No accepted search reports yet');
  });
});
