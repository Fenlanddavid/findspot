import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Session } from '../db';
import { useDurableSetting } from '../services/clientStorage';
import { isTrackingActiveForSession } from '../services/tracking';
import { sessionStartedAt } from '../services/session/activeSessionContext';
import { useActiveSessionFieldStatus } from './useActiveSessionFieldStatus';

export function useActiveSessionGuideContext(sessionId: string | null) {
  const session = useLiveQuery(
    async () => sessionId ? await db.sessions.get(sessionId) ?? null : null,
    [sessionId],
  ) as Session | null | undefined;
  const permission = useLiveQuery(
    async () => session?.permissionId ? await db.permissions.get(session.permissionId) : undefined,
    [session?.permissionId],
  );
  const findCount = useLiveQuery(
    () => sessionId ? db.finds.where('sessionId').equals(sessionId).filter(find => !find.isPending).count() : Promise.resolve(0),
    [sessionId],
    0,
  );
  const recordedTrailCount = useLiveQuery(
    () => sessionId
      ? db.tracks.where('sessionId').equals(sessionId).filter(track => (track.points?.length ?? 0) > 0).count()
      : Promise.resolve(0),
    [sessionId],
    0,
  );
  const [companionActiveSessionId] = useDurableSetting('fs_companion_active_session', '');
  const [now, setNow] = useState(Date.now()); const embeddedInSession = !!sessionId && session !== null && !session?.isFinished; const fieldStatus = useActiveSessionFieldStatus(sessionId, session, permission);
  useEffect(() => {
    if (!embeddedInSession) return;
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, [embeddedInSession]);

  const startedAt = session ? sessionStartedAt(session) : now;
  const elapsedMinutes = Math.max(0, Math.floor((now - startedAt) / 60_000));
  const durationText = elapsedMinutes >= 60
    ? `${Math.floor(elapsedMinutes / 60)}h ${elapsedMinutes % 60}m`
    : `${elapsedMinutes}m`;

  return {
    embeddedInSession,
    permissionId: permission?.id ?? null,
    permissionName: permission?.name ?? 'Active detecting session',
    durationText,
    findCount: findCount ?? 0,
    isTracking: sessionId ? isTrackingActiveForSession(sessionId) : false,
    isCompanionTracking: companionActiveSessionId === sessionId,
    hasRecordedTrail: (recordedTrailCount ?? 0) > 0,
    ...fieldStatus,
  };
}
