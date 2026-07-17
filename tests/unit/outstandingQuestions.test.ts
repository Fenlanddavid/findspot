// ─── Outstanding Questions — test suite ──────────────────────────────────────
// Covers: rules, gates, differ, cap, copy-lint per the test matrix.

import { describe, it, expect } from 'vitest';
import {
  hasRequiredSources,
  historicQuestionRuleScope,
  RULE_REQUIRED_SOURCES,
  runRules,
  corridorContextGeometry,
  type ScanContext,
} from '../../src/outstandingQuestions/rules';
import { isAnchorInScanBounds, passesBoundaryGate, passesSMGate, passesCoverageFence, passesAllGates } from '../../src/outstandingQuestions/gates';
import { generateCandidates } from '../../src/outstandingQuestions/generator';
import { diffQuestions } from '../../src/outstandingQuestions/differ';
import { confidenceBand, anchorOctant, HYPOTHESIS_BY_RULE } from '../../src/outstandingQuestions/types';
import type {
  QuestionCandidate,
  QuestionEvidenceSource,
  QuestionSourceAvailability,
  OutstandingQuestion,
  RuleId,
} from '../../src/outstandingQuestions/types';
import type { GeoJSONPolygon } from '../../src/db';
import type { Hotspot, HistoricRoute } from '../../src/pages/fieldGuideTypes';

// ─── Fixtures ───────────────────────────────────────────────────────────────

// A square permission polygon ~500m × ~500m around (52.5, -0.5)
const testBoundary: GeoJSONPolygon = {
  type: 'Polygon',
  coordinates: [[
    [-0.504, 52.498],
    [-0.496, 52.498],
    [-0.496, 52.502],
    [-0.504, 52.502],
    [-0.504, 52.498],
  ]],
};

const centroid = { lat: 52.5, lon: -0.5 };

function makeHotspot(overrides: Partial<Hotspot> & { type: Hotspot['type']; score: number; center: [number, number] }): Hotspot {
  return {
    id: 'h1',
    number: 1,
    confidence: 'Strong Signal',
    classification: 'Settlement' as any,
    classificationReason: 'test',
    explanation: [],
    bounds: [[-0.504, 52.498], [-0.496, 52.502]],
    memberIds: [],
    metrics: { anomaly: 0, context: 0, convergence: 0, behaviour: 0, penalty: 0, signalCount: 1, signalClassCount: 1 },
    ...overrides,
  };
}

function makeRoute(overrides?: Partial<HistoricRoute>): HistoricRoute {
  return {
    id: 'r1',
    type: 'holloway',
    source: 'lidar_interpreted',
    confidenceClass: 'B',
    certaintyScore: 0.7,
    geometry: [[-0.501, 52.500], [-0.499, 52.500]],
    bbox: [[-0.501, 52.499], [-0.499, 52.501]],
    ...overrides,
  };
}

function baseScanCtx(overrides?: Partial<ScanContext>): ScanContext {
  return {
    scanId: 'scan-1',
    hotspots: [],
    clusters: [],
    historicRoutes: [],
    finds: [],
    permissionCentroid: centroid,
    permissionBoundary: testBoundary,
    ...overrides,
  };
}

function makeCandidate(overrides?: Partial<QuestionCandidate>): QuestionCandidate {
  return {
    ruleId: 'MOVEMENT_NO_FINDS',
    hypothesisId: 'activity_follows_route',
    anchor: { lat: 52.5, lon: -0.5 },
    title: 'Test question',
    description: 'Test description',
    category: 'MOVEMENT',
    status: 'UNRESOLVED',
    confidence: 0.8,
    scanId: 'scan-1',
    supportingEvidence: [{ label: 'Evidence A', sourceScanId: 'scan-1' }],
    contradictingEvidence: [],
    metrics: { localCoveragePct: 60, findsNearCount: 0, bufferM: 200 },
    ...overrides,
  };
}

function makeExisting(overrides?: Partial<OutstandingQuestion>): OutstandingQuestion {
  return {
    id: 'q-existing-1',
    permissionId: 'perm-1',
    ruleId: 'MOVEMENT_NO_FINDS',
    anchor: { lat: 52.5, lon: -0.5 },
    title: 'Existing question',
    description: 'Existing description',
    category: 'MOVEMENT',
    status: 'UNRESOLVED',
    confidence: 0.8,
    createdAt: 1000,
    updatedAt: 1000,
    generatedByScanId: 'scan-0',
    supportingEvidence: [{ label: 'Old evidence', sourceScanId: 'scan-0' }],
    contradictingEvidence: [],
    hypothesisId: 'activity_follows_route',
    metrics: { localCoveragePct: 60, findsNearCount: 0, bufferM: 200 },
    initialMetrics: { localCoveragePct: 20, findsNearCount: 0, bufferM: 200 },
    ...overrides,
  };
}

// ─── Rules: positive fixtures ───────────────────────────────────────────────

