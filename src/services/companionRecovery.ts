import { db } from '../db';
import { isPendingCompanionCommand } from './companionControlState';

/** Explicit recovery after the user confirms Companion has no active recording. */
export async function resetCompanionSessionStatus(sessionId: string): Promise<void> {
  await db.transaction('rw', db.settings, async () => {
    const active = await db.settings.get('fs_companion_active_session');
    const pending = await db.settings.get('fs_companion_pending_command');
    if (active?.value !== sessionId
      || (isPendingCompanionCommand(pending?.value) && pending.value.sessionId !== sessionId)) {
      throw new Error('Companion status has changed. Reopen the visit before recovering it.');
    }
    await db.settings.bulkPut([
      { key: 'fs_companion_active_session', value: '' },
      { key: 'fs_companion_pending_command', value: null },
    ]);
  });
}
