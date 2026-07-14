import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const findsToArray = vi.fn();
  const sessionsToArray = vi.fn();
  const tracksToArray = vi.fn();
  const questionsToArray = vi.fn();
  const notesToArray = vi.fn();
  const bulkPut = vi.fn();
  const updateNote = vi.fn();
  const bulkPutNotes = vi.fn();
  const updatePermission = vi.fn();
  const getPermission = vi.fn();
  const generateCandidates = vi.fn();
  const diffQuestions = vi.fn();
  const calculateCoverage = vi.fn();
  const transaction = vi.fn(async (_mode: string, _table: unknown, callback: () => Promise<void>) => callback());

  return {
    findsToArray,
    sessionsToArray,
    tracksToArray,
    questionsToArray,
    notesToArray,
    bulkPut,
    updateNote,
    bulkPutNotes,
    updatePermission,
    getPermission,
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
    questionNotes: {
      where: () => ({ anyOf: () => ({ toArray: mocks.notesToArray }) }),
      update: mocks.updateNote,
      bulkPut: mocks.bulkPutNotes,
    },
    permissions: { get: mocks.getPermission, update: mocks.updatePermission },
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
    mocks.notesToArray.mockResolvedValue([]);
    mocks.generateCandidates.mockReturnValue([]);
    mocks.diffQuestions.mockReturnValue({ upserts: [], resolved: [] });
    mocks.calculateCoverage.mockReturnValue({
      undetectionsGeoJSON: null,
      detectedAreaM2: 40,
      totalAreaM2: 100,
      percentCovered: 40,
      percentUndetected: 60,
    });
    mocks.getPermission.mockResolvedValue(permission);
  });

  it('does nothing when the scan centre is outside every permission', async () => {
    await updateQuestionsAfterScan(input({ scanCenter: { lat: 53, lng: 0 } }));

    expect(mocks.generateCandidates).not.toHaveBeenCalled();
    expect(mocks.bulkPut).not.toHaveBeenCalled();
  });

  it('uses an explicitly requested permission even when its saved scan centre is outside the boundary', async () => {
    await updateQuestionsAfterScan(input({
      permissionId: 'permission-1',
      scanCenter: { lat: 53, lng: 0 },
    }));

    expect(mocks.generateCandidates).toHaveBeenCalled();
    expect(mocks.updatePermission).toHaveBeenCalledWith('permission-1', {
      questionsEvaluatedAt: expect.any(String),
    });
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
    expect(mocks.updatePermission).toHaveBeenCalledWith('permission-1', {
      questionsEvaluatedAt: expect.any(String),
    });
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

  it('filters candidates and differ coverage to the rules owned by this scan pass', async () => {
    const candidate = (ruleId: string) => ({
      ruleId,
      anchor: { lat: 52, lon: 0 },
      title: 'Question',
      description: 'Description',
      category: 'HISTORIC_CONTEXT',
      status: 'NEEDS_EVIDENCE',
      confidence: 0.7,
      scanId: 'scan-1',
      supportingEvidence: [],
      contradictingEvidence: [],
    });
    mocks.generateCandidates.mockReturnValue([
      candidate('ROMAN_ROUTE_ACTIVITY'),
      candidate('MOVEMENT_NO_FINDS'),
    ]);

    await updateQuestionsAfterScan(input({ ruleIds: ['ROMAN_ROUTE_ACTIVITY'] }));

    expect(mocks.diffQuestions.mock.calls[0][1]).toEqual([
      expect.objectContaining({ ruleId: 'ROMAN_ROUTE_ACTIVITY' }),
    ]);
    const diffScope = mocks.diffQuestions.mock.calls[0][3];
    expect(diffScope.contains({ ruleId: 'ROMAN_ROUTE_ACTIVITY', anchor: { lat: 52, lon: 0 } })).toBe(true);
    expect(diffScope.contains({ ruleId: 'MOVEMENT_NO_FINDS', anchor: { lat: 52, lon: 0 } })).toBe(false);
  });

  it('reads and writes question state inside a transaction', async () => {
    await updateQuestionsAfterScan(input());

    // Two transactions: protection/pasContext write, then diff/persist.
    // The diff transaction (second) must contain the question read.
    expect(mocks.transaction).toHaveBeenCalledTimes(2);
    const diffTransactionOrder = mocks.transaction.mock.invocationCallOrder[1];
    const readOrder = mocks.questionsToArray.mock.invocationCallOrder[0];
    expect(diffTransactionOrder).toBeLessThan(readOrder);
  });

  it('marks a matched permission as evaluated even when no questions fire', async () => {
    await updateQuestionsAfterScan(input());

    expect(mocks.bulkPut).not.toHaveBeenCalled();
    expect(mocks.updatePermission).toHaveBeenCalledWith(
      'permission-1',
      expect.objectContaining({ questionsEvaluatedAt: expect.any(String) }),
    );
  });

  it('keeps a partial green scan unknown and marks a fully containing green scan clear', async () => {
    await updateQuestionsAfterScan(input({
      scanBounds: { west: -0.005, south: 51.995, east: 0.005, north: 52.005 },
    }));
    expect(mocks.updatePermission).toHaveBeenNthCalledWith(1, 'permission-1',
      expect.objectContaining({
        protectionStatus: expect.objectContaining({ state: 'unknown', evaluatedAt: expect.any(String) }),
      }),
    );

    vi.clearAllMocks();
    mocks.findsToArray.mockResolvedValue([]);
    mocks.sessionsToArray.mockResolvedValue([]);
    mocks.questionsToArray.mockResolvedValue([]);
    mocks.notesToArray.mockResolvedValue([]);
    mocks.generateCandidates.mockReturnValue([]);
    mocks.diffQuestions.mockReturnValue({ upserts: [], resolved: [] });
    mocks.calculateCoverage.mockReturnValue(null);
    mocks.getPermission.mockResolvedValue(permission);

    await updateQuestionsAfterScan(input());
    expect(mocks.updatePermission).toHaveBeenNthCalledWith(1, 'permission-1',
      expect.objectContaining({
        protectionStatus: expect.objectContaining({ state: 'clear', evaluatedAt: expect.any(String) }),
      }),
    );
  });

  it('preserves a present state and monument count when monument coverage is unavailable', async () => {
    mocks.getPermission.mockResolvedValue({
      ...permission,
      protectionStatus: {
        state: 'present', evaluatedAt: '2026-01-01T00:00:00.000Z', monumentCount: 4,
      },
    });

    await updateQuestionsAfterScan(input({
      sourceAvailability: { ...completeSources, scheduled_monuments: false },
      scheduledMonuments: { features: [], available: false },
    }));

    expect(mocks.updatePermission).toHaveBeenNthCalledWith(1, 'permission-1',
      expect.objectContaining({
        protectionStatus: {
          state: 'present', evaluatedAt: expect.any(String), monumentCount: 4,
        },
      }),
    );
  });

  it('persists permission context before candidate generation can fail', async () => {
    mocks.generateCandidates.mockImplementation(() => { throw new Error('candidate failure'); });

    await expect(updateQuestionsAfterScan(input())).rejects.toThrow('candidate failure');

    expect(mocks.updatePermission).toHaveBeenCalledWith('permission-1',
      expect.objectContaining({
        protectionStatus: expect.any(Object),
        pasContext: expect.objectContaining({ count: 3 }),
      }),
    );
    expect(mocks.diffQuestions).not.toHaveBeenCalled();
  });

  it('includes question notes in the diff persistence transaction', async () => {
    await updateQuestionsAfterScan(input());

    expect(mocks.transaction.mock.calls[1][1]).toHaveLength(3);
  });

  it('increments decay without changing stored confidence when scan evidence is unchanged', async () => {
    const previous = {
      id: 'question-1', permissionId: 'permission-1', ruleId: 'MOVEMENT_NO_FINDS',
      hypothesisId: 'activity_follows_route', anchor: { lat: 52, lon: 0 },
      title: 'Question', description: 'Description', category: 'MOVEMENT',
      status: 'UNRESOLVED', confidence: 0.8, createdAt: 1, updatedAt: 100,
      generatedByScanId: 'scan-old', supportingEvidence: [], contradictingEvidence: [],
      metrics: { localCoveragePct: 60, findsNearCount: 0, bufferM: 200 },
      initialMetrics: { localCoveragePct: 20, findsNearCount: 0, bufferM: 200 },
      priorityState: { scansSinceEvidenceChange: 2 },
    } as any;
    const updated = { ...previous, updatedAt: 200, generatedByScanId: 'scan-new' };
    mocks.questionsToArray.mockResolvedValue([previous]);
    mocks.diffQuestions.mockReturnValue({ upserts: [updated], resolved: [] });

    await updateQuestionsAfterScan(input());

    expect(mocks.bulkPut).toHaveBeenCalledWith([
      expect.objectContaining({
        confidence: 0.8,
        priorityState: { scansSinceEvidenceChange: 3 },
      }),
    ]);
  });

  it('resets decay when a controlled observation was added since the previous scan', async () => {
    const previous = {
      id: 'question-1', permissionId: 'permission-1', ruleId: 'MOVEMENT_NO_FINDS',
      hypothesisId: 'activity_follows_route', anchor: { lat: 52, lon: 0 },
      title: 'Question', description: 'Description', category: 'MOVEMENT',
      status: 'UNRESOLVED', confidence: 0.8, createdAt: 1, updatedAt: 100,
      generatedByScanId: 'scan-old', supportingEvidence: [], contradictingEvidence: [],
      metrics: { localCoveragePct: 60, findsNearCount: 0, bufferM: 200 },
      initialMetrics: { localCoveragePct: 20, findsNearCount: 0, bufferM: 200 },
      priorityState: { scansSinceEvidenceChange: 4 },
    } as any;
    mocks.questionsToArray.mockResolvedValue([previous]);
    mocks.notesToArray.mockResolvedValue([{
      id: 'note-1', questionId: 'question-1', author: 'user',
      type: 'searched_nothing', createdAt: 150,
    }]);
    mocks.diffQuestions.mockReturnValue({
      upserts: [{ ...previous, updatedAt: 200, generatedByScanId: 'scan-new' }],
      resolved: [],
    });

    await updateQuestionsAfterScan(input());

    expect(mocks.bulkPut).toHaveBeenCalledWith([
      expect.objectContaining({ priorityState: { scansSinceEvidenceChange: 0 } }),
    ]);
  });

  it('resets decay for a new note and writes a closure outcome from notes in-transaction', async () => {
    const previous = {
      id: 'question-1', permissionId: 'permission-1', ruleId: 'MOVEMENT_NO_FINDS',
      hypothesisId: 'activity_follows_route', anchor: { lat: 52, lon: 0 },
      title: 'Question', description: 'Description', category: 'MOVEMENT',
      status: 'WEAKENING', confidence: 0.8, createdAt: 1, updatedAt: 100,
      generatedByScanId: 'scan-old', supportingEvidence: [], contradictingEvidence: [],
      metrics: { localCoveragePct: 70, findsNearCount: 0, bufferM: 200 },
      initialMetrics: { localCoveragePct: 20, findsNearCount: 0, bufferM: 200 },
      priorityState: { scansSinceEvidenceChange: 4 }, consecutiveMisses: 1,
    } as any;
    const resolved = {
      ...previous, status: 'RESOLVED', resolvedReason: 'preconditions_cleared',
      resolvedAt: 200, updatedAt: 200, consecutiveMisses: 2,
    } as any;
    mocks.questionsToArray.mockResolvedValue([previous]);
    mocks.notesToArray.mockResolvedValue([{
      id: 'note-1', questionId: 'question-1', author: 'user',
      type: 'searched_nothing', createdAt: 150,
    }]);
    mocks.diffQuestions.mockReturnValue({ upserts: [], resolved: [resolved] });

    await updateQuestionsAfterScan(input());

    expect(mocks.bulkPut).toHaveBeenCalledWith([
      expect.objectContaining({
        resolvedOutcome: 'likely_unsupported',
        priorityState: { scansSinceEvidenceChange: 0 },
      }),
    ]);
    expect(mocks.notesToArray).toHaveBeenCalled();
  });

  it('persists each status transition as a system timeline note', async () => {
    const previous = {
      id: 'question-1', permissionId: 'permission-1', ruleId: 'MOVEMENT_NO_FINDS',
      hypothesisId: 'activity_follows_route', anchor: { lat: 52, lon: 0 },
      title: 'Question', description: 'Description', category: 'MOVEMENT',
      status: 'UNRESOLVED', confidence: 0.8, createdAt: 1, updatedAt: 100,
      generatedByScanId: 'scan-old', supportingEvidence: [], contradictingEvidence: [],
      metrics: { localCoveragePct: 20, findsNearCount: 0, bufferM: 200 },
    } as any;
    mocks.questionsToArray.mockResolvedValue([previous]);
    mocks.diffQuestions.mockReturnValue({
      upserts: [{ ...previous, status: 'WEAKENING', updatedAt: 200 }],
      resolved: [],
    });

    await updateQuestionsAfterScan(input());

    expect(mocks.bulkPutNotes).toHaveBeenCalledWith([
      expect.objectContaining({
        questionId: 'question-1', author: 'system', type: 'status_change',
        text: expect.stringContaining('weakening'),
      }),
    ]);
  });

  it('re-points user notes through a supersession chain and records ancestry on the terminal survivor', async () => {
    const base = {
      permissionId: 'permission-1', ruleId: 'MOVEMENT_NO_FINDS',
      hypothesisId: 'activity_follows_route', anchor: { lat: 52, lon: 0 },
      description: 'Description', category: 'MOVEMENT', status: 'UNRESOLVED',
      confidence: 0.8, createdAt: 1, updatedAt: 100,
      generatedByScanId: 'scan-old', supportingEvidence: [], contradictingEvidence: [],
      metrics: { localCoveragePct: 20, findsNearCount: 0, bufferM: 200 },
    } as any;
    const a = { ...base, id: 'a', title: 'Earlier A' };
    const b = { ...base, id: 'b', title: 'Earlier B' };
    const c = { ...base, id: 'c', title: 'Survivor C' };
    mocks.questionsToArray.mockResolvedValue([a, b, c]);
    mocks.notesToArray.mockResolvedValue([
      { id: 'note-a', questionId: 'a', author: 'user', type: 'freeform', createdAt: 110 },
      { id: 'system-a', questionId: 'a', author: 'system', type: 'status_change', createdAt: 111 },
      { id: 'note-b', questionId: 'b', author: 'user', type: 'searched_nothing', createdAt: 112 },
    ]);
    mocks.diffQuestions.mockReturnValue({
      upserts: [{ ...c, updatedAt: 200 }],
      resolved: [
        { ...a, status: 'RESOLVED', resolvedReason: 'superseded', supersededByIds: ['b'], updatedAt: 200, resolvedAt: 200 },
        { ...b, status: 'RESOLVED', resolvedReason: 'superseded', supersededByIds: ['c'], updatedAt: 200, resolvedAt: 200 },
      ],
    });

    await updateQuestionsAfterScan(input());

    expect(mocks.updateNote).toHaveBeenCalledWith('note-a', { questionId: 'c' });
    expect(mocks.updateNote).toHaveBeenCalledWith('note-b', { questionId: 'c' });
    expect(mocks.updateNote).not.toHaveBeenCalledWith('system-a', expect.anything());
    const writtenNotes = mocks.bulkPutNotes.mock.calls[0][0];
    expect(writtenNotes).toEqual(expect.arrayContaining([
      expect.objectContaining({ questionId: 'c', author: 'system', type: 'merged_from', text: expect.stringContaining('Earlier A') }),
      expect.objectContaining({ questionId: 'c', author: 'system', type: 'merged_from', text: expect.stringContaining('Earlier B') }),
    ]));
  });
});