describe('Rules — positive fixtures', () => {
  it('clips and caps persisted corridor geometry inside the permission', () => {
    const longLine = Array.from({ length: 120 }, (_, index) =>
      [-0.51 + index * (0.02 / 119), 52.5] as [number, number]
    );
    const geometry = corridorContextGeometry(longLine, testBoundary);
    expect(geometry).toBeDefined();
    expect(geometry!.length).toBeLessThanOrEqual(50);
    expect(geometry!.every(([lon, lat]) =>
      lon >= -0.504 && lon <= -0.496 && lat >= 52.498 && lat <= 52.502
    )).toBe(true);
  });

  it('MOVEMENT_NO_FINDS fires on high-scoring corridor with no finds', () => {
    const ctx = baseScanCtx({
      hotspots: [makeHotspot({ type: 'Movement Corridor (Likely)', score: 70, center: [-0.5, 52.5] })],
      localCoverageAtAnchor: () => 35,
    });
    const results = runRules(ctx);
    const r = results.find(c => c.ruleId === 'MOVEMENT_NO_FINDS');
    expect(r).toBeTruthy();
    expect(r!.category).toBe('MOVEMENT');
    expect(r!.status).toBe('UNRESOLVED');
    expect(r!.metrics).toEqual({ localCoveragePct: 35, findsNearCount: 0, bufferM: 200 });
    expect(r!.contextGeometry?.length).toBeGreaterThanOrEqual(2);
  });

  it('SETTLEMENT_QUIET fires on high settlement score with good coverage but few finds', () => {
    const ctx = baseScanCtx({
      hotspots: [makeHotspot({ type: 'Likely Settlement Edge', score: 75, center: [-0.5, 52.5] })],
      localCoverageAtAnchor: () => 75,
      finds: [{ id: 'f1', lat: 52.501, lon: -0.501, permissionId: 'p1', projectId: 'pr1', fieldId: null, sessionId: null, findCode: '', objectType: '', period: '', material: '', osGridRef: '', w3w: '', notes: '', photos: [], isFavorite: false, isPending: false, foundAt: '', createdAt: '', updatedAt: '' } as any],
    });
    const results = runRules(ctx);
    const r = results.find(c => c.ruleId === 'SETTLEMENT_QUIET');
    expect(r).toBeTruthy();
    expect(r!.category).toBe('CONTRADICTION');
    expect(r!.metrics).toMatchObject({ localCoveragePct: 75, findsNearCount: 1, bufferM: 300 });
  });

  it('UNRECORDED_ROUTE fires on non-OSM route with few PAS records', () => {
    const ctx = baseScanCtx({
      historicRoutes: [makeRoute()],
      pasRecordCountInScanCell: 0,
    });
    const results = runRules(ctx);
    const r = results.find(c => c.ruleId === 'UNRECORDED_ROUTE');
    expect(r).toBeTruthy();
    expect(r!.category).toBe('HISTORIC_CONTEXT');
    expect(r!.metrics.bufferM).toBe(250);
  });

  it('ROMAN_ROUTE_ACTIVITY fires on a Roman road with high PAS density', () => {
    const ctx = baseScanCtx({
      historicRoutes: [makeRoute({ type: 'roman_road', source: 'itinere', name: 'Ermine Street' })],
      pasRecordCountInScanCell: 18,
      localCoverageAtAnchor: () => 35,
    });
    const results = runRules(ctx);
    const r = results.find(c => c.ruleId === 'ROMAN_ROUTE_ACTIVITY');
    expect(r).toBeTruthy();
    expect(r!.category).toBe('HISTORIC_CONTEXT');
    expect(r!.status).toBe('UNRESOLVED');
    expect(r!.description).toContain('contextual only');
    expect(r!.supportingEvidence.map(e => e.label)).toContain('Roman road alignment: Ermine Street');
    expect(r!.contextGeometry?.length).toBeGreaterThanOrEqual(2);
  });

  it('ROMAN_ROUTE_ACTIVITY survives the permission boundary and monument safety gates', () => {
    const candidates = generateCandidates(
      baseScanCtx({
        historicRoutes: [makeRoute({ type: 'roman_road', source: 'itinere' })],
        pasRecordCountInScanCell: 18,
      }),
      {
        boundary: testBoundary,
        smStatus: 'green',
        smCoverageAvailable: true,
        scanBounds: { west: -0.51, south: 52.49, east: -0.49, north: 52.51 },
        isAnchorProtected: () => false,
      },
    );

    expect(candidates.some(candidate => candidate.ruleId === 'ROMAN_ROUTE_ACTIVITY')).toBe(true);
  });

  it('ROMAN_ROUTE_ACTIVITY moves to a safe point on the road when its preferred anchor is protected', () => {
    const candidates = generateCandidates(
      baseScanCtx({
        historicRoutes: [makeRoute({ type: 'roman_road', source: 'itinere' })],
        pasRecordCountInScanCell: 18,
      }),
      {
        boundary: testBoundary,
        smStatus: 'green',
        smCoverageAvailable: true,
        scanBounds: { west: -0.51, south: 52.49, east: -0.49, north: 52.51 },
        isAnchorProtected: anchor => anchor.lon <= -0.5008,
      },
    );

    const question = candidates.find(candidate => candidate.ruleId === 'ROMAN_ROUTE_ACTIVITY');
    expect(question).toBeTruthy();
    expect(question!.anchor.lon).toBeGreaterThan(-0.5008);
    expect(question!.alternativeAnchors).toBeUndefined();
  });

  it('keeps protected Roman fallback metrics non-actionable at the synthetic safe anchor', () => {
    const candidates = generateCandidates(
      baseScanCtx({
        historicRoutes: [makeRoute({ type: 'roman_road', source: 'itinere' })],
        pasRecordCountInScanCell: 18,
        localCoverageAtAnchor: () => 73,
      }),
      {
        boundary: testBoundary,
        smStatus: 'green',
        smCoverageAvailable: true,
        scanBounds: { west: -0.51, south: 52.49, east: -0.49, north: 52.51 },
        isAnchorProtected: anchor => Math.abs(anchor.lat - 52.5) < 0.0001,
      },
    );

    const question = candidates.find(candidate => candidate.ruleId === 'ROMAN_ROUTE_ACTIVITY');
    expect(question).toMatchObject({
      locationActionAllowed: false,
      status: 'NEEDS_EVIDENCE',
      metrics: { bufferM: 250, findsNearCount: 0 },
    });
    expect(question!.metrics.localCoveragePct).toBeUndefined();
  });

  it('keeps a Roman road within 2km as non-actionable surrounding context', () => {
    const nearbyRoad = makeRoute({
      type: 'roman_road',
      source: 'itinere',
      name: 'Nearby Roman road',
      geometry: [[-0.486, 52.499], [-0.486, 52.501]],
      bbox: [[-0.486, 52.499], [-0.486, 52.501]],
    });
    const candidates = generateCandidates(
      baseScanCtx({
        historicRoutes: [nearbyRoad],
        pasRecordCountInScanCell: 12,
        localCoverageAtAnchor: () => 80,
        finds: [{ id: 'f-near', lat: 52.5, lon: -0.5 } as any],
      }),
      {
        boundary: testBoundary,
        smStatus: 'green',
        smCoverageAvailable: true,
        scanBounds: { west: -0.504, south: 52.498, east: -0.496, north: 52.502 },
        isAnchorProtected: () => false,
      },
    );

    const question = candidates.find(candidate => candidate.ruleId === 'ROMAN_ROUTE_ACTIVITY');
    expect(question).toBeDefined();
    expect(question).toMatchObject({
      locationActionAllowed: false,
      status: 'NEEDS_EVIDENCE',
      metrics: { bufferM: 250, findsNearCount: 0 },
    });
    expect(question!.metrics.localCoveragePct).toBeUndefined();
    expect(question!.contextGeometry).toBeUndefined();
    expect(question!.description).toContain('from this permission');
    expect(question!.description).toContain('surrounding landscape context only');
    expect(question!.supportingEvidence.map(e => e.label).join(' ')).toMatch(/approximately .* from permission boundary/);
    expect(question!.anchor.lon).toBeLessThan(-0.496);
    expect(question!.anchor.lon).toBeGreaterThan(-0.504);
  });

  it('keeps a nearby non-Roman historic route as non-actionable context', () => {
    const nearbyRoute = makeRoute({
      geometry: [[-0.486, 52.499], [-0.486, 52.501]],
      bbox: [[-0.486, 52.499], [-0.486, 52.501]],
    });
    const candidates = generateCandidates(
      baseScanCtx({ historicRoutes: [nearbyRoute], pasRecordCountInScanCell: 0 }),
      {
        boundary: testBoundary,
        smStatus: 'green',
        smCoverageAvailable: true,
        scanBounds: { west: -0.504, south: 52.498, east: -0.496, north: 52.502 },
        isAnchorProtected: () => false,
      },
    );

    const question = candidates.find(candidate => candidate.ruleId === 'UNRECORDED_ROUTE');
    expect(question).toMatchObject({
      locationActionAllowed: false,
      status: 'UNRESOLVED',
      metrics: { bufferM: 250, findsNearCount: 0 },
    });
    expect(question!.description).toContain('surrounding landscape context only');
  });

});

