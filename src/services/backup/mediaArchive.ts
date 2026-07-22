import { Zip, ZipDeflate, ZipPassThrough, strToU8 } from 'fflate';
import { db, type Media } from '../../db';
import type { BackupExportManifest } from './schema';

// Stored photo formats are already compressed, so raw Blob size is a useful
// approximation of the pass-through archive size shown by the Settings UI.
export const MEDIA_EXPORT_WARN_BYTES = 150 * 1024 * 1024;
export const MAX_BACKUP_MEDIA_ENTRY_BYTES = 1024 * 1024 * 1024;

export type BackupExportProgress = {
  processedMedia: number;
  totalMedia: number;
  percent: number;
};

export type MediaArchiveOptions = {
  onProgress?: (progress: BackupExportProgress) => void;
};

const MEDIA_MIME_EXTENSIONS: Readonly<Record<string, string>> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'image/gif': 'gif',
  'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/rtf': 'rtf',
  'text/rtf': 'rtf',
  'text/plain': 'txt',
};

export async function estimateMediaSizeBytes(): Promise<{
  count: number;
  bytes: number;
  damaged: number;
}> {
  let count = 0;
  let bytes = 0;
  let damaged = 0;

  // Walk records without retaining a year of Blob handles in an array.
  await db.media.each(media => {
    count += 1;
    const persistedBlob: unknown = (media as { blob?: unknown }).blob;
    if (persistedBlob instanceof Blob) bytes += persistedBlob.size;
    else damaged += 1;
  });

  return { count, bytes, damaged };
}

/** File extension for a media record (falls back to bin for unknown MIME). */
export function mediaExt(mime: string | undefined): string {
  const normalised = mime?.split(';', 1)[0].trim().toLowerCase();
  if (!normalised) return 'bin';
  return MEDIA_MIME_EXTENSIONS[normalised] ?? 'bin';
}

function requireMediaBlob(media: Media): Blob {
  const persistedBlob: unknown = (media as { blob?: unknown }).blob;
  if (!(persistedBlob instanceof Blob)) {
    throw new Error(`${media.filename || `Media ${media.id}`} is damaged and cannot be included in a full backup.`);
  }
  return persistedBlob;
}

function mediaEntryName(media: Media): string {
  return `media/${encodeURIComponent(String(media.id))}.${mediaExt(media.mime)}`;
}

/**
 * Build a full backup without retaining a second in-memory copy of every media
 * Blob. The manifest is first so future restore previews can stop before the
 * binary entries in very large archives.
 */
export async function createMediaArchive(
  manifest: BackupExportManifest,
  options: MediaArchiveOptions = {},
): Promise<Blob> {
  const outputParts: Blob[] = [];
  let resolveArchive!: (blob: Blob) => void;
  let rejectArchive!: (reason: unknown) => void;
  let settled = false;
  const archiveReady = new Promise<Blob>((resolve, reject) => {
    resolveArchive = resolve;
    rejectArchive = reject;
  });
  const zip = new Zip((error, chunk, final) => {
    if (settled) return;
    if (error) {
      settled = true;
      rejectArchive(error);
      return;
    }
    outputParts.push(new Blob([new Uint8Array(chunk)]));
    if (final) {
      settled = true;
      resolveArchive(new Blob(outputParts, { type: 'application/zip' }));
    }
  });

  try {
    // Collection.each() does not await async callbacks, so fetch keys and then
    // load one media row at a time.
    const mediaIds = await db.media.toCollection().primaryKeys();

    for (const id of mediaIds) {
      const media = await db.media.get(id);
      if (!media) throw new Error(`Media ${String(id)} changed while the backup was being prepared. Please try again.`);
      const mediaBlob = requireMediaBlob(media);
      if (mediaBlob.size > MAX_BACKUP_MEDIA_ENTRY_BYTES) {
        throw new Error(`${media.filename || 'A media file'} exceeds the supported 1 GB per-file backup limit.`);
      }
      const { blob: persistedBlob, ...metadata } = media;
      void persistedBlob;
      manifest.media.push({ ...metadata, _zipEntry: mediaEntryName(media) });
    }

    const manifestEntry = new ZipDeflate('manifest.json', { level: 1 });
    zip.add(manifestEntry);
    manifestEntry.push(strToU8(JSON.stringify(manifest)), true);

    options.onProgress?.({
      processedMedia: 0,
      totalMedia: mediaIds.length,
      percent: mediaIds.length ? 0 : 100,
    });

    let processedMedia = 0;
    for (const id of mediaIds) {
      const media = await db.media.get(id);
      if (!media) throw new Error(`Media ${String(id)} changed while the backup was being prepared. Please try again.`);
      const mediaBlob = requireMediaBlob(media);
      const entry = new ZipPassThrough(mediaEntryName(media));
      zip.add(entry);
      const reader = mediaBlob.stream().getReader();

      while (true) {
        const { value, done } = await reader.read();
        if (value?.byteLength) entry.push(value, false);
        if (done) {
          entry.push(new Uint8Array(), true);
          break;
        }
      }

      processedMedia += 1;
      options.onProgress?.({
        processedMedia,
        totalMedia: mediaIds.length,
        percent: mediaIds.length ? Math.round((processedMedia / mediaIds.length) * 100) : 100,
      });
    }
    zip.end();
  } catch (error) {
    zip.terminate();
    if (!settled) {
      settled = true;
      rejectArchive(error);
    }
  }

  return archiveReady;
}
