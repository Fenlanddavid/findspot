import Dexie, { type Table } from 'dexie';
import { Unzip, UnzipInflate, strFromU8 } from 'fflate';
import type { Media } from '../../db';
import type { ValidatedBackupMedia } from './schema';
import type { RawBackupData } from './schema';
import type { BackupImportOptions } from './importTypes';
import {
  BackupLimitError,
  formatMiB,
  isQuotaExceeded,
  MAX_BACKUP_MANIFEST_BYTES,
  MAX_BACKUP_ZIP_ENTRIES,
  parseJsonBackup,
} from './importInput';
import { MAX_BACKUP_MEDIA_ENTRY_BYTES } from './mediaArchive';
import { reportNonFatal } from '../diagLog';

type StagedZipEntry = {
  name: string;
  size: number;
  chunkCount: number;
};

type StagedZipChunk = {
  id: string;
  name: string;
  index: number;
  blob: Blob;
};

export class RestoreStageDB extends Dexie {
  entries!: Table<StagedZipEntry, string>;
  chunks!: Table<StagedZipChunk, string>;

  constructor(name: string) {
    super(name);
    this.version(1).stores({
      entries: '&name',
      chunks: '&id,name,[name+index]',
    });
  }
}

export const RESTORE_STAGE_PREFIX = 'findspot_restore_staging_';

export async function cleanupStaleRestoreStages(): Promise<void> {
  const staleBefore = Date.now() - 24 * 60 * 60 * 1000;
  try {
    const names = await Dexie.getDatabaseNames();
    await Promise.all(names
      .filter(name => name.startsWith(RESTORE_STAGE_PREFIX))
      .filter(name => {
        const timestamp = Number(name.slice(RESTORE_STAGE_PREFIX.length).split('_')[0]);
        return !Number.isFinite(timestamp) || timestamp < staleBefore;
      })
      .map(name => Dexie.delete(name)));
  } catch (error) {
    reportNonFatal('backup', 'Stale restore staging cleanup failed', error);
    // Database enumeration is not available in every browser. The active stage
    // still has an explicit finally cleanup in importData.
  }
}

function emitReadingProgress(
  options: BackupImportOptions | undefined,
  processedBytes: number,
  totalBytes: number,
  percent: number,
): void {
  options?.onProgress?.({ phase: 'reading', processedBytes, totalBytes, percent });
}