// ─── Rules: negative fixtures ───────────────────────────────────────────────

describe('Rules — negative fixtures', () => {
  it('MOVEMENT_NO_FINDS stays silent when finds exist in corridor', () => {
    const ctx = baseScanCtx({
      hotspots: [makeHotspot({ type: 'Movement Corridor (Likely)', score: 70, center: [-0.5, 52.5] })],
      finds: [{ id: 'f1', lat: 52.5, lon: -0.5, permissionId: 'p1' } as any],
    });
    const results = runRules(ctx);
    expect(results.find(c => c.ruleId === 'MOVEMENT_NO_FINDS')).toBeFalsy();
  });

  it('SETTLEMENT_QUIET stays silent with low coverage', () => {
    const ctx = baseScanCtx({
      hotspots: [makeHotspot({ type: 'Likely Settlement Edge', score: 75, center: [-0.5, 52.5] })],
      localCoverageAtAnchor: () => 20,
    });
    const results = runRules(ctx);
    expect(results.find(c => c.ruleId === 'SETTLEMENT_QUIET')).toBeFalsy();
  });

  it('UNRECORDED_ROUTE stays silent when the PAS record count is high', () => {
    const ctx = baseScanCtx({
      historicRoutes: [makeRoute()],
      pasRecordCountInScanCell: 10,
    });
    const results = runRules(ctx);
    expect(results.find(c => c.ruleId === 'UNRECORDED_ROUTE')).toBeFalsy();
  });

  it('UNRECORDED_ROUTE stays silent when PAS data is unavailable', () => {
    const ctx = baseScanCtx({ historicRoutes: [makeRoute()] });
    const results = runRules(ctx);
    expect(results.find(c => c.ruleId === 'UNRECORDED_ROUTE')).toBeFalsy();
  });

  it('UNRECORDED_ROUTE stays silent for OSM-sourced routes', () => {
    const ctx = baseScanCtx({
      historicRoutes: [makeRoute({ source: 'osm' })],
      pasRecordCountInScanCell: 0,
    });
    const results = runRules(ctx);
    expect(results.find(c => c.ruleId === 'UNRECORDED_ROUTE')).toBeFalsy();
  });

  it('ROMAN_ROUTE_ACTIVITY remains useful when PAS density is low', () => {
    const ctx = baseScanCtx({
      historicRoutes: [makeRoute({ type: 'roman_road', source: 'itinere' })],
      pasRecordCountInScanCell: 5,
    });
    const results = runRules(ctx);
    expect(results.find(c => c.ruleId === 'ROMAN_ROUTE_ACTIVITY')).toBeTruthy();
  });

  it('does not emit Roman-road context beyond 2km of the permission', () => {
    const results = runRules(baseScanCtx({
      historicRoutes: [makeRoute({
        type: 'roman_road',
        source: 'itinere',
        geometry: [[-0.45, 52.499], [-0.45, 52.501]],
        bbox: [[-0.45, 52.499], [-0.45, 52.501]],
      })],
    }));
    expect(results.find(candidate => candidate.ruleId === 'ROMAN_ROUTE_ACTIVITY')).toBeUndefined();
  });


});

