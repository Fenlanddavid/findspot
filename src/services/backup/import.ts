import Dexie from 'dexie';
import { v4 as uuid } from 'uuid';
import type { Media } from '../../db';
import { applyValidatedBackup } from './atomicRestore';
import {
  BackupLimitError,
  decodeBackupInput,
  isQuotaExceeded,
  isZipBlob,
  MAX_BACKUP_MANIFEST_BYTES,
  parseJsonBackup,
} from './importInput';
import type { BackupImportOptions, BackupImportProgress } from './importTypes';
import { base64ToBlob } from './mediaEncoding';
import {
  cleanupStaleRestoreStages,
  materializeStagedMedia,
  RESTORE_STAGE_PREFIX,
  RestoreStageDB,
  streamZipBackup,
} from './restoreStage';
import type { RawBackupData } from './schema';
import { validateBackupData } from './validation';

export type { BackupImportOptions, BackupImportProgress } from './importTypes';
export {
  MAX_BACKUP_IN_MEMORY_BYTES,
  MAX_BACKUP_MANIFEST_BYTES,
  MAX_BACKUP_UNCOMPRESSED_BYTES,
  MAX_BACKUP_ZIP_ENTRIES,
} from './importInput';

function emitImportProgress(
  options: BackupImportOptions | undefined,
  phase: BackupImportProgress['phase'],
  processedBytes: number,
  totalBytes: number,
  percent: number,
): void {
  options?.onProgress?.({ phase, processedBytes, totalBytes, percent });
}

/** Safely decode only the manifest used by the restore preview UI. */
export async function readBackupManifest(
  input: string | ArrayBuffer | Blob,
): Promise<Record<string, unknown>> {
  let data: RawBackupData;
  if (input instanceof Blob) {
    if (await isZipBlob(input)) {
      data = (await streamZipBackup(input, undefined, { stopAfterManifest: true })).data;
    } else {
      if (input.size > MAX_BACKUP_MANIFEST_BYTES) {
        throw new BackupLimitError(`Invalid backup file: JSON exceeds ${Math.round(MAX_BACKUP_MANIFEST_BYTES / (1024 * 1024))} MB.`);
      }
      data = parseJsonBackup(await input.text(), false);
    }
  } else {
    data = decodeBackupInput(input).data;
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('Invalid backup file: expected an object.');
  }
  return data as Record<string, unknown>;
}

/**
 * Validate and atomically replace live data from legacy JSON or a full zip.
 * Blob zips stage media outside the live database before the transaction opens.
 */
export async function importData(
  input: string | ArrayBuffer | Blob,
  options: BackupImportOptions = {},
): Promise<void> {
  let data: RawBackupData;
  let zipBytes: Uint8Array | null = null;
  let entryNames: Set<string> | null = null;
  let mediaItems: Media[] | null = null;
  let stage: RestoreStageDB | null = null;

  try {
    if (input instanceof Blob) {
      if (await isZipBlob(input)) {
        await cleanupStaleRestoreStages();
        stage = new RestoreStageDB(`${RESTORE_STAGE_PREFIX}${Date.now()}_${uuid()}`);
        const streamed = await streamZipBackup(input, options, { stage });
        data = streamed.data;
        entryNames = streamed.entryNames;
      } else {
        if (input.size > MAX_BACKUP_MANIFEST_BYTES) {
          throw new BackupLimitError(`Invalid backup file: JSON exceeds ${Math.round(MAX_BACKUP_MANIFEST_BYTES / (1024 * 1024))} MB.`);
        }
        emitImportProgress(options, 'reading', input.size, input.size, 90);
        data = parseJsonBackup(await input.text(), false);
      }
    } else {
      const decoded = decodeBackupInput(input);
      data = decoded.data;
      zipBytes = decoded.zipBytes;
      entryNames = decoded.entryNames;
      const inputBytes = typeof input === 'string'
        ? new TextEncoder().encode(input).byteLength
        : input.byteLength;
      emitImportProgress(options, 'reading', inputBytes, inputBytes, 90);
    }

    const totalBytes = input instanceof Blob ? input.size : 0;
    emitImportProgress(options, 'validating', totalBytes, totalBytes, 92);
    const zipMode = !!zipBytes || !!stage;
    const backup = validateBackupData(data, { zipMode });

    if (zipMode && entryNames) {
      const referencedEntries = new Set<string>();
      for (const media of backup.media) {
        if (media.format !== 'zip') throw new Error('Invalid backup zip: legacy media manifest entry');
        if (!entryNames.has(media._zipEntry)) {
          throw new Error(`Invalid backup zip: missing media entry ${media._zipEntry}`);
        }
        if (referencedEntries.has(media._zipEntry)) {
          throw new Error(`Invalid backup zip: media entry ${media._zipEntry} is referenced more than once.`);
        }
        referencedEntries.add(media._zipEntry);
      }
      for (const entryName of entryNames) {
        if (entryName.startsWith('media/') && !referencedEntries.has(entryName)) {
          throw new Error(`Invalid backup zip: unreferenced media entry ${entryName}.`);
        }
      }
    }

    if (stage) {
      mediaItems = await materializeStagedMedia(stage, backup.media);
    } else if (!zipBytes) {
      mediaItems = await Promise.all(backup.media.map(async media => {
        if (media.format !== 'legacy') {
          throw new Error('Invalid JSON backup: zip media manifest entry');
        }
        const { format: _format, blob, ...rest } = media;
        return { ...rest, blob: await base64ToBlob(blob) } as Media;
      }));
    }

    emitImportProgress(options, 'restoring', totalBytes, totalBytes, 95);
    try {
      await applyValidatedBackup(backup, zipBytes, mediaItems ?? []);
    } catch (error) {
      if (isQuotaExceeded(error)) {
        throw new Error('Not enough free device storage to complete this restore. Existing FindSpot data has not been changed.');
      }
      throw error;
    }
    emitImportProgress(options, 'restoring', totalBytes, totalBytes, 100);
  } finally {
    if (stage) {
      stage.close();
      await Dexie.delete(stage.name).catch(() => {});
    }
  }
}
