import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, any>;

const { tables, db } = vi.hoisted(() => {
  function table(initial: Row[] = []) {
    let rows = initial;
    return {
      toArray: vi.fn(async () => structuredClone(rows)),
      clear: vi.fn(async () => { rows = []; }),
      bulkPut: vi.fn(async (items: Row[]) => { rows = structuredClone(items); }),
      _set(items: Row[]) { rows = structuredClone(items); },
      _get() { return structuredClone(rows); },
    };
  }

  const tables = {
    projects: table(), permissions: table(), fields: table(), sessions: table(),
    finds: table(), significantFinds: table(), media: table(), tracks: table(),
    settings: table(), importedPackages: table(), savedPoints: table(),
    undugSignals: table(), outstandingQuestions: table(), questionNotes: table(),
  };
  return {
    tables,
    db: {
      ...tables,
      transaction: vi.fn(async (_mode: string, _tables: unknown[], callback: () => Promise<void>) => callback()),
    },
  };
});

vi.mock('../../src/db', () => ({ db }));

import { exportData, importData } from '../../src/services/data';

describe('outstanding questions backup round-trip', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const table of Object.values(tables)) table._set([]);
    tables.projects._set([{ id: 'project-1', name: 'Project', region: 'England', createdAt: '2026-01-01' }]);
    tables.permissions._set([{
      id: 'permission-1',
      projectId: 'project-1',
      protectionStatus: {
        state: 'present', evaluatedAt: '2026-07-14T12:00:00.000Z', monumentCount: 1,
      },
      pasContext: {
        count: 12, topPeriods: ['ROMAN'], topTypes: ['COIN'],
        evaluatedAt: '2026-07-14T12:00:00.000Z',
      },
    }]);
    tables.outstandingQuestions._set([{
      id: 'question-1',
      permissionId: 'permission-1',
      ruleId: 'MOVEMENT_NO_FINDS',
      anchor: { lat: 52, lon: 0 },
      title: 'Question',
      description: 'Description',
      category: 'MOVEMENT',
      status: 'RESOLVED',
      confidence: 0.7,
      createdAt: 100,
      updatedAt: 200,
      generatedByScanId: 'scan-1',
      supportingEvidence: [{ label: 'Evidence', sourceScanId: 'scan-1' }],
      contradictingEvidence: [],
      consecutiveMisses: 2,
      resolvedReason: 'preconditions_cleared',
      resolvedAt: 200,
      dismissedByUser: true,
      hypothesisId: 'activity_follows_route',
      metrics: { localCoveragePct: 65, findsNearCount: 1, bufferM: 200 },
      initialMetrics: { localCoveragePct: 15, findsNearCount: 0, bufferM: 200 },
      contextGeometry: [[-0.001, 52], [0, 52], [0.001, 52]],
      resolvedOutcome: 'likely_supported',
      priorityState: { scansSinceEvidenceChange: 2 },
      supersededByIds: ['question-2'],
    }]);
    tables.questionNotes._set([
      {
        id: 'note-1', questionId: 'question-1', author: 'user',
        type: 'found_something', text: 'A useful comparison.',
        linkedFindIds: ['removed-find'], createdAt: 300,
      },
      {
        id: 'note-2', questionId: 'question-1', author: 'system',
        type: 'status_change', text: 'The investigation closed.', createdAt: 301,
      },
      {
        id: 'note-3', questionId: 'question-1', author: 'system',
        type: 'merged_from', text: 'Merged from an earlier investigation.', createdAt: 302,
      },
    ]);
  });

  it('exports and restores permission context, question state, dismissals and notes', async () => {
    const json = await exportData();
    const exported = JSON.parse(json);
    expect(exported.outstandingQuestions).toEqual(tables.outstandingQuestions._get());
    expect(exported.questionNotes).toEqual(tables.questionNotes._get());
    expect(exported.permissions).toEqual(tables.permissions._get());

    tables.permissions._set([]);
    tables.outstandingQuestions._set([]);
    tables.questionNotes._set([]);
    await importData(json);

    expect(tables.permissions._get()).toEqual(exported.permissions);
    expect(tables.outstandingQuestions._get()).toEqual(exported.outstandingQuestions);
    expect(tables.questionNotes._get()).toEqual(exported.questionNotes);
    expect(tables.outstandingQuestions.bulkPut).toHaveBeenCalledWith(exported.outstandingQuestions);
    expect(tables.questionNotes.bulkPut).toHaveBeenCalledWith(exported.questionNotes);
  });

  it('accepts an old export but filters retired rule rows before insertion', async () => {
    const exported = JSON.parse(await exportData());
    exported.questionNotes = [];
    exported.outstandingQuestions.push({
      ...exported.outstandingQuestions[0],
      id: 'retired-question',
      ruleId: 'PROTECTED_AREA_EXCLUSION',
      category: 'HISTORIC_CONTEXT',
      dismissedByUser: undefined,
    });

    await importData(JSON.stringify(exported));

    expect(tables.outstandingQuestions._get().map(row => row.id)).toEqual(['question-1']);
    expect(tables.outstandingQuestions.bulkPut).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'question-1', ruleId: 'MOVEMENT_NO_FINDS' }),
    ]);
  });
});
