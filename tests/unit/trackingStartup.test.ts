import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, type Track } from '../../src/db';
import {
  ACTIVE_BROWSER_TRACK_SETTING,
  closeStaleActiveTracks,
} from '../../src/services/tracking';

function track(id: string, isActive: boolean): Track {
  return {
    id,
    projectId: 'project-1',
    sessionId: null,
    name: id,
    points: Array.from({ length: 1_000 }, (_, index) => ({
      lat: 52 + index / 1_000_000,
      lon: index / 1_000_000,
      timestamp: index,
    })),
    isActive,
    color: '#000000',
    createdAt: '2026-08-04T08:00:00.000Z',
    updatedAt: '2026-08-04T08:00:00.000Z',
  };
}

beforeEach(async () => {
  db.close();
  await Dexie.delete('findspot_uk');
  await db.open();
});

describe('startup track cleanup', () => {
  it('does not scan unrelated dense tracks when no browser recording is active', async () => {
    await db.tracks.bulkPut([track('companion-1', false), track('companion-2', false)]);
    await expect(closeStaleActiveTracks()).resolves.toBe(0);
    expect(await db.tracks.count()).toBe(2);
  });

  it('closes only the track named by the active recording pointer', async () => {
    await db.tracks.bulkPut([track('active', true), track('companion', false)]);
    await db.settings.put({ key: ACTIVE_BROWSER_TRACK_SETTING, value: 'active' });

    await expect(closeStaleActiveTracks()).resolves.toBe(1);
    expect((await db.tracks.get('active'))?.isActive).toBe(false);
    expect(await db.settings.get(ACTIVE_BROWSER_TRACK_SETTING)).toBeUndefined();
    expect((await db.tracks.get('companion'))?.isActive).toBe(false);
  });
});
