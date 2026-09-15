import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FindSpotDB, type Find } from '../../src/db';
import { seedBackupFixture } from '../fixtures/backupFixtureFactories';
import { collectionSourceFingerprint, newCollection, newCollectionItem, saveCollection, duplicateCollection, deleteCollection, removeFindOrganisation } from '../../src/services/collections';
import { exportData, importData, validateBackupData } from '../../src/services/data';
import { capturePublicCollection } from '../../src/services/collectionExport';
import { applyDetectorBulkChange, saveDetectorGroup, deleteDetectorGroup } from '../../src/services/detectorReferenceGroups';
import { detectorResolver, queryDetectorReference, targetIdBins } from '../../src/services/detectorReferenceQuery';
import { readDetectorReferenceRecords } from '../../src/services/detectorReferenceRecords';

let database: FindSpotDB;
beforeEach(async () => { database = new FindSpotDB(`collections-${crypto.randomUUID()}`); await database.open(); await seedBackupFixture(database); });
afterEach(async () => { await database.delete(); });

describe('collection persistence and lifecycle', () => {
  it('keeps membership independent of source records and checks revisions', async () => {
    const source = await database.finds.get('find-1');
    const collection = newCollection('project-1', 'My collection'); const item = newCollectionItem(collection.id, 'find-1', 0); item.caption = 'A caption';
    const saved = await saveCollection(collection, [item], undefined, database);
    expect(await database.finds.get('find-1')).toEqual(source);
    await expect(saveCollection(saved, [item], undefined, database)).rejects.toThrow('changed');
    const copy = await duplicateCollection(saved.id, database);
    expect(await database.collectionItems.where('collectionId').equals(copy.id).count()).toBe(1);
    await deleteCollection(saved.id, database);
    expect(await database.finds.get('find-1')).toEqual(source);
    expect(await database.collectionItems.where('collectionId').equals(copy.id).count()).toBe(1);
  });
  it('rejects duplicate membership and cross-project/media ownership atomically', async () => {
    const collection = newCollection('project-1'); const item = newCollectionItem(collection.id, 'find-1', 0);
    await expect(saveCollection(collection, [item, { ...item, id: 'other' }], undefined, database)).rejects.toThrow();
    await database.finds.put({ ...(await database.finds.get('find-1'))!, id: 'outside', projectId: 'elsewhere' });
    await expect(saveCollection(collection, [{ ...item, findId: 'outside' }], undefined, database)).rejects.toThrow('project');
    const photo = await database.media.toCollection().first();
    await database.media.update(photo!.id, { findId: 'outside' });
    await expect(saveCollection(collection, [{ ...item, selectedMediaIds: [photo!.id] }], undefined, database)).rejects.toThrow('photographs');
    expect(await database.collections.get(collection.id)).toBeUndefined();
  });
  it('restores records-only structure and media selections without inventing photographs', async () => {
    const photo = await database.media.toCollection().first();
    await database.collectionItems.update('item-1', { selectedMediaIds: [photo!.id], caption: 'Preserve this' });
    const backup = await exportData({ database });
    await database.collectionItems.clear(); await database.media.clear();
    await importData(backup, { database });
    expect((await database.collectionItems.get('item-1'))?.caption).toBe('Preserve this');
    expect((await database.collectionItems.get('item-1'))?.selectedMediaIds).toEqual([photo!.id]);
    const publicData = await capturePublicCollection('collection-1', 'project-1', ['item-1'], database);
    expect(publicData.objects[0].missingPhotos).toBe(1);
    expect(publicData.objects[0].photos).toEqual([]);
  });
  it('removes membership and assignments transactionally, leaving a deterministic cover', async () => {
    await database.finds.put({ ...(await database.finds.get('find-1'))!, id: 'find-2' });
    await database.collectionItems.add({ ...newCollectionItem('collection-1', 'find-2', 1), id: 'item-2' });
    await database.transaction('rw', [database.collections, database.collectionItems, database.detectorReferenceAssignments], () => removeFindOrganisation(['find-1'], database));
    expect(await database.collectionItems.get('item-1')).toBeUndefined();
    expect((await database.collections.get('collection-1'))?.coverItemId).toBe('item-2');
    expect(await database.detectorReferenceAssignments.count()).toBe(0);
    expect(await database.finds.get('find-1')).toBeDefined();
  });
  it('rejects oversized persisted text while accepting absent old organisation tables', () => {
    expect(validateBackupData({ projects: [] }).collections).toEqual([]);
    expect(() => validateBackupData({ projects: [{ id: 'p' }], collections: [{ ...newCollection('p'), introduction: 'x'.repeat(2001) }] })).toThrow();
  });
  it('tracks only selected source facts and exact selected photo content', async () => {
    const find = (await database.finds.get('find-1'))!; const item = (await database.collectionItems.get('item-1'))!;
    const before = await collectionSourceFingerprint(find, item, []);
    expect(await collectionSourceFingerprint({ ...find, notes: 'New private note', updatedAt: new Date().toISOString() }, item, [])).toBe(before);
    expect(await collectionSourceFingerprint({ ...find, period: 'Modern' }, item, [])).not.toBe(before);
    const photo = (await database.media.toCollection().first())!; item.selectedMediaIds = [photo.id];
    const first = await collectionSourceFingerprint(find, item, [{ ...photo, blob: new Blob(['abc']) }]);
    expect(await collectionSourceFingerprint(find, item, [{ ...photo, blob: new Blob(['def']) }])).not.toBe(first);
  });
});

