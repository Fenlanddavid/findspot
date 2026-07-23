import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { unzipSync, zipSync } from 'fflate';
import { afterEach, describe, expect, it } from 'vitest';
import { FindSpotDB } from '../../src/db';
import { exportData, importData } from '../../src/services/data';
import {
  BACKED_UP_TABLE_NAMES,
  type BackedUpTableName,
} from '../../src/services/backup/tableRegistry';
import {
  BACKUP_FIXTURE_FACTORIES,
  seedBackupFixture,
} from '../fixtures/backupFixtureFactories';

const databaseNames = new Set<string>();

function databaseName(label: string): string {
  const name = `findspot-${label}-${crypto.randomUUID()}`;
  databaseNames.add(name);
  return name;
}

async function tableSnapshot(
  database: FindSpotDB,
): Promise<Record<BackedUpTableName, unknown[]>> {
  return Object.fromEntries(await Promise.all(BACKED_UP_TABLE_NAMES.map(async tableName => [
    tableName,
    await database.table(tableName).toArray(),
  ]))) as Record<BackedUpTableName, unknown[]>;
}

afterEach(async () => {
  await Promise.all([...databaseNames].map(name => Dexie.delete(name)));
  databaseNames.clear();
});

describe('full backup IndexedDB boundary', () => {
  it('requires a fixture factory for every backed-up table', () => {
    expect(Object.keys(BACKUP_FIXTURE_FACTORIES).sort())
      .toEqual([...BACKED_UP_TABLE_NAMES].sort());
  });

  it('exports a full ZIP, deletes the database, and restores every table into a fresh database', async () => {
    const name = databaseName('roundtrip');
    const source = new FindSpotDB(name);
    await source.open();
    await seedBackupFixture(source);

    const archive = await exportData({ includeMedia: true, database: source });
    source.close();
    await Dexie.delete(name);

    const restored = new FindSpotDB(name);
    await restored.open();
    const report = await importData(archive, { database: restored });

    for (const tableName of BACKED_UP_TABLE_NAMES) {
      const expectedCount = tableName === 'settings' ? 2 : 1;
      expect(
        await restored.table(tableName).count(),
        `${tableName} restored count`,
      ).toBe(expectedCount);
      expect(report.tables[tableName]).toEqual({
        imported: 1,
        skipped: 0,
        repaired: 0,
        damaged: 0,
      });
    }

    expect(report.totals).toEqual({
      imported: BACKED_UP_TABLE_NAMES.length,
      skipped: 0,
      repaired: 0,
      damaged: 0,
    });
    expect(await restored.finds.get('find-1')).toEqual(expect.objectContaining({
      objectType: 'Coin',
      period: 'Roman',
      notes: 'Representative fidelity marker.',
    }));
    expect(await restored.permissions.get('permission-1')).toEqual(expect.objectContaining({
      name: 'South Field',
      permissionGranted: true,
    }));

    const restoredMedia = await restored.media.get('media-1');
    expect(restoredMedia?.blob).toBeInstanceOf(Blob);
    expect(Array.from(new Uint8Array(await restoredMedia!.blob.arrayBuffer())))
      .toEqual([0xff, 0xd8, 0x01, 0x02, 0xff, 0xd9]);
    restored.close();
  });

  it('rejects damaged source media with the named diagnostic', async () => {
    const source = new FindSpotDB(databaseName('damaged-source'));
    await source.open();
    await source.projects.put(BACKUP_FIXTURE_FACTORIES.projects() as never);
    await source.media.put({
      ...BACKUP_FIXTURE_FACTORIES.media(),
      blob: undefined,
    } as never);

    await expect(exportData({ includeMedia: true, database: source }))
      .rejects.toThrow('roman-coin.jpg is damaged and cannot be included in a full backup.');
    source.close();
  });

  it('rejects an archive with missing media before changing the target database', async () => {
    const source = new FindSpotDB(databaseName('corrupt-source'));
    await source.open();
    await seedBackupFixture(source);
    const validArchive = await exportData({ includeMedia: true, database: source });
    source.close();

    const entries = unzipSync(new Uint8Array(await validArchive.arrayBuffer()));
    delete entries['media/media-1.jpg'];
    const corruptArchive = new Blob([new Uint8Array(zipSync(entries))], {
      type: 'application/zip',
    });

    const target = new FindSpotDB(databaseName('corrupt-target'));
    await target.open();
    await target.projects.put({
      id: 'existing-project',
      name: 'Must survive',
      region: 'Wales',
      createdAt: '2020-01-01T00:00:00.000Z',
    });
    await target.settings.put({ key: 'existing-setting', value: true });
    const before = await tableSnapshot(target);

    await expect(importData(corruptArchive, { database: target }))
      .rejects.toThrow('Invalid backup zip: missing media entry media/media-1.jpg');
    expect(await tableSnapshot(target)).toEqual(before);
    target.close();
  });
});
