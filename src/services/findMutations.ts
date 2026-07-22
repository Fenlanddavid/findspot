import { db } from '../db';
import type { Find, Media } from '../db';

export async function discardFindDraft(findId: string): Promise<void> {
  await db.transaction('rw', [db.finds, db.media], async () => {
    await db.media.where('findId').equals(findId).delete();
    await db.finds.delete(findId);
  });
}

export async function resolveFindPermission(input: {
  projectId: string;
  preferredPermissionId?: string | null;
  name: string;
  collector: string;
  permissionId: string;
  now: string;
}): Promise<string> {
  if (input.preferredPermissionId) {
    const preferred = await db.permissions.get(input.preferredPermissionId);
    if (preferred?.projectId === input.projectId) return preferred.id;
  }

  return db.transaction('rw', db.permissions, async () => {
    const existing = await db.permissions
      .where('projectId')
      .equals(input.projectId)
      .filter(permission => permission.name.toLowerCase() === input.name.toLowerCase())
      .first();
    if (existing) return existing.id;

    await db.permissions.add({
      id: input.permissionId,
      projectId: input.projectId,
      name: input.name,
      type: 'individual',
      lat: null,
      lon: null,
      gpsAccuracyM: null,
      collector: input.collector,
      landType: 'other',
      permissionGranted: false,
      notes: input.name === 'No Location'
        ? 'Auto-created — location not set at time of recording'
        : 'Automatically created via Club/Rally Dig',
      createdAt: input.now,
      updatedAt: input.now,
    });
    return input.permissionId;
  });
}

export async function saveCompletedFind(
  find: Omit<Find, 'createdAt'>,
  options: { existing: boolean; createdAt: string; sourceSignalId?: string | null },
): Promise<void> {
  if (options.existing) {
    await db.finds.update(find.id, find);
  } else {
    await db.finds.add({ ...find, createdAt: options.createdAt });
  }
  if (options.sourceSignalId) {
    await db.undugSignals.update(options.sourceSignalId, {
      status: 'dug-find',
      resolvedAt: Date.now(),
      resolvedFindId: find.id,
    }).catch(() => {});
  }
}

export async function savePendingFind(
  find: Omit<Find, 'createdAt'>,
  options: { existing: boolean; createdAt: string },
): Promise<void> {
  if (options.existing) await db.finds.update(find.id, find);
  else await db.finds.add({ ...find, createdAt: options.createdAt });
}

export async function createPhotoDraftFind(find: Find): Promise<void> {
  await db.finds.add(find);
}

export async function addFindPhotos(media: Media[]): Promise<void> {
  await db.media.bulkAdd(media);
}

export async function saveFindEdits(find: Find, updatedAt: string): Promise<void> {
  await db.finds.update(find.id, { ...find, updatedAt });
}

export async function deleteFindAndReopenSignal(findId: string, sourceSignalId?: string): Promise<void> {
  await db.transaction('rw', [db.finds, db.media, db.undugSignals], async () => {
    await db.media.where('findId').equals(findId).delete();
    await db.finds.delete(findId);
    if (sourceSignalId) {
      await db.undugSignals.where('id').equals(sourceSignalId).modify(signal => {
        signal.status = 'open';
        delete signal.resolvedAt;
        delete signal.resolvedFindId;
      });
    }
  });
}

export async function replaceFindPhotoSlot(
  findId: string,
  photoType: Media['photoType'],
  media: Media[],
): Promise<void> {
  await db.transaction('rw', db.media, async () => {
    if (photoType && photoType !== 'other') {
      const existing = await db.media
        .where('findId').equals(findId)
        .and(item => item.photoType === photoType)
        .toArray();
      if (existing.length) await db.media.bulkDelete(existing.map(item => item.id));
    }
    await db.media.bulkAdd(media);
  });
}

export async function deleteFindPhoto(mediaId: string): Promise<void> {
  await db.media.delete(mediaId);
}

export async function setFindFavorite(findId: string, isFavorite: boolean): Promise<void> {
  await db.finds.update(findId, { isFavorite });
}

export async function markPendingFindComplete(findId: string): Promise<void> {
  await db.finds.update(findId, { isPending: false });
}

export async function deletePendingFind(findId: string): Promise<void> {
  await db.transaction('rw', [db.finds, db.media], async () => {
    await db.media.where('findId').equals(findId).delete();
    await db.finds.delete(findId);
  });
}

export async function createQuickFind(find: Find): Promise<void> {
  await db.finds.add(find);
}

export async function attachQuickFindPhoto(media: Media): Promise<void> {
  await db.media.add(media);
}

export async function linkFindToSession(
  findId: string,
  sessionId: string,
  fieldId: string | null,
): Promise<void> {
  await db.finds.update(findId, { sessionId, fieldId, isPending: false });
}

export async function calibrateFindPhoto(mediaId: string, pxPerMm: number): Promise<void> {
  await db.media.update(mediaId, { pxPerMm, scalePresent: true });
}