/** Stream a zip and optionally persist media chunks outside the live database. */
export async function streamZipBackup(
  blob: Blob,
  options: BackupImportOptions | undefined,
  config: { stage?: RestoreStageDB; stopAfterManifest?: boolean } = {},
): Promise<{ data: RawBackupData; entryNames: Set<string> }> {
  const entryNames = new Set<string>();
  let data: RawBackupData | undefined;
  let streamError: Error | null = null;
  let pendingWrite: Promise<unknown> = Promise.resolve();
  let processedBytes = 0;
  let lastProgressPercent = -1;

  const unzip = new Unzip(file => {
    if (entryNames.has(file.name)) {
      streamError = new BackupLimitError(`Invalid backup zip: duplicate entry ${file.name}.`);
    }
    entryNames.add(file.name);
    if (entryNames.size > MAX_BACKUP_ZIP_ENTRIES) {
      streamError = new BackupLimitError(`Invalid backup zip: contains more than ${MAX_BACKUP_ZIP_ENTRIES.toLocaleString()} entries.`);
    }

    const isManifest = file.name === 'manifest.json';
    const isMedia = file.name.startsWith('media/');
    if (!isManifest && !isMedia) {
      streamError = new BackupLimitError(`Invalid backup zip: unexpected entry ${file.name}.`);
    }

    const manifestChunks: ArrayBuffer[] = [];
    let stagedChunkParts: ArrayBuffer[] = [];
    let stagedChunkBytes = 0;
    let stagedChunkIndex = 0;
    let expandedBytes = 0;

    const flushStagedChunk = () => {
      if (!config.stage || !stagedChunkBytes) return;
      const parts = stagedChunkParts;
      const index = stagedChunkIndex++;
      stagedChunkParts = [];
      stagedChunkBytes = 0;
      const chunkBlob = new Blob(parts);
      pendingWrite = pendingWrite.then(() => config.stage!.chunks.put({
        id: `${file.name}\u0000${index}`,
        name: file.name,
        index,
        blob: chunkBlob,
      }));
    };

    file.ondata = (error, chunk, final) => {
      if (streamError) return;
      if (error) {
        streamError = error instanceof Error ? error : new Error(String(error));
        return;
      }

      expandedBytes += chunk.byteLength;
      const entryLimit = isManifest
        ? MAX_BACKUP_MANIFEST_BYTES
        : config.stopAfterManifest && !config.stage
          ? 64 * 1024 * 1024
          : MAX_BACKUP_MEDIA_ENTRY_BYTES;
      if (expandedBytes > entryLimit) {
        streamError = new BackupLimitError(isManifest
          ? `Invalid backup zip: manifest.json exceeds ${formatMiB(MAX_BACKUP_MANIFEST_BYTES)}.`
          : `Invalid backup zip: media entry ${file.name} exceeds ${formatMiB(MAX_BACKUP_MEDIA_ENTRY_BYTES)}.`);
        manifestChunks.length = 0;
        stagedChunkParts.length = 0;
        return;
      }
      if (chunk.byteLength) {
        const ownedChunk = new Uint8Array(chunk).slice().buffer as ArrayBuffer;
        if (isManifest) {
          manifestChunks.push(ownedChunk);
        } else if (isMedia && config.stage) {
          stagedChunkParts.push(ownedChunk);
          stagedChunkBytes += ownedChunk.byteLength;
          if (stagedChunkBytes >= 4 * 1024 * 1024) flushStagedChunk();
        }
      }

      if (!final) return;
      if (isManifest) {
        const manifestBytes = new Uint8Array(expandedBytes);
        let offset = 0;
        for (const part of manifestChunks) {
          manifestBytes.set(new Uint8Array(part), offset);
          offset += part.byteLength;
        }
        data = parseJsonBackup(strFromU8(manifestBytes), true);
      } else if (isMedia && config.stage) {
        flushStagedChunk();
        const chunkCount = stagedChunkIndex;
        pendingWrite = pendingWrite.then(() => config.stage!.entries.put({
          name: file.name,
          size: expandedBytes,
          chunkCount,
        }));
      }
    };
    file.start();
  });
  unzip.register(UnzipInflate);

  const reader = blob.stream().getReader();
  try {
    while (true) {
      await pendingWrite;
      if (streamError) throw streamError;

      const { value, done } = await reader.read();
      if (value?.byteLength) {
        processedBytes += value.byteLength;
        unzip.push(value, false);
      }
      if (done) unzip.push(new Uint8Array(), true);
      await pendingWrite;
      if (streamError) throw streamError;

      const percent = blob.size
        ? Math.min(90, Math.floor((processedBytes / blob.size) * 90))
        : 90;
      if (percent !== lastProgressPercent) {
        lastProgressPercent = percent;
        emitReadingProgress(options, processedBytes, blob.size, percent);
      }
      if (config.stopAfterManifest && data !== undefined) {
        await reader.cancel();
        break;
      }
      if (done) break;
    }
  } catch (error) {
    await reader.cancel().catch(cancelError => {
      reportNonFatal('backup', 'Backup stream cancellation failed', cancelError);
    });
    if (isQuotaExceeded(error)) {
      throw new Error('Not enough free device storage to stage this backup. Existing FindSpot data has not been changed.');
    }
    if (error instanceof BackupLimitError) throw error;
    throw new Error(`Invalid backup file: could not read zip archive. ${error instanceof Error ? error.message : ''}`.trim());
  }

  if (data === undefined) throw new Error('Invalid backup zip: missing manifest.json.');
  return { data, entryNames };
}

export async function materializeStagedMedia(
  stage: RestoreStageDB,
  items: ValidatedBackupMedia[],
): Promise<Media[]> {
  const mediaItems: Media[] = [];
  for (const item of items) {
    if (item.format !== 'zip') throw new Error('Invalid backup zip: legacy media manifest entry');
    const staged = await stage.entries.get(item._zipEntry);
    if (!staged) throw new Error(`Invalid backup zip: missing media entry ${item._zipEntry}`);
    const chunks = await stage.chunks.where('name').equals(item._zipEntry).sortBy('index');
    if (
      chunks.length !== staged.chunkCount
      || chunks.reduce((sum, chunk) => sum + chunk.blob.size, 0) !== staged.size
    ) {
      throw new Error(`Invalid backup zip: incomplete media entry ${item._zipEntry}`);
    }
    const { _zipEntry, format: _format, ...rest } = item;
    const stagedBlob = new Blob(chunks.map(chunk => chunk.blob));
    mediaItems.push({
      ...rest,
      blob: stagedBlob.slice(0, stagedBlob.size, rest.mime || 'application/octet-stream'),
    } as Media);
  }
  return mediaItems;
}