describe('Rule source completeness', () => {
  it('has exactly one static hypothesis for each of the four live rules', () => {
    expect(Object.keys(HYPOTHESIS_BY_RULE).sort()).toEqual(Object.keys(RULE_REQUIRED_SOURCES).sort());
    expect(Object.keys(HYPOTHESIS_BY_RULE)).toHaveLength(4);
  });

  const sources = [
    'terrain', 'terrain_global', 'slope', 'hydrology', 'satellite_spring',
    'satellite_summer', 'scheduled_monuments', 'aim', 'historic_context',
    'historic_routes', 'pas_density',
  ] as const satisfies readonly QuestionEvidenceSource[];
  const complete = Object.fromEntries(sources.map(source => [source, true])) as QuestionSourceAvailability;

  for (const ruleId of Object.keys(RULE_REQUIRED_SOURCES) as RuleId[]) {
    it(`${ruleId} is complete when every required source is available`, () => {
      expect(hasRequiredSources(ruleId, complete)).toBe(true);
    });

    for (const missingSource of RULE_REQUIRED_SOURCES[ruleId]) {
      it(`${ruleId} is incomplete without ${missingSource}`, () => {
        expect(hasRequiredSources(ruleId, { ...complete, [missingSource]: false })).toBe(false);
      });
    }
  }
});

describe('Permission scan rule ownership', () => {
  it('limits historic updates after the permission-wide pass succeeds', () => {
    expect(historicQuestionRuleScope(true, true)).toEqual([
      'MOVEMENT_NO_FINDS',
      'SETTLEMENT_QUIET',
      'UNRECORDED_ROUTE',
    ]);
  });

  it('lets historic retain full fallback ownership when the permission-wide pass fails', () => {
    expect(historicQuestionRuleScope(true, false)).toBeUndefined();
  });

  it('keeps ordinary FieldGuide scans unscoped', () => {
    expect(historicQuestionRuleScope(false, true)).toBeUndefined();
  });
});

// ─── Rules: NEEDS_EVIDENCE variants ─────────────────────────────────────────

describe('Rules — coverage-below-threshold → NEEDS_EVIDENCE', () => {
  it('MOVEMENT_NO_FINDS returns NEEDS_EVIDENCE below 30% coverage', () => {
    const ctx = baseScanCtx({
      hotspots: [makeHotspot({ type: 'Movement Corridor (Likely)', score: 70, center: [-0.5, 52.5] })],
      localCoverageAtAnchor: () => 15,
    });
    const results = runRules(ctx);
    const r = results.find(c => c.ruleId === 'MOVEMENT_NO_FINDS');
    expect(r).toBeTruthy();
    expect(r!.status).toBe('NEEDS_EVIDENCE');
  });
});

