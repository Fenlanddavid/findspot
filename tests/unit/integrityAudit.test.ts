import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FINDSPOT_CURRENT_VERSION, FindSpotDB } from '../../src/db';
import {
  INTEGRITY_AUDIT_SCHEMA_SETTING_KEY,
  INTEGRITY_AUDIT_SUMMARY_SETTING_KEY,
  auditDatabaseIntegrity,
  formatIntegrityAuditStatus,
  getLatestIntegrityAuditSummary,
  parseIntegrityAuditSummary,
  runIntegrityAuditAfterSchemaChange,
} from '../../src/services/integrityAudit';

const databaseNames = new Set<string>();

async function openDatabase(): Promise<FindSpotDB> {
  const name = `findspot-integrity-${crypto.randomUUID()}`;
  databaseNames.add(name);
  const database = new FindSpotDB(name);
  await database.open();
  return database;
}

afterEach(async () => {
  await Promise.all([...databaseNames].map(name => Dexie.delete(name)));
  databaseNames.clear();
});

describe('on-device integrity audit', () => {
  it('reports a healthy database without writing to user tables', async () => {
    const database = await openDatabase();
    await database.table('projects').add({ id: 'project-1' });
    await database.table('permissions').add({ id: 'permission-1', projectId: 'project-1' });

    const summary = await auditDatabaseIntegrity(database, 40, '2026-07-22T20:00:00.000Z');

    expect(summary).toEqual({
      checkedAt: '2026-07-22T20:00:00.000Z',
      schemaVersion: 40,
      issueCount: 0,
      counts: { orphanedRecords: 0, danglingPermissionIds: 0, retiredRules: 0 },
    });
    expect(await database.projects.count()).toBe(1);
    expect(await database.permissions.count()).toBe(1);
    database.close();
  });

  it('counts inconsistent references and retired rules without repairing them', async () => {
    const database = await openDatabase();
    await database.transaction('rw', database.tables, async () => {
      await database.table('projects').add({ id: 'project-1' });
      await database.table('permissions').bulkAdd([
        { id: 'permission-1', projectId: 'project-1' },
        { id: 'permission-orphan', projectId: 'missing-project' },
      ]);
      await database.table('fields').add({
        id: 'field-dangling', projectId: 'project-1', permissionId: 'missing-permission',
      });
      await database.table('sessions').add({
        id: 'session-dangling', projectId: 'project-1', permissionId: 'missing-permission',
      });
      await database.table('finds').add({
        id: 'find-orphan', projectId: 'project-1', permissionId: 'permission-1',
        sessionId: 'missing-session',
      });
      await database.table('significantFinds').add({
        id: 'significant-orphan', projectId: 'project-1', permissionId: 'permission-1',
        linkedFindId: 'missing-find',
      });
      await database.table('media').add({
        id: 'media-orphan', projectId: 'project-1', findId: 'missing-find',
      });
      await database.table('tracks').add({
        id: 'track-orphan', projectId: 'project-1', sessionId: 'missing-session',
      });
      await database.table('savedPoints').add({
        id: 'point-orphan', projectId: 'missing-project',
      });
      await database.table('outstandingQuestions').bulkAdd([
        { id: 'question-dangling', permissionId: 'missing-permission', ruleId: 'MOVEMENT_NO_FINDS' },
        { id: 'question-retired', permissionId: 'permission-1', ruleId: 'PROTECTED_AREA_EXCLUSION' },
      ]);
      // User notes may intentionally outlive a generated question so that a
      // deterministic revival can reattach them; that is not an orphan issue.
      await database.table('questionNotes').add({ id: 'retained-note', questionId: 'revivable-question' });
    });

    const tableCountsBefore = await Promise.all(database.tables.map(table => table.count()));
    const summary = await auditDatabaseIntegrity(database);
    const tableCountsAfter = await Promise.all(database.tables.map(table => table.count()));

    expect(summary.counts).toEqual({
      orphanedRecords: 6,
      danglingPermissionIds: 3,
      retiredRules: 1,
    });
    expect(summary.issueCount).toBe(10);
    expect(tableCountsAfter).toEqual(tableCountsBefore);
    expect(await database.questionNotes.get('retained-note')).toBeDefined();
    database.close();
  });

  it('runs once per schema version and stores only its bounded summary and marker', async () => {
    const database = await openDatabase();
    const diagnostic = vi.fn();
    const audit = vi.fn(auditDatabaseIntegrity);

    const first = await runIntegrityAuditAfterSchemaChange({
      database,
      checkedAt: '2026-07-22T20:10:00.000Z',
      audit,
      diagnostic,
    });
    const second = await runIntegrityAuditAfterSchemaChange({ database, audit, diagnostic });

    expect(first.status).toBe('completed');
    expect(second.status).toBe('skipped');
    expect(audit).toHaveBeenCalledTimes(1);
    expect(await database.settings.get(INTEGRITY_AUDIT_SCHEMA_SETTING_KEY)).toMatchObject({
      value: FINDSPOT_CURRENT_VERSION,
    });
    expect(await getLatestIntegrityAuditSummary(database)).toMatchObject({
      checkedAt: '2026-07-22T20:10:00.000Z',
      issueCount: 0,
    });
    expect((await database.settings.get(INTEGRITY_AUDIT_SUMMARY_SETTING_KEY))?.value)
      .not.toHaveProperty('recordIds');
    expect(diagnostic).toHaveBeenCalledWith('info', 'On-device data check passed');
    database.close();
  });

  it('keeps startup non-fatal and leaves the marker unset so a failed audit retries', async () => {
    const database = await openDatabase();
    const diagnostic = vi.fn();
    const failure = new Error('read failed');

    const result = await runIntegrityAuditAfterSchemaChange({
      database,
      audit: async () => { throw failure; },
      diagnostic,
    });

    expect(result).toEqual({ status: 'failed', summary: null });
    expect(await database.settings.get(INTEGRITY_AUDIT_SCHEMA_SETTING_KEY)).toBeUndefined();
    expect(await database.settings.get(INTEGRITY_AUDIT_SUMMARY_SETTING_KEY)).toBeUndefined();
    expect(diagnostic).toHaveBeenCalledWith(
      'error',
      'On-device data check could not complete',
      'read failed',
    );
    database.close();
  });

  it('rejects malformed stored summaries before they reach Settings', () => {
    expect(parseIntegrityAuditSummary({
      checkedAt: 'yesterday',
      schemaVersion: 40,
      issueCount: 1,
      counts: { orphanedRecords: 0, danglingPermissionIds: 0, retiredRules: 0 },
    })).toBeNull();
  });

  it('formats one short Settings status without exposing record details', () => {
    expect(formatIntegrityAuditStatus(null)).toBe('Data check pending.');
    expect(formatIntegrityAuditStatus({
      checkedAt: '2026-07-22T20:00:00.000Z',
      schemaVersion: 40,
      issueCount: 2,
      counts: { orphanedRecords: 1, danglingPermissionIds: 1, retiredRules: 0 },
    })).toBe('Data check found 2 possible link issues. Your records were not changed.');
  });
});
