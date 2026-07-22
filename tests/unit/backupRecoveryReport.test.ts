import { describe, expect, it } from 'vitest';
import { RETIRED_QUESTION_RULE_IDS } from '../../src/services/persistenceValidation/backup';
import { createBackupRecoveryReport } from '../../src/services/backup/recoveryReport';
import { BACKED_UP_TABLE_NAMES } from '../../src/services/backup/tableRegistry';
import { validateBackupData } from '../../src/services/backup/validation';

describe('backup recovery reports', () => {
  it('reports every backed-up table and distinguishes imported, skipped and repaired rows', () => {
    const backup = validateBackupData({ projects: [] });
    const retiredRuleId = [...RETIRED_QUESTION_RULE_IDS][0];
    backup.projects.push({ id: 'project-1' } as never);
    backup.outstandingQuestions.push(
      { id: 'active', ruleId: 'MOVEMENT_NO_FINDS' } as never,
      { id: 'retired', ruleId: retiredRuleId } as never,
    );
    backup.media.push({ id: 'legacy', format: 'legacy', blob: 'data:image/jpeg;base64,AA==' } as never);

    const report = createBackupRecoveryReport(backup, 'drill', '2026-07-22T18:00:00.000Z');

    expect(Object.keys(report.tables).sort()).toEqual([...BACKED_UP_TABLE_NAMES].sort());
    expect(report.tables.projects.imported).toBe(1);
    expect(report.tables.outstandingQuestions).toEqual({
      imported: 1,
      skipped: 1,
      repaired: 0,
      damaged: 0,
    });
    expect(report.tables.media).toEqual({
      imported: 1,
      skipped: 0,
      repaired: 1,
      damaged: 0,
    });
    expect(report.totals).toEqual({ imported: 3, skipped: 1, repaired: 1, damaged: 0 });
  });
});