// ─── Gates ──────────────────────────────────────────────────────────────────

describe('Gates — boundary inset', () => {
  it('discards candidate near boundary edge (within 25m inset)', () => {
    // Point right at the boundary edge
    const candidate = makeCandidate({ anchor: { lat: 52.498, lon: -0.5 } });
    expect(passesBoundaryGate(candidate, testBoundary)).toBe(false);
  });

  it('passes candidate well inside boundary', () => {
    const candidate = makeCandidate({ anchor: { lat: 52.5, lon: -0.5 } });
    expect(passesBoundaryGate(candidate, testBoundary)).toBe(true);
  });

  it('discards candidate outside boundary', () => {
    const candidate = makeCandidate({ anchor: { lat: 53.0, lon: -0.5 } });
    expect(passesBoundaryGate(candidate, testBoundary)).toBe(false);
  });

  it('discards when no boundary', () => {
    const candidate = makeCandidate();
    expect(passesBoundaryGate(candidate, undefined)).toBe(false);
  });
});

describe('Gates — SM gate', () => {
  it('green passes', () => {
    expect(passesSMGate('green')).toBe(true);
  });

  it('green still fails when the candidate anchor is protected', () => {
    expect(passesSMGate('green', true)).toBe(false);
  });

  it('amber discards', () => {
    expect(passesSMGate('amber')).toBe(false);
  });

  it('red discards', () => {
    expect(passesSMGate('red')).toBe(false);
  });
});

describe('Gates — coverage fence', () => {
  it('passes when SM coverage available', () => {
    expect(passesCoverageFence(true)).toBe(true);
  });

  it('discards when SM coverage unavailable (Scotland/NI/border)', () => {
    expect(passesCoverageFence(false)).toBe(false);
  });
});

describe('Gates — scan footprint', () => {
  const bounds = { west: -0.51, south: 52.49, east: -0.49, north: 52.51 };

  it('passes an anchor re-examined by this scan', () => {
    expect(isAnchorInScanBounds({ lat: 52.5, lon: -0.5 }, bounds)).toBe(true);
  });

  it('rejects a permission anchor outside this scan', () => {
    expect(isAnchorInScanBounds({ lat: 52.52, lon: -0.5 }, bounds)).toBe(false);
  });
});

describe('Gates — combined', () => {
  it('checks monument protection at the candidate anchor', () => {
    const candidate = makeCandidate();
    expect(passesAllGates(candidate, {
      boundary: testBoundary,
      smStatus: 'green',
      smCoverageAvailable: true,
      scanBounds: { west: -0.51, south: 52.49, east: -0.49, north: 52.51 },
      isAnchorProtected: anchor => anchor.lat === candidate.anchor.lat,
    })).toBe(false);
  });
});

// ─── Diff engine ────────────────────────────────────────────────────────────

describe('Diff — carry-forward identity', () => {
  it('preserves id and createdAt when candidate matches existing within radius', () => {
    const existing = [makeExisting({ anchor: { lat: 52.5001, lon: -0.5001 } })];
    const candidates = [makeCandidate({ anchor: { lat: 52.5002, lon: -0.5002 }, confidence: 0.85 })];

    const result = diffQuestions(existing, candidates, 2000);
    expect(result.upserts).toHaveLength(1);
    expect(result.upserts[0].id).toBe('q-existing-1');
    expect(result.upserts[0].createdAt).toBe(1000);
    expect(result.upserts[0].confidence).toBe(0.85);
  });

  it('creates new question when anchor is beyond 100m radius', () => {
    const existing = [makeExisting({ anchor: { lat: 52.5, lon: -0.5 }, consecutiveMisses: 1 })];
    // ~1km away — well beyond 100m
    const candidates = [makeCandidate({ anchor: { lat: 52.51, lon: -0.5 } })];

    const result = diffQuestions(existing, candidates, 2000);
    // Original should be resolved, new question created
    expect(result.upserts).toHaveLength(1);
    expect(result.upserts[0].id).not.toBe('q-existing-1');
    expect(result.resolved.some(q => q.id === 'q-existing-1')).toBe(true);
  });

  it('preserves the display-only dismissal flag without using it as differ input', () => {
    const existing = [makeExisting({ dismissedByUser: true })];
    const result = diffQuestions(existing, [makeCandidate({ confidence: 0.85 })], 2000);

    expect(result.upserts[0]).toMatchObject({
      id: 'q-existing-1',
      dismissedByUser: true,
      confidence: 0.85,
    });
  });

  it('mechanically carries latest metrics while preserving the initial baseline', () => {
    const initialMetrics = { localCoveragePct: 12, findsNearCount: 0, bufferM: 200 };
    const latestMetrics = { localCoveragePct: 68, findsNearCount: 1, bufferM: 200 };
    const result = diffQuestions(
      [makeExisting({ initialMetrics, metrics: { ...initialMetrics } })],
      [makeCandidate({ metrics: latestMetrics })],
      2000,
    );

    expect(result.upserts[0].metrics).toEqual(latestMetrics);
    expect(result.upserts[0].initialMetrics).toEqual(initialMetrics);
    expect(result.upserts[0].hypothesisId).toBe('activity_follows_route');
  });

  it('stamps the first available baseline on a pre-Phase-C row', () => {
    const latestMetrics = { localCoveragePct: 35, findsNearCount: 0, bufferM: 200 };
    const result = diffQuestions(
      [makeExisting({ metrics: undefined, initialMetrics: undefined, hypothesisId: undefined })],
      [makeCandidate({ metrics: latestMetrics })],
      2000,
    );

    expect(result.upserts[0].initialMetrics).toEqual(latestMetrics);
  });
});

