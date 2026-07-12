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
} from './types';

export { confidenceBand, anchorOctant } from './types';
export { passesAllGates, passesBoundaryGate, passesSMGate, passesCoverageFence } from './gates';
export type { GateContext, SMStatus } from './gates';
export { runRules, RULES, RULE_REQUIRED_SOURCES, hasRequiredSources } from './rules';
export type { ScanContext } from './rules';
export { generateCandidates } from './generator';
export { diffQuestions } from './differ';
