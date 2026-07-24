import { db } from '../db';
import type { Field, Media, Permission } from '../db';
import { deleteQuestionsWithNotes } from '../outstandingQuestions/questionNotes';

export async function setPermissionPinned(permissionId: string, pinned: boolean): Promise<void> {
  await db.permissions.update(permissionId, { isPinned: pinned });
}

export async function createPermissionRecord(permission: Permission): Promise<void> {
  await db.permissions.add(permission);
}

export async function updatePermissionDetails(
  permissionId: string,
  updates: Partial<Permission>,
): Promise<void> {
  await db.permissions.update(permissionId, updates);
}

export async function saveClubDayShareDetails(
  permissionId: string,
  updates: Partial<Permission>,
): Promise<void> {
  await db.permissions.update(permissionId, updates);
}

export async function markClubDayExportSubmitted(permissionId: string, submittedAt: string): Promise<void> {
  await db.permissions.update(permissionId, { submittedAt });
}

export async function deletePermissionCascade(
  permissionId: string,
  options: { removeJoinRecord?: boolean } = {},
): Promise<void> {
  const permission = options.removeJoinRecord ? await db.permissions.get(permissionId) : undefined;
  const sessions = await db.sessions.where('permissionId').equals(permissionId).toArray();
  const sessionIds = sessions.map(session => session.id);
  const finds = await db.finds.where('permissionId').equals(permissionId).toArray();
  const findIds = finds.map(find => find.id);
  const significantFinds = await db.significantFinds.where('permissionId').equals(permissionId).toArray();
  const significantFindIds = significantFinds.map(find => find.id);

  await db.transaction(
    'rw',
    [
      db.permissions,
      db.sessions,
      db.finds,
      db.significantFinds,
      db.media,
      db.fields,
      db.tracks,
      db.importedPackages,
      db.outstandingQuestions,
      db.questionNotes,
      db.permissionSections,
      db.sessionCoverage,
    ],
    async () => {
      if (findIds.length) await db.media.where('findId').anyOf(findIds).delete();
      if (significantFindIds.length) await db.media.where('findId').anyOf(significantFindIds).delete();
      await db.media.where('permissionId').equals(permissionId).delete();
      await db.finds.where('permissionId').equals(permissionId).delete();
      await db.significantFinds.where('permissionId').equals(permissionId).delete();
      if (sessionIds.length) await db.tracks.where('sessionId').anyOf(sessionIds).delete();
      await db.sessions.where('permissionId').equals(permissionId).delete();
      await db.fields.where('permissionId').equals(permissionId).delete();
      await db.sessionCoverage.where('permissionId').equals(permissionId).delete();
      await db.permissionSections.where('permissionId').equals(permissionId).delete();

      const questionIds = (
        await db.outstandingQuestions.where('permissionId').equals(permissionId).toArray()
      ).map(question => question.id);
      if (questionIds.length) {
        await deleteQuestionsWithNotes(questionIds, { preserveUserNotes: false });
      }
      await db.permissions.delete(permissionId);

      if (options.removeJoinRecord && permission?.sharedPermissionId) {
        const joinRecord = await db.importedPackages
          .filter(row => row.sharedPermissionId === permission.sharedPermissionId)
          .first();
        if (joinRecord) await db.importedPackages.delete(joinRecord.id);
      }
    },
  );
}

export async function keepClubDayAsPersonalRecord(
  permissionId: string,
  updatedAt: string,
): Promise<Permission | undefined> {
  const permission = await db.permissions.get(permissionId);
  const sharedPermissionId = permission?.sharedPermissionId;

  await db.transaction('rw', [db.permissions, db.sessions, db.finds, db.importedPackages], async () => {
    await db.permissions.update(permissionId, {
      isClubDayMember: false,
      isPersonalRallyRecord: true,
      isSharedPermission: false,
      sharedPermissionId: undefined,
      organiserContactNumber: undefined,
      organiserEmail: undefined,
      significantFindInstructions: undefined,
      clubDayPublicNotes: undefined,
      submittedAt: undefined,
      landownerPhone: permission?.landownerPhone || permission?.organiserContactNumber,
      landownerEmail: permission?.landownerEmail || permission?.organiserEmail,
      notes: permission?.notes || permission?.clubDayPublicNotes || '',
      updatedAt,
    } as Partial<Permission>);

    await db.sessions.where('permissionId').equals(permissionId).modify(session => {
      delete session.sharedPermissionId;
      delete session.recorderId;
      delete session.recorderName;
      session.updatedAt = updatedAt;
    });
    await db.finds.where('permissionId').equals(permissionId).modify(find => {
      delete find.sharedPermissionId;
      delete find.recorderId;
      delete find.recorderName;
      find.updatedAt = updatedAt;
    });
    if (sharedPermissionId) {
      await db.importedPackages
        .filter(row => row.sharedPermissionId === sharedPermissionId)
        .delete();
    }
  });

  return permission;
}

export async function removeClubDaySharing(permissionId: string, updatedAt: string): Promise<void> {
  const permission = await db.permissions.get(permissionId);
  const sharedPermissionId = permission?.sharedPermissionId;

  await db.transaction('rw', [db.permissions, db.importedPackages], async () => {
    await db.permissions.update(permissionId, {
      isSharedPermission: false,
      sharedPermissionId: undefined,
      organiserContactNumber: undefined,
      organiserEmail: undefined,
      significantFindInstructions: undefined,
      clubDayPublicNotes: undefined,
      updatedAt,
    } as Partial<Permission>);
    if (sharedPermissionId) {
      await db.importedPackages
        .filter(row => row.sharedPermissionId === sharedPermissionId)
        .delete();
    }
  });
}

export async function deleteFieldAndUnlinkRecords(fieldId: string, updatedAt: string): Promise<void> {
  await db.transaction('rw', [db.fields, db.sessions, db.finds, db.permissionSections], async () => {
    await db.sessions.where('fieldId').equals(fieldId).modify({ fieldId: null, updatedAt });
    await db.finds.where('fieldId').equals(fieldId).modify({ fieldId: null, updatedAt });
    await db.permissionSections.where('fieldId').equals(fieldId).modify(section => {
      section.retiredAt = updatedAt;
      section.updatedAt = updatedAt;
    });
    await db.fields.delete(fieldId);
  });
}

export async function createFieldRecord(field: Field): Promise<void> {
  await db.fields.add(field);
}

export async function updateFieldDetails(fieldId: string, field: Field): Promise<void> {
  await db.fields.update(fieldId, field);
}

export async function saveFieldNotes(fieldId: string, notes: string, updatedAt: string): Promise<void> {
  await db.fields.update(fieldId, { notes, updatedAt });
}

export async function attachPermissionAgreement(
  permissionId: string,
  media: Media,
  permissionUpdates: Partial<Permission> = {},
): Promise<void> {
  await db.transaction('rw', [db.media, db.permissions], async () => {
    await db.media.add(media);
    await db.permissions.update(permissionId, {
      ...permissionUpdates,
      agreementId: media.id,
    });
  });
}
