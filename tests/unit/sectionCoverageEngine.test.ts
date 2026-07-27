import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import * as turf from '@turf/turf';
import { getResolution } from 'h3-js';
import type {
  PermissionSection,
  SessionCoverageObservation,
} from '../../src/shared/coverageTypes';
import {
  REPORTED_LARGE_SECTION_CONFIRMATIONS,
  SECTION_ABSOLUTE_FLOOR_M2,
  SECTION_BALANCE_MEDIAN_FRACTION,
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
  it('splits a small field into a compact set of selectable areas', () => {
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

    expect(sections.length).toBeGreaterThanOrEqual(3);
    expect(sections.length).toBeLessThanOrEqual(6);
    expect(sections.every(candidate => candidate.layoutKey.startsWith('h3:')))
      .toBe(true);
  });

  it('balances a swimming-pool-sized triangular field without slivers', () => {
    const latitude = 52.6;
    const longitudeSpan = 60 / (111_320 * Math.cos(latitude * Math.PI / 180));
    const latitudeSpan = 100 / 111_320;
    const boundary = {
      type: 'Polygon' as const,
      coordinates: [[
        [0, latitude],
        [longitudeSpan, latitude],
        [0, latitude + latitudeSpan],
        [0, latitude],
      ]],
    };
    const source = {
      fieldId: 'triangle-field',
      permissionId: 'permission-1',
      name: 'Triangle field',
      boundary,
    };

    const first = deriveSectionCandidates(source);
    const second = deriveSectionCandidates(source);
    const orderedAreas = first.map(candidate => candidate.areaM2)
      .sort((left, right) => left - right);
    const middle = Math.floor(orderedAreas.length / 2);
    const medianArea = orderedAreas.length % 2 === 1
      ? orderedAreas[middle]
      : (orderedAreas[middle - 1] + orderedAreas[middle]) / 2;
    const fieldArea = turf.area(turf.feature(boundary));
    const derivedArea = first.reduce((total, candidate) => total + candidate.areaM2, 0);

    expect(first.length).toBeGreaterThanOrEqual(3);
    expect(first.length).toBeLessThanOrEqual(6);
    expect(first.every(candidate =>
      candidate.areaM2 >= SECTION_ABSOLUTE_FLOOR_M2
      && candidate.areaM2 >= medianArea * SECTION_BALANCE_MEDIAN_FRACTION
    )).toBe(true);
    expect(Math.max(...orderedAreas)).toBeLessThanOrEqual(medianArea * 2);
    expect(Math.abs(derivedArea - fieldArea) / fieldArea).toBeLessThan(0.02);
    expect(second).toEqual(first);
  });

  it('applies balancing when retaining the H3 base resolution', () => {
    const latitude = 52.6;
    const longitudeSpan = 60 / (111_320 * Math.cos(latitude * Math.PI / 180));
    const latitudeSpan = 100 / 111_320;
    const source = {
      fieldId: 'triangle-field',
      permissionId: 'permission-1',
      name: 'Triangle field',
      boundary: {
        type: 'Polygon' as const,
        coordinates: [[
          [-1, latitude],
          [-1 + longitudeSpan, latitude],
          [-1, latitude + latitudeSpan],
          [-1, latitude],
        ]],
      },
    };
    const derived = deriveSectionCandidates(source);
    const retainedResolution = getResolution(derived[0].layoutKey.slice('h3:'.length));
    const retained = deriveSectionCandidates(source, retainedResolution);
    const areas = retained.map(candidate => candidate.areaM2).sort((a, b) => a - b);
    const medianArea = areas.length % 2 === 1
      ? areas[Math.floor(areas.length / 2)]
      : (areas[areas.length / 2 - 1] + areas[areas.length / 2]) / 2;

    expect(retained.length).toBeGreaterThanOrEqual(3);
    expect(retained.length).toBeLessThanOrEqual(6);
    expect(retained.every(candidate =>
      candidate.areaM2 >= Math.max(
        SECTION_ABSOLUTE_FLOOR_M2,
        medianArea * SECTION_BALANCE_MEDIAN_FRACTION,
      )
    )).toBe(true);
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
  it('does not count a find made before the prediction but recorded afterwards', () => {
    const decisions = resolvePredictionDecisions({
      predictions: [prediction()],
      finds: [{
        id: 'find-1',
        permissionId: 'permission-1',
        lat: 0.5,
        lon: 0.5,
        foundAt: new Date(SURFACED_AT - 1).toISOString(),
        createdAt: new Date(SURFACED_AT + 1).toISOString(),
      }],
      sections: [],
      observations: [],
      trackedCoverageByPrediction: new Map(),
    });

    expect(decisions).toEqual([]);
  });

  it('uses createdAt only when foundAt is absent or invalid', () => {
    const baseFind = {
      permissionId: 'permission-1',
      lat: 0.5,
      lon: 0.5,
      createdAt: new Date(SURFACED_AT + 1).toISOString(),
    };
    for (const find of [
      { ...baseFind, id: 'missing-found-at' },
      { ...baseFind, id: 'invalid-found-at', foundAt: 'not-a-date' },
    ]) {
      const decisions = resolvePredictionDecisions({
        predictions: [prediction()],
        finds: [find],
        sections: [],
        observations: [],
        trackedCoverageByPrediction: new Map(),
      });
      expect(decisions).toEqual([expect.objectContaining({
        outcome: 'hit',
        matchedFindId: find.id,
      })]);
    }
  });

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
