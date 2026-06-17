// ─── ALIE v5: Archaeological Landscape Interpretation Engine ─────────────────
// All types, the controlled signal vocabulary, and the worker input/output.
//
// IMPORTANT: All interpretation output is a model — not ground truth.
// Hedged language is mandatory throughout all consuming components.

import type { NHLEFeature, AIMFeature } from '../services/historicScanService';
import type { HistoricRoute } from '../pages/fieldGuideTypes';
import type { GeologyContext } from '../engines/geologyContext';

// ─── Controlled Signal Vocabulary ─────────────────────────────────────────────
// The only permitted signal phrases in user-facing output. Type-enforced —
// narrativeGenerator.ts must import from here, not define locally.

export const CONTROLLED_SIGNAL_VOCABULARY = [
    'overlooks a natural crossing point',
    'occupies a terrace edge',
    'sits on a geology transition',
    'lies adjacent to a historic movement corridor',
    'shows elevated dry ground near water',
    'sits on a slight elevation overlooking lower ground',
    'lies close to a documented spring or watercourse',
    'shows ridge-and-furrow earthwork evidence',
    'lies along a woodland boundary',
    'sits at a valley head or dry valley terminus',
    'lies on or near a Roman road alignment',
    'occupies high ground with restricted approach',
    'sits at a route convergence point',
    'lies at or near a river confluence',
    'shows evidence of historic industrial resource proximity',
    'occupies marginal ground between two landscape types',
] as const;

export type ControlledSignalPhrase = typeof CONTROLLED_SIGNAL_VOCABULARY[number];

// ─── Core ID types ────────────────────────────────────────────────────────────

export type PrimaryProcessId =
    | 'occupation_potential'
    | 'movement'
    | 'resource_exploitation'
    | 'water_relationships'
    | 'landscape_prominence'
    | 'boundary_relationships';

export type SecondaryInterpretationId =
    | 'settlement_activity_area'
    | 'agricultural_landscape'
    | 'movement_corridor'
    | 'riverine_activity'
    | 'industrial_landscape'
    | 'transition_zone'
    | 'burial_landscape'
    | 'defensive_landscape';

export type ArchaeologicalPeriod =
    | 'prehistoric_bronze_age'
    | 'iron_age'
    | 'romano_british'
    | 'early_medieval'
    | 'medieval'
    | 'post_medieval'
    | 'modern_industrial';

export type ConfidenceTier = 'very_high' | 'high' | 'moderate' | 'lower';

export type UncertaintyLevel = 'low' | 'moderate' | 'high';

export type TemporalPersistenceLabel =
    | 'transient'
    | 'recurrent'
    | 'persistent'
    | 'persistent_strategic_focus';

export type EvidencePolarity = 'supporting' | 'contradicting' | 'missing';

export type EvidenceSource =
    | 'terrain'
    | 'hydrology'
    | 'geology'
    | 'historic_routes'
    | 'historic_records'
    | 'remote_sensing'
    | 'derived_model';

export type EvidenceStrength = 'strong' | 'moderate' | 'weak';

export type LandscapeEngineId =
    | 'landscape_opportunity'
    | 'landscape_constraint'
    | 'landscape_memory';

export type BehaviourInteractionId =
    | 'river_crossing'
    | 'settlement_focus'
    | 'hilltop_settlement'
    | 'market_activity'
    | 'gateway'
    | 'industrial_activity'
    | 'ritual_landscape'
    | 'control_point';

export type LikelihoodTier = 'very_high' | 'high' | 'moderate' | 'low' | 'very_low';

// ─── Sub-types ────────────────────────────────────────────────────────────────

export interface EvidenceItem {
    id: string;
    label: string;
    source: EvidenceSource;
    strength: EvidenceStrength;
    polarity: EvidencePolarity;
    weight: number;
}

export interface PeriodSignalAggregate {
    period: ArchaeologicalPeriod;
    recordCount: number;
    certaintyWeightedCount: number;
}

export interface PeriodAffinityScore {
    period: ArchaeologicalPeriod;
    weight: number;
}

export interface PrimaryProcessScore {
    processId: PrimaryProcessId;
    rawScore: number;
    regionalMultiplier: number;
    finalScore: number;
    contributingSignals: string[];   // signal IDs (mapped to controlled phrases in narrativeGenerator)
    subComponents?: Array<{ id: string; score: number }>;
}

