import type {
  HypothesisId,
  InvestigationMetrics,
  OutstandingQuestion,
  QuestionNote,
  ResolvedOutcome,
} from './types';
import { HYPOTHESIS_BY_RULE } from './types';

export const FIELDWORK_PARTLY_PCT = 10;
export const FIELDWORK_WELL_PCT = 60;
export const PRIORITY_DECAY = 0.85; // TUNING: observe after release.
export const PRIORITY_FLOOR_FACTOR = 0.3; // TUNING: never fully bury a live signal.
export const ATTENTION_CAP = 3;
export const ADEQUACY_MIN_SESSIONS = 2;

export const FIELDWORK_PROGRESS_VALUES = [
  'BLOCKED', 'UNTESTED', 'PARTLY_TESTED', 'WELL_TESTED',
] as const;
export type FieldworkProgress = typeof FIELDWORK_PROGRESS_VALUES[number];

export const INTERPRETATION_DIRECTION_VALUES = [
  'STILL_UNTESTED', 'SUPPORTING', 'CONTRARY', 'MIXED', 'NO_CHANGE',
] as const;
export type InterpretationDirection = typeof INTERPRETATION_DIRECTION_VALUES[number];

export function isControlledObservation(note: Pick<QuestionNote, 'type'>): boolean {
  return note.type !== 'freeform';
}

export function hypothesisFor(question: Pick<OutstandingQuestion, 'ruleId' | 'hypothesisId'>): HypothesisId {
  return question.hypothesisId ?? HYPOTHESIS_BY_RULE[question.ruleId];
}

export function fieldworkProgress(
  question: Pick<OutstandingQuestion, 'metrics' | 'updatedAt'>,
  notes: readonly QuestionNote[] = [],
): FieldworkProgress {
  if (notes.some(note => note.type === 'ground_inaccessible' && note.createdAt > question.updatedAt)) {
    return 'BLOCKED';
  }
  const coverage = question.metrics?.localCoveragePct;
  if (coverage == null || !Number.isFinite(coverage) || coverage < FIELDWORK_PARTLY_PCT) {
    return 'UNTESTED';
  }
  if (coverage < FIELDWORK_WELL_PCT) return 'PARTLY_TESTED';
  return 'WELL_TESTED';
}

function findsDelta(question: Pick<OutstandingQuestion, 'metrics' | 'initialMetrics'>): number | null {
  const initial = question.initialMetrics?.findsNearCount;
  const latest = question.metrics?.findsNearCount;
  if (initial == null || latest == null || !Number.isFinite(initial) || !Number.isFinite(latest)) {
    return null;
  }
  return latest - initial;
}

export function interpretationDirection(
  question: Pick<OutstandingQuestion, 'ruleId' | 'hypothesisId' | 'metrics' | 'initialMetrics' | 'updatedAt'>,
  notes: readonly QuestionNote[] = [],
): InterpretationDirection {
  const progress = fieldworkProgress(question, notes);
  if (progress === 'UNTESTED') return 'STILL_UNTESTED';

  // Controlled conditions qualify the display interpretation without altering
  // lifecycle. Phase C has no persisted transition history from which to infer
  // a later superseding delta, so the observation remains conservatively live.
  const hasConditionsModifier = notes.some(note =>
    note.type === 'poor_conditions' || note.type === 'modern_disturbance'
  );
  if (hasConditionsModifier) return 'MIXED';

  const delta = findsDelta(question);
  if (delta == null) return 'NO_CHANGE';

  switch (hypothesisFor(question)) {
    case 'activity_follows_route':
    case 'activity_associated_with_roman_road':
      if (delta > 0) return 'SUPPORTING';
      if (progress === 'WELL_TESTED' && delta === 0) return 'CONTRARY';
      return 'NO_CHANGE';
    case 'settlement_signal_reflects_activity':
      if (delta >= 2) return 'SUPPORTING';
      if (progress === 'WELL_TESTED' && delta === 0) return 'CONTRARY';
      return 'NO_CHANGE';
    case 'route_signal_is_historic':
      if (delta > 0) return 'SUPPORTING';
      if (progress === 'WELL_TESTED' && delta === 0) return 'MIXED';
      return 'NO_CHANGE';
  }
}

export function investigationPriority(
  confidence: number,
  scansSinceEvidenceChange: number,
): number {
  const decayed = confidence * PRIORITY_DECAY ** Math.max(0, scansSinceEvidenceChange);
  return Math.max(confidence * PRIORITY_FLOOR_FACTOR, decayed);
}

export function metricsChanged(
  previous?: InvestigationMetrics,
  latest?: InvestigationMetrics,
): boolean {
  if (!previous && !latest) return false;
  if (!previous || !latest) return true;
  return previous.bufferM !== latest.bufferM ||
    previous.localCoveragePct !== latest.localCoveragePct ||
    previous.findsNearCount !== latest.findsNearCount;
}

export function hasAdequateFieldwork(
  question: Pick<OutstandingQuestion, 'metrics' | 'updatedAt'>,
  notes: readonly QuestionNote[],
): boolean {
  if (fieldworkProgress(question, notes) !== 'WELL_TESTED') return false;
  const sessionIds = new Set(notes.flatMap(note =>
    isControlledObservation(note) && note.sessionId ? [note.sessionId] : []
  ));
  // Before session integration exists, WELL_TESTED is sufficient. Once session
  // evidence is present for an investigation, require two distinct sessions.
  return sessionIds.size === 0 || sessionIds.size >= ADEQUACY_MIN_SESSIONS;
}

export function resolvedOutcomeFor(
  question: Pick<OutstandingQuestion,
    'ruleId' | 'hypothesisId' | 'metrics' | 'initialMetrics' | 'updatedAt'>,
  notes: readonly QuestionNote[],
): ResolvedOutcome {
  if (!hasAdequateFieldwork(question, notes)) return 'not_applicable';
  switch (interpretationDirection(question, notes)) {
    case 'SUPPORTING': return 'likely_supported';
    case 'CONTRARY': return 'likely_unsupported';
    case 'MIXED': return 'inconclusive_adequate';
    case 'STILL_UNTESTED':
    case 'NO_CHANGE':
      return 'not_applicable';
  }
}
