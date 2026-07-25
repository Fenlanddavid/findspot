import type { Session } from '../db';

export const SESSION_COVERAGE_EDIT_WINDOW_MS = 48 * 60 * 60 * 1_000;

export function sessionCoverageEditDeadline(session: Session): number | null {
  if (!session.isFinished || !session.endTime) return null;
  const endTime = Date.parse(session.endTime);
  if (!Number.isFinite(endTime)) return null;
  return endTime + SESSION_COVERAGE_EDIT_WINDOW_MS;
}

export function canEditSessionCoverage(session: Session, now = Date.now()): boolean {
  const deadline = sessionCoverageEditDeadline(session);
  return deadline !== null && now <= deadline;
}
