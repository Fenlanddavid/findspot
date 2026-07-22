import { strFromU8, unzipSync } from 'fflate';
import { MAX_BACKUP_MEDIA_ENTRY_BYTES } from './mediaArchive';
import { MAX_BACKUP_RECORDS, type RawBackupData } from './schema';

// File/Blob is the preferred path for large archives. These limits retain the
// existing protections for manifest parsing and in-memory compatibility calls.
export const MAX_BACKUP_IN_MEMORY_BYTES = 512 * 1024 * 1024;
export const MAX_BACKUP_MANIFEST_BYTES = 50 * 1024 * 1024;
export const MAX_BACKUP_UNCOMPRESSED_BYTES = 768 * 1024 * 1024;
export const MAX_BACKUP_ZIP_ENTRIES = MAX_BACKUP_RECORDS + 1;

export class BackupLimitError extends Error {}

export type DecodedBackup = {
  data: RawBackupData;
  zipBytes: Uint8Array | null;
  entryNames: Set<string> | null;
};

export function formatMiB(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

export function isQuotaExceeded(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'name' in error && error.name === 'QuotaExceededError';
}

function isZipBuffer(buffer: ArrayBuffer): boolean {
  if (buffer.byteLength < 2) return false;
  const header = new Uint8Array(buffer, 0, Math.min(4, buffer.byteLength));
  return header[0] === 0x50 && header[1] === 0x4b;
}

export async function isZipBlob(blob: Blob): Promise<boolean> {
  if (blob.size < 2) return false;
  const header = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
  return header[0] === 0x50 && header[1] === 0x4b;
}

export function parseJsonBackup(text: string, zipMode: boolean): RawBackupData {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(zipMode
      ? 'Invalid backup zip: could not parse manifest.json.'
      : 'Invalid backup file: could not parse JSON.');
  }
}

export function extractZipEntry(
  zipBytes: Uint8Array,
  entryName: string,
): Uint8Array | undefined {
  const entries = unzipSync(zipBytes, { filter: file => file.name === entryName });
  return entries[entryName];
}

function inspectZipEntries(zipBytes: Uint8Array): Set<string> {
  const names = new Set<string>();
  let totalUncompressedBytes = 0;

  try {
    unzipSync(zipBytes, {
      filter: file => {
        if (names.has(file.name)) {
          throw new BackupLimitError(`Invalid backup zip: duplicate entry ${file.name}.`);
        }
        names.add(file.name);
        if (names.size > MAX_BACKUP_ZIP_ENTRIES) {
          throw new BackupLimitError(`Invalid backup zip: contains more than ${MAX_BACKUP_ZIP_ENTRIES.toLocaleString()} entries.`);
        }
        if (!Number.isSafeInteger(file.originalSize) || file.originalSize < 0) {
          throw new BackupLimitError('Invalid backup zip: an entry has an invalid size.');
        }
        totalUncompressedBytes += file.originalSize;
        if (totalUncompressedBytes > MAX_BACKUP_UNCOMPRESSED_BYTES) {
          throw new BackupLimitError(`Invalid backup zip: expanded content exceeds ${formatMiB(MAX_BACKUP_UNCOMPRESSED_BYTES)}.`);
        }
        if (file.name === 'manifest.json' && file.originalSize > MAX_BACKUP_MANIFEST_BYTES) {
          throw new BackupLimitError(`Invalid backup zip: manifest.json exceeds ${formatMiB(MAX_BACKUP_MANIFEST_BYTES)}.`);
        }
        if (file.name.startsWith('media/') && file.originalSize > MAX_BACKUP_MEDIA_ENTRY_BYTES) {
          throw new BackupLimitError(`Invalid backup zip: media entry ${file.name} exceeds ${formatMiB(MAX_BACKUP_MEDIA_ENTRY_BYTES)}.`);
        }
        return false;
      },
    });
  } catch (error) {
    if (error instanceof BackupLimitError) throw error;
    throw new Error('Invalid backup file: could not read zip archive.');
  }

  return names;
}

export function decodeBackupInput(input: string | ArrayBuffer): DecodedBackup {
  if (typeof input === 'string') {
    if (new TextEncoder().encode(input).byteLength > MAX_BACKUP_MANIFEST_BYTES) {
      throw new BackupLimitError(`Invalid backup file: JSON exceeds ${formatMiB(MAX_BACKUP_MANIFEST_BYTES)}.`);
    }
    return { data: parseJsonBackup(input, false), zipBytes: null, entryNames: null };
  }

  if (!(input instanceof ArrayBuffer)) {
    throw new Error('Invalid backup file: unexpected input type.');
  }
  if (input.byteLength > MAX_BACKUP_IN_MEMORY_BYTES) {
    throw new BackupLimitError(`Invalid in-memory backup: exceeds ${formatMiB(MAX_BACKUP_IN_MEMORY_BYTES)}. Pass the File directly for streaming restore.`);
  }
  if (!isZipBuffer(input)) {
    if (input.byteLength > MAX_BACKUP_MANIFEST_BYTES) {
      throw new BackupLimitError(`Invalid backup file: JSON exceeds ${formatMiB(MAX_BACKUP_MANIFEST_BYTES)}.`);
    }
    return {
      data: parseJsonBackup(new TextDecoder().decode(input), false),
      zipBytes: null,
      entryNames: null,
    };
  }

  const zipBytes = new Uint8Array(input);
  const entryNames = inspectZipEntries(zipBytes);
  if (!entryNames.has('manifest.json')) {
    throw new Error('Invalid backup zip: missing manifest.json.');
  }

  let manifestBytes: Uint8Array | undefined;
  try {
    manifestBytes = extractZipEntry(zipBytes, 'manifest.json');
  } catch {
    throw new Error('Invalid backup file: could not read zip archive.');
  }
  if (!manifestBytes) throw new Error('Invalid backup zip: missing manifest.json.');

  return {
    data: parseJsonBackup(strFromU8(manifestBytes), true),
    zipBytes,
    entryNames,
  };
}
