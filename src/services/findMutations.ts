import { detectorContextSchema, type DetectorContext } from './collectionModels';
import { removeFindOrganisation } from './collections';
import { assertTargetIdMutation } from './detectorReferenceValidation';
import { db } from '../db';
import type { Find, Media, FindSpotDB } from '../db';
import { reportNonFatal } from './diagLog';
import { refreshHotspotPredictionOutcomes } from './hotspotPredictionService';

async function refreshPredictionEvidence(...permissionIds: Array<string | null | undefined>): Promise<void> {
  for (const permissionId of new Set(permissionIds.filter((id): id is string => !!id))) {
    await refreshHotspotPredictionOutcomes(permissionId).catch(error => {
      reportNonFatal('finds', 'Prediction evidence refresh failed', error);
    });
  }
}

export async function discardFindDraft(findId: string): Promise<void> {
  await db.transaction('rw', [db.finds, db.media, db.collections, db.collectionItems, db.detectorReferenceAssignments], async () => {
    await db.media.where('findId').equals(findId).delete();
    await removeFindOrganisation([findId]);
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

type PhotoChanges = { upsert: Media[]; removeIds: string[] };

async function commitRecord(find: Omit<Find, 'createdAt'>, options: { existing: boolean; createdAt: string; photos?: PhotoChanges }) {
  await db.transaction('rw', [db.finds, db.media, db.collections, db.collectionItems, db.detectorReferenceAssignments], async () => {
    const previous = options.existing ? await db.finds.get(find.id) : undefined;
    if (find.detectorContext !== undefined) detectorContextSchema.parse(find.detectorContext);
    assertTargetIdMutation(find.targetId, previous?.targetId);
    if (options.existing) {
      if (!previous) throw new Error('This find no longer exists. Your draft has not been saved.');
      await db.finds.update(find.id, find);
    } else await db.finds.add({ ...find, createdAt: options.createdAt });
    if (options.photos) {
      if (options.photos.upsert.some(photo => photo.findId !== find.id)) throw new Error('Photo belongs to another find.');
      await db.media.where('findId').equals(find.id).and(photo => options.photos!.removeIds.includes(photo.id)).delete();
      await db.media.bulkPut(options.photos.upsert);
    }
  });
}

export async function saveCompletedFind(
  find: Omit<Find, 'createdAt'>,
  options: { existing: boolean; createdAt: string; sourceSignalId?: string | null; photos?: PhotoChanges },
): Promise<void> {
  await commitRecord(find, options);
  if (options.sourceSignalId) {
    await db.undugSignals.update(options.sourceSignalId, {
      status: 'dug-find',
      resolvedAt: Date.now(),
      resolvedFindId: find.id,
    }).catch(error => {
      reportNonFatal('finds', 'Source signal resolution failed', error);
    });
  }
  await refreshPredictionEvidence(find.permissionId);
}

export async function savePendingFind(
  find: Omit<Find, 'createdAt'>,
  options: { existing: boolean; createdAt: string; photos?: PhotoChanges },
): Promise<void> {
  await commitRecord(find, options);
  await refreshPredictionEvidence(find.permissionId);
}

export async function createPhotoDraftFind(find: Find): Promise<void> {
  assertTargetIdMutation(find.targetId);
  await db.finds.add(find);
}

export async function addFindPhotos(media: Media[]): Promise<void> {
  await db.media.bulkAdd(media);
}

export async function saveFindEdits(
  find: Find,
  updatedAt: string,
  photos?: { upsert: Media[]; removeIds: string[] },
): Promise<void> {
  const previous = await db.transaction('rw', [db.finds, db.media, db.collections, db.collectionItems, db.detectorReferenceAssignments], async () => {
    const existing = await db.finds.get(find.id);
    if (!existing) throw new Error('This find no longer exists. Your changes have not been saved.');
    if (find.detectorContext !== undefined) detectorContextSchema.parse(find.detectorContext);
    assertTargetIdMutation(find.targetId, existing.targetId);
    await db.finds.update(find.id, { ...find, updatedAt });
    if (photos) {
      if (photos.upsert.some(photo => photo.findId !== find.id)) throw new Error('Photo belongs to another find.');
      await db.media.where('findId').equals(find.id).and(photo => photos.removeIds.includes(photo.id)).delete();
      await db.media.bulkPut(photos.upsert);
    }
    return existing;
  });
  await refreshPredictionEvidence(previous?.permissionId, find.permissionId);
}

export async function deleteFindAndReopenSignal(findId: string, sourceSignalId?: string): Promise<void> {
  const previous = await db.finds.get(findId);
  await db.transaction('rw', [db.finds, db.media, db.undugSignals, db.collections, db.collectionItems, db.detectorReferenceAssignments], async () => {
    await db.media.where('findId').equals(findId).delete();
    await removeFindOrganisation([findId]);
    await db.finds.delete(findId);
    if (sourceSignalId) {
      await db.undugSignals.where('id').equals(sourceSignalId).modify(signal => {
        signal.status = 'open';
        delete signal.resolvedAt;
        delete signal.resolvedFindId;
      });
    }
  });
  await refreshPredictionEvidence(previous?.permissionId);
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
  const previous = await db.finds.get(findId);
  await db.transaction('rw', [db.finds, db.media, db.collections, db.collectionItems, db.detectorReferenceAssignments], async () => {
    await db.media.where('findId').equals(findId).delete();
    await removeFindOrganisation([findId]);
    await db.finds.delete(findId);
  });
  await refreshPredictionEvidence(previous?.permissionId);
}

export async function createQuickFind(find: Find): Promise<void> {
  assertTargetIdMutation(find.targetId);
  await db.finds.add(find);
  await refreshPredictionEvidence(find.permissionId);
}

export async function attachQuickFindPhoto(media: Media): Promise<void> {
  await db.media.add(media);
}

/** Commit a quick find and its already-prepared attachment as one unit. */
export async function saveQuickFind(find: Find, media?: Media): Promise<void> {
  await db.transaction('rw', [db.finds, db.media, db.collections, db.collectionItems, db.detectorReferenceAssignments], async () => {
    assertTargetIdMutation(find.targetId);
    await db.finds.add(find);
    if (media) await db.media.add(media);
  });
  await refreshPredictionEvidence(find.permissionId);
}

export async function linkFindToSession(
  findId: string,
  sessionId: string,
  fieldId: string | null,
): Promise<void> {
  await db.finds.update(findId, { sessionId, fieldId, isPending: false });
  const find = await db.finds.get(findId);
  await refreshPredictionEvidence(find?.permissionId);
}

export async function calibrateFindPhoto(mediaId: string, pxPerMm: number): Promise<void> {
  await db.media.update(mediaId, { pxPerMm, scalePresent: true });
}

export type DetectorBulkChange = { detector?: string; groupId?: string | null; context?: DetectorContext };
/** Expected records are the preview: concurrent changes require a fresh confirmation. */
export async function applyDetectorBulkChange(projectId: string, expected: Array<{ id: string; signature: string }>, change: DetectorBulkChange, database: FindSpotDB = db) {
  if (!expected.length) throw new Error('Select records first.');
  if (change.detector !== undefined && (!change.detector.trim() || change.detector.length > 200)) throw new Error('Enter a detector name of up to 200 characters.');
  if (change.context) detectorContextSchema.parse(change.context);
  await database.transaction('rw', [database.finds, database.detectorReferenceGroups, database.detectorReferenceAssignments], async () => {
    if (change.groupId && (await database.detectorReferenceGroups.get(change.groupId))?.projectId !== projectId) throw new Error('Choose a group from this project.');
    for (const row of expected) {
      const find = await database.finds.get(row.id);
      if (!find || find.projectId !== projectId || JSON.stringify(find) !== row.signature) throw new Error('A selected record changed. Review the preview again.');
      if (change.groupId !== undefined) {
        await database.detectorReferenceAssignments.where('findId').equals(find.id).delete();
        if (change.groupId) await database.detectorReferenceAssignments.add({ id: crypto.randomUUID(), projectId, findId: find.id, groupId: change.groupId, createdAt: new Date().toISOString() });
      }
      await database.finds.update(find.id, {
        ...(change.detector !== undefined ? { detector: change.detector } : {}),
        ...(change.context ? { detectorContext: { ...find.detectorContext, ...change.context } } : {}),
        updatedAt: new Date(Math.max(Date.now(), (Date.parse(find.updatedAt) || 0) + 1)).toISOString(),
      });
    }
  });
}
