import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OutstandingQuestion, QuestionStatus } from '../../src/outstandingQuestions/types';

const warn = vi.hoisted(() => vi.fn(async () => {}));

vi.mock('../../src/services/diagLog', () => ({
  diagLog: { warn },
}));

import {
  applyQuestionTransition,
  QUESTION_LIFECYCLE_TRANSITIONS,
  transitionQuestion,
} from '../../src/outstandingQuestions/questionStateMachine';

function question(overrides: Partial<OutstandingQuestion> = {}): OutstandingQuestion {
  return {
    id: 'question-1', permissionId: 'permission-1', ruleId: 'MOVEMENT_NO_FINDS',
    hypothesisId: 'activity_follows_route', anchor: { lat: 52, lon: 0 },
    title: 'Question', description: 'Description', category: 'MOVEMENT',
    status: 'UNRESOLVED', confidence: 0.8, createdAt: 100, updatedAt: 100,
    generatedByScanId: 'scan-1', supportingEvidence: [], contradictingEvidence: [],
    ...overrides,
  };
}

describe('question state machine', () => {
  beforeEach(() => warn.mockClear());

  it('publishes an explicit table for every persisted lifecycle state', () => {
    expect(Object.keys(QUESTION_LIFECYCLE_TRANSITIONS).sort()).toEqual([
      'NEEDS_EVIDENCE',
      'RESOLVED_CAP_EVICTED',
      'RESOLVED_LEGACY',
      'RESOLVED_PRECONDITIONS',
      'RESOLVED_SUPERSEDED',
      'UNRESOLVED',
      'WEAKENING',
    ]);
  });

  it.each([
    ['UNRESOLVED', 'NEEDS_EVIDENCE'],
    ['NEEDS_EVIDENCE', 'UNRESOLVED'],
    ['WEAKENING', 'UNRESOLVED'],
  ] as Array<[QuestionStatus, 'UNRESOLVED' | 'NEEDS_EVIDENCE']>)(
    'moves %s to observed %s evidence',
    (from, candidateStatus) => {
      const result = transitionQuestion(
        question({ status: from }),
        { type: 'candidate_observed', candidateStatus, weakening: false },
        200,
      );

      expect(result).toEqual(expect.objectContaining({
        ok: true,
        question: expect.objectContaining({
          id: 'question-1', status: candidateStatus, consecutiveMisses: 0,
        }),
      }));
    },
  );

  it('moves a scoped miss through weakening and preconditions-cleared resolution', () => {
    const first = transitionQuestion(
      question(),
      { type: 'scoped_miss', consecutiveMisses: 1 },
      200,
    );
    expect(first).toEqual(expect.objectContaining({
      ok: true,
      question: expect.objectContaining({ status: 'WEAKENING', consecutiveMisses: 1 }),
    }));
    if (!first.ok) throw new Error(first.message);

    const second = transitionQuestion(
      first.question,
      { type: 'scoped_miss', consecutiveMisses: 2 },
      300,
    );
    expect(second).toEqual(expect.objectContaining({
      ok: true,
      question: expect.objectContaining({
        status: 'RESOLVED', resolvedReason: 'preconditions_cleared', resolvedAt: 300,
      }),
    }));
  });

  it('revives a cap-evicted state but rejects evidence for terminal resolutions', () => {
    const event = {
      type: 'candidate_observed' as const,
      candidateStatus: 'UNRESOLVED' as const,
      weakening: false,
    };
    const revived = transitionQuestion(question({
      status: 'RESOLVED', resolvedReason: 'cap_evicted', resolvedAt: 150,
    }), event, 200);
    expect(revived).toEqual(expect.objectContaining({
      ok: true,
      question: expect.objectContaining({
        id: 'question-1', status: 'UNRESOLVED', resolvedReason: undefined,
      }),
    }));

    for (const resolvedReason of ['preconditions_cleared', 'superseded'] as const) {
      const terminal = transitionQuestion(question({
        status: 'RESOLVED', resolvedReason, resolvedAt: 150,
      }), event, 200);
      expect(terminal).toMatchObject({ ok: false, code: 'illegal_transition' });
    }
  });

  it('requires a distinct immediate successor when superseding', () => {
    expect(transitionQuestion(
      question(),
      { type: 'superseded', successorId: 'question-1' },
      200,
    )).toMatchObject({ ok: false, code: 'self_supersession' });

    expect(transitionQuestion(
      question(),
      { type: 'superseded', successorId: 'question-2' },
      200,
    )).toEqual(expect.objectContaining({
      ok: true,
      question: expect.objectContaining({
        status: 'RESOLVED',
        resolvedReason: 'superseded',
        supersededByIds: ['question-2'],
      }),
    }));
  });

  it('records a non-fatal diagnostic and preserves state on a runtime violation', () => {
    const terminal = question({
      status: 'RESOLVED', resolvedReason: 'preconditions_cleared', resolvedAt: 150,
    });

    const result = applyQuestionTransition(
      terminal,
      { type: 'candidate_observed', candidateStatus: 'UNRESOLVED', weakening: false },
      200,
    );

    expect(result).toBe(terminal);
    expect(warn).toHaveBeenCalledWith(
      'questions.lifecycle',
      'Rejected illegal question lifecycle transition',
      expect.stringContaining('question-1'),
    );
  });
});
