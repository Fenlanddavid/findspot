import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Permission, type Session } from '../db';
import { getTrackingStatus } from '../services/tracking';
import { evaluateBoundaryPosition } from '../services/session/sessionFieldPosition';

export function useActiveSessionFieldStatus(sessionId: string | null, session: Session | null | undefined, permission: Permission | null | undefined) {
  const pendingCount = useLiveQuery(
    () => sessionId ? db.finds.where('sessionId').equals(sessionId).filter(find => !!find.isPending).count() : Promise.resolve(0),
    [sessionId], 0,
  );
  const field = useLiveQuery(() => session?.fieldId ? db.fields.get(session.fieldId) : undefined, [session?.fieldId]);
  const [trackingStatus, setTrackingStatus] = useState(() => getTrackingStatus());
  useEffect(() => {
    if (!sessionId || session?.isFinished) return;
    setTrackingStatus(getTrackingStatus());
    const timer = window.setInterval(() => setTrackingStatus(getTrackingStatus()), 2_000);
    return () => window.clearInterval(timer);
  }, [session?.isFinished, sessionId]);
  return {
    fieldName: field?.name,
    pendingCount: pendingCount ?? 0,
    trackingStatus,
    boundaryStatus: evaluateBoundaryPosition(field?.boundary ?? permission?.boundary, trackingStatus.lastAcceptedPoint),
  };
}
