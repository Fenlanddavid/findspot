import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { FindSpotDB } from '../../src/db';

const databaseNames = new Set<string>();

afterEach(async () => {
  await Promise.all([...databaseNames].map(name => Dexie.delete(name)));
  databaseNames.clear();
});

describe('pre-audit persistence integrity characterization', () => {
  it('retains inconsistent cross-table references until an explicit audit reports them', async () => {
    const name = `findspot-integrity-characterization-${crypto.randomUUID()}`;
    databaseNames.add(name);
    const database = new FindSpotDB(name);
    await database.open();

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
      await database.table('questionNotes').add({
        id: 'note-orphan', questionId: 'missing-question',
      });
    });

    expect(await database.permissions.count()).toBe(2);
    expect(await database.fields.get('field-dangling')).toBeDefined();
    expect(await database.sessions.get('session-dangling')).toBeDefined();
    expect(await database.finds.get('find-orphan')).toBeDefined();
    expect(await database.significantFinds.get('significant-orphan')).toBeDefined();
    expect(await database.media.get('media-orphan')).toBeDefined();
    expect(await database.tracks.get('track-orphan')).toBeDefined();
    expect(await database.savedPoints.get('point-orphan')).toBeDefined();
    expect((await database.outstandingQuestions.toArray()).map(row => row.id).sort()).toEqual([
      'question-dangling',
      'question-retired',
    ]);
    expect(await database.questionNotes.get('note-orphan')).toBeDefined();

    database.close();
  });
});
