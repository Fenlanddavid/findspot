import { db } from '../../db';
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
};

async function collectManifestData(): Promise<BackupExportManifest> {
  const [
    projects, permissions, sessions, finds, tracks, settings,
    importedPackages, fields, significantFinds, savedPoints,
    undugSignals, findHotspotSignals, hotspotPredictions,
    hotspotPredictionAggregates, outstandingQuestions, questionNotes,
  ] = await Promise.all([
    db.projects.toArray(),
    db.permissions.toArray(),
    db.sessions.toArray(),
    db.finds.toArray(),
    db.tracks.toArray(),
    db.settings.toArray(),
    db.importedPackages.toArray(),
    db.fields.toArray(),
    db.significantFinds.toArray(),
    db.savedPoints.toArray(),
    db.undugSignals.toArray(),
    db.findHotspotSignals.toArray(),
    db.hotspotPredictions.toArray(),
    db.hotspotPredictionAggregates.toArray(),
    db.outstandingQuestions.toArray(),
    db.questionNotes.toArray(),
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
  };
}

/**
 * Export data as legacy-compatible JSON or a manifest-first media archive.
 */
export async function exportData(options: BackupExportOptions = {}): Promise<Blob> {
  const manifest = await collectManifestData();

  if (options.includeMedia !== true) {
    return new Blob([JSON.stringify(manifest)], { type: 'application/json' });
  }

  return createMediaArchive(manifest, { onProgress: options.onProgress });
}
