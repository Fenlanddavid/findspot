import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../src/db';
import { seedBackupFixture } from '../fixtures/backupFixtureFactories';
import { saveFindEdits } from '../../src/services/findMutations';
import { captureLocationStatus } from '../../src/utils/captureLocationStatus';

afterEach(async () => { vi.restoreAllMocks(); db.close(); await Dexie.delete(db.name); });

describe('record editing commits photos and text together', () => {
  it('rolls back text and removed photos if adding the replacement fails, then permits retry', async () => {
    await db.open(); await seedBackupFixture(db);
    const find = (await db.finds.get('find-1'))!;
    const photo = (await db.media.get('media-1'))!;
    const replacement = { ...photo, id: 'replacement', filename: 'replacement.jpg' };
    const write = vi.spyOn(db.media, 'bulkPut').mockRejectedValueOnce(new DOMException('Full', 'QuotaExceededError'));
    await expect(saveFindEdits({ ...find, objectType: 'Buckle' }, new Date().toISOString(), {
      upsert: [replacement], removeIds: [photo.id],
    })).rejects.toThrow('Full');
    expect((await db.finds.get(find.id))?.objectType).toBe('Coin');
    expect(await db.media.get(photo.id)).toBeDefined();
    expect(await db.media.get(replacement.id)).toBeUndefined();
    write.mockRestore();
    await saveFindEdits({ ...find, objectType: 'Buckle' }, new Date().toISOString(), { upsert: [replacement], removeIds: [photo.id] });
    expect((await db.finds.get(find.id))?.objectType).toBe('Buckle');
    expect(await db.media.get(photo.id)).toBeUndefined();
    expect((await db.media.get(replacement.id))?.filename).toBe('replacement.jpg');
  });

  it('reports a deleted record instead of pretending to save it', async () => {
    await db.open(); await seedBackupFixture(db);
    const find = (await db.finds.get('find-1'))!;
    await db.finds.delete(find.id);
    await expect(saveFindEdits(find, new Date().toISOString())).rejects.toThrow('no longer exists');
  });
});

describe('capture location feedback', () => {
  const now = Date.parse('2026-09-11T12:00:00Z');
  it.each([
    [null, 'No position captured', true],
    [{ gpsAccuracyM: 5, fixTimestamp: now }, 'Position captured', false],
    [{ gpsAccuracyM: 90, fixTimestamp: now }, 'Position captured · low accuracy', true],
    [{ gpsAccuracyM: 5, fixTimestamp: now - 120_000 }, 'Earlier position captured', true],
    [{ gpsAccuracyM: 90, fixTimestamp: now - 120_000 }, 'Earlier position captured · low accuracy', true],
    [{ gpsAccuracyM: 5 }, 'Position captured · age unknown', true],
  ] as const)('describes the actual fix %#', (location, label, warning) => {
    expect(captureLocationStatus(location, now)).toEqual({ label, warning });
  });
});

it('keeps capture-time quality stable while completion takes several minutes', () => {
  const capturedAt = Date.parse('2026-09-11T12:00:00Z');
  vi.useFakeTimers();
  try {
    vi.setSystemTime(capturedAt + 300_000);
    expect(captureLocationStatus({ gpsAccuracyM: 8, capturedAt, fixTimestamp: capturedAt - 2_000, captureMethod: 'live_gps' })).toEqual({ label: 'Position captured', warning: false });
    expect(captureLocationStatus({ gpsAccuracyM: null, capturedAt, captureMethod: 'map_selected' })).toEqual({ label: 'Position selected on map · accuracy unknown', warning: true });
  } finally { vi.useRealTimers(); }
});
