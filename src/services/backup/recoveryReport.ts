import { RETIRED_QUESTION_RULE_IDS } from '../persistenceValidation/backup';
import type { BackupTableKey, ValidatedBackupData } from './schema';
import { BACKED_UP_TABLE_NAMES } from './tableRegistry';

export const LAST_RESTORE_REPORT_SETTING_KEY = 'lastRestoreReport';

export type BackupRecoveryTableReport = {
  imported: number;
  skipped: number;
  repaired: number;
  damaged: number;
};

export type BackupRecoveryReport = {
  mode: 'drill' | 'restore';
  ready: true;
  backupVersion: number;
  createdAt: string;
  tables: Record<BackupTableKey, BackupRecoveryTableReport>;
  totals: BackupRecoveryTableReport;
};

function emptyCounts(): BackupRecoveryTableReport {
  return { imported: 0, skipped: 0, repaired: 0, damaged: 0 };
}

export function createBackupRecoveryReport(
  backup: ValidatedBackupData,
  mode: BackupRecoveryReport['mode'],
  createdAt = new Date().toISOString(),
): BackupRecoveryReport {
  const tables = Object.fromEntries(BACKED_UP_TABLE_NAMES.map(tableName => [
    tableName,
    { ...emptyCounts(), imported: backup[tableName].length },
  ])) as Record<BackupTableKey, BackupRecoveryTableReport>;

  const retiredQuestionCount = backup.outstandingQuestions.filter(
    question => RETIRED_QUESTION_RULE_IDS.has(question.ruleId),
  ).length;
  tables.outstandingQuestions.imported -= retiredQuestionCount;
  tables.outstandingQuestions.skipped = retiredQuestionCount;

  // Legacy JSON media is valid and recoverable, but needs conversion from its
  // historical data-URI representation into the current persisted Blob shape.
  tables.media.repaired = backup.media.filter(media => media.format === 'legacy').length;

  const totals = BACKED_UP_TABLE_NAMES.reduce((summary, tableName) => {
    const table = tables[tableName];
    summary.imported += table.imported;
    summary.skipped += table.skipped;
    summary.repaired += table.repaired;
    summary.damaged += table.damaged;
    return summary;
  }, emptyCounts());

  return {
    mode,
    ready: true,
    backupVersion: backup.version,
    createdAt,
    tables,
    totals,
  };
}