describe('Diff — preconditions_cleared', () => {
  it('weakens after one scoped miss and resolves after the second', () => {
    const existing = [makeExisting()];
    const candidates: QuestionCandidate[] = []; // No candidates — preconditions cleared

    const first = diffQuestions(existing, candidates, 2000);
    expect(first.resolved).toHaveLength(0);
    expect(first.upserts[0].status).toBe('WEAKENING');
    expect(first.upserts[0].consecutiveMisses).toBe(1);

    const second = diffQuestions(first.upserts, candidates, 3000);
    expect(second.resolved).toHaveLength(1);
    expect(second.resolved[0].id).toBe('q-existing-1');
    expect(second.resolved[0].resolvedReason).toBe('preconditions_cleared');
    expect(second.resolved[0].status).toBe('RESOLVED');
  });

  it('resolves a dismissed question normally so resolved can trump hidden in the UI', () => {
    const result = diffQuestions([
      makeExisting({ dismissedByUser: true, consecutiveMisses: 1 }),
    ], [], 2000);

    expect(result.resolved[0]).toMatchObject({
      id: 'q-existing-1',
      status: 'RESOLVED',
      dismissedByUser: true,
    });
  });

  it('leaves questions outside the current scan untouched', () => {
    const existing = [makeExisting({ anchor: { lat: 52.5, lon: -0.5 } })];
    const result = diffQuestions(existing, [], 2000, {
      contains: question => question.anchor.lat > 53,
    });

    expect(result.resolved).toHaveLength(0);
    expect(result.upserts).toEqual(existing);
  });

  it('does not let a new scoped candidate evict untouched questions elsewhere', () => {
    const existing = Array.from({ length: 5 }, (_, i) => makeExisting({
      id: `outside-${i}`,
      anchor: { lat: 52.5 + i * 0.001, lon: -0.5 },
      confidence: 0.4 + i * 0.05,
    }));
    const candidate = makeCandidate({ anchor: { lat: 53, lon: -0.5 }, confidence: 0.99 });

    const result = diffQuestions(existing, [candidate], 2000, {
      contains: question => question.anchor.lat >= 53,
    });

    expect(result.upserts.map(q => q.id)).toEqual(existing.map(q => q.id));
    expect(result.resolved).toHaveLength(1);
    expect(result.resolved[0].resolvedReason).toBe('cap_evicted');
  });
});

describe('Diff — WEAKENING threshold', () => {
  it('resets scoped misses when the question is observed again', () => {
    const existing = [makeExisting({ consecutiveMisses: 1, status: 'WEAKENING' })];
    const result = diffQuestions(existing, [makeCandidate()], 2000);
    expect(result.upserts[0].consecutiveMisses).toBe(0);
    expect(result.upserts[0].status).toBe('UNRESOLVED');
  });

  it('sets WEAKENING on ≥25% relative confidence drop', () => {
    const existing = [makeExisting({ confidence: 0.8 })];
    // 0.8 → 0.5 = 37.5% drop (≥25%)
    const candidates = [makeCandidate({ confidence: 0.5 })];

    const result = diffQuestions(existing, candidates, 2000);
    expect(result.upserts[0].status).toBe('WEAKENING');
  });

  it('does NOT set WEAKENING on <25% relative drop', () => {
    const existing = [makeExisting({ confidence: 0.8 })];
    // 0.8 → 0.7 = 12.5% drop (<25%)
    const candidates = [makeCandidate({ confidence: 0.7 })];

    const result = diffQuestions(existing, candidates, 2000);
    expect(result.upserts[0].status).not.toBe('WEAKENING');
  });

  it('WEAKENING at exactly 25% boundary', () => {
    const existing = [makeExisting({ confidence: 0.8 })];
    // 0.8 → 0.6 = 25% drop (exactly at threshold)
    const candidates = [makeCandidate({ confidence: 0.6 })];

    const result = diffQuestions(existing, candidates, 2000);
    expect(result.upserts[0].status).toBe('WEAKENING');
  });
});

