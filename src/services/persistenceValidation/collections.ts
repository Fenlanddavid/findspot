import { collectionSchema, collectionItemSchema, detectorGroupSchema, detectorAliasSchema, detectorAssignmentSchema, detectorContextSchema, normalizeDetectorName } from '../collectionModels';
import type { UnvalidatedBackupTables } from '../backup/schema';

/** Missing sources are retained for explicit repair, including records-only restores. */
export function validateCollectionTables(tables: UnvalidatedBackupTables) {
  const collections = tables.collections.map(row => collectionSchema.parse(row));
  const items = tables.collectionItems.map(row => collectionItemSchema.parse(row));
  const groups = tables.detectorReferenceGroups.map(row => detectorGroupSchema.parse(row));
  const aliases = tables.detectorReferenceAliases.map(row => detectorAliasSchema.parse(row));
  const assignments = tables.detectorReferenceAssignments.map(row => detectorAssignmentSchema.parse(row));
  const projects = new Set(tables.projects.map(row => row.id));
  const finds = new Map(tables.finds.map(row => [row.id, row]));
  const media = new Map(tables.media.map(row => [row.id, row]));
  const collectionById = new Map(collections.map(row => [row.id, row]));
  const groupById = new Map(groups.map(row => [row.id, row]));
  const itemById = new Map(items.map(row => [row.id, row]));
  for (const rows of [collections, items, groups, aliases, assignments]) {
    if (new Set(rows.map(row => row.id)).size !== rows.length) throw new Error('Duplicate organisation record ID.');
  }
  for (const row of [...collections, ...groups, ...aliases, ...assignments]) {
    if (!projects.has(row.projectId)) throw new Error('Organisation references an unknown project.');
  }
  const memberships = new Set<string>();
  const counts = new Map<string, number>();
  for (const item of items) {
    const collection = collectionById.get(item.collectionId);
    if (!collection) throw new Error('Collection item has no collection.');
    const key = JSON.stringify([item.collectionId, item.findId]);
    if (memberships.has(key)) throw new Error('Duplicate collection membership.');
    memberships.add(key);
    const count = (counts.get(item.collectionId) ?? 0) + 1;
    if (count > 50) throw new Error('A collection may contain up to 50 finds.');
    counts.set(item.collectionId, count);
    const find = finds.get(item.findId);
    if (find && find.projectId !== collection.projectId) throw new Error('Collection find belongs to another project.');
    for (const mediaId of item.selectedMediaIds) {
      const photo = media.get(mediaId);
      if (photo && (photo.findId !== item.findId || photo.projectId !== collection.projectId || photo.type !== 'photo')) throw new Error('Selected photograph belongs to another record.');
    }
    if (Object.keys(item.cropSettings ?? {}).some(key => !item.selectedMediaIds.includes(key))) throw new Error('Crop does not belong to a selected photograph.');
  }
  for (const collection of collections) {
    if (collection.coverItemId && itemById.get(collection.coverItemId)?.collectionId !== collection.id) throw new Error('Cover item does not belong to collection.');
  }
  const names = new Set<string>();
  for (const alias of aliases) {
    if (groupById.get(alias.groupId)?.projectId !== alias.projectId) throw new Error('Detector alias group belongs to another project.');
    if (alias.normalizedName !== normalizeDetectorName(alias.sourceDetectorName)) throw new Error('Invalid detector alias normalization.');
    const key = JSON.stringify([alias.projectId, alias.normalizedName]);
    if (names.has(key)) throw new Error('Detector name belongs to multiple groups.');
    names.add(key);
  }
  const assignedFinds = new Set<string>();
  for (const assignment of assignments) {
    if (groupById.get(assignment.groupId)?.projectId !== assignment.projectId) throw new Error('Detector assignment group belongs to another project.');
    const find = finds.get(assignment.findId);
    if (find && find.projectId !== assignment.projectId) throw new Error('Detector assignment find belongs to another project.');
    if (assignedFinds.has(assignment.findId)) throw new Error('Find has multiple detector group assignments.');
    assignedFinds.add(assignment.findId);
  }
  for (const find of tables.finds) if (find.detectorContext !== undefined) detectorContextSchema.parse(find.detectorContext);
  return { collections, collectionItems: items, detectorReferenceGroups: groups, detectorReferenceAliases: aliases, detectorReferenceAssignments: assignments };
}
