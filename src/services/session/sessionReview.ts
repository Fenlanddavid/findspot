import { db, type FindSpotDB, type Track } from '../../db';
import { sessionStartedAt } from './activeSessionContext';
import { segmentCrossesRecordedGap } from '../../shared/trackSegments';
import { distanceMeters } from '../../utils/geo';

function distanceMetres(
  left: { lat: number; lon: number },
  right: { lat: number; lon: number },
): number {
  return distanceMeters(left, right);
}

function crossesGap(
  previous: Track['points'][number],
  current: Track['points'][number],
  gaps: Track['gaps'],
): boolean {
  return segmentCrossesRecordedGap(previous.timestamp, current.timestamp, gaps);
}

export function reliableTrackDistanceMetres(tracks: Track[]): number | null {
  let distance = 0;
  let segmentCount = 0;
  for (const track of tracks) {
    const points = [...track.points].sort((left, right) => left.timestamp - right.timestamp);
    for (let index = 1; index < points.length; index++) {
      const previous = points[index - 1];
      const current = points[index];
      if (crossesGap(previous, current, track.gaps)) continue;
      const elapsed = current.timestamp - previous.timestamp;
      const segment = distanceMetres(previous, current);
      if (elapsed <= 0 || elapsed > 120_000 || !Number.isFinite(segment) || segment > 200) continue;
      distance += segment;
      segmentCount++;
    }
  }
  return segmentCount > 0 ? distance : null;
}

export type SessionReview = {
  sessionId: string;
  permissionId: string;
  startedAt: number;
  endedAt: number | null;
  durationMinutes: number | null;
  findsCount: number;
  pendingFindCount: number;
  surfaceObservationCount: number;
  openSignalCount: number;
  walkedDistanceMetres: number | null;
  coverageStatement: string | null;
};

export async function getSessionReview(
  sessionId: string,
  database: FindSpotDB = db,
): Promise<SessionReview | null> {
  const session = await database.sessions.get(sessionId);
  if (!session) return null;
  const [finds, surfaceObservations, signals, tracks, coverage] = await Promise.all([
    database.finds.where('sessionId').equals(sessionId).toArray(),
    database.surfaceObservations.where('sessionId').equals(sessionId).toArray(),
    database.undugSignals.where('sessionId').equals(sessionId).toArray(),
    database.tracks.where('sessionId').equals(sessionId).toArray(),
    database.sessionCoverage.where('sessionId').equals(sessionId).toArray(),
  ]);
  const startedAt = sessionStartedAt(session);
  const parsedEnd = session.endTime ? Date.parse(session.endTime) : Number.NaN;
  const endedAt = Number.isFinite(parsedEnd) ? parsedEnd : null;
  const trackedEvidence = coverage.filter(item => item.evidence === 'tracked');
  const reportedEvidence = coverage.filter(item => item.evidence === 'reported');
  const coverageStatement = trackedEvidence.length > 0 || reportedEvidence.length > 0
    ? 'This session has limited recorded coverage evidence.'
    : null;
  return {
    sessionId,
    permissionId: session.permissionId,
    startedAt,
    endedAt,
    durationMinutes: endedAt !== null && startedAt > 0
      ? Math.max(0, Math.floor((endedAt - startedAt) / 60_000))
      : null,
    findsCount: finds.filter(find => !find.isPending).length,
    pendingFindCount: finds.filter(find => find.isPending).length,
    surfaceObservationCount: surfaceObservations.filter(item => !item.retiredAt).length,
    openSignalCount: signals.filter(signal => signal.status === 'open').length,
    walkedDistanceMetres: reliableTrackDistanceMetres(tracks),
    coverageStatement,
  };
}
