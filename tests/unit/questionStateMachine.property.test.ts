import fc from 'fast-check';
import { describe, expect, it, vi } from 'vitest';
import type {
  OutstandingQuestion,
  QuestionStatus,
} from '../../src/outstandingQuestions/types';

vi.mock('../../src/services/diagLog', () => ({
  diagLog: { warn: vi.fn(async () => {}) },
}));

import {
  transitionQuestion,
  type QuestionLifecycleEvent,
  type QuestionTransitionErrorCode,
} from '../../src/outstandingQuestions/questionStateMachine';

type ModelState =
  | 'UNRESOLVED'
  | 'NEEDS_EVIDENCE'
  | 'WEAKENING'
  | 'RESOLVED_CAP_EVICTED'
  | 'RESOLVED_PRECONDITIONS'
  | 'RESOLVED_SUPERSEDED'
  | 'RESOLVED_LEGACY';

const ACTIVE_STATES = new Set<ModelState>([
  'UNRESOLVED',
  'NEEDS_EVIDENCE',
  'WEAKENING',
]);
const TYPED_ERRORS = new Set<QuestionTransitionErrorCode>([
  'invalid_state',
  'invalid_event',
  'illegal_transition',
  'missing_successor',
  'self_supersession',
]);

function questionFor(state: ModelState): OutstandingQuestion {
  const activeStatus = ACTIVE_STATES.has(state) ? state as QuestionStatus : 'RESOLVED';
  const resolvedReason = state === 'RESOLVED_CAP_EVICTED'
    ? 'cap_evicted'
    : state === 'RESOLVED_PRECONDITIONS'
      ? 'preconditions_cleared'
      : state === 'RESOLVED_SUPERSEDED'
        ? 'superseded'
        : undefined;
  return {
    id: 'question-1',
    permissionId: 'permission-1',
    ruleId: 'MOVEMENT_NO_FINDS',
    anchor: { lat: 52, lon: 0 },
    title: 'Question',
    description: 'Description',
    category: 'MOVEMENT',
    status: activeStatus,
    confidence: 0.8,
    createdAt: 100,
    updatedAt: 100,
    generatedByScanId: 'scan-1',
    supportingEvidence: [],
    contradictingEvidence: [],
    resolvedReason,
    resolvedAt: resolvedReason ? 100 : undefined,
  };
}

function expectedNext(
  state: ModelState,
  event: QuestionLifecycleEvent,
): ModelState | null {
  if (event.type === 'superseded') {
    if (!event.successorId.trim() || event.successorId === 'question-1') return null;
  }
  if (event.type === 'scoped_miss' && (
    !Number.isInteger(event.consecutiveMisses) || event.consecutiveMisses < 1
  )) return null;

  if (ACTIVE_STATES.has(state)) {
    switch (event.type) {
      case 'candidate_observed':
        if (event.weakening) return 'WEAKENING';
        return event.candidateStatus;
      case 'scoped_miss':
        return event.consecutiveMisses >= 2
          ? 'RESOLVED_PRECONDITIONS'
          : 'WEAKENING';
      case 'superseded':
        return 'RESOLVED_SUPERSEDED';
      case 'cap_evicted':
        return 'RESOLVED_CAP_EVICTED';
    }
  }

  if (state === 'RESOLVED_CAP_EVICTED' && event.type === 'candidate_observed') {
    if (event.weakening) return 'WEAKENING';
    return event.candidateStatus;
  }
  return null;
}

function stateOf(question: OutstandingQuestion): ModelState {
  if (question.status !== 'RESOLVED') return question.status;
  if (question.resolvedReason === 'cap_evicted') return 'RESOLVED_CAP_EVICTED';
  if (question.resolvedReason === 'preconditions_cleared') return 'RESOLVED_PRECONDITIONS';
  if (question.resolvedReason === 'superseded') return 'RESOLVED_SUPERSEDED';
  return 'RESOLVED_LEGACY';
}

const eventArbitrary: fc.Arbitrary<QuestionLifecycleEvent> = fc.oneof(
  fc.record({
    type: fc.constant('candidate_observed' as const),
    candidateStatus: fc.constantFrom('UNRESOLVED', 'NEEDS_EVIDENCE'),
    weakening: fc.boolean(),
  }),
  fc.record({
    type: fc.constant('scoped_miss' as const),
    consecutiveMisses: fc.integer({ min: -2, max: 4 }),
  }),
  fc.record({
    type: fc.constant('superseded' as const),
    successorId: fc.constantFrom('', ' ', 'question-1', 'question-2', 'question-3'),
  }),
  fc.constant({ type: 'cap_evicted' as const }),
);

describe('question state machine properties', () => {
  it('matches an independent lifecycle model for bounded arbitrary event sequences', () => {
    fc.assert(fc.property(
      fc.constantFrom<ModelState>(
        'UNRESOLVED',
        'NEEDS_EVIDENCE',
        'WEAKENING',
        'RESOLVED_CAP_EVICTED',
        'RESOLVED_PRECONDITIONS',
        'RESOLVED_SUPERSEDED',
        'RESOLVED_LEGACY',
      ),
      fc.array(eventArbitrary, { minLength: 0, maxLength: 40 }),
      (initialState, events) => {
        let modelState = initialState;
        let actual = questionFor(initialState);
        let superseded = initialState === 'RESOLVED_SUPERSEDED';

        events.forEach((event, index) => {
          const expected = expectedNext(modelState, event);
          const result = transitionQuestion(actual, event, 1_000 + index);

          if (expected === null) {
            expect(result.ok).toBe(false);
            if (!result.ok) expect(TYPED_ERRORS.has(result.code)).toBe(true);
            return;
          }

          expect(result.ok).toBe(true);
          if (!result.ok) return;
          actual = result.question;
          modelState = expected;
          expect(stateOf(actual)).toBe(modelState);
          expect(Number.isFinite(actual.updatedAt)).toBe(true);

          if (modelState === 'RESOLVED_SUPERSEDED') superseded = true;
          if (superseded) {
            expect(stateOf(actual)).toBe('RESOLVED_SUPERSEDED');
          }
        });
      },
    ), { numRuns: 300 });
  });
});
