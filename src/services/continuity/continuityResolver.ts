import { db, type FindSpotDB } from '../../db';

export const CONTINUITY_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;

export type ContinuityItem = {
  id: string;
  permissionId: string;
  sourceType: 'undug-signal';
  sourceId: string;
  title: string;
  explanation: string;
  action: { href: string; label: string };
  priority: 'return';
};

export async function resolveContinuityForPermission(
  permissionId: string,
  now = Date.now(),
  database: FindSpotDB = db,
): Promise<ContinuityItem | null> {
  const permission = await database.permissions.get(permissionId);
  if (!permission || permission.isDefault) return null;
  const oldest = now - CONTINUITY_MAX_AGE_MS;
  const candidates = await database.undugSignals
    .where('[permissionId+status]')
    .equals([permissionId, 'open'])
    .toArray();
  const source = candidates
    .filter(signal => Number.isFinite(signal.createdAt) && signal.createdAt >= oldest && signal.createdAt <= now)
    .sort((left, right) => right.createdAt - left.createdAt || left.id.localeCompare(right.id))[0];
  if (!source) return null;
  return {
    id: `undug-signal:${source.id}`,
    permissionId,
    sourceType: 'undug-signal',
    sourceId: source.id,
    title: 'You left a signal open here',
    explanation: `Recorded on ${new Date(source.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'long' })}.`,
    action: {
      href: `/finds-box?tab=signals&signal=${encodeURIComponent(source.id)}`,
      label: 'View signal',
    },
    priority: 'return',
  };
}
