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
    expect(await db.geologyContext.get('retained-cache')).toBeDefined();
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
    expect(Object.keys(report.tables)).toHaveLength(17);
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