describe('Diff — all four statuses observed', () => {
  it('produces UNRESOLVED, NEEDS_EVIDENCE, WEAKENING, RESOLVED across test scenarios', () => {
    // UNRESOLVED: new candidate with sufficient evidence
    const r1 = diffQuestions([], [makeCandidate({ status: 'UNRESOLVED' })], 1000);
    expect(r1.upserts[0].status).toBe('UNRESOLVED');

    // NEEDS_EVIDENCE: new candidate below threshold
    const r2 = diffQuestions([], [makeCandidate({ status: 'NEEDS_EVIDENCE' })], 1000);
    expect(r2.upserts[0].status).toBe('NEEDS_EVIDENCE');

    // WEAKENING: matched with confidence drop
    const r3 = diffQuestions(
      [makeExisting({ confidence: 0.9 })],
      [makeCandidate({ confidence: 0.5 })],
      2000,
    );
    expect(r3.upserts[0].status).toBe('WEAKENING');

    // RESOLVED: no matching candidate
    const r4 = diffQuestions([makeExisting({ consecutiveMisses: 1 })], [], 2000);
    expect(r4.resolved[0].status).toBe('RESOLVED');
  });
});

// ─── Cap ────────────────────────────────────────────────────────────────────

describe('Cap — eviction and reason', () => {
  it('evicts 6th-ranked candidate as RESOLVED with cap_evicted', () => {
    const candidates = Array.from({ length: 6 }, (_, i) =>
      makeCandidate({
        ruleId: (['MOVEMENT_NO_FINDS', 'SETTLEMENT_QUIET', 'UNRECORDED_ROUTE'] as const)[i % 3],
        confidence: 0.9 - i * 0.1,
        supportingEvidence: [{ label: `Unique evidence ${i}`, sourceScanId: 'scan-1' }],
      })
    );

    const result = diffQuestions([], candidates, 1000);
    expect(result.upserts).toHaveLength(5);
    expect(result.resolved).toHaveLength(1);
    expect(result.resolved[0].resolvedReason).toBe('cap_evicted');
  });

  it('revives a deferred question with the same identity when a slot frees', () => {
    const candidates = Array.from({ length: 6 }, (_, i) => makeCandidate({
      ruleId: (['MOVEMENT_NO_FINDS', 'SETTLEMENT_QUIET', 'UNRECORDED_ROUTE'] as const)[i % 3],
      anchor: { lat: 52.5 + i * 0.002, lon: -0.5 },
      confidence: 0.9 - i * 0.1,
      supportingEvidence: [{ label: `Unique evidence ${i}`, sourceScanId: 'scan-1' }],
    }));
    const first = diffQuestions([], candidates, 1000);
    const deferred = first.resolved[0];
    const activeWithFreeSlot = first.upserts.slice(0, 4);

    const second = diffQuestions(
      [...activeWithFreeSlot, deferred],
      [candidates[5]],
      2000,
      { contains: question => question.id === deferred.id },
    );

    const revived = second.upserts.find(q => q.id === deferred.id);
    expect(revived).toBeDefined();
    expect(revived?.createdAt).toBe(deferred.createdAt);
    expect(revived?.status).not.toBe('RESOLVED');
    expect(revived?.resolvedReason).toBeUndefined();
  });
});

describe('Cap — dedupe overlap', () => {
  it('keeps higher-confidence candidate when ≥2 shared evidence labels', () => {
    const sharedEvidence = [
      { label: 'Shared A', sourceScanId: 'scan-1' },
      { label: 'Shared B', sourceScanId: 'scan-1' },
    ];

    const candidates = [
      makeCandidate({
        ruleId: 'MOVEMENT_NO_FINDS',
        confidence: 0.9,
        supportingEvidence: sharedEvidence,
      }),
      makeCandidate({
        ruleId: 'SETTLEMENT_QUIET',
        confidence: 0.5,
        supportingEvidence: sharedEvidence,
      }),
    ];

    const result = diffQuestions([], candidates, 1000);
    // Only the higher-confidence one should survive
    expect(result.upserts).toHaveLength(1);
    expect(result.upserts[0].ruleId).toBe('MOVEMENT_NO_FINDS');
  });

  it('resolves an existing active question when dedupe supersedes it', () => {
    const sharedEvidence = [
      { label: 'Shared A', sourceScanId: 'scan-1' },
      { label: 'Shared B', sourceScanId: 'scan-1' },
    ];
    const existing = [
      makeExisting({
        id: 'kept-existing',
        ruleId: 'MOVEMENT_NO_FINDS',
        confidence: 0.9,
        supportingEvidence: sharedEvidence,
      }),
      makeExisting({
        id: 'superseded-existing',
        ruleId: 'SETTLEMENT_QUIET',
        confidence: 0.5,
        supportingEvidence: sharedEvidence,
      }),
    ];
    const candidates = [
      makeCandidate({
        ruleId: 'MOVEMENT_NO_FINDS',
        confidence: 0.9,
        supportingEvidence: sharedEvidence,
      }),
      makeCandidate({
        ruleId: 'SETTLEMENT_QUIET',
        confidence: 0.5,
        supportingEvidence: sharedEvidence,
      }),
    ];

    const result = diffQuestions(existing, candidates, 2000);
    expect(result.upserts.map(q => q.id)).toContain('kept-existing');
    const superseded = result.resolved.find(q => q.id === 'superseded-existing');
    expect(superseded?.status).toBe('RESOLVED');
    expect(superseded?.resolvedReason).toBe('superseded');
    expect(superseded?.supersededByIds).toEqual(['kept-existing']);
  });
});