describe('public export boundary', () => {
  it('allowlists fields and isolates captured state from later edits', async () => {
    await database.finds.update('find-1', { targetId: 0, detector: 'PRIVATE DETECTOR', notes: 'PRIVATE NOTES', storageLocation: 'PRIVATE STORAGE', recorderName: 'PRIVATE NAME', detectorContext: { groundNotes: 'PRIVATE GROUND', coilLabel: 'Approved coil' } });
    const snapshot = await capturePublicCollection('collection-1', 'project-1', ['item-1'], database);
    const text = JSON.stringify(snapshot);
    for (const forbidden of ['PRIVATE', 'find-1', 'project-1', 'permission-1', '52.2053', 'TL 447', 'storageLocation', 'targetId']) expect(text).not.toContain(forbidden);
    await database.finds.update('find-1', { period: 'Modern' });
    expect(snapshot.objects[0].facts).toEqual([{ label: 'Recorded period', value: 'Roman' }]);
    await database.collectionItems.update('item-1', { selectedFactFields: ['targetId', 'coilLabel'] });
    const optedIn = await capturePublicCollection('collection-1', 'project-1', ['item-1'], database);
    expect(optedIn.objects[0].facts).toEqual([{ label: 'Target ID', value: '0' }, { label: 'Coil', value: 'Approved coil' }]);
  });
});

describe('detector grouping and queries', () => {
  it('reads across batch boundaries once, excludes other projects and retains only reference fields', async () => {
    const base = (await database.finds.get('find-1'))!;
    await database.finds.bulkPut(Array.from({ length: 1001 }, (_, index) => ({ ...base, id: `batch-${String(index).padStart(4, '0')}`, detector: 'D', targetId: index, notes: 'Private notes', detectorContext: { coilLabel: 'Coil A', groundNotes: 'Private conditions' } })));
    await database.finds.put({ ...base, id: 'outside-project', projectId: 'other' });
    const records = await readDetectorReferenceRecords(base.projectId, database);
    expect(records).toHaveLength(1002);
    expect(new Set(records.map(row => row.id)).size).toBe(1002);
    expect(records.some(row => row.id === 'outside-project')).toBe(false);
    expect(JSON.stringify(records)).not.toContain('Private');
    expect(records[0].detectorContext?.coilLabel).toBe('Coil A');
  });
  it('keeps identical detector names separable with explicit assignments and never rewrites history', async () => {
    const find = (await database.finds.get('find-1'))!;
    await database.finds.update(find.id, { detector: 'My Detector', targetId: 0 });
    await database.finds.put({ ...find, id: 'find-2', detector: 'My Detector', targetId: -9 });
    const now = new Date().toISOString();
    await saveDetectorGroup({ id: 'group-2', projectId: find.projectId, displayName: 'Different scale', createdAt: now, updatedAt: now }, [], database);
    const original = (await database.finds.get('find-2'))!;
    await applyDetectorBulkChange(find.projectId, [{ id: original.id, signature: JSON.stringify(original) }], { groupId: 'group-2' }, database);
    const organisation = { groups: await database.detectorReferenceGroups.toArray(), aliases: await database.detectorReferenceAliases.toArray(), assignments: await database.detectorReferenceAssignments.toArray() };
    const resolve = detectorResolver(find.projectId, organisation);
    expect(resolve((await database.finds.get(find.id))!)).toBe('group:group-1');
    expect(resolve((await database.finds.get('find-2'))!)).toBe('group:group-2');
    expect((await database.finds.get('find-2'))?.detector).toBe('My Detector');
    await deleteDetectorGroup('group-2', database);
    expect((await database.finds.get('find-2'))?.targetId).toBe(-9);
    await expect(applyDetectorBulkChange(find.projectId, [{ id: original.id, signature: JSON.stringify(original) }], { detector: 'Changed' }, database)).rejects.toThrow('changed');
  });
  it('uses exact/range scope, excludes malformed IDs, and keeps unknown recovery dates distinct', async () => {
    const base = (await database.finds.get('find-1'))!;
    const finds: Find[] = [
      { ...base, id: 'a', targetId: 0, detector: 'D', foundAt: undefined },
      { ...base, id: 'b', targetId: -3, detector: 'd', foundAt: '2026-09-10T00:00:00Z' },
      { ...base, id: 'c', targetId: 1.5, detector: 'D' },
      { ...base, id: 'd', targetId: 0, detector: 'Different model' },
      { ...base, id: 'e', targetId: 0, detector: 'D', projectId: 'other' },
    ];
    const org = { groups: [], aliases: [], assignments: [] };
    const filter = { projectId: base.projectId, group: 'name:d' };
    expect(queryDetectorReference([...finds, finds[0]], { ...filter, range: [-3, 0] }, org).map(find => find.id)).toEqual(['b', 'a']);
    expect(queryDetectorReference(finds, { ...filter, range: [0, 0] }, org).map(find => find.id)).toEqual(['a']);
    expect(queryDetectorReference(finds, { ...filter, from: '2026-09-01' }, org).map(find => find.id)).toEqual(['b']);
    expect(queryDetectorReference(finds, { ...filter, unknownDate: true }, org).map(find => find.id)).toEqual(['a']);
    const results = queryDetectorReference(finds, filter, org);
    expect(targetIdBins(results).reduce((sum, bin) => sum + bin.count, 0)).toBe(results.length);
    const extremes = targetIdBins([{ ...base, targetId: Number.MIN_SAFE_INTEGER }, { ...base, targetId: Number.MAX_SAFE_INTEGER }]);
    expect(extremes.every(bin => Number.isSafeInteger(bin.min) && Number.isSafeInteger(bin.max))).toBe(true);
    expect(extremes.reduce((sum, bin) => sum + bin.count, 0)).toBe(2);
  });
});
