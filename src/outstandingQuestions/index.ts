// ─── Outstanding Questions — barrel export ──────────────────────────────────

export type {
  OutstandingQuestion,
  QuestionCandidate,
  QuestionStatus,
  QuestionCategory,
  RuleId,
  EvidenceSnapshot,
  DiffResult,
  ConfidenceBand,
  QuestionEvidenceSource,
  QuestionSourceAvailability,
  QuestionNote,
  QuestionNoteType,
  UserObservationNoteType,
  HypothesisId,
  InvestigationMetrics,
  ResolvedOutcome,
} from './types';

export { confidenceBand, anchorOctant, QUESTION_NOTE_TYPES, NOTE_TAG_LABELS, HYPOTHESIS_BY_RULE } from './types';
export { passesAllGates, passesBoundaryGate, passesSMGate, passesCoverageFence } from './gates';
export type { GateContext, SMStatus } from './gates';
export {
  runRules,
  RULES,
  RULE_REQUIRED_SOURCES,
  hasRequiredSources,
  MOVEMENT_INVESTIGATION_BUFFER_M,
  SETTLEMENT_INVESTIGATION_BUFFER_M,
  ROUTE_INVESTIGATION_BUFFER_M,
  MAX_CONTEXT_GEOMETRY_POINTS,
  CONTEXT_GEOMETRY_SIMPLIFY_TOLERANCE,
} from './rules';
export type { ScanContext } from './rules';
export { generateCandidates } from './generator';
export { diffQuestions } from './differ';
export { deleteQuestionsWithNotes } from './questionNotes';
export {
  FIELDWORK_PARTLY_PCT,
  FIELDWORK_WELL_PCT,
  PRIORITY_DECAY,
  PRIORITY_FLOOR_FACTOR,
  ATTENTION_CAP,
  ADEQUACY_MIN_SESSIONS,
  FIELDWORK_PROGRESS_VALUES,
  INTERPRETATION_DIRECTION_VALUES,
  hypothesisFor,
  fieldworkProgress,
  interpretationDirection,
  isControlledObservation,
  investigationPriority,
  metricsChanged,
  hasAdequateFieldwork,
  resolvedOutcomeFor,
} from './investigationState';
export type { FieldworkProgress, InterpretationDirection } from './investigationState';
export {
  MAX_SUPERSEDE_CHAIN_DEPTH,
  STATUS_TRANSITION_COPY,
  statusTransitionText,
  mergedFromText,
  terminalSupersedingQuestionId,
} from './transitionHistory';
export { INTERPRETATION_COPY, interpretationCopyFor } from './interpretationCopy';
export type { InterpretationCopy, InterpretationCopyKey } from './interpretationCopy';
export {
  TIMELINE_FALLBACK_BUFFER_M,
  CLOSURE_OUTCOME_COPY,
  buildInvestigationTimeline,
} from './investigationTimeline';
export type { InvestigationTimelineEvent } from './investigationTimeline';
export {
  MIN_SECTIONAL_LENGTH_M,
  SECTION_COUNT,
  calculateInvestigationSections,
} from './sectionalStats';
export type { InvestigationSectionStat } from './sectionalStats';
