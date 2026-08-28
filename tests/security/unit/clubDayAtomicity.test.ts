import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, type Field, type Permission } from '../../../src/db';
import { importClubDayPack } from '../../../src/services/data';
import { validClubDayPack } from '../fixtures/clubDayHostileCorpus';

beforeEach(async () => {
  db.close();
  await Dexie.delete(db.name);
  await db.open();
  await db.projects.add({ id: 'project-1', name: 'Project', region: 'England', createdAt: '2026-08-28T08:00:00.000Z' });
});

afterEach(async () => {
  vi.restoreAllMocks();
  db.close();
  await Dexie.delete(db.name);
});

describe('Club Day import atomicity and identity', () => {
  it('rolls back permission and fields if the import ledger write fails', async () => {
    vi.spyOn(db.importedPackages, 'put').mockRejectedValueOnce(new Error('simulated ledger failure'));
    await expect(importClubDayPack(JSON.stringify(validClubDayPack()))).rejects.toThrow();
    expect(await db.permissions.count()).toBe(0);
    expect(await db.fields.count()).toBe(0);
    expect(await db.importedPackages.count()).toBe(0);
  });

  it('does not let an external field ID overwrite an unrelated local field', async () => {
    const permission: Permission = {
      id: 'local-permission', projectId: 'project-1', name: 'Local', type: 'individual',
      lat: null, lon: null, gpsAccuracyM: null, collector: '', landType: 'other',
      permissionGranted: true, notes: '', createdAt: '2026-08-28T08:00:00.000Z', updatedAt: '2026-08-28T08:00:00.000Z',
    };
    const field: Field = {
      id: 'external-field-1', projectId: 'project-1', permissionId: permission.id,
      name: 'Private field', boundary: validClubDayPack().fields[0].boundary,
      notes: 'keep me', createdAt: permission.createdAt, updatedAt: permission.updatedAt,
    };
    await db.permissions.add(permission);
    await db.fields.add(field);

    await importClubDayPack(JSON.stringify(validClubDayPack()));

    expect(await db.fields.get(field.id)).toMatchObject({ permissionId: permission.id, notes: 'keep me' });
    const imported = await db.fields.filter(candidate => candidate.sharedFieldId === 'external-field-1').first();
    expect(imported?.id).not.toBe(field.id);
    expect(imported?.permissionId).not.toBe(permission.id);
  });
});
