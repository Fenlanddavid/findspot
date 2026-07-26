import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../src/db';

const { refreshHotspotPredictionOutcomes } = vi.hoisted(() => ({
  refreshHotspotPredictionOutcomes: vi.fn(),
}));

vi.mock('../../src/services/hotspotPredictionService', () => ({
  refreshHotspotPredictionOutcomes,
}));

import { saveSessionSearchedAreas } from '../../src/services/sessionCoverageCommands';
import { ensurePermissionSections } from '../../src/services/coverageMutations';

const ISO = '2026-07-24T08:00:00.000Z';

beforeEach(async () => {
  refreshHotspotPredictionOutcomes.mockReset();
  await db.open();
  await Promise.all([
    db.projects.clear(),
    db.permissions.clear(),
    db.fields.clear(),
    db.sessions.clear(),
    db.permissionSections.clear(),
    db.sessionCoverage.clear(),
    db.diagnosticLog.clear(),
  ]);
  await db.projects.put({
    id: 'project-1',
    name: 'Project',
    region: 'England',
    createdAt: ISO,
  });
  await db.permissions.put({
    id: 'permission-1',
    projectId: 'project-1',
    name: 'Permission',
    type: 'individual',
    lat: 52,
    lon: 0,
    gpsAccuracyM: 5,
    collector: 'Tester',
    landType: 'arable',
    permissionGranted: true,
    notes: '',
    createdAt: ISO,
    updatedAt: ISO,
  });
  await db.fields.put({
    id: 'field-1',
    projectId: 'project-1',
    permissionId: 'permission-1',
    name: 'North field',
    boundary: {
      type: 'Polygon',
      coordinates: [[
        [0, 52], [0.001, 52], [0.001, 52.001],
        [0, 52.001], [0, 52],
      ]],
    },
    notes: '',
    createdAt: ISO,
    updatedAt: ISO,
  });
  await db.sessions.put({
    id: 'session-1',
    projectId: 'project-1',
    permissionId: 'permission-1',
    fieldId: 'field-1',
    date: ISO,
    lat: null,
    lon: null,
    gpsAccuracyM: null,
    landUse: '',
    cropType: '',
    isStubble: false,
    notes: '',
    isFinished: true,
    endTime: ISO,
    createdAt: ISO,
    updatedAt: ISO,
  });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await db.sessionCoverage.clear();
});

describe('session searched-area command', () => {
  it('reports a pending derived refresh without misrepresenting the saved evidence', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse(ISO) + 60_000);
    const sections = await ensurePermissionSections('permission-1', ISO);
    refreshHotspotPredictionOutcomes.mockRejectedValueOnce(
      new Error('Derived refresh failed'),
    );

    const result = await saveSessionSearchedAreas({
      sessionId: 'session-1',
      selectedSectionIds: new Set([sections[0].id]),
    });

    expect(result.predictionRefresh).toBe('pending');
    expect(refreshHotspotPredictionOutcomes).toHaveBeenCalledWith('permission-1');
    expect(result.observations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sessionId: 'session-1',
        sectionId: sections[0].id,
        evidence: 'reported',
      }),
    ]));
    expect(await db.sessionCoverage.where('sessionId').equals('session-1').count())
      .toBe(1);
  });
});
