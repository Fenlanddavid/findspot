import 'fake-indexeddb/auto';
import { afterEach, expect, it, vi } from 'vitest';
import Dexie from 'dexie';
import { db } from '../../src/db';
import { seedBackupFixture } from '../fixtures/backupFixtureFactories';
import { saveCompletedFind } from '../../src/services/findMutations';
import { loadFindsMapState, saveFindsMapState } from '../../src/services/findsMapState';
import { permissionAction } from '../../src/services/permissionAction';

afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllGlobals(); db.close(); await Dexie.delete(db.name); });
it('restores map state within its project and tolerates corrupt or unavailable storage', () => {
  const data = new Map<string, string>();
  vi.stubGlobal('sessionStorage', { getItem: (key: string) => data.get(key), setItem: (key: string, value: string) => data.set(key, value) });
  const viewport = { center: [-1, 52] as [number, number], zoom: 14, satellite: true };
  saveFindsMapState('north', viewport);
  expect(loadFindsMapState('north')).toEqual(viewport);
  expect(loadFindsMapState('south')).toBeNull();
  data.set('fs_finds_map:north', '{broken');
  expect(loadFindsMapState('north')).toBeNull();
  vi.stubGlobal('sessionStorage', { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } });
  expect(() => saveFindsMapState('north', viewport)).not.toThrow();
  expect(loadFindsMapState('north')).toBeNull();
});
it('chooses a stable permission action without requiring optional setup', () => {
  expect(permissionAction({ id: 'p', activeSessionId: 's' })).toEqual({ label: 'Resume visit', href: '/session/s' });
  expect(permissionAction({ id: 'p' })).toEqual({ label: 'Start visit', href: '/session/new?permissionId=p' });
});
it('commits capture provenance and staged media atomically, retaining them on edit', async () => {
  await db.open(); await seedBackupFixture(db);
  const original = (await db.finds.get('find-1'))!;
  const photo = (await db.media.get('media-1'))!;
  const find = { ...original, id: 'capture', locationMethod: 'session_track' as const, locationFixAt: '2026-09-11T11:58:00.000Z', locationFrozenAt: '2026-09-11T12:00:00.000Z' };
  const replacement = { ...photo, id: 'staged', findId: find.id };
  const options = { existing: false, createdAt: find.createdAt, photos: { upsert: [replacement], removeIds: [photo.id] } };
  vi.spyOn(db.media, 'bulkPut').mockRejectedValueOnce(new DOMException('Full', 'QuotaExceededError'));
  await expect(saveCompletedFind(find, options)).rejects.toThrow('Full');
  expect(await db.finds.get(find.id)).toBeUndefined();
  expect(await db.media.get(photo.id)).toBeDefined();
  await saveCompletedFind(find, options);
  await saveCompletedFind({ ...find, objectType: 'Edited' }, { existing: true, createdAt: find.createdAt });
  expect(await db.finds.get(find.id)).toMatchObject({ locationMethod: 'session_track', locationFixAt: find.locationFixAt, locationFrozenAt: find.locationFrozenAt });
  expect(await db.media.get('staged')).toBeDefined();
  expect(await db.media.get(photo.id)).toBeDefined();
});
