import { db } from '../db';
import type { FindSpotDB, Session, Track } from '../db';
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

export async function deleteSessionCascade(sessionId: string, database: FindSpotDB = db): Promise<void> {
  const finds = await database.finds.where('sessionId').equals(sessionId).toArray();
  const significantFinds = await database.significantFinds.where('sessionId').equals(sessionId).toArray();
  const findIds = finds.map(find => find.id);
  const significantFindIds = significantFinds.map(find => find.id);
  const companionImports = await database.companionImports.where('sessionId').equals(sessionId).toArray();
  const companionRecordingIds = companionImports.map(entry => entry.recordingId);

  await database.transaction('rw', [
    database.sessions, database.finds, database.significantFinds, database.media, database.tracks, database.sessionCoverage,
    database.companionImports, database.companionRecordings, database.surfaceObservations,
  ], async () => {
    if (findIds.length) await database.media.where('findId').anyOf(findIds).delete();
    if (significantFindIds.length) await database.media.where('findId').anyOf(significantFindIds).delete();
    await database.finds.where('sessionId').equals(sessionId).delete();
    await database.significantFinds.where('sessionId').equals(sessionId).delete();
    await database.tracks.where('sessionId').equals(sessionId).delete();
    await database.sessionCoverage.where('sessionId').equals(sessionId).delete();
    await database.companionImports.where('sessionId').equals(sessionId).delete();
    if (companionRecordingIds.length > 0) {
      await database.companionRecordings.bulkDelete(companionRecordingIds);
    }
    await database.surfaceObservations.where('sessionId').equals(sessionId).modify(observation => {
      observation.sessionId = null;
      observation.updatedAt = new Date().toISOString();
    });
    await database.sessions.delete(sessionId);
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
  await db.sessions.update(sessionId, {
    isFinished: false,
    activatedAt: new Date().toISOString(),
  });
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

export async function appendSessionNote(sessionId: string, note: string, recordedAt = new Date()): Promise<string> {
  const clean = note.trim();
  if (!clean) throw new Error('Write a note before saving.');
  return db.transaction('rw', db.sessions, async () => {
    const session = await db.sessions.get(sessionId);
    if (!session) throw new Error('Session not found.');
    const time = recordedAt.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    const entry = `[${time}] ${clean}`;
    const notes = session.notes.trim() ? `${session.notes.trim()}\n${entry}` : entry;
    await db.sessions.update(sessionId, { notes, updatedAt: recordedAt.toISOString() });
    return notes;
  });
}
