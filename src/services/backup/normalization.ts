import { DEFAULT_LEGACY_BACKUP_FORMAT_VERSION } from './backupVersion';
import type {
  BackupTableKey,
  RawBackupData,
  UnvalidatedBackupTables,
  UnvalidatedRow,
} from './schema';
import { BACKED_UP_TABLE_NAMES } from './tableRegistry';

export type NormalizedBackupInput = {
  version: number;
  tables: UnvalidatedBackupTables;
};

function requireArray(
  data: Record<string, unknown>,
  key: BackupTableKey,
  required = false,
): UnvalidatedRow[] {
  const value = data[key];
  if (value === undefined || value === null) {
    if (required) throw new Error(`Invalid format: missing ${key}`);
    return [];
  }
  if (!Array.isArray(value)) throw new Error(`Invalid format: ${key} must be an array`);
  value.forEach((row, index) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      throw new Error(`Invalid format: ${key}[${index}] must be an object`);
    }
  });
  return value as UnvalidatedRow[];
}

export function normalizeBackupInput(data: RawBackupData): NormalizedBackupInput {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('Invalid backup file: expected an object.');
  }

  const raw = data as Record<string, unknown>;
  const tableEntries = BACKED_UP_TABLE_NAMES.map(name => [
    name,
    requireArray(raw, name, name === 'projects'),
  ] as const);

  return {
    version: typeof raw.version === 'number' && Number.isFinite(raw.version)
      ? raw.version
      : DEFAULT_LEGACY_BACKUP_FORMAT_VERSION,
    tables: Object.fromEntries(tableEntries) as UnvalidatedBackupTables,
  };
}
