import { db } from '../db';
import type { Session, Track } from '../db';
import { applyCompanionTrackTrim, regenerateCompanionTracks } from './companionImport';

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
  const companionImports = await db.companionImports.where('sessionId').equals(sessionId).toArray();
  const companionRecordingIds = companionImports.map(entry => entry.recordingId);

  await db.transaction('rw', [
    db.sessions, db.finds, db.significantFinds, db.media, db.tracks, db.sessionCoverage,
    db.companionImports, db.companionRecordings,
  ], async () => {
    if (findIds.length) await db.media.where('findId').anyOf(findIds).delete();
    if (significantFindIds.length) await db.media.where('findId').anyOf(significantFindIds).delete();
    await db.finds.where('sessionId').equals(sessionId).delete();
    await db.significantFinds.where('sessionId').equals(sessionId).delete();
    await db.tracks.where('sessionId').equals(sessionId).delete();
    await db.sessionCoverage.where('sessionId').equals(sessionId).delete();
    await db.companionImports.where('sessionId').equals(sessionId).delete();
    if (companionRecordingIds.length > 0) {
      await db.companionRecordings.bulkDelete(companionRecordingIds);
    }
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
  const track = await db.tracks.get(trackId);
  if (!track) throw new Error('Track not found.');
  if (await applyCompanionTrackTrim(track, points, updatedAt)) {
    await regenerateCompanionTracks(track.sourceRecordingUuid!);
    return;
  }
  await db.tracks.update(trackId, { points, updatedAt });
}

export async function saveSessionKeyNotes(sessionId: string, keyNotes: string[]): Promise<void> {
  await db.sessions.update(sessionId, { keyNotes });
}
