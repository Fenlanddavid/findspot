import { validatePersistedBackupTables } from '../persistenceValidation/backup';
import { normalizeBackupInput } from './normalization';
import type {
  BackupValidationOptions,
  RawBackupData,
  ValidatedBackupData,
} from './schema';

export function validateBackupData(
  data: RawBackupData,
  options?: BackupValidationOptions,
): ValidatedBackupData {
  const normalized = normalizeBackupInput(data);
  return validatePersistedBackupTables(normalized, options);
}
