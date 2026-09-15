import { db, type FindSpotDB, type Find, type Media } from '../db';
import { collectionSchema, collectionItemSchema, orderCollectionItems, type FindCollection, type CollectionItem, type CollectionFactField } from './collectionModels';
import { isUsableTargetId } from './detectorReferenceValidation';

export function collectionFacts(find: Find, fields: CollectionFactField[]): Array<{ label: string; value: string }> {
  return fields.flatMap(field => {
    if (field === 'targetId') return isUsableTargetId(find.targetId) ? [{ label: 'Target ID', value: String(find.targetId) }] : [{ label: 'Target ID', value: 'Unknown' }];
    if (field === 'period') return [{ label: 'Recorded period', value: find.period || 'Unknown' }];
    if (field === 'material') return [{ label: 'Material', value: find.material || 'Unknown' }];
    if (field === 'coilLabel' || field === 'programmeLabel' || field === 'frequencyLabel') {
      return [{ label: { coilLabel: 'Coil', programmeLabel: 'Programme', frequencyLabel: 'Frequency' }[field], value: find.detectorContext?.[field] || 'Unknown' }];
    }
    const labels = { weightG: 'Weight', widthMm: 'Width', heightMm: 'Height' };
    const value = find[field];
    return [{ label: labels[field], value: typeof value === 'number' && Number.isFinite(value) ? `${value} ${field === 'weightG' ? 'g' : 'mm'}` : 'Unknown' }];
  });
}

/** Hash only selected media; private notes and unrelated edits never trigger review. */
export async function collectionSourceFingerprint(find: Find, item: Pick<CollectionItem, 'selectedMediaIds' | 'selectedFactFields'>, photos: Media[]): Promise<string> {
  const signatures = [];
  for (const id of item.selectedMediaIds) {
    const photo = photos.find(row => row.id === id && row.findId === find.id);
    const hash = photo ? Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await photo.blob.arrayBuffer())), byte => byte.toString(16).padStart(2, '0')).join('') : 'missing';
    signatures.push([id, hash]);
  }
  return JSON.stringify([find.objectType, collectionFacts(find, item.selectedFactFields), signatures]);
}

export function newCollection(projectId: string, title = 'My collection'): FindCollection {
  const now = new Date().toISOString();
  return { id: crypto.randomUUID(), projectId, title, introduction: '', templateId: 'museum', createdAt: now, updatedAt: now };
}
export function newCollectionItem(collectionId: string, findId: string, position: number): CollectionItem {
  const now = new Date().toISOString();
  return { id: crypto.randomUUID(), collectionId, findId, position, selectedMediaIds: [], selectedFactFields: ['period', 'material'], createdAt: now, updatedAt: now };
}

