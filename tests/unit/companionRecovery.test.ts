import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { db } from '../../src/db';
import { resetCompanionSessionStatus } from '../../src/services/companionRecovery';

beforeEach(async () => {
  db.close();
  await Dexie.delete('findspot_uk');
  await db.open();
  await db.settings.bulkPut([
    { key: 'fs_companion_active_session', value: 'visit-a' },
    { key: 'fs_companion_pending_command', value: { action: 'stop', sessionId: 'visit-a', requestedAt: 123, finishAfterImport: true } },
    { key: 'unrelated', value: 'keep me' },
  ]);
});
afterEach(() => db.close());

it('clears both recording markers together and keeps unrelated settings', async () => {
  await resetCompanionSessionStatus('visit-a');
  expect((await db.settings.get('fs_companion_active_session'))?.value).toBe('');
  expect((await db.settings.get('fs_companion_pending_command'))?.value).toBeNull();
  expect((await db.settings.get('unrelated'))?.value).toBe('keep me');
});

it('refuses to clear the recording of a different visit', async () => {
  await expect(resetCompanionSessionStatus('visit-b')).rejects.toThrow('status has changed');
  expect((await db.settings.get('fs_companion_active_session'))?.value).toBe('visit-a');
  expect((await db.settings.get('fs_companion_pending_command'))?.value).toMatchObject({ sessionId: 'visit-a' });
});

it('keeps both markers if another visit has acquired a pending command', async () => {
  await db.settings.put({ key: 'fs_companion_pending_command', value: { action: 'start', sessionId: 'visit-b', requestedAt: 456 } });
  await expect(resetCompanionSessionStatus('visit-a')).rejects.toThrow('status has changed');
  expect((await db.settings.get('fs_companion_active_session'))?.value).toBe('visit-a');
  expect((await db.settings.get('fs_companion_pending_command'))?.value).toMatchObject({ sessionId: 'visit-b' });
});
