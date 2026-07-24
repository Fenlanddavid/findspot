import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import {
  FINDSPOT_CURRENT_VERSION,
  FINDSPOT_VERSION_SPECS,
  FindSpotDB,
  applyFindSpotVersions,
} from '../../src/db';

type FixtureRows = Record<string, Array<Record<string, unknown>>>;

const fixtureNames = new Set<string>();

async function createFixtureDb(
  name: string,
  upTo: number,
  rows: FixtureRows,
): Promise<void> {
  await Dexie.delete(name);
  fixtureNames.add(name);

  const fixture = new Dexie(name);
  applyFindSpotVersions(fixture, upTo);
  await fixture.open();

  await fixture.transaction('rw', fixture.tables, async () => {
    for (const [tableName, tableRows] of Object.entries(rows)) {
      if (tableRows.length > 0) await fixture.table(tableName).bulkAdd(tableRows);
    }
  });
  fixture.close();
}

async function openCurrent(name: string): Promise<FindSpotDB> {
  const current = new FindSpotDB(name);
  await current.open();
  return current;
}

async function expectNoDanglingPermissionIds(database: FindSpotDB): Promise<void> {
  const permissionIds = new Set((await database.permissions.toArray()).map(row => row.id));
  const references = [
    ...(await database.fields.toArray()).map(row => ['fields', row.permissionId] as const),
    ...(await database.sessions.toArray()).map(row => ['sessions', row.permissionId] as const),
    ...(await database.finds.toArray()).map(row => ['finds', row.permissionId] as const),
    ...(await database.significantFinds.toArray()).map(row => ['significantFinds', row.permissionId] as const),
  ];

  for (const [table, permissionId] of references) {
    expect(permissionIds.has(permissionId), `${table} has dangling permissionId ${permissionId}`).toBe(true);
  }
}

afterEach(async () => {
  await Promise.all([...fixtureNames].map(name => Dexie.delete(name)));
  fixtureNames.clear();
});

describe('FindSpot IndexedDB forward migrations', () => {
  it('exports one ordered schema history through the current version', () => {
    expect(FINDSPOT_VERSION_SPECS.map(spec => spec.version)).toEqual(
      Array.from({ length: FINDSPOT_CURRENT_VERSION }, (_, index) => index + 1),
    );
  });

  it('migrates v10 permission boundaries into Main Field rows and repoints children', async () => {
    const name = 'findspot-migration-v10';
    await createFixtureDb(name, 10, {
      projects: [{ id: 'project-1', name: 'Project', region: 'England', createdAt: '2024-01-01' }],
      permissions: [{
        id: 'permission-1', projectId: 'project-1', name: 'Permission', type: 'individual',
        permissionGranted: true, boundary: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [0, 0]]] },
        createdAt: '2024-01-01',
      }],
      sessions: [{
        id: 'session-1', projectId: 'project-1', permissionId: 'permission-1',
        date: '2024-01-01', isFinished: false, createdAt: '2024-01-01',
      }],
      finds: [{
        id: 'find-1', projectId: 'project-1', permissionId: 'permission-1',
        sessionId: 'session-1', findCode: 'F1', objectType: 'Coin', createdAt: '2024-01-01',
      }],
    });

    const current = await openCurrent(name);
    const fields = await current.fields.toArray();
    const session = await current.sessions.get('session-1');
    const find = await current.finds.get('find-1');

    expect(fields).toHaveLength(1);
    expect(fields[0]).toMatchObject({
      projectId: 'project-1',
      permissionId: 'permission-1',
      name: 'Main Field',
    });
    expect(session?.fieldId).toBe(fields[0].id);
    expect(find?.fieldId).toBe(fields[0].id);
    expect(await current.permissions.count()).toBe(1);
    expect(await current.sessions.count()).toBe(1);
    expect(await current.finds.count()).toBe(1);
    await expectNoDanglingPermissionIds(current);
    current.close();
  });

  it('runs the v19 orphan-field sweep when upgrading a v18 fixture', async () => {
    const name = 'findspot-migration-v18';
    await createFixtureDb(name, 18, {
      projects: [{ id: 'project-1' }],
      permissions: [{ id: 'permission-1', projectId: 'project-1' }],
      fields: [
        { id: 'field-valid', projectId: 'project-1', permissionId: 'permission-1' },
        { id: 'field-orphan', projectId: 'project-1', permissionId: 'missing-permission' },
      ],
    });

    const current = await openCurrent(name);
    expect((await current.fields.toArray()).map(row => row.id)).toEqual(['field-valid']);
    await expectNoDanglingPermissionIds(current);
    current.close();
  });

  it('keeps user rows and the retired object stores absent from a v25 fixture', async () => {
    const name = 'findspot-migration-v25';
    await createFixtureDb(name, 25, {
      projects: [{ id: 'project-1' }],
      permissions: [{ id: 'permission-1', projectId: 'project-1' }],
      fields: [{ id: 'field-1', projectId: 'project-1', permissionId: 'permission-1' }],
    });

    const current = await openCurrent(name);
    expect(await current.projects.count()).toBe(1);
    expect(await current.permissions.count()).toBe(1);
    expect(await current.fields.count()).toBe(1);
    expect(current.tables.map(table => table.name)).not.toContain('fieldGuideInvestigations');
    expect(current.tables.map(table => table.name)).not.toContain('autoBackups');
    await expectNoDanglingPermissionIds(current);
    current.close();
  });

  it('deletes retired question rules while preserving active rows from v34', async () => {
    const name = 'findspot-migration-v34';
    await createFixtureDb(name, 34, {
      projects: [{ id: 'project-1' }],
      permissions: [{ id: 'permission-1', projectId: 'project-1' }],
      outstandingQuestions: [
        { id: 'active', permissionId: 'permission-1', ruleId: 'MOVEMENT_NO_FINDS', status: 'UNRESOLVED' },
        { id: 'retired-1', permissionId: 'permission-1', ruleId: 'PROTECTED_AREA_EXCLUSION', status: 'UNRESOLVED' },
        { id: 'retired-2', permissionId: 'permission-1', ruleId: 'COVERAGE_GAP', status: 'UNRESOLVED' },
        { id: 'retired-3', permissionId: 'permission-1', ruleId: 'PUBLIC_RECORD_CONTEXT', status: 'UNRESOLVED' },
      ],
    });

    const current = await openCurrent(name);
    expect((await current.outstandingQuestions.toArray()).map(row => row.id)).toEqual(['active']);
    expect(await current.projects.count()).toBe(1);
    expect(await current.permissions.count()).toBe(1);
    await expectNoDanglingPermissionIds(current);
    current.close();
  });

  it('adds coverage tables to a v40 database without changing existing prediction outcomes', async () => {
    const name = 'findspot-migration-v40-coverage';
    await createFixtureDb(name, 40, {
      projects: [{ id: 'project-1' }],
      permissions: [{ id: 'permission-1', projectId: 'project-1' }],
      hotspotPredictions: [{
        id: 'prediction-1',
        engineVersion: 'engine-v1',
        confidence: 'Strong Signal',
        surfacedAt: 1,
        permissionId: 'permission-1',
        outcome: 'hit',
      }],
    });

    const current = await openCurrent(name);
    expect(await current.permissionSections.count()).toBe(0);
    expect(await current.sessionCoverage.count()).toBe(0);
    expect(await current.hotspotPredictions.get('prediction-1')).toMatchObject({
      engineVersion: 'engine-v1',
      outcome: 'hit',
    });
    expect(await current.projects.count()).toBe(1);
    expect(await current.permissions.count()).toBe(1);
    current.close();
  });
});
