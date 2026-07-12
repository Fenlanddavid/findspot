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
    undugSignals: table(), outstandingQuestions: table(),
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
    for (const table of Object.values(tables)) table._set([]);
    tables.projects._set([{ id: 'project-1', name: 'Project', region: 'England', createdAt: '2026-01-01' }]);
    tables.permissions._set([{ id: 'permission-1', projectId: 'project-1' }]);
    tables.outstandingQuestions._set([{
      id: 'question-1',
      permissionId: 'permission-1',
      ruleId: 'MOVEMENT_NO_FINDS',
      anchor: { lat: 52, lon: 0 },
      title: 'Question',
      description: 'Description',
      category: 'MOVEMENT',
      status: 'WEAKENING',
      confidence: 0.7,
      createdAt: 100,
      updatedAt: 200,
      generatedByScanId: 'scan-1',
      supportingEvidence: [{ label: 'Evidence', sourceScanId: 'scan-1' }],
      contradictingEvidence: [],
      consecutiveMisses: 1,
    }]);
  });

  it('exports and restores question identity, evidence and lifecycle state', async () => {
    const json = await exportData();
    const exported = JSON.parse(json);
    expect(exported.outstandingQuestions).toEqual(tables.outstandingQuestions._get());

    tables.outstandingQuestions._set([]);
    await importData(json);

    expect(tables.outstandingQuestions._get()).toEqual(exported.outstandingQuestions);
    expect(tables.outstandingQuestions.bulkPut).toHaveBeenCalledWith(exported.outstandingQuestions);
  });
});
