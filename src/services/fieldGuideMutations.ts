import { db } from '../db';
import type {
  FieldGuideScanCache,
  LandscapeInterpretationRecord,
  SavedPoint,
} from '../db';

export async function createSavedPoint(point: SavedPoint): Promise<void> {
  await db.savedPoints.add(point);
}

export async function removeSavedPoint(pointId: string): Promise<void> {
  await db.savedPoints.delete(pointId);
}

export async function discardFieldGuideScanCache(cacheId: string): Promise<void> {
  await db.fieldGuideCache.delete(cacheId);
}

export async function refreshCachedModernWays(
  cacheId: string,
  modernWays: unknown,
  fetchedAt: number,
): Promise<void> {
  await db.fieldGuideCache.update(cacheId, { modernWays, modernWaysFetchedAt: fetchedAt });
}

export async function saveTerrainScanCache(
  cache: FieldGuideScanCache,
  expiredCutoff: number,
): Promise<void> {
  await db.fieldGuideCache.where('createdAt').below(expiredCutoff).delete();
  await db.fieldGuideCache.put(cache);
}

export async function saveHistoricScanCache(
  cache: FieldGuideScanCache,
  expiredCutoff: number,
): Promise<void> {
  await db.fieldGuideCache
    .filter(row => row.id.startsWith('historic:') && row.createdAt < expiredCutoff)
    .delete();
  await db.fieldGuideCache.put(cache);
}

export async function discardLandscapeInterpretation(geohash6: string): Promise<void> {
  await db.landscapeInterpretations.delete(geohash6);
}

export async function saveLandscapeInterpretation(
  record: LandscapeInterpretationRecord,
): Promise<void> {
  await db.landscapeInterpretations.put(record);
}

export async function markPermissionQuestionsEvaluated(
  permissionId: string,
  evaluatedAt: string,
): Promise<void> {
  await db.permissions.update(permissionId, { questionsEvaluatedAt: evaluatedAt });
}
