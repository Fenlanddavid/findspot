import { describe, expect, it } from 'vitest';
import {
  FIELDWORK_PARTLY_PCT,
  FIELDWORK_WELL_PCT,
  fieldworkProgress,
  interpretationDirection,
  investigationPriority,
  isControlledObservation,
  metricsChanged,
  resolvedOutcomeFor,
} from '../../src/outstandingQuestions/investigationState';
import type { HypothesisId, OutstandingQuestion, QuestionNote } from '../../src/outstandingQuestions/types';

function question(overrides: Partial<OutstandingQuestion> = {}): OutstandingQuestion {
  return {
    id: 'question-1', permissionId: 'permission-1', ruleId: 'MOVEMENT_NO_FINDS',
    hypothesisId: 'activity_follows_route', anchor: { lat: 52, lon: 0 },
    title: 'Investigation', description: 'Description', category: 'MOVEMENT',
    status: 'UNRESOLVED', confidence: 0.8, createdAt: 100, updatedAt: 1_000,
    generatedByScanId: 'scan-1', supportingEvidence: [], contradictingEvidence: [],
    initialMetrics: { localCoveragePct: 0, findsNearCount: 0, bufferM: 200 },
    metrics: { localCoveragePct: 60, findsNearCount: 0, bufferM: 200 },
    ...overrides,
  };
}

function note(type: QuestionNote['type'], overrides: Partial<QuestionNote> = {}): QuestionNote {
  return {
    id: `note-${type}`, questionId: 'question-1', author: 'user', type,
    createdAt: 1_100, ...overrides,
  };
}

describe('fieldwork progress', () => {
  it('is fail-safe when coverage is absent and respects both named thresholds', () => {
    expect(fieldworkProgress(question({ metrics: { bufferM: 200 } }))).toBe('UNTESTED');
    expect(fieldworkProgress(question({ metrics: { bufferM: 200, localCoveragePct: FIELDWORK_PARTLY_PCT - 1 } }))).toBe('UNTESTED');
    expect(fieldworkProgress(question({ metrics: { bufferM: 200, localCoveragePct: FIELDWORK_PARTLY_PCT } }))).toBe('PARTLY_TESTED');
    expect(fieldworkProgress(question({ metrics: { bufferM: 200, localCoveragePct: FIELDWORK_WELL_PCT } }))).toBe('WELL_TESTED');
  });

  it('is blocked by a ground-inaccessible observation newer than the latest scan', () => {
    expect(fieldworkProgress(question(), [note('ground_inaccessible')])).toBe('BLOCKED');
    expect(fieldworkProgress(question(), [note('ground_inaccessible', { createdAt: 999 })])).toBe('WELL_TESTED');
  });
});

describe('interpretation direction tables', () => {
  const cases: Array<{
    name: string;
    hypothesisId: HypothesisId;
    finds: number;
    coverage: number;
    expected: ReturnType<typeof interpretationDirection>;
  }> = [
    { name: 'movement supporting', hypothesisId: 'activity_follows_route', finds: 1, coverage: 60, expected: 'SUPPORTING' },
    { name: 'movement contrary', hypothesisId: 'activity_follows_route', finds: 0, coverage: 60, expected: 'CONTRARY' },
    { name: 'movement no change', hypothesisId: 'activity_follows_route', finds: 0, coverage: 30, expected: 'NO_CHANGE' },
    { name: 'Roman-road supporting', hypothesisId: 'activity_associated_with_roman_road', finds: 1, coverage: 60, expected: 'SUPPORTING' },
    { name: 'Roman-road contrary', hypothesisId: 'activity_associated_with_roman_road', finds: 0, coverage: 60, expected: 'CONTRARY' },
    { name: 'settlement supporting at two finds', hypothesisId: 'settlement_signal_reflects_activity', finds: 2, coverage: 60, expected: 'SUPPORTING' },
    { name: 'settlement one-find no change', hypothesisId: 'settlement_signal_reflects_activity', finds: 1, coverage: 60, expected: 'NO_CHANGE' },
    { name: 'settlement contrary', hypothesisId: 'settlement_signal_reflects_activity', finds: 0, coverage: 60, expected: 'CONTRARY' },
    { name: 'historic route supporting', hypothesisId: 'route_signal_is_historic', finds: 1, coverage: 60, expected: 'SUPPORTING' },
    { name: 'historic route zero-find mixed', hypothesisId: 'route_signal_is_historic', finds: 0, coverage: 60, expected: 'MIXED' },
    { name: 'historic route partly tested no change', hypothesisId: 'route_signal_is_historic', finds: 0, coverage: 30, expected: 'NO_CHANGE' },
  ];

  for (const row of cases) {
    it(row.name, () => {
      expect(interpretationDirection(question({
        hypothesisId: row.hypothesisId,
        metrics: { localCoveragePct: row.coverage, findsNearCount: row.finds, bufferM: 200 },
      }))).toBe(row.expected);
    });
  }

  it('uses controlled conditions observations as a mixed modifier', () => {
    for (const hypothesisId of [
      'activity_follows_route',
      'settlement_signal_reflects_activity',
      'route_signal_is_historic',
      'activity_associated_with_roman_road',
    ] as const) {
      expect(interpretationDirection(question({ hypothesisId }), [note('poor_conditions')])).toBe('MIXED');
      expect(interpretationDirection(question({ hypothesisId }), [note('modern_disturbance')])).toBe('MIXED');
    }
  });

  it('always returns STILL_UNTESTED before applying a hypothesis table', () => {
    for (const hypothesisId of [
      'activity_follows_route',
      'settlement_signal_reflects_activity',
      'route_signal_is_historic',
      'activity_associated_with_roman_road',
    ] as const) {
      expect(interpretationDirection(question({
        hypothesisId,
        metrics: { localCoveragePct: 0, findsNearCount: 5, bufferM: 200 },
      }), [note('poor_conditions')])).toBe('STILL_UNTESTED');
    }
  });

  it('does not treat a missing find metric as zero evidence', () => {
    expect(interpretationDirection(question({
      metrics: { localCoveragePct: 80, bufferM: 200 },
    }))).toBe('NO_CHANGE');
  });
});

