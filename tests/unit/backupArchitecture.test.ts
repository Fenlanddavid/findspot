import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { readdir, readFile } from 'node:fs/promises';
import { afterEach, describe, expect, it } from 'vitest';
import { FindSpotDB } from '../../src/db';
import {
  BACKUP_FORMAT_DEFINITIONS,
  CURRENT_BACKUP_FORMAT_VERSION,
  DEFAULT_LEGACY_BACKUP_FORMAT_VERSION,
  SUPPORTED_BACKUP_FORMAT_VERSIONS,
} from '../../src/services/backup/backupVersion';
import {
  BACKED_UP_TABLE_NAMES,
  BACKUP_TABLE_REGISTRY,
  EXCLUDED_TABLE_NAMES,
} from '../../src/services/backup/tableRegistry';
import {
  estimateMediaSizeBytes,
  drillRestore,
  exportData,
  importData,
  mediaExt,
  readBackupManifest,
  validateBackupData,
} from '../../src/services/data';
import { ATOMIC_RESTORE_TABLE_NAMES } from '../../src/services/backup/atomicRestore';
import { exportData as exportDataModule } from '../../src/services/backup/export';
import {
  drillRestore as drillRestoreModule,
  importData as importDataModule,
  readBackupManifest as readBackupManifestModule,
} from '../../src/services/backup/import';
import {
  estimateMediaSizeBytes as estimateMediaSizeBytesModule,
  mediaExt as mediaExtModule,
} from '../../src/services/backup/mediaArchive';
import { validateBackupData as validateBackupDataModule } from '../../src/services/backup/validation';

const databaseNames = new Set<string>();

afterEach(async () => {
  await Promise.all([...databaseNames].map(name => Dexie.delete(name)));
  databaseNames.clear();
});

function sorted(values: readonly string[]): string[] {
  return [...values].sort();
}

describe('backup format registry', () => {
  it('defines one ordered current format and every characterized legacy format', () => {
    expect(SUPPORTED_BACKUP_FORMAT_VERSIONS).toEqual([1, 2, 3, 4, 5, 6]);
    expect(DEFAULT_LEGACY_BACKUP_FORMAT_VERSION).toBe(1);
    expect(CURRENT_BACKUP_FORMAT_VERSION).toBe(6);
    expect(BACKUP_FORMAT_DEFINITIONS.filter(format => format.lifecycle === 'current'))
      .toEqual([expect.objectContaining({ version: CURRENT_BACKUP_FORMAT_VERSION })]);
  });
});

describe('backup validation boundary', () => {
  it('keeps the data service compatibility export wired to the extracted validator', () => {
    expect(validateBackupData).toBe(validateBackupDataModule);
  });
});

describe('backup export boundaries', () => {
  it('keeps data service compatibility exports wired to the extracted modules', () => {
    expect(exportData).toBe(exportDataModule);
    expect(estimateMediaSizeBytes).toBe(estimateMediaSizeBytesModule);
    expect(mediaExt).toBe(mediaExtModule);
  });
});

describe('backup import boundaries', () => {
  it('keeps data service compatibility exports wired to the extracted importer', () => {
    expect(importData).toBe(importDataModule);
    expect(drillRestore).toBe(drillRestoreModule);
    expect(readBackupManifest).toBe(readBackupManifestModule);
  });

  it('derives the atomic replacement transaction from every backed-up table', () => {
    expect(sorted(ATOMIC_RESTORE_TABLE_NAMES)).toEqual(sorted(BACKED_UP_TABLE_NAMES));
  });
});

describe('backup table registry', () => {
  it('classifies every live Dexie table exactly once', async () => {
    const name = `findspot-backup-registry-${crypto.randomUUID()}`;
    databaseNames.add(name);
    const database = new FindSpotDB(name);
    await database.open();

    expect(sorted(Object.keys(BACKUP_TABLE_REGISTRY)))
      .toEqual(sorted(database.tables.map(table => table.name)));

    database.close();
  });

  it('records a non-empty reason for every classification', () => {
    for (const [name, registration] of Object.entries(BACKUP_TABLE_REGISTRY)) {
      expect(registration.reason.trim(), `${name} must state its backup decision`).not.toBe('');
    }
  });

  it('partitions the registry into backed-up and excluded tables', () => {
    expect(new Set([...BACKED_UP_TABLE_NAMES, ...EXCLUDED_TABLE_NAMES]).size)
      .toBe(Object.keys(BACKUP_TABLE_REGISTRY).length);
    expect(BACKED_UP_TABLE_NAMES).toHaveLength(17);
    expect(EXCLUDED_TABLE_NAMES).toHaveLength(5);
  });

  it('matches the normalized backup write shape', () => {
    const normalized = validateBackupData({ projects: [] });
    const normalizedTableNames = Object.keys(normalized).filter(key => key !== 'version');
    expect(sorted(BACKED_UP_TABLE_NAMES)).toEqual(sorted(normalizedTableNames));
  });
});

describe('backup module size ratchet', () => {
  it('keeps every backup module at or below 500 lines', async () => {
    const backupDirectory = new URL('../../src/services/backup/', import.meta.url);
    const moduleNames = (await readdir(backupDirectory)).filter(name => name.endsWith('.ts'));
    const lineCounts = await Promise.all(moduleNames.map(async name => ({
      name,
      lines: (await readFile(new URL(name, backupDirectory), 'utf8')).split('\n').length,
    })));

    expect(lineCounts.filter(module => module.lines > 500)).toEqual([]);
  });
});
