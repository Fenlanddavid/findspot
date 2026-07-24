import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { getResolution } from 'h3-js';
import type {
  PermissionSection,
  SessionCoverageObservation,
} from '../../src/shared/coverageTypes';
import {
  REPORTED_LARGE_SECTION_CONFIRMATIONS,
  deriveSectionCandidates,
  resolvePredictionDecisions,
} from '../../src/engines/coverage/sectionCoverageEngine';

const ISO = '2026-07-24T10:00:00.000Z';
const SURFACED_AT = Date.parse('2026-07-24T09:00:00.000Z');
const OBSERVED_AT = Date.parse(ISO);

function section(areaM2 = 5_000): PermissionSection {
  return {
    id: 'section-1',
    permissionId: 'permission-1',
    fieldId: 'field-1',
    layoutKey: 'whole',
    label: 'Test section',
    currentGeometryVersion: 1,
    geometryVersions: [{
      version: 1,
      boundaryHash: 'boundary-1',
      geometry: {
        type: 'Polygon',
        coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
      },
      areaM2,
      effectiveFrom: ISO,
    }],
    createdAt: ISO,
    updatedAt: ISO,
  };
}

function observation(
  evidence: SessionCoverageObservation['evidence'],
  sessionId: string,
): SessionCoverageObservation {
  return {
    id: `${sessionId}:${evidence}`,
    sessionId,
    permissionId: 'permission-1',
    sectionId: 'section-1',
    sectionGeometryVersion: 1,
    evidence,
    startedAt: SURFACED_AT + 1,
    observedAt: OBSERVED_AT,
    createdAt: ISO,
    updatedAt: ISO,
  };
}

function prediction(outcome: 'hit' | 'searched_no_find' | 'unvisited' = 'unvisited') {
  return {
    id: 'prediction-1',
    permissionId: 'permission-1',
    surfacedAt: SURFACED_AT,
    center: [0.5, 0.5] as [number, number],
    bounds: [[0.4, 0.4], [0.6, 0.6]] as [[number, number], [number, number]],
    outcome,
  };
}

describe('section derivation', () => {
  it('splits a small field into several selectable areas', () => {
    const sections = deriveSectionCandidates({
      fieldId: 'field-1',
      permissionId: 'permission-1',
      name: 'Home field',
      boundary: {
        type: 'Polygon',
        coordinates: [[
          [0, 52], [0.001, 52], [0.001, 52.001],
          [0, 52.001], [0, 52],
        ]],
      },
    });

    expect(sections.length).toBeGreaterThanOrEqual(6);
    expect(sections.every(candidate => candidate.layoutKey.startsWith('h3:')))
      .toBe(true);
  });

  it('keeps H3 identities stable when a large boundary is edited', () => {
    const original = deriveSectionCandidates({
      fieldId: 'field-1',
      permissionId: 'permission-1',
      name: 'North field',
      boundary: {
        type: 'Polygon',
        coordinates: [[
          [-0.01, 51.99], [0.01, 51.99], [0.01, 52.01],
          [-0.01, 52.01], [-0.01, 51.99],
        ]],
      },
    });
    const retainedResolution = getResolution(original[0].layoutKey.slice('h3:'.length));
    const edited = deriveSectionCandidates({
      fieldId: 'field-1',
      permissionId: 'permission-1',
      name: 'North field',
      boundary: {
        type: 'Polygon',
        coordinates: [[
          [-0.01, 51.99], [0.011, 51.99], [0.011, 52.01],
          [-0.01, 52.01], [-0.01, 51.99],
        ]],
      },
    }, retainedResolution);

    expect(original.length).toBeGreaterThanOrEqual(2);
    expect(original.length).toBeLessThanOrEqual(12);
    const editedIds = new Set(edited.map(candidate => candidate.id));
    expect(original.filter(candidate => editedIds.has(candidate.id)).length)
      .toBeGreaterThan(original.length / 2);
  });
});

