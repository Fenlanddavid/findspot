import { db, type FindSpotDB, type Permission, type Session } from '../../db';
import {
  chooseCurrentUnfinishedSession,
  completedSessionAt,
  type ActiveSessionContext,
} from '../session/activeSessionContext';

export type HomeReturnContext = {
  permission: Permission;
  lastVisitAt: number | null;
  reason: 'active-session' | 'completed-session' | 'recent-activity';
};

export type HomeContext = {
  active: ActiveSessionContext;
  returnTo: HomeReturnContext | null;
  completedSessionCount: number;
};

function permissionActivityAt(permission: Permission): number {
  for (const candidate of [permission.updatedAt, permission.createdAt]) {
    const parsed = Date.parse(candidate);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

export function chooseMostRecentCompletedSession(sessions: Session[]): Session | null {
  return sessions
    .filter(session => session.isFinished)
    .sort((left, right) =>
      completedSessionAt(right) - completedSessionAt(left)
      || left.id.localeCompare(right.id)
    )[0] ?? null;
}

export async function getHomeContext(
  projectId: string,
  database: FindSpotDB = db,
): Promise<HomeContext> {
  const [sessions, permissions] = await Promise.all([
    database.sessions.where('projectId').equals(projectId).toArray(),
    database.permissions.where('projectId').equals(projectId).toArray(),
  ]);
  const realPermissions = permissions.filter(permission => !permission.isDefault);
  const permissionById = new Map(realPermissions.map(permission => [permission.id, permission]));
  const active = chooseCurrentUnfinishedSession(sessions);
  const completed = sessions.filter(session => session.isFinished);

  if (active.session) {
    const permission = permissionById.get(active.session.permissionId);
    if (permission) {
      return {
        active,
        completedSessionCount: completed.length,
        returnTo: { permission, lastVisitAt: null, reason: 'active-session' },
      };
    }
  }

  const recentSession = chooseMostRecentCompletedSession(sessions);
  if (recentSession) {
    const permission = permissionById.get(recentSession.permissionId);
    if (permission) {
      return {
        active,
        completedSessionCount: completed.length,
        returnTo: {
          permission,
          lastVisitAt: completedSessionAt(recentSession),
          reason: 'completed-session',
        },
      };
    }
  }

  const permission = realPermissions.sort((left, right) =>
    permissionActivityAt(right) - permissionActivityAt(left)
    || left.createdAt.localeCompare(right.createdAt)
    || left.id.localeCompare(right.id)
  )[0];
  return {
    active,
    completedSessionCount: completed.length,
    returnTo: permission
      ? {
          permission,
          lastVisitAt: permissionActivityAt(permission),
          reason: 'recent-activity',
        }
      : null,
  };
}
