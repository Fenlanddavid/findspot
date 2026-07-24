import { db, type FindSpotDB } from '../../db';
import {
  FINDSPOT_COPYRIGHT_NOTICE,
  REPORT_PROTECTION_NOTICE,
  TERMS_OF_USE_VERSION,
} from '../../utils/legalCopy';
import { CURRENT_BACKUP_FORMAT_VERSION } from './backupVersion';
import {
  createMediaArchive,
  type BackupExportProgress,
} from './mediaArchive';
import type { BackupExportManifest } from './schema';

export type { BackupExportProgress } from './mediaArchive';

export type BackupExportOptions = {
  includeMedia?: boolean;
  onProgress?: (progress: BackupExportProgress) => void;
  /** Test/recovery seam; production defaults to the live singleton. */
  database?: FindSpotDB;
};

async function collectManifestData(database: FindSpotDB): Promise<BackupExportManifest> {
  const [
    projects, permissions, sessions, finds, tracks, settings,
    importedPackages, fields, significantFinds, savedPoints,
    undugSignals, findHotspotSignals, hotspotPredictions,
    hotspotPredictionAggregates, outstandingQuestions, questionNotes,
    permissionSections, sessionCoverage,
  ] = await Promise.all([
    database.projects.toArray(),
    database.permissions.toArray(),
    database.sessions.toArray(),
    database.finds.toArray(),
    database.tracks.toArray(),
    database.settings.toArray(),
    database.importedPackages.toArray(),
    database.fields.toArray(),
    database.significantFinds.toArray(),
    database.savedPoints.toArray(),
    database.undugSignals.toArray(),
    database.findHotspotSignals.toArray(),
    database.hotspotPredictions.toArray(),
    database.hotspotPredictionAggregates.toArray(),
    database.outstandingQuestions.toArray(),
    database.questionNotes.toArray(),
    database.permissionSections.toArray(),
    database.sessionCoverage.toArray(),
  ]);

  return {
    version: CURRENT_BACKUP_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    generatedBy: 'FindSpot',
    termsVersion: TERMS_OF_USE_VERSION,
    copyrightNotice: FINDSPOT_COPYRIGHT_NOTICE,
    exportNotice: `User records in this backup remain owned by the user. ${REPORT_PROTECTION_NOTICE}`,
    projects,
    permissions,
    fields,
    sessions,
    finds,
    significantFinds,
    tracks,
    media: [],
    settings,
    importedPackages,
    savedPoints,
    undugSignals,
    findHotspotSignals,
    hotspotPredictions,
    hotspotPredictionAggregates,
    outstandingQuestions,
    questionNotes,
    permissionSections,
    sessionCoverage,
  };
}

/**
 * Export data as legacy-compatible JSON or a manifest-first media archive.
 */
export async function exportData(options: BackupExportOptions = {}): Promise<Blob> {
  const database = options.database ?? db;
  const manifest = await collectManifestData(database);

  if (options.includeMedia !== true) {
    return new Blob([JSON.stringify(manifest)], { type: 'application/json' });
  }

  return createMediaArchive(manifest, {
    onProgress: options.onProgress,
    database,
  });
}
