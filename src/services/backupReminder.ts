import { db, type Find } from '../db';

export const BACKUP_IMPORTANT_FIND_COUNT = 5;
export const BACKUP_URGENT_FIND_COUNT = 20;

export type BackupReminderLevel = 'none' | 'recommended' | 'important' | 'urgent';

export type BackupReminderState = {
  level: BackupReminderLevel;
  changedFindCount: number;
  hasExternalBackup: boolean;
  snoozed: boolean;
  title: string;
  message: string;
};

export type BackupReminderInput = {
  permissionCount: number;
  finds: Array<Pick<Find, 'createdAt' | 'updatedAt'>>;
  lastBackupDate: string | null;
  snoozedUntil: string | null;
  now?: number;
};

function validTimestamp(value: string | null): number | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function changedAfterBackup(
  find: Pick<Find, 'createdAt' | 'updatedAt'>,
  lastBackupAt: number | null,
): boolean {
  if (lastBackupAt === null) return true;
  const updatedAt = validTimestamp(find.updatedAt) ?? validTimestamp(find.createdAt);
  return updatedAt === null || updatedAt > lastBackupAt;
}

function reminderCopy(
  level: Exclude<BackupReminderLevel, 'none'>,
  changedFindCount: number,
  hasExternalBackup: boolean,
): Pick<BackupReminderState, 'title' | 'message'> {
  const title = level === 'urgent'
    ? 'Backup Urgent'
    : level === 'important'
      ? 'Backup Due'
      : 'Backup Recommended';
  if (changedFindCount === 0) {
    return { title, message: 'This device has records that have never been backed up.' };
  }
  const noun = changedFindCount === 1 ? 'find has' : 'finds have';
  return {
    title,
    message: hasExternalBackup
      ? `${changedFindCount} ${noun} changed since your last backup.`
      : `${changedFindCount} ${noun} not yet been protected by an external backup.`,
  };
}

export function evaluateBackupReminder(input: BackupReminderInput): BackupReminderState {
  const now = input.now ?? Date.now();
  const lastBackupAt = validTimestamp(input.lastBackupDate);
  const hasExternalBackup = lastBackupAt !== null;
  const changedFindCount = input.finds.filter(find => changedAfterBackup(find, lastBackupAt)).length;
  const hasUserData = input.permissionCount > 0 || input.finds.length > 0;

  if (!hasUserData || (hasExternalBackup && changedFindCount === 0)) {
    return {
      level: 'none', changedFindCount, hasExternalBackup, snoozed: false,
      title: '', message: '',
    };
  }

  const unsnoozedLevel: Exclude<BackupReminderLevel, 'none'> =
    changedFindCount >= BACKUP_URGENT_FIND_COUNT
      ? 'urgent'
      : changedFindCount >= BACKUP_IMPORTANT_FIND_COUNT
        ? 'important'
        : 'recommended';
  const snoozedUntil = validTimestamp(input.snoozedUntil);
  const snoozed = snoozedUntil !== null && snoozedUntil > now;
  if (snoozed && unsnoozedLevel !== 'urgent') {
    return {
      level: 'none', changedFindCount, hasExternalBackup, snoozed: true,
      title: '', message: '',
    };
  }

  return {
    level: unsnoozedLevel,
    changedFindCount,
    hasExternalBackup,
    snoozed,
    ...reminderCopy(unsnoozedLevel, changedFindCount, hasExternalBackup),
  };
}

export async function getBackupReminderState(now = Date.now()): Promise<BackupReminderState> {
  const [permissionCount, finds, lastBackup, snoozedUntil] = await Promise.all([
    db.permissions.filter(permission => !permission.isDefault).count(),
    db.finds.toArray(),
    db.settings.get('lastBackupDate'),
    db.settings.get('backupSnoozedUntil'),
  ]);
  return evaluateBackupReminder({
    permissionCount,
    finds,
    lastBackupDate: typeof lastBackup?.value === 'string' ? lastBackup.value : null,
    snoozedUntil: typeof snoozedUntil?.value === 'string' ? snoozedUntil.value : null,
    now,
  });
}