describe('coverage prediction resolution', () => {
  it('treats a find visit as hit-only evidence, never a searched-no-find', () => {
    const decisions = resolvePredictionDecisions({
      predictions: [prediction()],
      finds: [],
      sections: [section()],
      observations: [observation('find-visited', 'session-1')],
      trackedCoverageByPrediction: new Map(),
    });
    expect(decisions).toEqual([]);
  });

  it('commits a small reported section immediately', () => {
    const decisions = resolvePredictionDecisions({
      predictions: [prediction()],
      finds: [],
      sections: [section(5_000)],
      observations: [observation('reported', 'session-1')],
      trackedCoverageByPrediction: new Map(),
    });
    expect(decisions).toEqual([expect.objectContaining({
      outcome: 'searched_no_find',
      evidence: 'reported',
      reportedConfirmationCount: 1,
    })]);
  });

  it('does not use a session report against a prediction surfaced after that session began', () => {
    const report = {
      ...observation('reported', 'session-1'),
      startedAt: SURFACED_AT - 1,
      observedAt: SURFACED_AT + 1,
    };
    expect(resolvePredictionDecisions({
      predictions: [prediction()],
      finds: [],
      sections: [section(5_000)],
      observations: [report],
      trackedCoverageByPrediction: new Map(),
    })).toEqual([]);
  });

  it('requires three unique sessions for a large reported section', () => {
    const duplicateSession = [
      observation('reported', 'session-1'),
      { ...observation('reported', 'session-1'), id: 'duplicate' },
      observation('reported', 'session-2'),
    ];
    expect(resolvePredictionDecisions({
      predictions: [prediction()],
      finds: [],
      sections: [section(20_000)],
      observations: duplicateSession,
      trackedCoverageByPrediction: new Map(),
    })).toEqual([]);

    expect(resolvePredictionDecisions({
      predictions: [prediction()],
      finds: [],
      sections: [section(20_000)],
      observations: [...duplicateSession, observation('reported', 'session-3')],
      trackedCoverageByPrediction: new Map(),
    })).toEqual([expect.objectContaining({
      outcome: 'searched_no_find',
      reportedConfirmationCount: REPORTED_LARGE_SECTION_CONFIRMATIONS,
    })]);
  });

  it('keeps a committed hit permanent', () => {
    expect(resolvePredictionDecisions({
      predictions: [prediction('hit')],
      finds: [],
      sections: [section()],
      observations: [
        observation('reported', 'session-1'),
        observation('reported', 'session-2'),
        observation('reported', 'session-3'),
      ],
      trackedCoverageByPrediction: new Map([['prediction-1', 1]]),
    })).toEqual([]);
  });

  it('matches an independent model for bounded arbitrary evidence sequences', () => {
    const event = fc.record({
      evidence: fc.constantFrom('reported', 'find-visited'),
      session: fc.integer({ min: 0, max: 5 }),
      beforePrediction: fc.boolean(),
    });

    fc.assert(fc.property(
      fc.array(event, { maxLength: 20 }),
      fc.boolean(),
      fc.boolean(),
      fc.boolean(),
      (events, largeSection, tracked, matchedFind) => {
        const observations = events.map((value, index) => ({
          ...observation(value.evidence, `session-${value.session}`),
          id: `observation-${index}`,
          observedAt: value.beforePrediction ? SURFACED_AT - 1 : OBSERVED_AT,
        }));
        const reportedSessions = new Set(events
          .filter(value => value.evidence === 'reported' && !value.beforePrediction)
          .map(value => value.session));
        const required = largeSection ? REPORTED_LARGE_SECTION_CONFIRMATIONS : 1;
        const expectedOutcome = matchedFind
          ? 'hit'
          : tracked || reportedSessions.size >= required
            ? 'searched_no_find'
            : null;
        const finds = matchedFind ? [{
          id: 'find-1',
          permissionId: 'permission-1',
          lat: 0.5,
          lon: 0.5,
          createdAt: ISO,
        }] : [];
        const decisions = resolvePredictionDecisions({
          predictions: [prediction()],
          finds,
          sections: [section(largeSection ? 20_000 : 5_000)],
          observations,
          trackedCoverageByPrediction: new Map([
            ['prediction-1', tracked ? 0.2 : 0],
          ]),
        });
        expect(decisions[0]?.outcome ?? null).toBe(expectedOutcome);
      },
    ), { numRuns: 120 });
  });
});
