import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';

/** Owns all live IndexedDB reads needed by one session page. */
export function useSessionData(params: {
    sessionId: string;
    permissionId: string | null;
    fieldId: string | null;
}) {
    const { sessionId, permissionId, fieldId } = params;
    const session = useLiveQuery(() => db.sessions.get(sessionId), [sessionId]);
    const permission = useLiveQuery(
        async () => permissionId
            ? db.permissions.get(permissionId)
            : db.sessions.get(sessionId).then(row => row ? db.permissions.get(row.permissionId) : null),
        [permissionId, sessionId],
    );
    const fields = useLiveQuery(async () => {
        const resolvedPermissionId = permissionId || await db.sessions.get(sessionId).then(row => row?.permissionId);
        return resolvedPermissionId
            ? db.fields.where('permissionId').equals(resolvedPermissionId).toArray()
            : [];
    }, [permissionId, sessionId]);
    const selectedField = useLiveQuery(
        async () => fieldId ? (await db.fields.get(fieldId)) ?? null : null,
        [fieldId],
    );
    const finds = useLiveQuery(
        () => db.finds.where('sessionId').equals(sessionId)
            .filter(find => !find.scatterId && !find.isNotableFind)
            .reverse()
            .sortBy('createdAt'),
        [sessionId],
    );
    const allMedia = useLiveQuery(async () => {
        const ids = (finds ?? []).map(find => find.id);
        return ids.length > 0 ? db.media.where('findId').anyOf(ids).toArray() : [];
    }, [finds]);
    const tracks = useLiveQuery(
        () => db.tracks.where('sessionId').equals(sessionId).toArray(),
        [sessionId],
    );

    return { session, permission, fields, selectedField, finds, allMedia, tracks };
}
