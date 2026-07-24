import { db } from '../db';
import type { Session, Track } from '../db';

export async function setSessionGroundConditions(
  sessionId: string,
  updates: Pick<Partial<Session>, 'isStubble' | 'landUse'>,
  updatedAt: string,
): Promise<void> {
  await db.sessions.update(sessionId, { ...updates, updatedAt });
}

export async function setSessionLocation(
  sessionId: string,
  location: Pick<Session, 'lat' | 'lon' | 'gpsAccuracyM'>,
  updatedAt: string,
): Promise<void> {
  await db.sessions.update(sessionId, { ...location, updatedAt });
}

export async function deleteSessionCascade(sessionId: string): Promise<void> {
  const finds = await db.finds.where('sessionId').equals(sessionId).toArray();
  const significantFinds = await db.significantFinds.where('sessionId').equals(sessionId).toArray();
  const findIds = finds.map(find => find.id);
  const significantFindIds = significantFinds.map(find => find.id);

  await db.transaction('rw', [
    db.sessions, db.finds, db.significantFinds, db.media, db.tracks, db.sessionCoverage,
  ], async () => {
    if (findIds.length) await db.media.where('findId').anyOf(findIds).delete();
    if (significantFindIds.length) await db.media.where('findId').anyOf(significantFindIds).delete();
    await db.finds.where('sessionId').equals(sessionId).delete();
    await db.significantFinds.where('sessionId').equals(sessionId).delete();
    await db.tracks.where('sessionId').equals(sessionId).delete();
    await db.sessionCoverage.where('sessionId').equals(sessionId).delete();
    await db.sessions.delete(sessionId);
  });
}

export async function createSessionRecord(session: Session): Promise<void> {
  await db.sessions.add(session);
}

export async function updateSessionDetails(sessionId: string, updates: Partial<Session>): Promise<void> {
  await db.sessions.update(sessionId, updates);
}

export async function recordSessionTrackingStart(sessionId: string, startedAt: string): Promise<void> {
  await db.sessions.update(sessionId, { startTime: startedAt });
}

export async function finishSessionRecord(sessionId: string, endTime: string): Promise<void> {
  await db.sessions.update(sessionId, { isFinished: true, endTime });
}

export async function reopenSessionRecord(sessionId: string): Promise<void> {
  await db.sessions.update(sessionId, { isFinished: false });
}

export async function trimSessionTrack(
  trackId: string,
  points: Track['points'],
  updatedAt: string,
): Promise<void> {
  await db.tracks.update(trackId, { points, updatedAt });
}

export async function saveSessionKeyNotes(sessionId: string, keyNotes: string[]): Promise<void> {
  await db.sessions.update(sessionId, { keyNotes });
}
