import { describe, expect, it } from 'vitest';
import {
  isAcknowledgedStopForSession,
  isPendingCompanionCommand,
  type PendingCompanionCommand,
} from '../../src/services/companionControlState';

describe('Companion control state', () => {
  const stop: PendingCompanionCommand = {
    action: 'stop',
    sessionId: 'session-1',
    requestedAt: 123,
    finishAfterImport: true,
  };

  it('requires a session-scoped durable command', () => {
    expect(isPendingCompanionCommand(stop)).toBe(true);
    expect(isPendingCompanionCommand({ ...stop, sessionId: '' })).toBe(false);
    expect(isPendingCompanionCommand({ ...stop, finishAfterImport: 'yes' })).toBe(false);
  });

  it('authorises finish only for the matching confirmed stop-and-finish request', () => {
    expect(isAcknowledgedStopForSession(stop, 'session-1', true)).toBe(true);
    expect(isAcknowledgedStopForSession(stop, 'session-2', true)).toBe(false);
    expect(isAcknowledgedStopForSession({ ...stop, finishAfterImport: false }, 'session-1', true)).toBe(false);
    expect(isAcknowledgedStopForSession({ ...stop, finishAfterImport: false }, 'session-1', false)).toBe(true);
  });
});
