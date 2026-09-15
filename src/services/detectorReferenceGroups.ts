import { db, type FindSpotDB } from '../db';
import { detectorGroupSchema, normalizeDetectorName, type DetectorReferenceGroup } from './collectionModels';

export async function saveDetectorGroup(group: DetectorReferenceGroup, names: string[], database: FindSpotDB = db) {
  detectorGroupSchema.parse(group);
  if (names.some(name => !name.trim() || name.length > 200)) throw new Error('Enter detector names of up to 200 characters.');
  if (new Set(names.map(normalizeDetectorName)).size !== names.length) throw new Error('Choose each detector name only once.');
  await database.transaction('rw', [database.projects, database.detectorReferenceGroups, database.detectorReferenceAliases], async () => {
    if (!await database.projects.get(group.projectId)) throw new Error('Project no longer exists.');
    const existing = await database.detectorReferenceGroups.get(group.id);
    if (existing && existing.projectId !== group.projectId) throw new Error('Group belongs to another project.');
    const aliases = await database.detectorReferenceAliases.where('projectId').equals(group.projectId).toArray();
    if (names.some(name => aliases.some(alias => alias.normalizedName === normalizeDetectorName(name) && alias.groupId !== group.id))) throw new Error('A selected name already belongs to another group. Remove that alias first.');
    await database.detectorReferenceGroups.put({ ...group, updatedAt: new Date().toISOString() });
    await database.detectorReferenceAliases.where('groupId').equals(group.id).delete();
    await database.detectorReferenceAliases.bulkAdd(names.map(sourceDetectorName => ({ id: crypto.randomUUID(), projectId: group.projectId, groupId: group.id, sourceDetectorName, normalizedName: normalizeDetectorName(sourceDetectorName), createdAt: new Date().toISOString() })));
  });
}
export async function deleteDetectorGroup(id: string, database: FindSpotDB = db) {
  await database.transaction('rw', [database.detectorReferenceGroups, database.detectorReferenceAliases, database.detectorReferenceAssignments], async () => {
    await database.detectorReferenceAliases.where('groupId').equals(id).delete();
    await database.detectorReferenceAssignments.where('groupId').equals(id).delete();
    await database.detectorReferenceGroups.delete(id);
  });
}
export { applyDetectorBulkChange, type DetectorBulkChange } from './findMutations';