export interface SecondaryInterpretationScore {
    interpretationId: SecondaryInterpretationId;
    derivedScore: number;
    periodAffinity: PeriodAffinityScore[];
    confidenceTier: ConfidenceTier;
}

export interface DepositionAffinityResult {
    convergenceMet: boolean;
    noteTemplateId: string | null;
}

export interface HedgedNarrative {
    templateId: string;
    periodSubstitution: ArchaeologicalPeriod | null;
    signalSubstitutions: ControlledSignalPhrase[];
}

export interface LandscapeEngineAssessment {
    engineId: LandscapeEngineId;
    label: string;
    score: number;
    tier: LikelihoodTier;
    supportingEvidence: EvidenceItem[];
    contradictingEvidence: EvidenceItem[];
    reasoning: string;
}

export interface PeriodLikelihood {
    period: ArchaeologicalPeriod;
    score: number;
    tier: LikelihoodTier;
    supportingEvidence: EvidenceItem[];
    contradictingEvidence: EvidenceItem[];
    reasoning: string;
}

export interface BehaviourInteraction {
    interactionId: BehaviourInteractionId;
    label: string;
    score: number;
    tier: LikelihoodTier;
    drivers: PrimaryProcessId[];
    supportingEvidence: EvidenceItem[];
    contradictingEvidence: EvidenceItem[];
    reasoning: string;
}

export interface ArchaeologicalEvidenceAssessment {
    supportingEvidence: EvidenceItem[];
    contradictingEvidence: EvidenceItem[];
    missingEvidence: EvidenceItem[];
    supportingPercent: number;
    contradictingPercent: number;
    confidenceSummary: string;
    primaryInfluencingFactors: string[];
    suggestedInterpretation: string;
    archaeologicalReasoning: string;
    landscapeSummary: string;
    landscapeEngines: LandscapeEngineAssessment[];
    periodLikelihood: PeriodLikelihood[];
    behaviourInteractions: BehaviourInteraction[];
}

// ─── Main result type ─────────────────────────────────────────────────────────

export interface LandscapeInterpretation {
    geohash6: string;
    processScores: PrimaryProcessScore[];
    interpretationScores: SecondaryInterpretationScore[];
    evidenceAssessment: ArchaeologicalEvidenceAssessment;
    primaryInterpretationId: SecondaryInterpretationId | null;
    secondaryInterpretationId: SecondaryInterpretationId | null;
    depositionAffinity: DepositionAffinityResult;
    temporalPersistence: TemporalPersistenceLabel;
    recordSparsity: boolean;
    uncertainty: UncertaintyLevel;
    scheduledMonumentOverlap: boolean;
    narrative: HedgedNarrative;
    engineVersion: string;
    generatedAt: number;
}

// ─── Worker boundary types ────────────────────────────────────────────────────

export interface LandscapeInterpretationWorkerInput {
    geohash6: string;
    nhleFeatures: NHLEFeature[];
    aimFeatures: AIMFeature[];
    routeFeatures: HistoricRoute[];
    geologyContext: GeologyContext | null;
    // Hotspot metrics from the primary hotspot (if any) — nullable when no scan
    hotspotMetrics: {
        anomaly: number;
        context: number;
        convergence: number;
        behaviour: number;
        penalty: number;
        signalCount: number;
        signalClassCount: number;
    } | null;
    hotspotContext?: {
        hasCrossingHotspot: boolean;
        hasMovementHotspot: boolean;
        hasRouteConvergenceHotspot: boolean;
    };
    centerLat: number;
    centerLon: number;
    // Terrain values — use 0 as default when not available from scan
    elevationM: number;
    slopePercent: number;
    aspectDegrees: number;
    // PotentialScore breakdown from the existing hotspot engine — used as
    // primary terrain/water proxy when raw terrain data is unavailable.
    // terrain: 0–100 terrain relief/anomaly. hydro: 0–100 water proximity.
    potentialBreakdown: {
        terrain: number;
        hydro: number;
        historic: number;
        signals: number;
    } | null;
}

export interface LandscapeInterpretationWorkerOutput {
    result?: LandscapeInterpretation;
    error?: string;
}
