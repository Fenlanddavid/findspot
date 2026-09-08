import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import {
  FINDSPOT_CURRENT_VERSION,
  FindSpotDB,
  applyFindSpotVersions,
} from '../../src/db';

const databaseNames = new Set<string>();

class CompatibilityRollbackDB extends Dexie {
  constructor(name: string) {
    super(name);
    // A rollback must retain this current schema registry even when its engine
    // and interface files come from the prior live release.
    applyFindSpotVersions(this);
  }
}

afterEach(async () => {
  await Promise.all([...databaseNames].map(name => Dexie.delete(name)));
  databaseNames.clear();
});

describe('old → new → compatibility rollback', () => {
  it('preserves copied user records and the new prediction ledger across rollback', async () => {
    const name = `findspot-rollback-${crypto.randomUUID()}`;
    databaseNames.add(name);

    const old = new Dexie(name);
    applyFindSpotVersions(old, 46);
    await old.open();
    await old.table('projects').put({
      id: 'project-1', name: 'Existing project', region: 'England',
      createdAt: '2026-08-01T09:00:00.000Z',
    });
    await old.table('permissions').put({
      id: 'permission-1', projectId: 'project-1', name: 'Existing permission',
      type: 'individual', permissionGranted: true,
      createdAt: '2026-08-01T09:00:00.000Z',
    });
    await old.table('sessions').put({
      id: 'session-1', projectId: 'project-1', permissionId: 'permission-1',
      date: '2026-08-02', isFinished: true,
      createdAt: '2026-08-02T09:00:00.000Z',
    });
    await old.table('finds').put({
      id: 'find-1', projectId: 'project-1', permissionId: 'permission-1',
      sessionId: 'session-1', findCode: 'F-001', objectType: 'Coin',
      completeness: 'Complete', lat: 52.2, lon: 0.12,
      createdAt: '2026-08-02T10:00:00.000Z',
    });
    await old.table('hotspotPredictions').put({
      id: 'prediction-1', permissionId: 'permission-1', sessionId: 'session-1',
      engineVersion: 'live-engine', confidence: 'Strong Signal', surfacedAt: 1,
      center: [0.12, 52.2], bounds: [[0.119, 52.199], [0.121, 52.201]],
      geohash6: 'u120fx', outcome: 'hit', matchedFindId: 'find-1',
    });
    const copiedOldFind = await old.table('finds').get('find-1');
    old.close();

    const next = new FindSpotDB(name);
    await next.open();
    expect(next.verno).toBe(FINDSPOT_CURRENT_VERSION);
    expect(await next.finds.get('find-1')).toEqual(copiedOldFind);
    expect(await next.hotspotPredictions.get('prediction-1')).toMatchObject({
      outcome: 'find_recorded', legacyOutcome: 'hit', matchedFindId: 'find-1',
    });
    await next.finds.update('find-1', {
      locationMethod: 'live_gps',
      locationFixAt: '2026-08-02T09:59:58.000Z',
      locationFrozenAt: '2026-08-02T10:00:00.000Z',
    });
    await next.hotspotPredictionEvidence.put({
      id: 'prediction-1:find_association:find-1', predictionId: 'prediction-1',
      kind: 'find_association', sourceRecordId: 'find-1', observedAt: 2,
      permissionId: 'permission-1', sessionId: 'session-1',
      createdAt: '2026-08-02T10:00:00.000Z',
    });
    next.close();

    const rollback = new CompatibilityRollbackDB(name);
    await rollback.open();
    expect(rollback.verno).toBe(FINDSPOT_CURRENT_VERSION);
    expect(await rollback.table('projects').get('project-1')).toMatchObject({
      name: 'Existing project',
    });
    expect(await rollback.table('permissions').get('permission-1')).toMatchObject({
      name: 'Existing permission',
    });
    expect(await rollback.table('sessions').get('session-1')).toMatchObject({
      date: '2026-08-02', isFinished: true,
    });
    expect(await rollback.table('finds').get('find-1')).toMatchObject({
      objectType: 'Coin', completeness: 'Complete', locationMethod: 'live_gps',
      locationFixAt: '2026-08-02T09:59:58.000Z',
      locationFrozenAt: '2026-08-02T10:00:00.000Z',
    });
    expect(await rollback.table('hotspotPredictions').get('prediction-1')).toMatchObject({
      outcome: 'find_recorded', legacyOutcome: 'hit', matchedFindId: 'find-1',
    });
    expect(await rollback.table('hotspotPredictionEvidence').get(
      'prediction-1:find_association:find-1',
    )).toMatchObject({ kind: 'find_association', sourceRecordId: 'find-1' });
    rollback.close();
  });
});
