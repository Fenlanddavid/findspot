import { db, type FindSpotDB, type Session } from '../../db';

function parsedTimestamp(value: string | undefined): number | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

/** Honest visit start. Never treats the legacy tracking start as session start. */
export function sessionStartedAt(session: Session): number {
  return parsedTimestamp(session.sessionStartedAt)
    ?? parsedTimestamp(session.createdAt)
    ?? parsedTimestamp(session.date)
    ?? 0;
}

export function sessionActivatedAt(session: Session): number {
  return parsedTimestamp(session.activatedAt) ?? sessionStartedAt(session);
}

export function completedSessionAt(session: Session): number {
  return parsedTimestamp(session.endTime)
    ?? parsedTimestamp(session.date)
    ?? parsedTimestamp(session.updatedAt)
    ?? parsedTimestamp(session.createdAt)
    ?? 0;
}

export type ActiveSessionContext = {
  session: Session | null;
  startedAt: number | null;
  otherUnfinishedSessionIds: string[];
};

export function chooseCurrentUnfinishedSession(sessions: Session[]): ActiveSessionContext {
  const ordered = sessions
    .filter(session => !session.isFinished)
    .sort((left, right) =>
      sessionActivatedAt(right) - sessionActivatedAt(left)
      || sessionStartedAt(right) - sessionStartedAt(left)
      || left.id.localeCompare(right.id)
    );
  const session = ordered[0] ?? null;
  return {
    session,
    startedAt: session ? sessionStartedAt(session) : null,
    otherUnfinishedSessionIds: ordered.slice(1).map(candidate => candidate.id),
  };
}

export async function getActiveSessionContext(
  projectId: string,
  database: FindSpotDB = db,
): Promise<ActiveSessionContext> {
  const unfinished = await database.sessions
    .where('projectId')
    .equals(projectId)
    .filter(session => !session.isFinished)
    .toArray();
  return chooseCurrentUnfinishedSession(unfinished);
}
