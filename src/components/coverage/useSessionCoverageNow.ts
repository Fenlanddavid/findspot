import { useEffect, useState } from 'react';
import type { Session } from '../../db';
import { sessionCoverageEditDeadline } from '../../shared/sessionCoveragePolicy';

const MAX_TIMER_DELAY_MS = 2_147_483_647;

export function nextSessionCoverageDeadline(
  sessions: readonly Session[],
  now: number,
): number | null {
  const future = sessions.flatMap(session => {
    const deadline = sessionCoverageEditDeadline(session);
    return deadline !== null && deadline >= now ? [deadline] : [];
  });
  return future.length > 0 ? Math.min(...future) : null;
}

export function useSessionCoverageNow(sessions: readonly Session[]): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const current = Date.now();
    const deadline = nextSessionCoverageDeadline(sessions, current);
    if (deadline === null) return;
    const delay = Math.min(
      MAX_TIMER_DELAY_MS,
      Math.max(0, deadline - current + 1),
    );
    const timeout = globalThis.setTimeout(() => setNow(Date.now()), delay);
    return () => globalThis.clearTimeout(timeout);
  }, [sessions, now]);

  return now;
}
