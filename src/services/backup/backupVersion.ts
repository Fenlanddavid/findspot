/**
 * Backup format history is independent of the Dexie schema version. A single
 * backup format can span several database migrations because omitted arrays
 * are normalized during import.
 */
export const DEFAULT_LEGACY_BACKUP_FORMAT_VERSION = 1 as const;
export const CURRENT_BACKUP_FORMAT_VERSION = 6 as const;

export type BackupContainer = 'json' | 'json-or-zip';

export type BackupFormatDefinition = {
  version: number;
  lifecycle: 'legacy' | 'current';
  container: BackupContainer;
  description: string;
};

/**
 * Formats produced by prior FindSpot v4.x releases and accepted by the current
 * normalization pipeline. Missing version fields normalize to format 1.
 *
 * Import validation is intentionally not changed in v4.6.0. In particular,
 * rules for rejecting unknown future versions will be introduced only with
 * characterization coverage in the validation/versioning slice.
 */
export const BACKUP_FORMAT_DEFINITIONS = [
  {
    version: 1,
    lifecycle: 'legacy',
    container: 'json',
    description: 'Earliest JSON backup shape; also represents exports with no version field.',
  },
  {
    version: 2,
    lifecycle: 'legacy',
    container: 'json',
    description: 'Legacy JSON backup retained for v4.x restore compatibility.',
  },
  {
    version: 3,
    lifecycle: 'legacy',
    container: 'json',
    description: 'Legacy JSON backup; newer optional tables normalize to empty arrays.',
  },
  {
    version: 4,
    lifecycle: 'legacy',
    container: 'json',
    description: 'Legacy JSON backup with media represented by data URIs.',
  },
  {
    version: 5,
    lifecycle: 'legacy',
    container: 'json-or-zip',
    description: 'Introduced full zip archives with manifest media-entry references.',
  },
  {
    version: CURRENT_BACKUP_FORMAT_VERSION,
    lifecycle: 'current',
    container: 'json-or-zip',
    description: 'Current manifest including question and hotspot accuracy history.',
  },
] as const satisfies readonly BackupFormatDefinition[];

export const SUPPORTED_BACKUP_FORMAT_VERSIONS = BACKUP_FORMAT_DEFINITIONS.map(
  definition => definition.version,
);
