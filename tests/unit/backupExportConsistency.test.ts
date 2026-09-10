import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { db, FindSpotDB } from '../../src/db';
import { exportData, markBackupExportPrepared, markExternalBackupSaved } from '../../src/services/data';
import { seedBackupFixture } from '../fixtures/backupFixtureFactories';
import { getBackupReminderState } from '../../src/services/backupReminder';

const databases: FindSpotDB[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const database of databases) { database.close(); await Dexie.delete(database.name); }
  databases.length = 0;
  db.close();
  await Dexie.delete(db.name);
});

describe('coherent backup exports', () => {
  it.each([false, true])('queues other-tab writes throughout capture (includeMedia=%s)', async includeMedia => {
    const source = new FindSpotDB(`capture-consistency-${crypto.randomUUID()}`);
    const otherTab = new FindSpotDB(source.name);
    databases.push(source, otherTab);
    await source.open();
    await otherTab.open();
    await seedBackupFixture(source);
    const original = source.permissions.toArray.bind(source.permissions);
    let mutation: Promise<unknown> | undefined;
    vi.spyOn(source.permissions, 'toArray').mockImplementation(async () => {
      const permissions = await original();
      mutation = Dexie.ignoreTransaction(() => otherTab.transaction('rw', otherTab.finds, otherTab.media, async () => {
        await otherTab.finds.update('find-1', { objectType: 'Updated during capture' });
        await otherTab.media.delete('media-1');
      }));
      return permissions;
    });
    const blob = await exportData({ database: source, includeMedia });
    await mutation;
    const entries = includeMedia ? unzipSync(new Uint8Array(await blob.arrayBuffer())) : null;
    const manifest = JSON.parse(entries ? strFromU8(entries['manifest.json']) : await blob.text());
    expect(manifest.finds[0].objectType).toBe('Coin');
    if (entries) {
      expect(manifest.media.map((row: { id: string }) => row.id)).toEqual(['media-1']);
      expect(Array.from(entries[manifest.media[0]._zipEntry])).toEqual([0xff, 0xd8, 0x01, 0x02, 0xff, 0xd9]);
    }
    expect((await source.finds.get('find-1'))?.objectType).toBe('Updated during capture');
    expect(await source.media.count()).toBe(0);
  });

  it('fails a snapshot write cleanly without changing live records or keeping staging data', async () => {
    const source = new FindSpotDB(`capture-failure-${crypto.randomUUID()}`);
    databases.push(source);
    await source.open();
    await seedBackupFixture(source);
    const original = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args) {
      if (this.transaction.db.name.startsWith('findspot_export_staging_')) {
        throw new DOMException('No room for snapshot', 'QuotaExceededError');
      }
      return original.apply(this, args);
    });
    await expect(exportData({ database: source, includeMedia: true })).rejects.toThrow('No room for snapshot');
    expect((await source.finds.get('find-1'))?.objectType).toBe('Coin');
    expect(await source.media.count()).toBe(1);
    expect((await Dexie.getDatabaseNames()).filter(name => name.startsWith('findspot_export_staging_'))).toEqual([]);
  });

  it('keeps the captured records and photo bytes when another tab edits, adds and deletes during archiving', async () => {
    const source = new FindSpotDB(`export-consistency-${crypto.randomUUID()}`);
    const otherTab = new FindSpotDB(source.name);
    databases.push(source, otherTab);
    await source.open();
    await otherTab.open();
    await seedBackupFixture(source);
    let mutation: Promise<unknown> | undefined;
    const archive = await exportData({ database: source, includeMedia: true, onProgress: progress => {
      if (progress.processedMedia === 0 && !mutation) {
        mutation = otherTab.transaction('rw', otherTab.finds, otherTab.media, async () => {
          await otherTab.finds.update('find-1', { objectType: 'Changed while exporting' });
          const old = await otherTab.media.get('media-1');
          await otherTab.media.delete('media-1');
          await otherTab.media.put({ ...old!, id: 'new-photo', blob: new Blob(['new photo']) });
        });
      }
    } });
    await mutation;
    const entries = unzipSync(new Uint8Array(await archive.arrayBuffer()));
    const manifest = JSON.parse(strFromU8(entries['manifest.json']));
    expect(manifest.finds[0].objectType).toBe('Coin');
    expect(manifest.media.map((row: { id: string }) => row.id)).toEqual(['media-1']);
    expect(Array.from(entries[manifest.media[0]._zipEntry])).toEqual([0xff, 0xd8, 0x01, 0x02, 0xff, 0xd9]);
    expect((await source.finds.get('find-1'))?.objectType).toBe('Changed while exporting');
    expect((await Dexie.getDatabaseNames()).filter(name => name.startsWith('findspot_export_staging_'))).toEqual([]);
  });

  it('records-only export reads related tables within a single transaction', async () => {
    const source = new FindSpotDB(`records-consistency-${crypto.randomUUID()}`);
    databases.push(source);
    await source.open();
    await seedBackupFixture(source);
    const original = source.permissions.toArray.bind(source.permissions);
    let transactionId: object | undefined;
    vi.spyOn(source.permissions, 'toArray').mockImplementation(() => {
      transactionId = Dexie.currentTransaction;
      return original();
    });
    const findsOriginal = source.finds.toArray.bind(source.finds);
    vi.spyOn(source.finds, 'toArray').mockImplementation(() => {
      expect(Dexie.currentTransaction).toBe(transactionId);
      expect(transactionId).toBeDefined();
      return findsOriginal();
    });
    const manifest = JSON.parse(await (await exportData({ database: source })).text());
    expect(manifest.finds).toHaveLength(1);
    expect(manifest.media).toEqual([]);
  });

  it('does not infer photo protection from historical dates, prepared files or records-only confirmations', async () => {
    await db.open();
    await seedBackupFixture(db);
    const at = '2099-01-01T00:00:00.000Z';
    await db.settings.put({ key: 'lastBackupDate', value: at });
    await markBackupExportPrepared('full', at);
    await markExternalBackupSaved(at, 'records');
    expect((await getBackupReminderState()).hasExternalBackup).toBe(false);
    await markExternalBackupSaved(at, 'full');
    expect((await getBackupReminderState()).hasExternalBackup).toBe(true);
  });
});
