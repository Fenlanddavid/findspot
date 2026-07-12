// ─── Outstanding Questions — data model ─────────────────────────────────────
// Deterministic archaeological enquiries derived from FieldGuide scan output.
// Pure types only — no imports from engine internals.

export type RuleId =
  | 'MOVEMENT_NO_FINDS'
  | 'SETTLEMENT_QUIET'
  | 'UNRECORDED_ROUTE';

export type QuestionCategory =
  | 'MOVEMENT'
  | 'CONTRADICTION'
  | 'HISTORIC_CONTEXT';

export type QuestionStatus = 'UNRESOLVED' | 'NEEDS_EVIDENCE' | 'WEAKENING' | 'RESOLVED';

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
  resolvedReason?: 'preconditions_cleared' | 'superseded' | 'cap_evicted';
  resolvedAt?: number;
  /** Consecutive scoped scans where this question's preconditions were absent. */
  consecutiveMisses?: number;
}

/** Pre-gate, pre-cap candidate emitted by a rule. */
export interface QuestionCandidate {
  ruleId: RuleId;
  anchor: { lat: number; lon: number };
  title: string;
  description: string;
  category: QuestionCategory;
  status: 'UNRESOLVED' | 'NEEDS_EVIDENCE';
  confidence: number;
  scanId: string;
  supportingEvidence: EvidenceSnapshot[];
  contradictingEvidence: EvidenceSnapshot[];
}

/** Result of the diff engine. */
export interface DiffResult {
  upserts: OutstandingQuestion[];
  resolved: OutstandingQuestion[];
}

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
