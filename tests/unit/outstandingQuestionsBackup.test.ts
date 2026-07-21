import { beforeEach, describe, expect, it, vi } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';

type Row = Record<string, any>;

const { tables, db } = vi.hoisted(() => {
  function table(initial: Row[] = []) {
    let rows = initial;
    return {
      toArray: vi.fn(async () => structuredClone(rows)),
      toCollection: vi.fn(() => ({
        primaryKeys: vi.fn(async () => rows.map(row => row.id ?? row.signalKey ?? row.key)),
      })),
      get: vi.fn(async (key: string) => structuredClone(rows.find(row => (row.id ?? row.signalKey ?? row.key) === key))),
      put: vi.fn(async (item: Row) => {
        const key = item.id ?? item.signalKey ?? item.key;
        const index = rows.findIndex(row => (row.id ?? row.signalKey ?? row.key) === key);
        if (index >= 0) rows[index] = structuredClone(item);
        else rows.push(structuredClone(item));
        return key;
      }),
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
    undugSignals: table(), findHotspotSignals: table(),
    hotspotPredictions: table(), hotspotPredictionAggregates: table(),
    outstandingQuestions: table(), questionNotes: table(),
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
    const blob = await exportData();
    const json = await blob.text();
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
    const blob = await exportData();
    const exported = JSON.parse(await blob.text());
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

  it('round-trips binary media and hotspot accuracy history through a full zip backup', async () => {
    const mediaBytes = new Uint8Array([0, 1, 2, 127, 255]);
    tables.media._set([{
      id: 'media-1', projectId: 'project-1', permissionId: 'permission-1',
      type: 'photo', filename: 'field.jpg', mime: 'image/jpeg',
      blob: new Blob([mediaBytes], { type: 'image/jpeg' }), caption: '',
      scalePresent: false, createdAt: '2026-07-16T12:00:00.000Z',
    }]);
    tables.findHotspotSignals._set([{
      signalKey: 'permission-1:gcpuuz', permissionId: 'permission-1', geohash6: 'gcpuuz',
      findCount: 1, findIds: ['find-1'], periodCounts: { Roman: 1 },
      lastFindAt: '2026-07-16T12:00:00.000Z',
      lastHotspotClassification: 'Settlement Edge Candidate', lastHotspotScore: 72,
      updatedAt: 1_768_476_000_000,
    }]);

    const progress = vi.fn();
    const backup = await exportData({ includeMedia: true, onProgress: progress });
    const backupBytes = new Uint8Array(await backup.arrayBuffer());
    // The first local-file header must be manifest.json, allowing previews of
    // very large photo archives without scanning through their media payloads.
    const filenameLength = new DataView(backupBytes.buffer).getUint16(26, true);
    expect(strFromU8(backupBytes.slice(30, 30 + filenameLength))).toBe('manifest.json');
    expect(progress).toHaveBeenLastCalledWith({ processedMedia: 1, totalMedia: 1, percent: 100 });

    const entries = unzipSync(backupBytes);
    const manifest = JSON.parse(strFromU8(entries['manifest.json']));
    expect(manifest.media).toEqual([
      expect.objectContaining({ id: 'media-1', _zipEntry: 'media/media-1.jpg' }),
    ]);
    expect(Array.from(entries['media/media-1.jpg'])).toEqual(Array.from(mediaBytes));
    expect(manifest.findHotspotSignals).toEqual(tables.findHotspotSignals._get());

    tables.media._set([]);
    tables.findHotspotSignals._set([]);
    await importData(await backup.arrayBuffer());

    const [restoredMedia] = tables.media._get();
    expect(restoredMedia.blob).toBeInstanceOf(Blob);
    expect(Array.from(new Uint8Array(await restoredMedia.blob.arrayBuffer()))).toEqual(Array.from(mediaBytes));
    expect(restoredMedia.mime).toBe('image/jpeg');
    expect(tables.findHotspotSignals._get()).toEqual(manifest.findHotspotSignals);
  });
});
