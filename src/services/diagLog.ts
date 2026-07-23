// ─── On-device diagnostic logger ──────────────────────────────────────────────
// Ring buffer backed by Dexie. Hard cap: 2,000 entries. Oldest pruned on write.
// NEVER transmitted to any server. User-exportable from Settings > Backup.
//
// Usage:
//   import { diagLog } from './diagLog';
//   diagLog.error('export', 'Export failed', String(e));

import { v4 as uuid } from 'uuid';
import { db } from '../db';
import type { DiagLogLevel } from '../db';

const RING_BUFFER_CAP = 2000;

async function writeLog(
  level: DiagLogLevel,
  scope: string,
  message: string,
  detail?: string,
): Promise<void> {
  try {
    await db.transaction('rw', db.diagnosticLog, async () => {
      const count = await db.diagnosticLog.count();
      if (count >= RING_BUFFER_CAP) {
        const overflow = count - RING_BUFFER_CAP + 1;
        const oldest = await db.diagnosticLog.orderBy('ts').limit(overflow).toArray();
        await db.diagnosticLog.bulkDelete(oldest.map(e => e.id));
      }
      await db.diagnosticLog.add({
        id: uuid(),
        ts: new Date().toISOString(),
        level,
        scope,
        message,
        detail,
      });
    });
  } catch {
    // Logger must never throw into the path it is observing.
  }
}

export const diagLog = {
  info:  (scope: string, message: string, detail?: string) => writeLog('info',  scope, message, detail),
  warn:  (scope: string, message: string, detail?: string) => writeLog('warn',  scope, message, detail),
  error: (scope: string, message: string, detail?: string) => writeLog('error', scope, message, detail),
};

export function reportNonFatal(scope: string, message: string, error: unknown): void {
  void diagLog.warn(scope, message, String(error));
}

export async function exportDiagLog(): Promise<string> {
  const entries = await db.diagnosticLog.orderBy('ts').toArray();
  return JSON.stringify(entries, null, 2);
}
