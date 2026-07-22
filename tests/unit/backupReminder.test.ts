import { describe, expect, it } from 'vitest';
import {
  BACKUP_IMPORTANT_FIND_COUNT,
  BACKUP_URGENT_FIND_COUNT,
  evaluateBackupReminder,
} from '../../src/services/backupReminder';

const backupAt = '2026-07-01T12:00:00.000Z';
const beforeBackup = '2026-06-30T12:00:00.000Z';
const afterBackup = '2026-07-02T12:00:00.000Z';
const now = Date.parse('2026-07-22T12:00:00.000Z');

function finds(count: number, updatedAt = afterBackup) {
  return Array.from({ length: count }, () => ({ createdAt: updatedAt, updatedAt }));
}

describe('backup reminder escalation', () => {
  it('stays silent when there is no user data', () => {
    expect(evaluateBackupReminder({
      permissionCount: 0, finds: [], lastBackupDate: null, snoozedUntil: null, now,
    }).level).toBe('none');
  });

  it('recommends the first backup for user records even before a find exists', () => {
    expect(evaluateBackupReminder({
      permissionCount: 1, finds: [], lastBackupDate: null, snoozedUntil: null, now,
    })).toMatchObject({ level: 'recommended', changedFindCount: 0, hasExternalBackup: false });
  });

  it('stays silent when every find is already covered, regardless of backup age', () => {
    expect(evaluateBackupReminder({
      permissionCount: 1,
      finds: finds(3, beforeBackup),
      lastBackupDate: backupAt,
      snoozedUntil: null,
      now,
    })).toMatchObject({ level: 'none', changedFindCount: 0 });
  });

  it.each([
    [1, 'recommended'],
    [BACKUP_IMPORTANT_FIND_COUNT, 'important'],
    [BACKUP_URGENT_FIND_COUNT, 'urgent'],
  ] as const)('maps %i changed finds to %s', (count, level) => {
    expect(evaluateBackupReminder({
      permissionCount: 1,
      finds: finds(count),
      lastBackupDate: backupAt,
      snoozedUntil: null,
      now,
    })).toMatchObject({ level, changedFindCount: count });
  });

  it('uses updatedAt rather than createdAt when an older find is edited', () => {
    expect(evaluateBackupReminder({
      permissionCount: 1,
      finds: [{ createdAt: beforeBackup, updatedAt: afterBackup }],
      lastBackupDate: backupAt,
      snoozedUntil: null,
      now,
    }).changedFindCount).toBe(1);
  });

  it('treats an invalid historical timestamp as changed rather than silently protected', () => {
    expect(evaluateBackupReminder({
      permissionCount: 1,
      finds: [{ createdAt: 'invalid', updatedAt: 'invalid' }],
      lastBackupDate: backupAt,
      snoozedUntil: null,
      now,
    }).changedFindCount).toBe(1);
  });

  it('honours snooze below urgent while an urgent backlog overrides it', () => {
    const snoozedUntil = '2026-07-23T12:00:00.000Z';
    expect(evaluateBackupReminder({
      permissionCount: 1,
      finds: finds(BACKUP_IMPORTANT_FIND_COUNT),
      lastBackupDate: backupAt,
      snoozedUntil,
      now,
    })).toMatchObject({ level: 'none', snoozed: true });
    expect(evaluateBackupReminder({
      permissionCount: 1,
      finds: finds(BACKUP_URGENT_FIND_COUNT),
      lastBackupDate: backupAt,
      snoozedUntil,
      now,
    })).toMatchObject({ level: 'urgent', snoozed: true });
  });
});
