import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../src/db';
import {
  drillRestore,
  getSetting,
  importData,
  markExternalBackupSaved,
  type BackupImportProgress,
} from '../../src/services/data';
import { ensurePermissionSections, saveReportedSessionCoverage } from '../../src/services/coverageMutations';
import { auditDatabaseIntegrity } from '../../src/services/integrityAudit';
import { BACKUP_FIXTURE_FACTORIES } from '../fixtures/backupFixtureFactories';

function backup(overrides: Record<string, unknown> = {}) {
  return {
    version: 6,
    exportedAt: '2026-07-22T12:00:00.000Z',
    generatedBy: 'FindSpot',
    projects: [{
      id: 'restored-project',
      name: 'Restored project',
      region: 'England',
      createdAt: '2026-07-22T12:00:00.000Z',
    }],
    ...overrides,
  };
}

async function stagingDatabaseNames(): Promise<string[]> {
  return (await Dexie.getDatabaseNames())
    .filter(name => name.startsWith('findspot_restore_staging_'));
}

beforeEach(async () => {
  db.close();
  await Dexie.delete(db.name);
  await Promise.all((await stagingDatabaseNames()).map(name => Dexie.delete(name)));
  await db.open();
});

afterEach(async () => {
  vi.restoreAllMocks();
  db.close();
  await Dexie.delete(db.name);
  await Promise.all((await stagingDatabaseNames()).map(name => Dexie.delete(name)));
});

