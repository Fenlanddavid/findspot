export type PendingCompanionCommand =
  | {
      action: 'start';
      sessionId: string;
      requestedAt: number;
    }
  | {
      action: 'stop';
      sessionId: string;
      requestedAt: number;
      finishAfterImport: boolean;
    };

export type CompanionControlResult =
  | 'started'
  | 'start_cancelled'
  | 'start_failed'
  | 'stop_failed';

export function isPendingCompanionCommand(value: unknown): value is PendingCompanionCommand {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const command = value as Record<string, unknown>;
  if (typeof command.sessionId !== 'string' || command.sessionId.length === 0) return false;
  if (typeof command.requestedAt !== 'number' || !Number.isFinite(command.requestedAt)) return false;
  if (command.action === 'start') return !('finishAfterImport' in command);
  return command.action === 'stop' && typeof command.finishAfterImport === 'boolean';
}

export function isAcknowledgedStopForSession(
  command: PendingCompanionCommand | null,
  sessionId: string,
  finishRequested: boolean,
): boolean {
  return command?.action === 'stop'
    && command.sessionId === sessionId
    && (!finishRequested || command.finishAfterImport);
}