/** Save the entire ordered membership graph atomically. A revision check prevents lost edits. */
export async function saveCollection(collection: FindCollection, items: CollectionItem[], expectedUpdatedAt?: string, database: FindSpotDB = db): Promise<FindCollection> {
  const validated = collectionSchema.safeParse(collection);
  if (!validated.success) throw new Error(collection.title.trim() ? validated.error.issues[0].message : 'Enter a collection title.');
  for (const item of items) { const result = collectionItemSchema.safeParse(item); if (!result.success) throw new Error(result.error.issues[0].message); }
  if (items.length > 50 || new Set(items.map(item => item.findId)).size !== items.length || new Set(items.map(item => item.id)).size !== items.length) throw new Error('Choose up to 50 different finds.');
  if (items.some(item => item.collectionId !== collection.id)) throw new Error('Item belongs to another collection.');
  if (collection.coverItemId && !items.some(item => item.id === collection.coverItemId)) throw new Error('Choose a cover from this collection.');
  return database.transaction('rw', [database.collections, database.collectionItems, database.finds, database.media, database.projects], async () => {
    const existing = await database.collections.get(collection.id);
    if (existing?.updatedAt !== expectedUpdatedAt) throw new Error('This collection changed elsewhere. Reopen it before saving.');
    if (!await database.projects.get(collection.projectId)) throw new Error('This project no longer exists.');
    if (existing && existing.projectId !== collection.projectId) throw new Error('A collection cannot move between projects.');
    for (const item of items) {
      const previous = await database.collectionItems.get(item.id);
      if (previous && previous.collectionId !== collection.id) throw new Error('Item belongs to another collection.');
      const find = await database.finds.get(item.findId);
      if (!find && previous?.findId !== item.findId) throw new Error('A selected find no longer exists.');
      if (find && find.projectId !== collection.projectId) throw new Error('Choose finds from this project.');
      for (const id of item.selectedMediaIds) {
        const media = await database.media.get(id);
        if (!media && !previous?.selectedMediaIds.includes(id)) throw new Error('A selected photograph no longer exists.');
        if (media && (media.findId !== item.findId || media.projectId !== collection.projectId || media.type !== 'photo')) throw new Error('Choose photographs belonging to this find.');
      }
      if (Object.keys(item.cropSettings ?? {}).some(id => !item.selectedMediaIds.includes(id))) throw new Error('Crop belongs to an unselected photograph.');
    }
    const now = new Date(Math.max(Date.now(), existing ? Date.parse(existing.updatedAt) + 1 : 0)).toISOString();
    const saved = { ...collection, updatedAt: now };
    await database.collectionItems.where('collectionId').equals(collection.id).delete();
    await database.collectionItems.bulkPut(orderCollectionItems(items).map((item, position) => ({ ...item, position, updatedAt: now })));
    await database.collections.put(saved);
    return saved;
  });
}

export async function duplicateCollection(id: string, database: FindSpotDB = db): Promise<FindCollection> {
  return database.transaction('rw', [database.collections, database.collectionItems, database.finds, database.media, database.projects], async () => {
    const original = await database.collections.get(id);
    if (!original) throw new Error('Collection no longer exists.');
    const copy = newCollection(original.projectId, original.title);
    copy.introduction = original.introduction;
    const items = orderCollectionItems(await database.collectionItems.where('collectionId').equals(id).toArray()).map(item => {
      const copied = { ...item, id: crypto.randomUUID(), collectionId: copy.id };
      if (item.id === original.coverItemId) copy.coverItemId = copied.id;
      return copied;
    });
    // Already validated persisted structure; preserve missing sources in duplicates too.
    await database.collections.add(copy);
    await database.collectionItems.bulkAdd(items);
    return copy;
  });
}

export async function deleteCollection(id: string, database: FindSpotDB = db) {
  await database.transaction('rw', [database.collections, database.collectionItems], async () => {
    await database.collectionItems.where('collectionId').equals(id).delete();
    await database.collections.delete(id);
  });
}

export async function collectionDeletionImpact(findIds: string[], database: FindSpotDB = db): Promise<string[]> {
  if (!findIds.length) return [];
  const items = await database.collectionItems.where('findId').anyOf(findIds).toArray();
  const collections = await database.collections.bulkGet([...new Set(items.map(item => item.collectionId))]);
  return collections.flatMap(collection => collection ? [collection.title] : []);
}

/** Call inside the source deletion transaction, including these three tables. */
export async function removeFindOrganisation(findIds: string[], database: FindSpotDB = db): Promise<void> {
  if (!findIds.length) return;
  const removed = await database.collectionItems.where('findId').anyOf(findIds).toArray();
  await database.collectionItems.bulkDelete(removed.map(item => item.id));
  await database.detectorReferenceAssignments.where('findId').anyOf(findIds).delete();
  for (const id of new Set(removed.map(item => item.collectionId))) {
    const collection = await database.collections.get(id);
    if (!collection) continue;
    const remaining = orderCollectionItems(await database.collectionItems.where('collectionId').equals(id).toArray());
    await database.collections.update(id, {
      coverItemId: remaining.some(item => item.id === collection.coverItemId) ? collection.coverItemId : remaining[0]?.id,
      updatedAt: new Date(Math.max(Date.now(), Date.parse(collection.updatedAt) + 1)).toISOString(),
    });
  }
}
