import { diagLog } from '../services/diagLog';
import type {
  OutstandingQuestion,
  QuestionCandidate,
  QuestionStatus,
} from './types';

export type QuestionLifecycleState =
  | 'UNRESOLVED'
  | 'NEEDS_EVIDENCE'
  | 'WEAKENING'
  | 'RESOLVED_CAP_EVICTED'
  | 'RESOLVED_PRECONDITIONS'
  | 'RESOLVED_SUPERSEDED'
  | 'RESOLVED_LEGACY';

export type QuestionLifecycleTransitionKey =
  | 'OBSERVED_UNRESOLVED'
  | 'OBSERVED_NEEDS_EVIDENCE'
  | 'OBSERVED_WEAKENING'
  | 'SCOPED_MISS'
  | 'PRECONDITIONS_CLEARED'
  | 'SUPERSEDED'
  | 'CAP_EVICTED';

export type QuestionLifecycleEvent =
  | {
      type: 'candidate_observed';
      candidateStatus: QuestionCandidate['status'];
      weakening: boolean;
    }
  | { type: 'scoped_miss'; consecutiveMisses: number }
  | { type: 'superseded'; successorId: string }
  | { type: 'cap_evicted' };

export type QuestionTransitionErrorCode =
  | 'invalid_state'
  | 'invalid_event'
  | 'illegal_transition'
  | 'missing_successor'
  | 'self_supersession';

export type QuestionTransitionResult =
  | { ok: true; question: OutstandingQuestion }
  | { ok: false; code: QuestionTransitionErrorCode; message: string };

type TransitionRow = Partial<Record<QuestionLifecycleTransitionKey, QuestionLifecycleState>>;

const ACTIVE_TRANSITIONS: TransitionRow = {
  OBSERVED_UNRESOLVED: 'UNRESOLVED',
  OBSERVED_NEEDS_EVIDENCE: 'NEEDS_EVIDENCE',
  OBSERVED_WEAKENING: 'WEAKENING',
  SCOPED_MISS: 'WEAKENING',
  PRECONDITIONS_CLEARED: 'RESOLVED_PRECONDITIONS',
  SUPERSEDED: 'RESOLVED_SUPERSEDED',
  CAP_EVICTED: 'RESOLVED_CAP_EVICTED',
};

/** Explicit legal state/event matrix for every persisted lifecycle state. */
export const QUESTION_LIFECYCLE_TRANSITIONS: Record<QuestionLifecycleState, TransitionRow> = {
  UNRESOLVED: { ...ACTIVE_TRANSITIONS },
  NEEDS_EVIDENCE: { ...ACTIVE_TRANSITIONS },
  WEAKENING: { ...ACTIVE_TRANSITIONS },
  RESOLVED_CAP_EVICTED: {
    OBSERVED_UNRESOLVED: 'UNRESOLVED',
    OBSERVED_NEEDS_EVIDENCE: 'NEEDS_EVIDENCE',
    OBSERVED_WEAKENING: 'WEAKENING',
  },
  RESOLVED_PRECONDITIONS: {},
  RESOLVED_SUPERSEDED: {},
  RESOLVED_LEGACY: {},
};

function failure(code: QuestionTransitionErrorCode, message: string): QuestionTransitionResult {
  return { ok: false, code, message };
}

function lifecycleState(question: OutstandingQuestion): QuestionLifecycleState | null {
  if (question.status !== 'RESOLVED') {
    return question.resolvedReason === undefined ? question.status : null;
  }
  switch (question.resolvedReason) {
    case 'cap_evicted': return 'RESOLVED_CAP_EVICTED';
    case 'preconditions_cleared': return 'RESOLVED_PRECONDITIONS';
    case 'superseded': return 'RESOLVED_SUPERSEDED';
    case undefined: return 'RESOLVED_LEGACY';
  }
}