describe('backup import characterization', () => {
  it('clears a reminder snooze when an external backup is saved', async () => {
    await db.settings.put({ key: 'backupSnoozedUntil', value: '2099-01-01T00:00:00.000Z' });

    const savedAt = await markExternalBackupSaved();

    expect(await getSetting('lastBackupDate', null)).toBe(savedAt);
    expect(await db.settings.get('backupSnoozedUntil')).toBeUndefined();
  });

  it('reports the existing JSON import phase and percentage sequence', async () => {
    const progress: BackupImportProgress[] = [];

    await importData(JSON.stringify(backup()), {
      onProgress: update => progress.push(update),
    });

    expect(progress.map(({ phase, percent }) => ({ phase, percent }))).toEqual([
      { phase: 'reading', percent: 90 },
      { phase: 'validating', percent: 92 },
      { phase: 'restoring', percent: 95 },
      { phase: 'restoring', percent: 100 },
    ]);
  });

  it('replaces backed-up tables while retaining excluded regenerable caches', async () => {
    await db.projects.put({
      id: 'live-project',
      name: 'Live project',
      region: 'England',
      createdAt: '2026-07-21T12:00:00.000Z',
    });
    await db.geologyContext.put({
      tileKey: 'retained-cache',
      fetchedAt: Date.now(),
      context: { source: 'characterization' },
    } as never);

    await importData(JSON.stringify(backup()));

    expect((await db.projects.toArray()).map(row => row.id)).toEqual(['restored-project']);
    expect(await db.permissionSections.count()).toBe(0);
    expect(await db.sessionCoverage.count()).toBe(0);
    expect(await db.geologyContext.get('retained-cache')).toBeDefined();
  });

  it('preserves restored legacy permission-level coverage without allowing extensions', async () => {
    const legacySection = {
      ...BACKUP_FIXTURE_FACTORIES.permissionSections(),
      id: 'permission-1:whole',
      fieldId: null,
      label: 'South Field',
    };
    const legacyObservation = {
      ...BACKUP_FIXTURE_FACTORIES.sessionCoverage(),
      id: 'session-1:permission-1:whole:v1:reported',
      sectionId: legacySection.id,
    };
    const restoredSession = {
      ...BACKUP_FIXTURE_FACTORIES.sessions(),
      fieldId: null,
      endTime: '2026-07-23T12:00:00.000Z',
    };

    await importData(JSON.stringify(backup({
      projects: [BACKUP_FIXTURE_FACTORIES.projects()],
      permissions: [BACKUP_FIXTURE_FACTORIES.permissions()],
      fields: [],
      sessions: [restoredSession],
      permissionSections: [legacySection],
      sessionCoverage: [legacyObservation],
    })));

    expect((await auditDatabaseIntegrity(db)).issueCount).toBe(0);
    expect(await db.sessionCoverage.get(legacyObservation.id)).toBeDefined();
    expect(await ensurePermissionSections(
      'permission-1',
      '2026-07-25T12:00:00.000Z',
    )).toEqual([]);
    expect((await db.permissionSections.get(legacySection.id))?.retiredAt)
      .toBe('2026-07-25T12:00:00.000Z');
    expect(await db.sessionCoverage.get(legacyObservation.id)).toBeDefined();
    await expect(saveReportedSessionCoverage(
      restoredSession.id,
      new Set([legacySection.id]),
      Date.parse('2026-07-23T13:00:00.000Z'),
    )).rejects.toThrow('Add a mapped field');
  });

  it('normalizes legacy surface-period vocabulary during restore', async () => {
    const legacy = {
      ...BACKUP_FIXTURE_FACTORIES.surfaceObservations(),
      fieldId: null,
      sectionId: null,
      sessionId: null,
      periodImpression: 'anglo_saxon',
      reassessments: [{
        previous: {
          material: 'pottery', abundance: 'few', materialConfidence: 'confident',
          periodImpression: 'prehistoric', datingConfidence: 'fairly_sure',
        },
        current: {
          material: 'pottery', abundance: 'dense', materialConfidence: 'confident',
          periodImpression: 'anglo_saxon', datingConfidence: 'confident',
        },
        reassessedAt: '2026-07-23T12:00:00.000Z',
      }],
    };

    await importData(JSON.stringify(backup({
      version: 8,
      projects: [BACKUP_FIXTURE_FACTORIES.projects()],
      permissions: [BACKUP_FIXTURE_FACTORIES.permissions()],
      surfaceObservations: [legacy],
    })));

    expect(await db.surfaceObservations.get(legacy.id)).toMatchObject({
      periodImpression: 'early_medieval',
      reassessments: [{
        previous: { periodImpression: 'unknown' },
        current: { periodImpression: 'early_medieval' },
      }],
    });
  });

  it('restores V2 surface context, non-relational origin provenance and owned media', async () => {
    const observation = {
      ...BACKUP_FIXTURE_FACTORIES.surfaceObservations(),
      fieldId: null,
      sectionId: null,
      sessionId: null,
      originSessionId: 'deleted-session',
      originSessionDate: '2026-07-20T10:00:00.000Z',
    };
    const surfacePhoto = {
      id: 'surface-photo-1', projectId: 'project-1', permissionId: 'permission-1',
      surfaceObservationId: observation.id, type: 'photo', photoType: 'other',
      filename: 'surface.jpg', mime: 'image/jpeg',
      blob: 'data:image/jpeg;base64,/9j/2Q==', caption: '', scalePresent: false,
      createdAt: '2026-07-23T12:00:00.000Z',
    };

    await importData(JSON.stringify(backup({
      version: 9,
      projects: [BACKUP_FIXTURE_FACTORIES.projects()],
      permissions: [BACKUP_FIXTURE_FACTORIES.permissions()],
      surfaceObservations: [observation],
      media: [surfacePhoto],
    })));

    expect(await db.surfaceObservations.get(observation.id)).toMatchObject({
      originSessionId: 'deleted-session', extent: 'approx_25m', surfaceVisibility: 'good',
    });
    expect(await db.media.get(surfacePhoto.id)).toMatchObject({
      surfaceObservationId: observation.id, permissionId: 'permission-1',
    });
  });

  it('rejects invalid V2 context while leaving optional legacy values absent', async () => {
    const base = {
      ...BACKUP_FIXTURE_FACTORIES.surfaceObservations(),
      fieldId: null, sectionId: null, sessionId: null,
    };
    await expect(importData(JSON.stringify(backup({
      version: 9,
      projects: [BACKUP_FIXTURE_FACTORIES.projects()],
      permissions: [BACKUP_FIXTURE_FACTORIES.permissions()],
      surfaceObservations: [{ ...base, note: 'x'.repeat(501) }],
    })))).rejects.toThrow('note');
    await expect(importData(JSON.stringify(backup({
      version: 9,
      projects: [BACKUP_FIXTURE_FACTORIES.projects()],
      permissions: [BACKUP_FIXTURE_FACTORIES.permissions()],
      surfaceObservations: [{ ...base, groundCondition: 'pasture', groundConditionOther: 'Muddy verge' }],
    })))).rejects.toThrow('groundConditionOther');
  });

  it('drills the complete restore without replacing live data or recording a restore', async () => {
    await db.projects.put({
      id: 'live-project',
      name: 'Live project',
      region: 'England',
      createdAt: '2026-07-21T12:00:00.000Z',
    });

    const report = await drillRestore(JSON.stringify(backup()));

    expect(report).toEqual(expect.objectContaining({
      mode: 'drill',
      ready: true,
      backupVersion: 6,
      totals: expect.objectContaining({ imported: 1, damaged: 0 }),
    }));
    expect(Object.keys(report.tables)).toHaveLength(22);
    expect((await db.projects.toArray()).map(row => row.id)).toEqual(['live-project']);
    expect(await getSetting('lastRestoreReport', null)).toBeNull();
    expect(await stagingDatabaseNames()).toEqual([]);
  });

  it('returns and atomically records the recovery report for a confirmed restore', async () => {
    const report = await importData(JSON.stringify(backup()));

    expect(report.mode).toBe('restore');
    expect(report.tables.projects).toEqual({
      imported: 1,
      skipped: 0,
      repaired: 0,
      damaged: 0,
    });
    expect(await getSetting('lastRestoreReport', null)).toEqual(report);
  });

  it('does not open the replacement transaction when validation fails', async () => {
    await db.projects.put({
      id: 'live-project',
      name: 'Live project',
      region: 'England',
      createdAt: '2026-07-21T12:00:00.000Z',
    });
    const transaction = vi.spyOn(db, 'transaction');

    await expect(importData(JSON.stringify(backup({ projects: 'invalid' }))))
      .rejects.toThrow(/projects/i);

    expect(transaction).not.toHaveBeenCalled();
    expect((await db.projects.toArray()).map(row => row.id)).toEqual(['live-project']);
  });

  it('rolls back cleared and written rows when a quota error interrupts replacement', async () => {
    await db.projects.put({
      id: 'live-project',
      name: 'Live project',
      region: 'England',
      createdAt: '2026-07-21T12:00:00.000Z',
    });
    await db.permissions.put({
      id: 'live-permission',
      projectId: 'live-project',
      name: 'Live permission',
      type: 'individual',
      createdAt: '2026-07-21T12:00:00.000Z',
      updatedAt: '2026-07-21T12:00:00.000Z',
    } as never);
    vi.spyOn(db.permissions, 'bulkPut').mockRejectedValueOnce(
      new DOMException('Storage quota exhausted', 'QuotaExceededError'),
    );

    await expect(importData(JSON.stringify(backup({
      permissions: [{
        id: 'restored-permission',
        projectId: 'restored-project',
        name: 'Restored permission',
        type: 'individual',
        createdAt: '2026-07-22T12:00:00.000Z',
        updatedAt: '2026-07-22T12:00:00.000Z',
      }],
    })))).rejects.toThrow(
      'Not enough free device storage to complete this restore. Existing FindSpot data has not been changed.',
    );

    expect((await db.projects.toArray()).map(row => row.id)).toEqual(['live-project']);
    expect((await db.permissions.toArray()).map(row => row.id)).toEqual(['live-permission']);
  });
});
