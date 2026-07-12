import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const findsToArray = vi.fn();
  const sessionsToArray = vi.fn();
  const tracksToArray = vi.fn();
  const questionsToArray = vi.fn();
  const bulkPut = vi.fn();
  const generateCandidates = vi.fn();
  const diffQuestions = vi.fn();
  const calculateCoverage = vi.fn();
  const transaction = vi.fn(async (_mode: string, _table: unknown, callback: () => Promise<void>) => callback());

  return {
    findsToArray,
    sessionsToArray,
    tracksToArray,
    questionsToArray,
    bulkPut,
    generateCandidates,
    diffQuestions,
    calculateCoverage,
    transaction,
  };
});

vi.mock('../../src/db', () => ({
  db: {
    finds: { where: () => ({ equals: () => ({ toArray: mocks.findsToArray }) }) },
    sessions: { where: () => ({ equals: () => ({ toArray: mocks.sessionsToArray }) }) },
    tracks: { where: () => ({ anyOf: () => ({ toArray: mocks.tracksToArray }) }) },
    outstandingQuestions: {
      where: () => ({ equals: () => ({ toArray: mocks.questionsToArray }) }),
      bulkPut: mocks.bulkPut,
    },
    transaction: mocks.transaction,
  },
}));

vi.mock('../../src/services/coverage', () => ({
  calculateCoverage: mocks.calculateCoverage,
}));

vi.mock('../../src/outstandingQuestions/generator', () => ({
  generateCandidates: mocks.generateCandidates,
}));

vi.mock('../../src/outstandingQuestions/differ', () => ({
  diffQuestions: mocks.diffQuestions,
}));

import { updateQuestionsAfterScan } from '../../src/outstandingQuestions/updateAfterScan';

const boundary = {
  type: 'Polygon' as const,
  coordinates: [[
    [-0.01, 51.99], [0.01, 51.99], [0.01, 52.01],
    [-0.01, 52.01], [-0.01, 51.99],
  ]],
};

const permission = { id: 'permission-1', boundary } as any;

const completeSources = {
  terrain: true,
  terrain_global: true,
  slope: true,
  hydrology: true,
  satellite_spring: true,
  satellite_summer: true,
  scheduled_monuments: true,
  aim: true,
  historic_context: true,
  historic_routes: true,
  pas_density: true,
};

function input(overrides: Record<string, unknown> = {}) {
  return {
    scanCenter: { lat: 52, lng: 0 },
    hotspots: [],
    clusters: [],
    routes: [],
    scanBounds: { west: -0.02, south: 51.98, east: 0.02, north: 52.02 },
    sourceAvailability: completeSources,
    permissions: [permission],
    scheduledMonuments: { features: [], available: true },
    pasRecordCountInScanCell: 3,
    ...overrides,
  } as any;
}

describe('updateQuestionsAfterScan', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findsToArray.mockResolvedValue([]);
    mocks.sessionsToArray.mockResolvedValue([]);
    mocks.questionsToArray.mockResolvedValue([]);
    mocks.generateCandidates.mockReturnValue([]);
    mocks.diffQuestions.mockReturnValue({ upserts: [], resolved: [] });
    mocks.calculateCoverage.mockReturnValue({
      undetectionsGeoJSON: null,
      detectedAreaM2: 40,
      totalAreaM2: 100,
      percentCovered: 40,
      percentUndetected: 60,
    });
  });

  it('does nothing when the scan centre is outside every permission', async () => {
    await updateQuestionsAfterScan(input({ scanCenter: { lat: 53, lng: 0 } }));

    expect(mocks.generateCandidates).not.toHaveBeenCalled();
    expect(mocks.bulkPut).not.toHaveBeenCalled();
  });

  it('passes PAS and monument context through and stamps persisted records', async () => {
    const monument = {
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [[
        [-0.001, 51.999], [0.001, 51.999], [0.001, 52.001],
        [-0.001, 52.001], [-0.001, 51.999],
      ]] },
      properties: {},
    };
    const upsert = {
      id: 'question-1', permissionId: '', ruleId: 'MOVEMENT_NO_FINDS',
      anchor: { lat: 52, lon: 0 }, title: 'Question', description: 'Description',
      category: 'MOVEMENT', status: 'UNRESOLVED', confidence: 0.8,
      createdAt: 1, updatedAt: 1, generatedByScanId: 'scan-1',
      supportingEvidence: [], contradictingEvidence: [],
    };
    mocks.diffQuestions.mockReturnValue({ upserts: [upsert], resolved: [] });

    await updateQuestionsAfterScan(input({
      scheduledMonuments: { features: [monument], available: true },
    }));

    const [scanContext, gateContext] = mocks.generateCandidates.mock.calls[0];
    expect(scanContext.pasRecordCountInScanCell).toBe(3);
    expect(scanContext.permissionCentroid).toEqual({ lat: 52, lon: 0 });
    expect(scanContext.localCoverageAtAnchor(52, 0, 200)).toBe(40);
    expect(gateContext.smCoverageAvailable).toBe(true);
    expect(gateContext.scanBounds).toEqual({ west: -0.02, south: 51.98, east: 0.02, north: 52.02 });
    expect(gateContext.isAnchorProtected({ lat: 52, lon: 0 })).toBe(true);
    expect(gateContext.isAnchorProtected({ lat: 52.005, lon: 0 })).toBe(false);
    const diffScope = mocks.diffQuestions.mock.calls[0][3];
    expect(diffScope.contains({ ruleId: 'MOVEMENT_NO_FINDS', anchor: { lat: 52, lon: 0 } })).toBe(true);
    expect(mocks.bulkPut).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'question-1', permissionId: 'permission-1' }),
    ]);
  });

  it('does not count a miss when a rule-specific source is unavailable', async () => {
    await updateQuestionsAfterScan(input({
      pasRecordCountInScanCell: undefined,
      sourceAvailability: { ...completeSources, pas_density: false },
    }));

    const diffScope = mocks.diffQuestions.mock.calls[0][3];
    expect(diffScope.contains({ ruleId: 'UNRECORDED_ROUTE', anchor: { lat: 52, lon: 0 } })).toBe(false);
    expect(diffScope.contains({ ruleId: 'MOVEMENT_NO_FINDS', anchor: { lat: 52, lon: 0 } })).toBe(false);
  });

  it('does not create, refresh or weaken a candidate when its required sources are incomplete', async () => {
    mocks.generateCandidates.mockReturnValue([{
      ruleId: 'UNRECORDED_ROUTE',
      anchor: { lat: 52, lon: 0 },
      title: 'Question',
      description: 'Description',
      category: 'HISTORIC_CONTEXT',
      status: 'UNRESOLVED',
      confidence: 0.7,
      scanId: 'scan-1',
      supportingEvidence: [],
      contradictingEvidence: [],
    }]);

    await updateQuestionsAfterScan(input({
      sourceAvailability: { ...completeSources, pas_density: false },
    }));

    expect(mocks.diffQuestions).toHaveBeenCalledWith(
      expect.any(Array),
      [],
      expect.any(Number),
      expect.any(Object),
    );
  });

  it('reads and writes question state inside one transaction', async () => {
    await updateQuestionsAfterScan(input());

    const transactionOrder = mocks.transaction.mock.invocationCallOrder[0];
    const readOrder = mocks.questionsToArray.mock.invocationCallOrder[0];
    expect(transactionOrder).toBeLessThan(readOrder);
  });
});