describe('priority and evidence comparison', () => {
  it('keeps free text outside controlled observation state', () => {
    expect(isControlledObservation(note('searched_nothing'))).toBe(true);
    expect(isControlledObservation(note('freeform'))).toBe(false);
  });

  it('lets a fresh lower-confidence investigation outrank one untouched for five scans', () => {
    const oldPriority = investigationPriority(0.9, 5);
    const freshPriority = investigationPriority(0.5, 0);
    expect(oldPriority).toBeLessThan(freshPriority);
    expect(0.9).toBe(0.9);
  });

  it('never decays below 30% of live confidence', () => {
    expect(investigationPriority(0.8, 100)).toBeCloseTo(0.24);
  });

  it('detects changes across every persisted metric', () => {
    const baseline = { localCoveragePct: 20, findsNearCount: 0, bufferM: 200 };
    expect(metricsChanged(baseline, { ...baseline })).toBe(false);
    expect(metricsChanged(baseline, { ...baseline, localCoveragePct: 21 })).toBe(true);
    expect(metricsChanged(baseline, { ...baseline, findsNearCount: 1 })).toBe(true);
    expect(metricsChanged(baseline, { ...baseline, bufferM: 250 })).toBe(true);
  });
});

describe('closure outcomes', () => {
  it('maps adequate supporting, contrary and mixed directions', () => {
    expect(resolvedOutcomeFor(question({
      metrics: { localCoveragePct: 70, findsNearCount: 1, bufferM: 200 },
    }), [])).toBe('likely_supported');
    expect(resolvedOutcomeFor(question(), [])).toBe('likely_unsupported');
    expect(resolvedOutcomeFor(question({ hypothesisId: 'route_signal_is_historic' }), []))
      .toBe('inconclusive_adequate');
  });

  it('uses WELL_TESTED alone before session evidence exists', () => {
    expect(resolvedOutcomeFor(question(), [])).toBe('likely_unsupported');
  });

  it('requires two distinct sessions once session evidence exists', () => {
    const oneSession = [note('session_crossed', { author: 'system', sessionId: 'session-1' })];
    const twoSessions = [
      ...oneSession,
      note('session_crossed', { id: 'note-session-2', author: 'system', sessionId: 'session-2' }),
    ];
    expect(resolvedOutcomeFor(question(), oneSession)).toBe('not_applicable');
    expect(resolvedOutcomeFor(question(), twoSessions)).toBe('likely_unsupported');
  });

  it('does not let free text create session adequacy', () => {
    expect(resolvedOutcomeFor(question(), [
      note('freeform', { sessionId: 'session-1', text: 'Unstructured note' }),
    ])).toBe('likely_unsupported');
  });

  it('never assigns an adequate outcome to missing coverage', () => {
    expect(resolvedOutcomeFor(question({ metrics: { bufferM: 200, findsNearCount: 0 } }), []))
      .toBe('not_applicable');
  });
});
