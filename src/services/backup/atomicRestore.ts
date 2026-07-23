import { db, type FindSpotDB, type Media } from '../../db';
import { RETIRED_QUESTION_RULE_IDS } from '../persistenceValidation/backup';
import { extractZipEntry } from './importInput';
import {
  LAST_RESTORE_REPORT_SETTING_KEY,
  type BackupRecoveryReport,
} from './recoveryReport';
import type { ValidatedBackupData } from './schema';
import { BACKED_UP_TABLE_NAMES } from './tableRegistry';

export const ATOMIC_RESTORE_TABLE_NAMES = BACKED_UP_TABLE_NAMES;

/** Replace every backed-up table inside one IndexedDB transaction. */
export async function applyValidatedBackup(
  backup: ValidatedBackupData,
  zipBytes: Uint8Array | null,
  mediaItems: Media[],
  report: BackupRecoveryReport,
  database: FindSpotDB = db,
): Promise<void> {
  const transactionTables = ATOMIC_RESTORE_TABLE_NAMES.map(name => database[name]);
  await database.transaction('rw', transactionTables, async () => {
    // Clear all backed-up data first so placeholder records cannot survive
    // beside the restored graph. Any later failure rolls these clears back.
    for (const tableName of ATOMIC_RESTORE_TABLE_NAMES) {
      await database[tableName].clear();
    }

    await database.projects.bulkPut(backup.projects);
    if (backup.permissions.length) await database.permissions.bulkPut(backup.permissions);
    if (backup.fields.length) await database.fields.bulkPut(backup.fields);
    if (backup.sessions.length) await database.sessions.bulkPut(backup.sessions);
    if (backup.finds.length) await database.finds.bulkPut(backup.finds);
    if (backup.significantFinds.length) await database.significantFinds.bulkPut(backup.significantFinds);
    if (backup.tracks.length) await database.tracks.bulkPut(backup.tracks);
    if (backup.settings.length) await database.settings.bulkPut(backup.settings);
    if (backup.importedPackages.length) await database.importedPackages.bulkPut(backup.importedPackages);

    if (zipBytes) {
      // Keep in-memory archive compatibility without retaining a second
      // uncompressed copy of the complete media library.
      for (const item of backup.media) {
        if (item.format !== 'zip') throw new Error('Invalid backup zip: legacy media manifest entry');
        const bytes = extractZipEntry(zipBytes, item._zipEntry);
        if (!bytes) throw new Error(`Invalid backup zip: missing media entry ${item._zipEntry}`);
        const { _zipEntry, format: _format, ...rest } = item;
        await database.media.put({
          ...rest,
          blob: new Blob([new Uint8Array(bytes)], { type: rest.mime || 'application/octet-stream' }),
        } as Media);
      }
    } else {
      // One request per Blob avoids serializing a year of photos in one payload.
      for (const media of mediaItems) await database.media.put(media);
    }

    if (backup.savedPoints.length) await database.savedPoints.bulkPut(backup.savedPoints);
    if (backup.undugSignals.length) await database.undugSignals.bulkPut(backup.undugSignals);
    if (backup.findHotspotSignals.length) await database.findHotspotSignals.bulkPut(backup.findHotspotSignals);
    if (backup.hotspotPredictions.length) await database.hotspotPredictions.bulkPut(backup.hotspotPredictions);
    if (backup.hotspotPredictionAggregates.length) {
      await database.hotspotPredictionAggregates.bulkPut(backup.hotspotPredictionAggregates);
    }
    const activeQuestions = backup.outstandingQuestions.filter(
      question => !RETIRED_QUESTION_RULE_IDS.has(question.ruleId),
    );
    if (activeQuestions.length) await database.outstandingQuestions.bulkPut(activeQuestions);
    if (backup.questionNotes.length) await database.questionNotes.bulkPut(backup.questionNotes);
    await database.settings.put({ key: LAST_RESTORE_REPORT_SETTING_KEY, value: report });
  });
}
