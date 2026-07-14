// ─── Outstanding Questions — data model ─────────────────────────────────────
// Deterministic archaeological enquiries derived from FieldGuide scan output.
// Pure types only — no imports from engine internals.

export type RuleId =
  | 'MOVEMENT_NO_FINDS'
  | 'SETTLEMENT_QUIET'
  | 'UNRECORDED_ROUTE'
  | 'ROMAN_ROUTE_ACTIVITY';

export type QuestionCategory =
  | 'MOVEMENT'
  | 'COVERAGE'
  | 'CONTRADICTION'
  | 'HISTORIC_CONTEXT';

export type QuestionStatus = 'UNRESOLVED' | 'NEEDS_EVIDENCE' | 'WEAKENING' | 'RESOLVED';

export type HypothesisId =
  | 'activity_follows_route'
  | 'settlement_signal_reflects_activity'
  | 'route_signal_is_historic'
  | 'activity_associated_with_roman_road';

export const HYPOTHESIS_BY_RULE: Record<RuleId, HypothesisId> = {
  MOVEMENT_NO_FINDS: 'activity_follows_route',
  SETTLEMENT_QUIET: 'settlement_signal_reflects_activity',
  UNRECORDED_ROUTE: 'route_signal_is_historic',
  ROMAN_ROUTE_ACTIVITY: 'activity_associated_with_roman_road',
};

export interface InvestigationMetrics {
  localCoveragePct?: number;
  findsNearCount?: number;
  bufferM: number;
}

export type ResolvedOutcome =
  | 'likely_supported'
  | 'likely_unsupported'
  | 'inconclusive_adequate'
  | 'not_applicable';

export type QuestionEvidenceSource =
  | 'terrain'
  | 'terrain_global'
  | 'slope'
  | 'hydrology'
  | 'satellite_spring'
  | 'satellite_summer'
  | 'scheduled_monuments'
  | 'aim'
  | 'historic_context'
  | 'historic_routes'
  | 'pas_density';

export type QuestionSourceAvailability = Record<QuestionEvidenceSource, boolean>;

export interface EvidenceSnapshot {
  label: string;
  sourceScanId: string;
}

export interface OutstandingQuestion {
  id: string;
  permissionId: string;
  ruleId: RuleId;
  anchor: { lat: number; lon: number };
  title: string;
  description: string;
  category: QuestionCategory;
  status: QuestionStatus;
  confidence: number; // 0–1
  createdAt: number;
  updatedAt: number;
  generatedByScanId: string;
  supportingEvidence: EvidenceSnapshot[];
  contradictingEvidence: EvidenceSnapshot[];
  /** False for contextual questions whose evidence lies on protected land. */
  locationActionAllowed?: boolean;
  resolvedReason?: 'preconditions_cleared' | 'superseded' | 'cap_evicted';
  resolvedAt?: number;
  /** Consecutive scoped scans where this question's preconditions were absent. */
  consecutiveMisses?: number;
  /** Display filter only — never a differ input (G4). */
  dismissedByUser?: boolean;
  /** Static for the generating rule. Optional only for pre-Phase-C rows. */
  hypothesisId?: HypothesisId;
  /** Latest scan metrics; absence is always treated as untested. */
  metrics?: InvestigationMetrics;
  /** First available metrics baseline; stamped once and never overwritten. */
  initialMetrics?: InvestigationMetrics;
  /** Simplified [lon, lat] corridor, capped at 50 points. */
  contextGeometry?: [number, number][];
  resolvedOutcome?: ResolvedOutcome;
  /** Display priority state only; never read by the differ. */
  priorityState?: { scansSinceEvidenceChange: number };
  /** Immediate successor IDs when this row was superseded. */
  supersededByIds?: string[];
}

/** Pre-gate, pre-cap candidate emitted by a rule. */
export interface QuestionCandidate {
  ruleId: RuleId;
  hypothesisId: HypothesisId;
  anchor: { lat: number; lon: number };
  /** Alternate points for the safety gates to try; never persisted. */
  alternativeAnchors?: { lat: number; lon: number }[];
  title: string;
  description: string;
  category: QuestionCategory;
  status: 'UNRESOLVED' | 'NEEDS_EVIDENCE';
  confidence: number;
  scanId: string;
  supportingEvidence: EvidenceSnapshot[];
  contradictingEvidence: EvidenceSnapshot[];
  /** False when the eventual question must not link to its evidence location. */
  locationActionAllowed?: boolean;
  /** Candidate-only: evidence is near, rather than inside, the permission. */
  contextOnly?: boolean;
  metrics: InvestigationMetrics;
  contextGeometry?: [number, number][];
}

/** Result of the diff engine. */
export interface DiffResult {
  upserts: OutstandingQuestion[];
  resolved: OutstandingQuestion[];
}

// ─── Question notes (Phase B) ──────────────────────────────────────────────

export type QuestionNoteType =
  | 'searched_nothing'
  | 'found_something'
  | 'ground_inaccessible'
  | 'poor_conditions'
  | 'modern_disturbance'
  | 'freeform'
  | 'session_crossed'
  | 'status_change'
  | 'merged_from';

export type UserObservationNoteType =
  | 'searched_nothing'
  | 'found_something'
  | 'ground_inaccessible'
  | 'poor_conditions'
  | 'modern_disturbance';

export interface QuestionNote {
  id: string;               // uuid
  questionId: string;       // stable across evict/revive (locked)
  author: 'user' | 'system';
  type: QuestionNoteType;
  text?: string;            // freeform body; optional on tags
  sessionId?: string;       // optional in B, populated in D
  linkedFindIds?: string[]; // found_something picker
  geometryContext?: unknown; // reserved for D; not written in B
  createdAt: number;
}

export const QUESTION_NOTE_TYPES: readonly QuestionNoteType[] = [
  'searched_nothing',
  'found_something',
  'ground_inaccessible',
  'poor_conditions',
  'modern_disturbance',
  'freeform',
  'session_crossed',
  'status_change',
  'merged_from',
];

export const NOTE_TAG_LABELS: Record<UserObservationNoteType, string> = {
  searched_nothing: 'Searched — nothing found',
  found_something: 'Found something nearby',
  ground_inaccessible: 'Ground inaccessible',
  poor_conditions: 'Poor conditions',
  modern_disturbance: 'Modern disturbance',
};

// Confidence bands — UI only, never stored
export type ConfidenceBand = 'Low' | 'Moderate' | 'Strong';

export function confidenceBand(c: number): ConfidenceBand {
  if (c > 0.7) return 'Strong';
  if (c >= 0.4) return 'Moderate';
  return 'Low';
}

// Compass octant from anchor position within permission
export function anchorOctant(
  anchorLat: number, anchorLon: number,
  centroidLat: number, centroidLon: number,
): string {
  const dLon = anchorLon - centroidLon;
  const dLat = anchorLat - centroidLat;
  if (Math.abs(dLon) < 1e-6 && Math.abs(dLat) < 1e-6) return 'central part of this permission';
  const angle = Math.atan2(dLon, dLat) * 180 / Math.PI;
  const octants = ['northern', 'north-eastern', 'eastern', 'south-eastern', 'southern', 'south-western', 'western', 'north-western'];
  const idx = Math.round(((angle + 360) % 360) / 45) % 8;
  return `${octants[idx]} part of this permission`;
}