function transitionKey(event: QuestionLifecycleEvent): QuestionLifecycleTransitionKey | null {
  switch (event.type) {
    case 'candidate_observed':
      if (event.weakening) return 'OBSERVED_WEAKENING';
      return event.candidateStatus === 'UNRESOLVED'
        ? 'OBSERVED_UNRESOLVED'
        : 'OBSERVED_NEEDS_EVIDENCE';
    case 'scoped_miss':
      if (!Number.isInteger(event.consecutiveMisses) || event.consecutiveMisses < 1) return null;
      return event.consecutiveMisses >= 2 ? 'PRECONDITIONS_CLEARED' : 'SCOPED_MISS';
    case 'superseded': return 'SUPERSEDED';
    case 'cap_evicted': return 'CAP_EVICTED';
  }
}

function persistedStatus(state: QuestionLifecycleState): QuestionStatus {
  switch (state) {
    case 'UNRESOLVED':
    case 'NEEDS_EVIDENCE':
    case 'WEAKENING':
      return state;
    case 'RESOLVED_CAP_EVICTED':
    case 'RESOLVED_PRECONDITIONS':
    case 'RESOLVED_SUPERSEDED':
    case 'RESOLVED_LEGACY':
      return 'RESOLVED';
  }
}

export function initialQuestionLifecycle(
  status: QuestionCandidate['status'],
): Pick<OutstandingQuestion, 'status' | 'consecutiveMisses'> {
  return { status, consecutiveMisses: 0 };
}

/** Pure lifecycle transition. Invalid requests return data and never mutate. */
export function transitionQuestion(
  question: OutstandingQuestion,
  event: QuestionLifecycleEvent,
  now: number,
): QuestionTransitionResult {
  const from = lifecycleState(question);
  if (!from) {
    return failure('invalid_state', `Question ${question.id} has incompatible status and resolution fields.`);
  }
  const key = transitionKey(event);
  if (!key) {
    return failure('invalid_event', `Question ${question.id} received an invalid ${event.type} event.`);
  }
  if (event.type === 'superseded') {
    if (!event.successorId.trim()) {
      return failure('missing_successor', `Question ${question.id} cannot be superseded without a successor.`);
    }
    if (event.successorId === question.id) {
      return failure('self_supersession', `Question ${question.id} cannot supersede itself.`);
    }
  }

  const to = QUESTION_LIFECYCLE_TRANSITIONS[from][key];
  if (!to) {
    return failure('illegal_transition', `Question ${question.id} cannot apply ${key} from ${from}.`);
  }

  const next: OutstandingQuestion = {
    ...question,
    status: persistedStatus(to),
    updatedAt: now,
  };

  switch (event.type) {
    case 'candidate_observed':
      next.consecutiveMisses = 0;
      next.resolvedReason = undefined;
      next.resolvedAt = undefined;
      break;
    case 'scoped_miss':
      next.consecutiveMisses = event.consecutiveMisses;
      if (to === 'RESOLVED_PRECONDITIONS') {
        next.resolvedReason = 'preconditions_cleared';
        next.resolvedAt = now;
      }
      break;
    case 'superseded':
      next.resolvedReason = 'superseded';
      next.resolvedAt = now;
      next.supersededByIds = [event.successorId];
      break;
    case 'cap_evicted':
      next.resolvedReason = 'cap_evicted';
      next.resolvedAt = now;
      break;
  }

  return { ok: true, question: next };
}

/** Runtime boundary: preserve data and log rather than throwing on violations. */
export function applyQuestionTransition(
  question: OutstandingQuestion,
  event: QuestionLifecycleEvent,
  now: number,
): OutstandingQuestion {
  const result = transitionQuestion(question, event, now);
  if (result.ok) return result.question;
  void diagLog.warn(
    'questions.lifecycle',
    'Rejected illegal question lifecycle transition',
    JSON.stringify({
      questionId: question.id,
      status: question.status,
      resolvedReason: question.resolvedReason,
      event,
      code: result.code,
      message: result.message,
    }),
  );
  return question;
}