// ─── Evidence snapshots survive scan replacement ────────────────────────────

describe('Evidence snapshots', () => {
  it('evidence labels survive without resolving sourceScanId', () => {
    const existing = [makeExisting({
      supportingEvidence: [
        { label: 'Movement corridor score: 70', sourceScanId: 'old-scan-deleted' },
      ],
    })];

    // Evidence is snapshotted text — even if old-scan-deleted no longer exists,
    // the label is still readable
    expect(existing[0].supportingEvidence[0].label).toBe('Movement corridor score: 70');
    expect(existing[0].supportingEvidence[0].sourceScanId).toBe('old-scan-deleted');
  });
});

// ─── Diff — equidistant tiebreaker ──────────────────────────────────────────

describe('Diff — equidistant tiebreaker', () => {
  it('matches oldest createdAt when two existing questions are equidistant', () => {
    const existing = [
      makeExisting({ id: 'older', createdAt: 100, anchor: { lat: 52.5001, lon: -0.5 } }),
      makeExisting({ id: 'newer', createdAt: 200, anchor: { lat: 52.4999, lon: -0.5 } }),
    ];
    const candidates = [makeCandidate({ anchor: { lat: 52.5, lon: -0.5 } })];

    const result = diffQuestions(existing, candidates, 2000);
    const kept = result.upserts.find(q => q.id === 'older' || q.id === 'newer');
    expect(kept).toBeTruthy();
    // Oldest wins the match
    expect(kept!.id).toBe('older');
  });
});

// ─── Confidence bands ───────────────────────────────────────────────────────

describe('Confidence bands', () => {
  it('Low < 0.4', () => expect(confidenceBand(0.3)).toBe('Low'));
  it('Moderate 0.4–0.7', () => expect(confidenceBand(0.5)).toBe('Moderate'));
  it('Strong > 0.7', () => expect(confidenceBand(0.8)).toBe('Strong'));
  it('boundary 0.4 = Moderate', () => expect(confidenceBand(0.4)).toBe('Moderate'));
  it('boundary 0.7 = Moderate', () => expect(confidenceBand(0.7)).toBe('Moderate'));
});

// ─── Octant ─────────────────────────────────────────────────────────────────

describe('Anchor octant', () => {
  it('returns central for same point', () => {
    expect(anchorOctant(52.5, -0.5, 52.5, -0.5)).toBe('central part of this permission');
  });

  it('returns directional label for offset', () => {
    const label = anchorOctant(52.51, -0.5, 52.5, -0.5);
    expect(label).toContain('northern');
  });
});

// ─── Copy-lint ──────────────────────────────────────────────────────────────

describe('Copy-lint — prohibited terms', () => {
  const PROHIBITED = [
    /\bgo detect\b/i,
    /\bdig\b/i,
    /\bsearch here\b/i,
    /\btreasure\b/i,
    /\bdefinitely\b/i,
    /\bproves\b/i,
    /\bwill find\b/i,
    /\bguarantee/i,
  ];

  // Collect all template strings from the rules
  it('no prohibited terms in rule output', () => {
    const contexts: ScanContext[] = [
      baseScanCtx({
        hotspots: [
          makeHotspot({ type: 'Movement Corridor (Likely)', score: 70, center: [-0.5, 52.5] }),
          makeHotspot({ id: 'h2', type: 'Likely Settlement Edge', score: 75, center: [-0.501, 52.501] }),
          makeHotspot({ id: 'h3', type: 'Water Interaction Zone', score: 50, center: [-0.502, 52.5] }),
        ],
        historicRoutes: [makeRoute()],
        localCoverageAtAnchor: () => 75,
        finds: [
          { id: 'f1', lat: 52.5001, lon: -0.5001, permissionId: 'p1' } as any,
          { id: 'f2', lat: 52.5002, lon: -0.5002, permissionId: 'p1' } as any,
        ],
        pasRecordCountInScanCell: 0,
      }),
      baseScanCtx({
        hotspots: [makeHotspot({ type: 'Movement Corridor (Likely)', score: 70, center: [-0.5, 52.5] })],
        localCoverageAtAnchor: () => 10,
      }),
      baseScanCtx({
        historicRoutes: [makeRoute({ type: 'roman_road', source: 'itinere', name: 'Test Roman road' })],
        pasRecordCountInScanCell: 18,
        localCoverageAtAnchor: () => 30,
      }),
    ];

    for (const ctx of contexts) {
      const results = runRules(ctx);
      for (const r of results) {
        for (const pattern of PROHIBITED) {
          expect(r.title).not.toMatch(pattern);
          expect(r.description).not.toMatch(pattern);
        }
      }
    }
  });
});
