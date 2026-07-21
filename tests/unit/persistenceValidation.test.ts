import { describe, expect, it } from 'vitest';
import {
  safeParseFieldGuideScanCache,
  safeParseGeologyContextRecord,
  safeParseLandscapeInterpretationRecord,
} from '../../src/services/persistenceValidation';

describe('persisted cache validation', () => {
  it('accepts a valid Field Guide cache and rejects malformed clusters', () => {
    const cache = {
      id: '15-123-456',
      createdAt: 1_700_000_000_000,
      sourceAvailability: { terrain: true },
      rawClusters: [{
        id: 'cluster-1',
        points: [{ x: 1, y: 2 }],
        minX: 1,
        maxX: 1,
        minY: 2,
        maxY: 2,
        type: 'terrain',
        score: 0.8,
        number: 1,
        isProtected: false,
        confidence: 'High',
        findPotential: 72,
        center: [-1.2, 52.1],
        source: 'terrain',
        sources: ['terrain'],
      }],
    };

    expect(safeParseFieldGuideScanCache(cache)?.rawClusters).toHaveLength(1);
    expect(safeParseFieldGuideScanCache({ ...cache, rawClusters: 'corrupt' })).toBeNull();
  });

  it('accepts a valid geology record and rejects a malformed context', () => {
    const context = {
      tileKey: 'u120fx',
      centroid: { lat: 52.1, lon: -1.2 },
      source: { bedrock: 'BGS_625K' },
      raw: { bedrockName: 'Mudstone' },
      landscapeClass: 'heavy_clay',
      confidence: 'high',
      modifiers: {
        hydrology: 0,
        terrain: -2,
        spectral: 0,
        route: 0,
        soilMechanics: 2,
        preservation: 1,
        movementRisk: 0,
      },
      explanation: ['Clay-rich bedrock'],
      fetchedAt: 1_700_000_000_000,
      classifierVersion: 2,
      sourceVersion: 'bgs625k-v2',
    };
    const record = {
      tileKey: context.tileKey,
      centroid: context.centroid,
      context,
      fetchedAt: context.fetchedAt,
      classifierVersion: context.classifierVersion,
      sourceVersion: context.sourceVersion,
    };

    expect(safeParseGeologyContextRecord(record)?.context.landscapeClass).toBe('heavy_clay');
    expect(safeParseGeologyContextRecord({ ...record, context: { ...context, modifiers: null } })).toBeNull();
  });

  it('accepts a valid landscape interpretation record and rejects damaged evidence', () => {
    const interpretation = {
      geohash6: 'u120fx',
      processScores: [],
      interpretationScores: [],
      evidenceAssessment: {
        supportingEvidence: [],
        contradictingEvidence: [],
        missingEvidence: [],
        supportingPercent: 0,
        contradictingPercent: 0,
        confidenceSummary: 'Limited evidence',
        primaryInfluencingFactors: [],
        suggestedInterpretation: 'No dominant interpretation',
        archaeologicalReasoning: 'Evidence remains sparse.',
        landscapeSummary: 'No strong landscape pattern.',
        landscapeEngines: [],
        periodLikelihood: [],
        behaviourInteractions: [],
      },
      primaryInterpretationId: null,
      secondaryInterpretationId: null,
      depositionAffinity: { convergenceMet: false, noteTemplateId: null },
      temporalPersistence: 'transient',
      recordSparsity: true,
      uncertainty: 'high',
      scheduledMonumentOverlap: false,
      narrative: { templateId: 'sparse', periodSubstitution: null, signalSubstitutions: [] },
      engineVersion: 'alie-v5',
      generatedAt: 1_700_000_000_000,
    };
    const record = {
      geohash6: interpretation.geohash6,
      generatedAt: interpretation.generatedAt,
      engineVersion: interpretation.engineVersion,
      interpretation,
    };

    expect(safeParseLandscapeInterpretationRecord(record)?.interpretation.recordSparsity).toBe(true);
    expect(safeParseLandscapeInterpretationRecord({
      ...record,
      interpretation: {
        ...interpretation,
        evidenceAssessment: { ...interpretation.evidenceAssessment, supportingEvidence: 'corrupt' },
      },
    })).toBeNull();
  });
});
