import type { Find } from '../db';
import type { DetectorReferenceGroup, DetectorReferenceAlias, DetectorReferenceAssignment } from './collectionModels';
import { normalizeDetectorName } from './collectionModels';
import { isUsableTargetId } from './detectorReferenceValidation';

export type DetectorReferenceRecord = Pick<Find, 'id' | 'projectId' | 'permissionId' | 'objectType' | 'findCategory' | 'material' | 'detector' | 'targetId' | 'foundAt' | 'detectorContext'>;
/** IndexedDB has no field projection; discard unrelated fields one row at a time. */
export function projectDetectorRecord(find: Find): DetectorReferenceRecord {
  return { id: find.id, projectId: find.projectId, permissionId: find.permissionId, objectType: find.objectType, findCategory: find.findCategory, material: find.material, detector: find.detector, targetId: find.targetId, foundAt: find.foundAt, detectorContext: find.detectorContext ? { coilLabel: find.detectorContext.coilLabel, programmeLabel: find.detectorContext.programmeLabel, frequencyLabel: find.detectorContext.frequencyLabel, groundCondition: find.detectorContext.groundCondition } : undefined };
}

export type DetectorReferenceFilters = {
  projectId: string; group: string; range?: [number, number]; material?: string; category?: string;
  from?: string; to?: string; unknownDate?: boolean; permission?: string;
  coil?: string; programme?: string; ground?: string; missingOnly?: boolean;
};
export type DetectorOrganisation = { groups: DetectorReferenceGroup[]; aliases: DetectorReferenceAlias[]; assignments: DetectorReferenceAssignment[] };
export function detectorResolver(projectId: string, organisation: DetectorOrganisation) {
  const groups = new Set(organisation.groups.filter(row => row.projectId === projectId).map(row => row.id));
  const aliases = new Map(organisation.aliases.filter(row => row.projectId === projectId && groups.has(row.groupId)).map(row => [row.normalizedName, row.groupId]));
  const assignments = new Map(organisation.assignments.filter(row => row.projectId === projectId && groups.has(row.groupId)).map(row => [row.findId, row.groupId]));
  return (find: DetectorReferenceRecord): string => {
    if (find.projectId !== projectId) return 'outside-project';
    const name = typeof find.detector === 'string' ? normalizeDetectorName(find.detector) : '';
    const assigned = assignments.get(find.id) ?? aliases.get(name);
    return assigned ? `group:${assigned}` : name ? `name:${name}` : 'unknown';
  };
}
export function recoveryDateKey(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return undefined;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

const matches = (value: string | undefined | null, filter?: string) => !filter || (filter === '__unknown' ? !value || value === 'unknown' || value === 'Unknown' : value === filter);
export function queryDetectorReference<T extends DetectorReferenceRecord>(finds: T[], filters: DetectorReferenceFilters, organisation: DetectorOrganisation): T[] {
  const resolve = detectorResolver(filters.projectId, organisation);
  const ids = new Set<string>();
  return finds.filter(find => {
    if (find.projectId !== filters.projectId || ids.has(find.id)) return false;
    ids.add(find.id);
    const group = resolve(find);
    if (filters.missingOnly) {
      if (group !== 'unknown' && isUsableTargetId(find.targetId)) return false;
    } else if (group !== filters.group || !isUsableTargetId(find.targetId)) return false;
    if (filters.range && (!isUsableTargetId(find.targetId) || find.targetId < filters.range[0] || find.targetId > filters.range[1])) return false;
    if (!matches(find.material, filters.material) || !matches(find.findCategory, filters.category) || !matches(find.permissionId, filters.permission)) return false;
    if (!matches(find.detectorContext?.coilLabel, filters.coil) || !matches(find.detectorContext?.programmeLabel, filters.programme) || !matches(find.detectorContext?.groundCondition, filters.ground)) return false;
    const date = recoveryDateKey(find.foundAt);
    if (filters.unknownDate) return !date;
    if (filters.from && (!date || date < filters.from)) return false;
    if (filters.to && (!date || date > filters.to)) return false;
    return true;
  }).sort((a, b) => (a.targetId ?? 0) - (b.targetId ?? 0) || a.id.localeCompare(b.id));
}

export function targetIdBins(finds: Pick<Find, 'targetId'>[]): Array<{ min: number; max: number; count: number }> {
  const readings = finds.map(find => find.targetId).filter(isUsableTargetId);
  if (!readings.length) return [];
  let min = readings[0], max = readings[0];
  for (const reading of readings) { min = Math.min(min, reading); max = Math.max(max, reading); }
  // BigInt keeps inclusive bounds exact even at the safe-integer extremes.
  const width = (BigInt(max) - BigInt(min)) / 30n + 1n;
  const bins = new Map<number, { min: number; max: number; count: number }>();
  for (const reading of readings) {
    const start = BigInt(min) + ((BigInt(reading) - BigInt(min)) / width) * width;
    const end = start + width - 1n;
    const key = Number(start);
    const bin = bins.get(key) ?? { min: key, max: Number(end > BigInt(max) ? BigInt(max) : end), count: 0 };
    bin.count += 1;
    bins.set(key, bin);
  }
  return [...bins.values()].sort((a, b) => a.min - b.min);
}
