import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../src/db';
import { seedBackupFixture } from '../fixtures/backupFixtureFactories';
import { deleteFindAndReopenSignal, deleteFindPhoto } from '../../src/services/findMutations';
import { deletePermissionCascade } from '../../src/services/permissionMutations';
import { deleteSessionCascade } from '../../src/services/sessionMutations';
import { capturePublicCollection } from '../../src/services/collectionExport';

beforeEach(async () => { await db.open(); await seedBackupFixture(db); });
afterEach(async () => { await db.delete(); });
describe('canonical deletions with collection membership', () => {
  it.each(['find', 'permission', 'session'])('removes memberships and assignments when deleting a %s', async kind => {
    if (kind === 'find') await deleteFindAndReopenSignal('find-1');
    if (kind === 'permission') await deletePermissionCascade('permission-1');
    if (kind === 'session') await deleteSessionCascade('session-1');
    expect(await db.finds.get('find-1')).toBeUndefined();
    expect(await db.collectionItems.count()).toBe(0);
    expect(await db.detectorReferenceAssignments.count()).toBe(0);
    expect((await db.collections.get('collection-1'))?.coverItemId).toBeUndefined();
    expect((await db.collections.get('collection-1'))?.title).toBe('Everyday objects');
  });
  it('keeps a deleted photograph explicitly missing instead of substituting the other selected photo', async () => {
    const photo = (await db.media.toCollection().first())!;
    await db.media.add({ ...photo, id: 'second-photo' });
    await db.collectionItems.update('item-1', { selectedMediaIds: [photo.id, 'second-photo'] });
    await deleteFindPhoto(photo.id);
    const snapshot = await capturePublicCollection('collection-1', 'project-1', ['item-1']);
    expect(snapshot.cover).toBeUndefined();
    expect(snapshot.objects[0].missingPhotos).toBe(1);
    expect(snapshot.objects[0].photos).toHaveLength(1);
    expect((await db.collectionItems.get('item-1'))?.selectedMediaIds).toEqual([photo.id, 'second-photo']);
  });
});
