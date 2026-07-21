import Dexie, { type Table } from "dexie";
import {
  db,
  type Field,
  type Find,
  type FindHotspotSignal,
  type HotspotPrediction,
  type HotspotPredictionAggregate,
  type ImportedPackage,
  type Media,
  type Permission,
  type Project,
  type QuestionNote,
  type SavedPoint,
  type Session,
  type Setting,
  type SignificantFind,
  type Track,
  type UndugSignal,
  type OutstandingQuestion,
} from "../db";
import { v4 as uuid } from "uuid";
import {
  FINDSPOT_COPYRIGHT_NOTICE,
  REPORT_PROTECTION_NOTICE,
  TERMS_OF_USE_VERSION,
} from "../utils/legalCopy";
import { Unzip, UnzipInflate, Zip, ZipDeflate, ZipPassThrough, unzipSync, strToU8, strFromU8 } from "fflate";

export async function markExternalBackupSaved() {
  const now = new Date().toISOString();
  await db.settings.put({ key: "lastBackupDate", value: now });
  return now;
}

// Threshold above which a media-included export triggers a UI size warning.
// Stored photo formats are already compressed, so the raw blob total is also a
// useful approximation of the resulting pass-through zip size.
export const MEDIA_EXPORT_WARN_BYTES = 150 * 1024 * 1024; // 150 MB raw blob total

// Full backups may contain user photos, but imports still need firm limits so a
// malformed JSON file or zip bomb cannot exhaust the browser's memory. These
// caps are deliberately above the export warning threshold to keep ordinary
// photo archives restorable while rejecting unreasonable inputs early.
// In-memory callers retain a ceiling because a compressed zip bomb has already
// consumed a contiguous ArrayBuffer. The Settings UI passes File objects and
// uses the streaming path below, so legitimate photo archives are not subject
// to a whole-backup size cap.
export const MAX_BACKUP_IN_MEMORY_BYTES = 512 * 1024 * 1024;
export const MAX_BACKUP_MANIFEST_BYTES = 50 * 1024 * 1024;
export const MAX_BACKUP_MEDIA_ENTRY_BYTES = 1024 * 1024 * 1024;
export const MAX_BACKUP_UNCOMPRESSED_BYTES = 768 * 1024 * 1024;
export const MAX_BACKUP_RECORDS = 100_000;
export const MAX_BACKUP_ZIP_ENTRIES = MAX_BACKUP_RECORDS + 1; // media rows plus manifest.json

export async function estimateMediaSizeBytes(): Promise<{ count: number; bytes: number; damaged: number }> {
  let count = 0;
  let bytes = 0;
  let damaged = 0;
  // Walk records without retaining a year of Blob handles in an array.
  await db.media.each(m => {
    count += 1;
    const persistedBlob: unknown = (m as { blob?: unknown }).blob;
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

function requireMediaBlob(media: Media): Blob {
  const persistedBlob: unknown = (media as { blob?: unknown }).blob;
  if (!(persistedBlob instanceof Blob)) {
    throw new Error(`${media.filename || `Media ${media.id}`} is damaged and cannot be included in a full backup.`);
  }
  return persistedBlob;
}

// ─── Export ──────────────────────────────────────────────────────────────────

async function collectManifestData() {
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
    version: 6,
    exportedAt: new Date().toISOString(),
    generatedBy: "FindSpot",
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
    media: [] as any[],      // placeholder — media stored as separate zip entries
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
 * Export data as a Blob.
 *
 * - `{ includeMedia: false }` (default): returns a JSON blob (same as legacy v4).
 * - `{ includeMedia: true }`: returns a zip containing `manifest.json` plus
 *   each media blob stored as raw binary under `media/{id}.{ext}`. The archive
 *   is emitted incrementally, retaining the output plus at most one raw media
 *   item instead of retaining a second copy of the entire library.
 */
export type BackupExportProgress = {
  processedMedia: number;
  totalMedia: number;
  percent: number;
};

export async function exportData(options: {
  includeMedia?: boolean;
  onProgress?: (progress: BackupExportProgress) => void;
} = {}): Promise<Blob> {
  const includeMedia = options.includeMedia === true;
  const manifest = await collectManifestData();

  if (!includeMedia) {
    // Data-only: plain JSON, same shape as before (but version 5).
    return new Blob([JSON.stringify(manifest)], { type: "application/json" });
  }

  // ── Full backup: streamed zip ──────────────────────────────────────────

  // Media metadata (everything except the blob) is written to the manifest
  // after each binary entry has been emitted.
  const outputParts: Blob[] = [];
  const mediaMeta: any[] = [];
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
    // Move completed chunks into Blob-backed storage promptly rather than
    // retaining the whole archive as JavaScript Uint8Arrays.
    outputParts.push(new Blob([new Uint8Array(chunk)]));
    if (final) {
      settled = true;
      resolveArchive(new Blob(outputParts, { type: "application/zip" }));
    }
  });

  try {
    // Fetch keys first, then read one media row at a time. Dexie's
    // Collection.each() does not await async callbacks and must not be used here.
    const mediaIds = await db.media.toCollection().primaryKeys();

    // Put the manifest first so a future restore can preview and validate a
    // multi-gigabyte archive without reading through every photo. This metadata
    // pass never calls blob.arrayBuffer(), so photo bytes remain out of JS heap.
    for (const id of mediaIds) {
      const m = await db.media.get(id);
      if (!m) throw new Error(`Media ${String(id)} changed while the backup was being prepared. Please try again.`);
      const mediaBlob = requireMediaBlob(m);
      if (mediaBlob.size > MAX_BACKUP_MEDIA_ENTRY_BYTES) {
        throw new Error(`${m.filename || "A media file"} exceeds the supported 1 GB per-file backup limit.`);
      }
      const filename = `media/${encodeURIComponent(String(m.id))}.${mediaExt(m.mime)}`;
      const { blob: _blob, ...meta } = m as any;
      mediaMeta.push({ ...meta, _zipEntry: filename });
    }

    manifest.media = mediaMeta;
    const manifestEntry = new ZipDeflate("manifest.json", { level: 1 });
    zip.add(manifestEntry);
    manifestEntry.push(strToU8(JSON.stringify(manifest)), true);

    options.onProgress?.({ processedMedia: 0, totalMedia: mediaIds.length, percent: mediaIds.length ? 0 : 100 });
    let processedMedia = 0;
    for (const id of mediaIds) {
      const m = await db.media.get(id);
      if (!m) throw new Error(`Media ${String(id)} changed while the backup was being prepared. Please try again.`);
      const mediaBlob = requireMediaBlob(m);
      const filename = `media/${encodeURIComponent(String(m.id))}.${mediaExt(m.mime)}`;

      // Photos are already compressed in practice; pass-through avoids a large
      // synchronous recompression and emits each entry immediately.
      const entry = new ZipPassThrough(filename);
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

export async function exportToCSV(): Promise<string> {
  const permissions = await db.permissions.toArray();
  const sessions = await db.sessions.toArray();
  const finds = await db.finds.toArray();
  
  const locMap = new Map(permissions.map(l => [l.id, l]));
  const sessMap = new Map(sessions.map(s => [s.id, s]));
  
  const headers = [
    "Find Code", "Object Type", "Coin Type", "Coin Denomination", "Period", "Material", "Completeness",
    "Weight (g)", "Width (mm)", "Decoration",
    "Target ID", "Depth (cm)", "Date Range",
    "Permission Name", "Permission Type", "Landowner Name", "Landowner Phone", "Landowner Email", "Landowner Address",
    "Latitude", "Longitude", "GPS Accuracy (m)", "OS Grid Ref", "What3Words",
    "Land Type", "Land Use", "Crop Type", "Is Stubble",
    "Date Observed", "Detectorist", "Insurance Provider", "Membership No", "Insurance Expiry", "Find Notes", "Permission Notes"
  ];

  const insuranceProvider = await getSetting("insuranceProvider", "");
  const ncmdNumber = await getSetting("ncmdNumber", "");
  const ncmdExpiry = await getSetting("ncmdExpiry", "");

  const rows = finds.map(s => {
    const l = locMap.get(s.permissionId);
    const sess = s.sessionId ? sessMap.get(s.sessionId) : null;

    // Sanitize notes by removing newlines and escaping quotes
    const sNotes = (s.notes || "").replace(/\r?\n|\r/g, " ");
    const lNotes = (l?.notes || "").replace(/\r?\n|\r/g, " ");

    return [
      s.findCode, s.objectType, s.coinType ?? "", s.coinDenomination ?? "", s.period, s.material, s.completeness,
      s.weightG ?? "", s.widthMm ?? "", s.decoration ?? "",
      s.targetId ?? "", s.depthCm ?? "", s.dateRange ?? "",
      l?.name ?? "", l?.type ?? "individual", l?.landownerName ?? "", l?.landownerPhone ?? "", l?.landownerEmail ?? "", l?.landownerAddress ?? "",
      s.lat ?? sess?.lat ?? l?.lat ?? "", s.lon ?? sess?.lon ?? l?.lon ?? "", s.gpsAccuracyM ?? sess?.gpsAccuracyM ?? l?.gpsAccuracyM ?? "", s.osGridRef ?? "", s.w3w ?? "",
      l?.landType ?? "", sess?.landUse ?? "", sess?.cropType ?? "", sess?.isStubble ? "Yes" : "No",
      sess?.date ? new Date(sess.date).toLocaleString() : (l?.createdAt ? new Date(l.createdAt).toLocaleString() : ""),
      l?.collector ?? "", insuranceProvider, ncmdNumber, ncmdExpiry, sNotes, lNotes
    ].map(val => `"${String(val).replace(/"/g, '""')}"`);
  });

  return "\uFEFF" + [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
}

/** Untrusted bytes/JSON entering from outside IndexedDB. */
export type RawBackupData = unknown;

/** Validated manifest media before its Blob is reconstructed. */
export type ValidatedBackupMedia = Omit<Media, "blob"> & (
  | { format: "legacy"; blob: string }
  | { format: "zip"; _zipEntry: string }
);

/**
 * The only backup shape accepted by the write pipeline. Raw input cannot be
 * passed to applyValidatedBackup without first going through validateBackupData.
 */
export type ValidatedBackupData = {
  version: number;
  projects: Project[];
  permissions: Permission[];
  fields: Field[];
  sessions: Session[];
  finds: Find[];
  significantFinds: SignificantFind[];
  tracks: Track[];
  media: ValidatedBackupMedia[];
  settings: Setting[];
  importedPackages: ImportedPackage[];
  savedPoints: SavedPoint[];
  undugSignals: UndugSignal[];
  findHotspotSignals: FindHotspotSignal[];
  hotspotPredictions: HotspotPrediction[];
  hotspotPredictionAggregates: HotspotPredictionAggregate[];
  outstandingQuestions: OutstandingQuestion[];
  questionNotes: QuestionNote[];
};

type BackupTableKey = Exclude<keyof ValidatedBackupData, "version">;
type UnvalidatedRow = Record<string, any>;
type UnvalidatedBackupTables = Record<BackupTableKey, UnvalidatedRow[]>;

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
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      throw new Error(`Invalid format: ${key}[${index}] must be an object`);
    }
  });
  return value as UnvalidatedRow[];
}

function assertRowsHaveId(rows: any[], table: string) {
  rows.forEach((row, index) => {
    if (!row || typeof row !== "object" || typeof row.id !== "string" || !row.id.trim()) {
      throw new Error(`Invalid format: ${table}[${index}] is missing an id`);
    }
  });
}

function isIsoDateString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && Number.isFinite(Date.parse(value));
}

function assertPermissionIntelligence(permission: any, index: number) {
  const invalid = (field: string) => new Error(`Invalid format: permissions[${index}] has an invalid ${field}`);

  if (permission.protectionStatus !== undefined) {
    const status = permission.protectionStatus;
    if (!status || typeof status !== "object") throw invalid("protectionStatus");
    if (!new Set(["present", "clear", "unknown"]).has(status.state)) {
      throw invalid("protectionStatus.state");
    }
    if (!isIsoDateString(status.evaluatedAt)) throw invalid("protectionStatus.evaluatedAt");
    if (status.monumentCount !== undefined &&
        (!Number.isInteger(status.monumentCount) || status.monumentCount < 0)) {
      throw invalid("protectionStatus.monumentCount");
    }
  }

  if (permission.pasContext !== undefined) {
    const context = permission.pasContext;
    if (!context || typeof context !== "object") throw invalid("pasContext");
    if (!Number.isInteger(context.count) || context.count < 0) throw invalid("pasContext.count");
    for (const field of ["topPeriods", "topTypes"] as const) {
      if (!Array.isArray(context[field]) || context[field].length > 3 ||
          context[field].some((value: unknown) => typeof value !== "string")) {
        throw invalid(`pasContext.${field}`);
      }
    }
    if (!isIsoDateString(context.evaluatedAt)) throw invalid("pasContext.evaluatedAt");
  }
}

// Active rule IDs — used for validation of current exports.
const QUESTION_RULE_IDS = new Set([
  "MOVEMENT_NO_FINDS",
  "SETTLEMENT_QUIET",
  "UNRECORDED_ROUTE",
  "ROMAN_ROUTE_ACTIVITY",
]);

// Retired rule IDs — accepted on import (old backups), silently dropped before insertion.
const RETIRED_QUESTION_RULE_IDS = new Set([
  "PUBLIC_RECORD_CONTEXT",
  "COVERAGE_GAP",
  "PROTECTED_AREA_EXCLUSION",
]);
const QUESTION_CATEGORIES = new Set(["MOVEMENT", "COVERAGE", "CONTRADICTION", "HISTORIC_CONTEXT"]);
const QUESTION_STATUSES = new Set(["UNRESOLVED", "NEEDS_EVIDENCE", "WEAKENING", "RESOLVED"]);
const QUESTION_RESOLVED_REASONS = new Set(["preconditions_cleared", "superseded", "cap_evicted"]);
const QUESTION_HYPOTHESES = new Set([
  "activity_follows_route",
  "settlement_signal_reflects_activity",
  "route_signal_is_historic",
  "activity_associated_with_roman_road",
]);
const QUESTION_RESOLVED_OUTCOMES = new Set([
  "likely_supported", "likely_unsupported", "inconclusive_adequate", "not_applicable",
]);

function assertInvestigationMetrics(value: any, invalid: (field: string) => Error, field: string) {
  if (!value || typeof value !== "object") throw invalid(field);
  if (!Number.isFinite(value.bufferM) || value.bufferM <= 0) throw invalid(`${field}.bufferM`);
  if (value.localCoveragePct !== undefined &&
      (!Number.isFinite(value.localCoveragePct) || value.localCoveragePct < 0 || value.localCoveragePct > 100)) {
    throw invalid(`${field}.localCoveragePct`);
  }
  if (value.findsNearCount !== undefined &&
      (!Number.isInteger(value.findsNearCount) || value.findsNearCount < 0)) {
    throw invalid(`${field}.findsNearCount`);
  }
}

function assertOutstandingQuestion(question: any, index: number) {
  const invalid = (field: string) => new Error(`Invalid format: outstandingQuestions[${index}] has an invalid ${field}`);
  if (!QUESTION_RULE_IDS.has(question.ruleId) && !RETIRED_QUESTION_RULE_IDS.has(question.ruleId)) throw invalid("ruleId");
  if (!QUESTION_CATEGORIES.has(question.category)) throw invalid("category");
  if (!QUESTION_STATUSES.has(question.status)) throw invalid("status");
  if (!question.anchor || typeof question.anchor !== "object" ||
      !Number.isFinite(question.anchor.lat) || question.anchor.lat < -90 || question.anchor.lat > 90 ||
      !Number.isFinite(question.anchor.lon) || question.anchor.lon < -180 || question.anchor.lon > 180) {
    throw invalid("anchor");
  }
  if (typeof question.title !== "string" || !question.title.trim()) throw invalid("title");
  if (typeof question.description !== "string" || !question.description.trim()) throw invalid("description");
  if (!Number.isFinite(question.confidence) || question.confidence < 0 || question.confidence > 1) throw invalid("confidence");
  if (!Number.isFinite(question.createdAt) || !Number.isFinite(question.updatedAt)) throw invalid("timestamps");
  if (typeof question.generatedByScanId !== "string" || !question.generatedByScanId.trim()) throw invalid("generatedByScanId");
  if (question.resolvedReason !== undefined && !QUESTION_RESOLVED_REASONS.has(question.resolvedReason)) throw invalid("resolvedReason");
  if (question.resolvedAt !== undefined && !Number.isFinite(question.resolvedAt)) throw invalid("resolvedAt");
  if (question.consecutiveMisses !== undefined &&
      (!Number.isInteger(question.consecutiveMisses) || question.consecutiveMisses < 0)) {
    throw invalid("consecutiveMisses");
  }
  if (question.dismissedByUser !== undefined && typeof question.dismissedByUser !== "boolean") {
    throw invalid("dismissedByUser");
  }
  if (question.hypothesisId !== undefined && !QUESTION_HYPOTHESES.has(question.hypothesisId)) {
    throw invalid("hypothesisId");
  }
  if (question.metrics !== undefined) assertInvestigationMetrics(question.metrics, invalid, "metrics");
  if (question.initialMetrics !== undefined) assertInvestigationMetrics(question.initialMetrics, invalid, "initialMetrics");
  if (question.contextGeometry !== undefined) {
    if (!Array.isArray(question.contextGeometry) || question.contextGeometry.length < 2 ||
        question.contextGeometry.length > 50 || question.contextGeometry.some((point: any) =>
          !Array.isArray(point) || point.length !== 2 ||
          !Number.isFinite(point[0]) || point[0] < -180 || point[0] > 180 ||
          !Number.isFinite(point[1]) || point[1] < -90 || point[1] > 90
        )) {
      throw invalid("contextGeometry");
    }
  }
  if (question.resolvedOutcome !== undefined && !QUESTION_RESOLVED_OUTCOMES.has(question.resolvedOutcome)) {
    throw invalid("resolvedOutcome");
  }
  if (question.resolvedOutcome !== undefined && question.status !== "RESOLVED") {
    throw invalid("resolvedOutcome");
  }
  if (question.priorityState !== undefined &&
      (!question.priorityState || typeof question.priorityState !== "object" ||
       !Number.isInteger(question.priorityState.scansSinceEvidenceChange) ||
       question.priorityState.scansSinceEvidenceChange < 0)) {
    throw invalid("priorityState");
  }
  if (question.supersededByIds !== undefined &&
      (!Array.isArray(question.supersededByIds) || question.supersededByIds.length === 0 ||
       question.supersededByIds.some((id: any) => typeof id !== "string" || !id.trim()))) {
    throw invalid("supersededByIds");
  }

  for (const field of ["supportingEvidence", "contradictingEvidence"] as const) {
    if (!Array.isArray(question[field]) || question[field].some((e: any) =>
      !e || typeof e !== "object" || typeof e.label !== "string" || !e.label.trim() ||
      typeof e.sourceScanId !== "string" || !e.sourceScanId.trim()
    )) {
      throw invalid(field);
    }
  }
}

export function validateBackupData(
  data: RawBackupData,
  options?: { zipMode?: boolean },
): ValidatedBackupData {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Invalid backup file: expected an object.");
  }

  const raw = data as Record<string, unknown>;
  const backup: UnvalidatedBackupTables = {
    projects: requireArray(raw, "projects", true),
    permissions: requireArray(raw, "permissions"),
    fields: requireArray(raw, "fields"),
    sessions: requireArray(raw, "sessions"),
    finds: requireArray(raw, "finds"),
    significantFinds: requireArray(raw, "significantFinds"),
    tracks: requireArray(raw, "tracks"),
    media: requireArray(raw, "media"),
    settings: requireArray(raw, "settings"),
    importedPackages: requireArray(raw, "importedPackages"),
    savedPoints: requireArray(raw, "savedPoints"),
    undugSignals: requireArray(raw, "undugSignals"),
    findHotspotSignals: requireArray(raw, "findHotspotSignals"),
    hotspotPredictions: requireArray(raw, "hotspotPredictions"),
    hotspotPredictionAggregates: requireArray(raw, "hotspotPredictionAggregates"),
    outstandingQuestions: requireArray(raw, "outstandingQuestions"),
    questionNotes: requireArray(raw, "questionNotes"),
  };

  const recordCount = Object.values(backup).reduce((total, rows) => total + rows.length, 0);
  if (recordCount > MAX_BACKUP_RECORDS) {
    throw new Error(`Invalid backup file: contains more than ${MAX_BACKUP_RECORDS.toLocaleString()} records.`);
  }

  assertRowsHaveId(backup.projects, "projects");
  assertRowsHaveId(backup.permissions, "permissions");
  assertRowsHaveId(backup.fields, "fields");
  assertRowsHaveId(backup.sessions, "sessions");
  assertRowsHaveId(backup.finds, "finds");
  assertRowsHaveId(backup.significantFinds, "significantFinds");
  assertRowsHaveId(backup.tracks, "tracks");
  assertRowsHaveId(backup.media, "media");
  assertRowsHaveId(backup.importedPackages, "importedPackages");
  assertRowsHaveId(backup.savedPoints, "savedPoints");
  assertRowsHaveId(backup.undugSignals, "undugSignals");
  assertRowsHaveId(backup.outstandingQuestions, "outstandingQuestions");
  assertRowsHaveId(backup.questionNotes, "questionNotes");

  const projectIds = new Set(backup.projects.map(p => p.id));
  const permissionIds = new Set(backup.permissions.map(p => p.id));
  const sessionIds = new Set(backup.sessions.map(s => s.id));
  const findIds = new Set(backup.finds.map(f => f.id));
  const significantFindIds = new Set(backup.significantFinds.map(f => f.id));

  backup.permissions.forEach((permission, index) => {
    if (!projectIds.has(permission.projectId)) {
      throw new Error(`Invalid format: permissions[${index}] references an unknown project`);
    }
    // Optional for old backups; fully validated when present in current ones.
    assertPermissionIntelligence(permission, index);
  });

  backup.fields.forEach((field, index) => {
    if (!permissionIds.has(field.permissionId)) {
      throw new Error(`Invalid format: fields[${index}] references an unknown permission`);
    }
  });

  backup.sessions.forEach((session, index) => {
    if (!permissionIds.has(session.permissionId)) {
      throw new Error(`Invalid format: sessions[${index}] references an unknown permission`);
    }
  });

  backup.finds.forEach((find, index) => {
    if (!permissionIds.has(find.permissionId)) {
      throw new Error(`Invalid format: finds[${index}] references an unknown permission`);
    }
    if (find.sessionId && !sessionIds.has(find.sessionId)) {
      throw new Error(`Invalid format: finds[${index}] references an unknown session`);
    }
  });

  backup.significantFinds.forEach((find, index) => {
    if (!projectIds.has(find.projectId)) {
      throw new Error(`Invalid format: significantFinds[${index}] references an unknown project`);
    }
    if (!permissionIds.has(find.permissionId)) {
      throw new Error(`Invalid format: significantFinds[${index}] references an unknown permission`);
    }
    if (find.sessionId && !sessionIds.has(find.sessionId)) {
      throw new Error(`Invalid format: significantFinds[${index}] references an unknown session`);
    }
    if (find.linkedFindId && !findIds.has(find.linkedFindId)) {
      throw new Error(`Invalid format: significantFinds[${index}] references an unknown find`);
    }
  });

  backup.tracks.forEach((track, index) => {
    if (track.sessionId && !sessionIds.has(track.sessionId)) {
      throw new Error(`Invalid format: tracks[${index}] references an unknown session`);
    }
  });

  backup.media.forEach((media, index) => {
    if (options?.zipMode) {
      // Zip format: media has _zipEntry string pointing to zip entry, no blob field.
      if (typeof media._zipEntry !== "string" || !media._zipEntry.startsWith("media/")) {
        throw new Error(`Invalid format: media[${index}] has an invalid _zipEntry`);
      }
    } else {
      // Legacy JSON: blob must be a data: URI.
      if (typeof media.blob !== "string" || !media.blob.startsWith("data:")) {
        throw new Error(`Invalid format: media[${index}] has an invalid blob`);
      }
    }
    if (media.findId && !findIds.has(media.findId) && !significantFindIds.has(media.findId)) {
      throw new Error(`Invalid format: media[${index}] references an unknown find or significant find`);
    }
    if (media.permissionId && !permissionIds.has(media.permissionId)) {
      throw new Error(`Invalid format: media[${index}] references an unknown permission`);
    }
  });

  backup.settings.forEach((setting, index) => {
    if (!setting || typeof setting !== "object" || typeof setting.key !== "string" || !setting.key.trim()) {
      throw new Error(`Invalid format: settings[${index}] is missing a key`);
    }
  });

  backup.savedPoints.forEach((sp, index) => {
    if (!projectIds.has(sp.projectId)) {
      throw new Error(`Invalid format: savedPoints[${index}] references an unknown project`);
    }
  });

  backup.findHotspotSignals.forEach((signal, index) => {
    const invalid = (field: string) => new Error(`Invalid format: findHotspotSignals[${index}] has an invalid ${field}`);
    if (!signal || typeof signal !== "object") throw invalid("row");
    if (typeof signal.signalKey !== "string" || !signal.signalKey.trim()) throw invalid("signalKey");
    if (typeof signal.permissionId !== "string" || !signal.permissionId.trim()) throw invalid("permissionId");
    if (typeof signal.geohash6 !== "string" || !signal.geohash6.trim()) throw invalid("geohash6");
    if (!Number.isInteger(signal.findCount) || signal.findCount < 0) throw invalid("findCount");
    if (signal.findIds !== undefined &&
        (!Array.isArray(signal.findIds) || signal.findIds.some((id: unknown) => typeof id !== "string" || !id.trim()))) {
      throw invalid("findIds");
    }
  });

  backup.hotspotPredictions.forEach((prediction, index) => {
    const invalid = (field: string) => new Error(`Invalid format: hotspotPredictions[${index}] has an invalid ${field}`);
    if (typeof prediction.id !== "string" || !prediction.id.trim()) throw invalid("id");
    if (typeof prediction.engineVersion !== "string" || !prediction.engineVersion.trim()) throw invalid("engineVersion");
    if (!Number.isFinite(prediction.surfacedAt)) throw invalid("surfacedAt");
    if (!['hit', 'searched_no_find', 'unvisited'].includes(prediction.outcome)) throw invalid("outcome");
    if (!Array.isArray(prediction.center) || prediction.center.length !== 2 || prediction.center.some((value: unknown) => !Number.isFinite(value))) throw invalid("center");
    if (!Array.isArray(prediction.bounds) || prediction.bounds.length !== 2) throw invalid("bounds");
  });

  backup.hotspotPredictionAggregates.forEach((aggregate, index) => {
    const invalid = (field: string) => new Error(`Invalid format: hotspotPredictionAggregates[${index}] has an invalid ${field}`);
    if (typeof aggregate.id !== "string" || !aggregate.id.trim()) throw invalid("id");
    if (typeof aggregate.engineVersion !== "string" || !aggregate.engineVersion.trim()) throw invalid("engineVersion");
    for (const field of ['surfacedCount', 'searchedCount', 'hitCount'] as const) {
      if (!Number.isInteger(aggregate[field]) || aggregate[field] < 0) throw invalid(field);
    }
    if (aggregate.hitCount > aggregate.searchedCount || aggregate.searchedCount > aggregate.surfacedCount) throw invalid("counts");
  });

  backup.outstandingQuestions.forEach((question, index) => {
    if (!permissionIds.has(question.permissionId)) {
      throw new Error(`Invalid format: outstandingQuestions[${index}] references an unknown permission`);
    }
    assertOutstandingQuestion(question, index);
  });

  const VALID_NOTE_TYPES = new Set([
    "searched_nothing", "found_something", "ground_inaccessible",
    "poor_conditions", "modern_disturbance", "freeform", "session_crossed",
    "status_change", "merged_from",
  ]);
  backup.questionNotes.forEach((note, index) => {
    const invalid = (field: string) => new Error(`Invalid format: questionNotes[${index}] has an invalid ${field}`);
    if (typeof note.questionId !== "string" || !note.questionId.trim()) throw invalid("questionId");
    // questionId may reference a deleted question (orphaned user notes are retained — documented).
    if (typeof note.author !== "string" || (note.author !== "user" && note.author !== "system")) throw invalid("author");
    if (!VALID_NOTE_TYPES.has(note.type)) throw invalid("type");
    if (note.text !== undefined && (typeof note.text !== "string" || note.text.length > 1000)) throw invalid("text");
    if (!Number.isFinite(note.createdAt)) throw invalid("createdAt");
    if (note.sessionId !== undefined && typeof note.sessionId !== "string") throw invalid("sessionId");
    if (note.linkedFindIds !== undefined) {
      if (!Array.isArray(note.linkedFindIds) || note.linkedFindIds.some((id: any) => typeof id !== "string")) {
        throw invalid("linkedFindIds");
      }
    }
  });

  // This is the single assertion bridge from untrusted records to domain
  // records. All structural, table-specific and referential checks above have
  // completed; downstream write functions accept only this concrete type.
  return {
    version: typeof raw.version === "number" && Number.isFinite(raw.version)
      ? raw.version
      : 1,
    projects: backup.projects as Project[],
    permissions: backup.permissions as Permission[],
    fields: backup.fields as Field[],
    sessions: backup.sessions as Session[],
    finds: backup.finds as Find[],
    significantFinds: backup.significantFinds as SignificantFind[],
    tracks: backup.tracks as Track[],
    media: backup.media.map((media) => options?.zipMode
      ? { ...media, format: "zip" as const } as ValidatedBackupMedia
      : { ...media, format: "legacy" as const } as ValidatedBackupMedia),
    settings: backup.settings as Setting[],
    importedPackages: backup.importedPackages as ImportedPackage[],
    savedPoints: backup.savedPoints as SavedPoint[],
    undugSignals: backup.undugSignals as UndugSignal[],
    findHotspotSignals: backup.findHotspotSignals as FindHotspotSignal[],
    hotspotPredictions: backup.hotspotPredictions as HotspotPrediction[],
    hotspotPredictionAggregates: backup.hotspotPredictionAggregates as HotspotPredictionAggregate[],
    outstandingQuestions: backup.outstandingQuestions as OutstandingQuestion[],
    questionNotes: backup.questionNotes as QuestionNote[],
  };
}

// ─── Format detection ────────────────────────────────────────────────────────
// Zip files start with PK (0x50 0x4b). Legacy JSON starts with { or whitespace.

function isZipBuffer(buf: ArrayBuffer): boolean {
  if (buf.byteLength < 2) return false;
  const header = new Uint8Array(buf, 0, Math.min(4, buf.byteLength));
  return header[0] === 0x50 && header[1] === 0x4b; // PK
}

class BackupLimitError extends Error {}

type DecodedBackup = {
  data: RawBackupData;
  zipBytes: Uint8Array | null;
  entryNames: Set<string> | null;
};

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

class RestoreStageDB extends Dexie {
  entries!: Table<StagedZipEntry, string>;
  chunks!: Table<StagedZipChunk, string>;

  constructor(name: string) {
    super(name);
    this.version(1).stores({
      entries: "&name",
      chunks: "&id,name,[name+index]",
    });
  }
}

const RESTORE_STAGE_PREFIX = "findspot_restore_staging_";

async function cleanupStaleRestoreStages() {
  const staleBefore = Date.now() - 24 * 60 * 60 * 1000;
  try {
    const names = await Dexie.getDatabaseNames();
    await Promise.all(names
      .filter(name => name.startsWith(RESTORE_STAGE_PREFIX))
      .filter(name => {
        const timestamp = Number(name.slice(RESTORE_STAGE_PREFIX.length).split("_")[0]);
        return !Number.isFinite(timestamp) || timestamp < staleBefore;
      })
      .map(name => Dexie.delete(name)));
  } catch {
    // Database enumeration is not available in every browser. The active stage
    // still has an explicit finally cleanup below.
  }
}

export type BackupImportProgress = {
  phase: "reading" | "validating" | "restoring";
  processedBytes: number;
  totalBytes: number;
  percent: number;
};

type BackupImportOptions = {
  onProgress?: (progress: BackupImportProgress) => void;
};

type StreamedZipBackup = {
  data: RawBackupData;
  entryNames: Set<string>;
};

function formatMiB(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

function isQuotaExceeded(error: unknown): boolean {
  return !!error && typeof error === "object" && "name" in error && error.name === "QuotaExceededError";
}

function emitImportProgress(
  options: BackupImportOptions | undefined,
  phase: BackupImportProgress["phase"],
  processedBytes: number,
  totalBytes: number,
  percent: number,
) {
  options?.onProgress?.({ phase, processedBytes, totalBytes, percent });
}

async function isZipBlob(blob: Blob): Promise<boolean> {
  if (blob.size < 2) return false;
  const header = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
  return header[0] === 0x50 && header[1] === 0x4b;
}

/**
 * Read a zip incrementally. Media entries are written to a temporary IndexedDB
 * as each one completes, keeping memory bounded to a single photo. The live
 * FindSpot database is not opened for writing here.
 */
async function streamZipBackup(
  blob: Blob,
  options: BackupImportOptions | undefined,
  config: { stage?: RestoreStageDB; stopAfterManifest?: boolean } = {},
): Promise<StreamedZipBackup> {
  const entryNames = new Set<string>();
  let data: any;
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

    const isManifest = file.name === "manifest.json";
    const isMedia = file.name.startsWith("media/");
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

      const percent = blob.size ? Math.min(90, Math.floor((processedBytes / blob.size) * 90)) : 90;
      if (percent !== lastProgressPercent) {
        lastProgressPercent = percent;
        emitImportProgress(options, "reading", processedBytes, blob.size, percent);
      }
      if (config.stopAfterManifest && data !== undefined) {
        await reader.cancel();
        break;
      }
      if (done) break;
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    if (isQuotaExceeded(error)) {
      throw new Error("Not enough free device storage to stage this backup. Existing FindSpot data has not been changed.");
    }
    if (error instanceof BackupLimitError) throw error;
    throw new Error(`Invalid backup file: could not read zip archive. ${error instanceof Error ? error.message : ""}`.trim());
  }

  if (data === undefined) throw new Error("Invalid backup zip: missing manifest.json.");
  return { data, entryNames };
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
          throw new BackupLimitError("Invalid backup zip: an entry has an invalid size.");
        }
        totalUncompressedBytes += file.originalSize;
        if (totalUncompressedBytes > MAX_BACKUP_UNCOMPRESSED_BYTES) {
          throw new BackupLimitError(`Invalid backup zip: expanded content exceeds ${formatMiB(MAX_BACKUP_UNCOMPRESSED_BYTES)}.`);
        }
        if (file.name === "manifest.json" && file.originalSize > MAX_BACKUP_MANIFEST_BYTES) {
          throw new BackupLimitError(`Invalid backup zip: manifest.json exceeds ${formatMiB(MAX_BACKUP_MANIFEST_BYTES)}.`);
        }
        if (file.name.startsWith("media/") && file.originalSize > MAX_BACKUP_MEDIA_ENTRY_BYTES) {
          throw new BackupLimitError(`Invalid backup zip: media entry ${file.name} exceeds ${formatMiB(MAX_BACKUP_MEDIA_ENTRY_BYTES)}.`);
        }
        return false;
      },
    });
  } catch (error) {
    if (error instanceof BackupLimitError) throw error;
    throw new Error("Invalid backup file: could not read zip archive.");
  }

  return names;
}

function extractZipEntry(zipBytes: Uint8Array, entryName: string): Uint8Array | undefined {
  const entries = unzipSync(zipBytes, { filter: file => file.name === entryName });
  return entries[entryName];
}

function parseJsonBackup(text: string, zipMode: boolean): RawBackupData {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(zipMode
      ? "Invalid backup zip: could not parse manifest.json."
      : "Invalid backup file: could not parse JSON.");
  }
}

function decodeBackupInput(input: string | ArrayBuffer): DecodedBackup {
  if (typeof input === "string") {
    if (new TextEncoder().encode(input).byteLength > MAX_BACKUP_MANIFEST_BYTES) {
      throw new BackupLimitError(`Invalid backup file: JSON exceeds ${formatMiB(MAX_BACKUP_MANIFEST_BYTES)}.`);
    }
    return { data: parseJsonBackup(input, false), zipBytes: null, entryNames: null };
  }

  if (!(input instanceof ArrayBuffer)) {
    throw new Error("Invalid backup file: unexpected input type.");
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
  if (!entryNames.has("manifest.json")) {
    throw new Error("Invalid backup zip: missing manifest.json.");
  }

  let manifestBytes: Uint8Array | undefined;
  try {
    manifestBytes = extractZipEntry(zipBytes, "manifest.json");
  } catch {
    throw new Error("Invalid backup file: could not read zip archive.");
  }
  if (!manifestBytes) {
    throw new Error("Invalid backup zip: missing manifest.json.");
  }
  return {
    data: parseJsonBackup(strFromU8(manifestBytes), true),
    zipBytes,
    entryNames,
  };
}

/** Safely decode only the manifest used by the restore preview UI. */
export async function readBackupManifest(input: string | ArrayBuffer | Blob): Promise<Record<string, unknown>> {
  let data: RawBackupData;
  if (input instanceof Blob) {
    if (await isZipBlob(input)) {
      data = (await streamZipBackup(input, undefined, { stopAfterManifest: true })).data;
    } else {
      if (input.size > MAX_BACKUP_MANIFEST_BYTES) {
        throw new BackupLimitError(`Invalid backup file: JSON exceeds ${formatMiB(MAX_BACKUP_MANIFEST_BYTES)}.`);
      }
      data = parseJsonBackup(await input.text(), false);
    }
  } else {
    data = decodeBackupInput(input).data;
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Invalid backup file: expected an object.");
  }
  return data as Record<string, unknown>;
}

/**
 * Import a backup from either:
 *  - A legacy JSON string (v4 and earlier)
 *  - A zip File/Blob (v5+, streamed and staged outside the live database)
 *  - A zip ArrayBuffer (v5+, retained for programmatic backwards compatibility)
 *
 * File/Blob is the preferred path: total photo-library size is not capped and
 * memory stays bounded to one media entry. Both paths feed into the same atomic
 * replacement transaction only after validation is complete.
 */
export async function importData(
  input: string | ArrayBuffer | Blob,
  options: BackupImportOptions = {},
) {
  let data: any;
  let zipBytes: Uint8Array | null = null;
  let entryNames: Set<string> | null = null;
  let stagedMediaItems: Media[] | null = null;
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
          throw new BackupLimitError(`Invalid backup file: JSON exceeds ${formatMiB(MAX_BACKUP_MANIFEST_BYTES)}.`);
        }
        emitImportProgress(options, "reading", input.size, input.size, 90);
        data = parseJsonBackup(await input.text(), false);
      }
    } else {
      const decoded = decodeBackupInput(input);
      data = decoded.data;
      zipBytes = decoded.zipBytes;
      entryNames = decoded.entryNames;
      const inputBytes = typeof input === "string" ? new TextEncoder().encode(input).byteLength : input.byteLength;
      emitImportProgress(options, "reading", inputBytes, inputBytes, 90);
    }

    emitImportProgress(options, "validating", input instanceof Blob ? input.size : 0, input instanceof Blob ? input.size : 0, 92);
    const zipMode = !!zipBytes || !!stage;
    const backup = validateBackupData(data, { zipMode });

    if (zipMode && entryNames) {
      const referencedEntries = new Set<string>();
      for (const media of backup.media) {
        if (media.format !== "zip") throw new Error("Invalid backup zip: legacy media manifest entry");
        if (!entryNames.has(media._zipEntry)) {
          throw new Error(`Invalid backup zip: missing media entry ${media._zipEntry}`);
        }
        if (referencedEntries.has(media._zipEntry)) {
          throw new Error(`Invalid backup zip: media entry ${media._zipEntry} is referenced more than once.`);
        }
        referencedEntries.add(media._zipEntry);
      }
      for (const entryName of entryNames) {
        if (entryName.startsWith("media/") && !referencedEntries.has(entryName)) {
          throw new Error(`Invalid backup zip: unreferenced media entry ${entryName}.`);
        }
      }
    }

    // Reconstruct media before opening the live replacement transaction. For
    // streamed zips these are lightweight Blob handles backed by the temporary
    // IndexedDB, not a second in-memory copy of the photo library.
    if (stage) {
      stagedMediaItems = [];
      for (const item of backup.media) {
        if (item.format !== "zip") throw new Error("Invalid backup zip: legacy media manifest entry");
        const staged = await stage.entries.get(item._zipEntry);
        if (!staged) throw new Error(`Invalid backup zip: missing media entry ${item._zipEntry}`);
        const chunks = await stage.chunks.where("name").equals(item._zipEntry).sortBy("index");
        if (chunks.length !== staged.chunkCount || chunks.reduce((sum, chunk) => sum + chunk.blob.size, 0) !== staged.size) {
          throw new Error(`Invalid backup zip: incomplete media entry ${item._zipEntry}`);
        }
        const { _zipEntry, format: _format, ...rest } = item;
        const stagedBlob = new Blob(chunks.map(chunk => chunk.blob));
        stagedMediaItems.push({
          ...rest,
          blob: stagedBlob.slice(0, stagedBlob.size, rest.mime || "application/octet-stream"),
        } as Media);
      }
    } else if (!zipBytes) {
      stagedMediaItems = backup.media.length
        ? await Promise.all(backup.media.map(async (media) => {
            if (media.format !== "legacy") {
              throw new Error("Invalid JSON backup: zip media manifest entry");
            }
            const { format: _format, blob, ...rest } = media;
            return { ...rest, blob: await base64ToBlob(blob) } as Media;
          }))
        : [];
    }

    emitImportProgress(options, "restoring", input instanceof Blob ? input.size : 0, input instanceof Blob ? input.size : 0, 95);
    try {
      await applyValidatedBackup(backup, zipBytes, stagedMediaItems ?? []);
    } catch (error) {
      if (isQuotaExceeded(error)) {
        throw new Error("Not enough free device storage to complete this restore. Existing FindSpot data has not been changed.");
      }
      throw error;
    }
    emitImportProgress(options, "restoring", input instanceof Blob ? input.size : 0, input instanceof Blob ? input.size : 0, 100);
  } finally {
    if (stage) {
      stage.close();
      await Dexie.delete(stage.name).catch(() => {});
    }
  }
}

async function applyValidatedBackup(
  backup: ValidatedBackupData,
  zipBytes: Uint8Array | null,
  mediaItems: Media[],
) {
  await db.transaction("rw", [db.projects, db.permissions, db.fields, db.sessions, db.finds, db.significantFinds, db.media, db.tracks, db.settings, db.importedPackages, db.savedPoints, db.undugSignals, db.findHotspotSignals, db.hotspotPredictions, db.hotspotPredictionAggregates, db.outstandingQuestions, db.questionNotes], async () => {
    // Clear all existing data first — prevents orphaned placeholder records
    // (e.g. the fresh-install project created before the restore) from
    // surviving alongside the backup data and causing projectId mismatches.
    await db.projects.clear();
    await db.permissions.clear();
    await db.fields.clear();
    await db.sessions.clear();
    await db.finds.clear();
    await db.significantFinds.clear();
    await db.tracks.clear();
    await db.settings.clear();
    await db.media.clear();
    await db.importedPackages.clear();
    await db.savedPoints.clear();
    await db.undugSignals.clear();
    await db.findHotspotSignals.clear();
    await db.hotspotPredictions.clear();
    await db.hotspotPredictionAggregates.clear();
    await db.outstandingQuestions.clear();
    await db.questionNotes.clear();

    await db.projects.bulkPut(backup.projects);
    if (backup.permissions.length) await db.permissions.bulkPut(backup.permissions);
    if (backup.fields.length) await db.fields.bulkPut(backup.fields);
    if (backup.sessions.length) await db.sessions.bulkPut(backup.sessions);
    if (backup.finds.length) await db.finds.bulkPut(backup.finds);
    if (backup.significantFinds.length) await db.significantFinds.bulkPut(backup.significantFinds);
    if (backup.tracks.length) await db.tracks.bulkPut(backup.tracks);
    if (backup.settings.length) await db.settings.bulkPut(backup.settings);
    if (backup.importedPackages.length) await db.importedPackages.bulkPut(backup.importedPackages);
    if (zipBytes) {
      // Extract and persist one item at a time so restore does not retain a
      // second uncompressed copy of the entire photo library.
      for (const item of backup.media) {
        if (item.format !== "zip") throw new Error("Invalid backup zip: legacy media manifest entry");
        const bytes = extractZipEntry(zipBytes, item._zipEntry);
        if (!bytes) throw new Error(`Invalid backup zip: missing media entry ${item._zipEntry}`);
        const { _zipEntry, format: _format, ...rest } = item;
        await db.media.put({
          ...rest,
          blob: new Blob([new Uint8Array(bytes)], { type: rest.mime || "application/octet-stream" }),
        } as Media);
      }
    } else if (mediaItems.length) {
      // One request per Blob avoids asking IndexedDB to serialise a year of
      // photos as one giant bulkPut payload while keeping the transaction atomic.
      for (const media of mediaItems) await db.media.put(media);
    }
    if (backup.savedPoints.length) await db.savedPoints.bulkPut(backup.savedPoints);
    if (backup.undugSignals.length) await db.undugSignals.bulkPut(backup.undugSignals);
    if (backup.findHotspotSignals.length) await db.findHotspotSignals.bulkPut(backup.findHotspotSignals);
    if (backup.hotspotPredictions.length) await db.hotspotPredictions.bulkPut(backup.hotspotPredictions);
    if (backup.hotspotPredictionAggregates.length) await db.hotspotPredictionAggregates.bulkPut(backup.hotspotPredictionAggregates);
    const activeQuestions = backup.outstandingQuestions.filter(
      (q: any) => !RETIRED_QUESTION_RULE_IDS.has(q.ruleId)
    );
    if (activeQuestions.length) await db.outstandingQuestions.bulkPut(activeQuestions);
    if (backup.questionNotes.length) await db.questionNotes.bulkPut(backup.questionNotes);
  });
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function base64ToBlob(base64: string): Promise<Blob> {
  const res = await fetch(base64);
  return res.blob();
}

/**
 * Gets a setting value
 */
export async function getSetting<T>(key: string, defaultValue: T): Promise<T> {
  const setting = await db.settings.get(key);
  return setting ? (setting.value as T) : defaultValue;
}

/**
 * Sets a setting value
 */
export async function setSetting(key: string, value: any) {
  await db.settings.put({ key, value });
}

// ─── Club Day ─────────────────────────────────────────────────────────────────

/**
 * Returns the recorder ID for this device, creating one if it doesn't exist yet.
 */
export async function getOrCreateRecorderId(): Promise<string> {
  const existing = await getSetting<string>("recorderId", "");
  if (existing) return existing;
  const id = uuid();
  await setSetting("recorderId", id);
  return id;
}

export type ClubDayPackField = Pick<Field, "id" | "name" | "boundary"> & Partial<Pick<Field, "notes" | "createdAt" | "updatedAt">>;

export type ClubDayPack = {
  type: "findspot-club-day-pack";
  version: 1;
  sharedPermissionId: string;
  eventName: string;
  eventDate: string;
  organiserName?: string;
  organiserContactNumber?: string;
  organiserEmail?: string;
  significantFindInstructions?: string;
  publicNotes?: string;
  boundary?: Field["boundary"];
  fields: ClubDayPackField[];
  createdAt: string;
};

type EncodedPolygon = number[][];
type CompactClubDayField = [id: string, name: string, boundary: EncodedPolygon];

type CompactClubDayPack = {
  t: "cdp";
  v: 1;
  s: string;
  n: string;
  d: string;
  o?: string;
  c?: string;
  e?: string;
  i?: string;
  p?: string;
  b?: EncodedPolygon;
  f: CompactClubDayField[];
  a: string;
};

const COORD_SCALE = 1_000_000;

function roundCoord(value: number): number {
  return Number(value.toFixed(6));
}

function sameCoord(a: number[], b: number[]): boolean {
  return a[0] === b[0] && a[1] === b[1];
}

function compactPolygon(boundary?: Field["boundary"]): Field["boundary"] | undefined {
  if (!boundary?.coordinates?.length) return undefined;

  const rings = boundary.coordinates
    .map(ring => {
      const cleaned: number[][] = [];
      ring.forEach(point => {
        if (!Array.isArray(point) || point.length < 2) return;
        const lon = Number(point[0]);
        const lat = Number(point[1]);
        if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;
        const next = [roundCoord(lon), roundCoord(lat)];
        const prev = cleaned[cleaned.length - 1];
        if (!prev || !sameCoord(prev, next)) cleaned.push(next);
      });

      if (cleaned.length < 3) return [];
      const first = cleaned[0];
      const last = cleaned[cleaned.length - 1];
      if (!sameCoord(first, last)) cleaned.push([...first]);
      return cleaned;
    })
    .filter(ring => ring.length >= 4);

  if (rings.length === 0) return undefined;
  return { type: "Polygon", coordinates: rings };
}

function boundaryFromCoordinates(coordinates?: number[][][]): Field["boundary"] | undefined {
  if (!coordinates?.length) return undefined;
  return compactPolygon({ type: "Polygon", coordinates });
}

function encodePolygon(boundary?: Field["boundary"]): EncodedPolygon | undefined {
  const compact = compactPolygon(boundary);
  if (!compact) return undefined;

  return compact.coordinates.map(ring => {
    const encoded: number[] = [];
    let prevLon = 0;
    let prevLat = 0;

    ring.forEach((point, index) => {
      const lon = Math.round(point[0] * COORD_SCALE);
      const lat = Math.round(point[1] * COORD_SCALE);
      if (index === 0) {
        encoded.push(lon, lat);
      } else {
        encoded.push(lon - prevLon, lat - prevLat);
      }
      prevLon = lon;
      prevLat = lat;
    });

    return encoded;
  });
}

function decodePolygon(encoded?: EncodedPolygon): Field["boundary"] | undefined {
  if (!encoded?.length) return undefined;

  const coordinates = encoded.map(ring => {
    const decoded: number[][] = [];
    let lon = 0;
    let lat = 0;

    for (let i = 0; i < ring.length - 1; i += 2) {
      if (i === 0) {
        lon = ring[i];
        lat = ring[i + 1];
      } else {
        lon += ring[i];
        lat += ring[i + 1];
      }
      decoded.push([roundCoord(lon / COORD_SCALE), roundCoord(lat / COORD_SCALE)]);
    }

    return decoded;
  });

  return boundaryFromCoordinates(coordinates);
}

function boundaryFromCompactValue(value?: EncodedPolygon | number[][][]): Field["boundary"] | undefined {
  if (!value?.length) return undefined;
  const firstRing = value[0] as unknown[];
  return typeof firstRing?.[0] === "number"
    ? decodePolygon(value as EncodedPolygon)
    : boundaryFromCoordinates(value as number[][][]);
}

function isFullClubDayPack(value: any): value is ClubDayPack {
  return value?.type === "findspot-club-day-pack" && value.version === 1 && typeof value.sharedPermissionId === "string";
}

function isCompactClubDayPack(value: any): value is CompactClubDayPack {
  return value?.t === "cdp" && value.v === 1 && typeof value.s === "string";
}

export function normalizeClubDayPack(value: unknown): ClubDayPack | null {
  if (isFullClubDayPack(value)) {
    return {
      ...value,
      boundary: compactPolygon(value.boundary),
      fields: (value.fields ?? [])
        .map(f => {
          const boundary = compactPolygon(f.boundary);
          return boundary ? { ...f, boundary } : null;
        })
        .filter((f): f is ClubDayPackField => !!f),
    };
  }

  if (!isCompactClubDayPack(value)) return null;

  const createdAt = value.a || new Date().toISOString();
  return {
    type: "findspot-club-day-pack",
    version: 1,
    sharedPermissionId: value.s,
    eventName: value.n || "Club Day Event",
    eventDate: value.d || createdAt.slice(0, 10),
    organiserName: value.o,
    organiserContactNumber: value.c,
    organiserEmail: value.e,
    significantFindInstructions: value.i,
    publicNotes: value.p,
    boundary: boundaryFromCompactValue(value.b),
    fields: (value.f ?? [])
      .map((tuple): ClubDayPackField | null => {
        if (!Array.isArray(tuple)) return null;
        const [id, name, encodedBoundary] = tuple;
        const boundary = boundaryFromCompactValue(encodedBoundary);
        if (!id || !boundary) return null;
        return {
          id,
          name: name || "Field",
          boundary,
          notes: "",
          createdAt,
          updatedAt: createdAt,
        };
      })
      .filter((f): f is ClubDayPackField => !!f),
    createdAt,
  };
}

export function compactClubDayPackJson(json: string): string {
  const pack = normalizeClubDayPack(JSON.parse(json));
  if (!pack) throw new Error("Invalid Club Day Pack.");

  const compact: CompactClubDayPack = {
    t: "cdp",
    v: 1,
    s: pack.sharedPermissionId,
    n: pack.eventName,
    d: pack.eventDate,
    f: pack.fields
      .map(field => {
        const boundary = encodePolygon(field.boundary);
        return boundary ? [field.id, field.name, boundary] as CompactClubDayField : null;
      })
      .filter((field): field is CompactClubDayField => !!field),
    a: pack.createdAt,
  };

  if (pack.organiserName) compact.o = pack.organiserName;
  if (pack.organiserContactNumber) compact.c = pack.organiserContactNumber;
  if (pack.organiserEmail) compact.e = pack.organiserEmail;
  if (pack.significantFindInstructions) compact.i = pack.significantFindInstructions;
  if (pack.publicNotes) compact.p = pack.publicNotes;
  if (pack.boundary) compact.b = encodePolygon(pack.boundary);

  return JSON.stringify(compact);
}

/**
 * Organiser: creates a Club Day Pack from a permission.
 * selectedFieldIds controls which fields are included — supports the
 * "different fields on different days" use case.
 * Strips all landowner/private data. Returns JSON string.
 */
export async function createClubDayPack(
  permissionId: string,
  selectedFieldIds: string[]
): Promise<string> {
  const permission = await db.permissions.get(permissionId);
  if (!permission) throw new Error("Permission not found");

  // Ensure the permission has a stable shared ID
  const sharedPermissionId = permission.sharedPermissionId ?? uuid();
  const now = new Date().toISOString();

  if (!permission.sharedPermissionId || !permission.isSharedPermission || permission.type !== "rally") {
    await db.permissions.update(permissionId, {
      type: "rally",
      sharedPermissionId,
      isSharedPermission: true,
      updatedAt: now,
    });
  }

  const allFields = await db.fields.where("permissionId").equals(permissionId).toArray();
  const selectedFields = allFields
    .filter(f => selectedFieldIds.includes(f.id))
    .map(f => {
      const boundary = compactPolygon(f.boundary);
      if (!boundary) return null;
      return {
        id: f.id,
        name: f.name,
        boundary,
      };
    })
    .filter((f): f is ClubDayPackField => !!f);

  const pack: ClubDayPack = {
    type: "findspot-club-day-pack",
    version: 1,
    sharedPermissionId,
    eventName: permission.name,
    eventDate: permission.validFrom ?? now.slice(0, 10),
    // The rally form historically stored its "Organiser / Contact Name" in
    // landownerName. Prefer the dedicated collector field, but retain that
    // legacy/current-form fallback in shared packs.
    organiserName: permission.collector || permission.landownerName || undefined,
    organiserContactNumber: permission.organiserContactNumber,
    organiserEmail: permission.organiserEmail,
    significantFindInstructions: permission.significantFindInstructions,
    publicNotes: permission.clubDayPublicNotes,
    boundary: selectedFields.length === 0 ? compactPolygon(permission.boundary) : undefined,
    fields: selectedFields,
    createdAt: now,
  };

  return JSON.stringify(pack);
}

export type ClubDayImportResult = {
  eventName: string;
  eventDate: string;
  alreadyImported: boolean;
  updatedExisting?: boolean;
  permissionId?: string;
};

async function applyClubDayPackToLocalPermission(
  localPermissionId: string,
  projectId: string,
  pack: ClubDayPack,
  now: string
) {
  const fieldRecords: Field[] = pack.fields.map(f => ({
    id: f.id,
    projectId,
    permissionId: localPermissionId,
    name: f.name,
    boundary: f.boundary,
    notes: f.notes ?? "",
    createdAt: f.createdAt ?? now,
    updatedAt: f.updatedAt ?? now,
  }));

  const incomingFieldIds = new Set(fieldRecords.map(f => f.id));
  const [existingFields, existingSessions, existingFinds] = await Promise.all([
    db.fields.where("permissionId").equals(localPermissionId).toArray(),
    db.sessions.where("permissionId").equals(localPermissionId).toArray(),
    db.finds.where("permissionId").equals(localPermissionId).toArray(),
  ]);

  const referencedFieldIds = new Set<string>();
  existingSessions.forEach(s => { if (s.fieldId) referencedFieldIds.add(s.fieldId); });
  existingFinds.forEach(f => { if (f.fieldId) referencedFieldIds.add(f.fieldId); });

  const removableStaleFieldIds = existingFields
    .filter(f => !incomingFieldIds.has(f.id) && !referencedFieldIds.has(f.id))
    .map(f => f.id);

  await db.permissions.update(localPermissionId, {
    name: pack.eventName,
    type: "rally",
    collector: pack.organiserName ?? "",
    boundary: pack.boundary as any,
    notes: pack.publicNotes ?? "",
    validFrom: pack.eventDate,
    organiserContactNumber: pack.organiserContactNumber,
    organiserEmail: pack.organiserEmail,
    significantFindInstructions: pack.significantFindInstructions,
    clubDayPublicNotes: pack.publicNotes,
    sharedPermissionId: pack.sharedPermissionId,
    isClubDayMember: true,
    updatedAt: now,
  });

  if (removableStaleFieldIds.length > 0) {
    await db.fields.bulkDelete(removableStaleFieldIds);
  }
  if (fieldRecords.length > 0) {
    await db.fields.bulkPut(fieldRecords);
  }
}

/**
 * Member: imports a Club Day Pack and creates a read-only synthetic permission.
 * The synthetic permission keeps sharedPermissionId as the merge anchor so
 * sessions/finds recorded against it can be merged back by the organiser.
 */
export async function importClubDayPack(json: string): Promise<ClubDayImportResult> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("Invalid Club Day Pack: could not parse file.");
  }

  const pack = normalizeClubDayPack(parsed);
  if (!pack) {
    throw new Error("This file is not a Club Day Pack.");
  }

  // Duplicate check: hash first (exact match), then by sharedPermissionId (re-scan)
  const hash = await hashString(json);
  const existingByHash = await db.importedPackages.where("packageHash").equals(hash).first();
  if (existingByHash) {
    const existingPermission = await db.permissions
      .filter(p => !!p.isClubDayMember && p.sharedPermissionId === pack.sharedPermissionId)
      .first();
    return { eventName: pack.eventName, eventDate: pack.eventDate, alreadyImported: true, permissionId: existingPermission?.id };
  }

  // Check if already joined (different hash each scan due to fresh createdAt)
  const existingPermission = await db.permissions
    .filter(p => !!p.isClubDayMember && p.sharedPermissionId === pack.sharedPermissionId)
    .first();
  if (existingPermission) {
    const now = new Date().toISOString();
    const existingJoinRecord = await db.importedPackages
      .filter(p => p.sharedPermissionId === pack.sharedPermissionId && !p.recorderId)
      .first();

    await db.transaction("rw", [db.permissions, db.fields, db.sessions, db.finds, db.importedPackages], async () => {
      await applyClubDayPackToLocalPermission(existingPermission.id, existingPermission.projectId, pack, now);
      await db.importedPackages.put({
        id: existingJoinRecord?.id ?? uuid(),
        packageHash: hash,
        importedAt: now,
        sharedPermissionId: pack.sharedPermissionId,
      } as ImportedPackage);
    });

    return { eventName: pack.eventName, eventDate: pack.eventDate, alreadyImported: false, updatedExisting: true, permissionId: existingPermission.id };
  }

  const project = await db.projects.toCollection().first();
  if (!project) throw new Error("No project found on this device.");

  const now = new Date().toISOString();
  // Use a local UUID for the permission record — sharedPermissionId is the merge anchor,
  // not the local record ID. This avoids conflating local identity with event identity.
  const localPermissionId = uuid();

  await db.transaction("rw", [db.permissions, db.fields, db.sessions, db.finds], async () => {
    // Create synthetic read-only permission from pack data
    await db.permissions.put({
      id: localPermissionId,
      projectId: project.id,
      name: pack.eventName,
      type: "rally",
      lat: null,
      lon: null,
      gpsAccuracyM: null,
      collector: pack.organiserName ?? "",
      landType: "other",
      permissionGranted: true,
      boundary: pack.boundary as any,
      notes: pack.publicNotes ?? "",
      validFrom: pack.eventDate,
      organiserContactNumber: pack.organiserContactNumber,
      organiserEmail: pack.organiserEmail,
      significantFindInstructions: pack.significantFindInstructions,
      clubDayPublicNotes: pack.publicNotes,
      sharedPermissionId: pack.sharedPermissionId,
      isClubDayMember: true,
      createdAt: now,
      updatedAt: now,
    });

    // Import the selected fields, re-keyed to the synthetic permission
    await applyClubDayPackToLocalPermission(localPermissionId, project.id, pack, now);
  });

  // Record the import to prevent duplicates
  await db.importedPackages.put({
    id: uuid(),
    packageHash: hash,
    importedAt: now,
    sharedPermissionId: pack.sharedPermissionId,
  } as ImportedPackage);

  return { eventName: pack.eventName, eventDate: pack.eventDate, alreadyImported: false, permissionId: localPermissionId };
}

export type ClubDayExport = {
  type: "findspot-club-day-export";
  version: 1;
  sharedPermissionId: string;
  recorderId: string;
  recorderName: string;
  exportedAt: string;
  sessions: object[];
  finds: object[];
  significantFinds?: object[];
  media: object[];
};

/**
 * Member: exports their sessions and finds for a specific Club Day permission.
 * Only data linked to that sharedPermissionId is included.
 */
export async function exportClubDayData(sharedPermissionId: string, nameOverride?: string): Promise<string> {
  const recorderId = await getOrCreateRecorderId();

  // Find the local synthetic permission for this event to get the correct local permissionId
  const localPermission = await db.permissions
    .filter(p => !!p.isClubDayMember && p.sharedPermissionId === sharedPermissionId)
    .first();
  if (!localPermission) throw new Error("Not a Club Day permission — cannot export.");

  const sessions = await db.sessions
    .where("permissionId").equals(localPermission.id)
    .toArray();

  const finds = await db.finds
    .where("permissionId").equals(localPermission.id)
    .toArray();

  const significantFinds = await db.significantFinds
    .where("permissionId").equals(localPermission.id)
    .toArray();

  // Prefer recorder name already stamped on sessions (recorded at detection time),
  // then the modal override, then current settings — avoids mid-event name change drift.
  const sessionRecorderName = (sessions as any[]).find(s => s.recorderName)?.recorderName as string | undefined;
  const recorderName = nameOverride?.trim() || sessionRecorderName || await getSetting<string>("recorderName", "Unnamed detectorist");

  const findIds = new Set(finds.map(f => f.id));
  const significantFindIds = new Set(significantFinds.map(f => f.id));
  const allMedia = await db.media.toArray();
  const relatedMedia = allMedia.filter(m => m.findId && (findIds.has(m.findId) || significantFindIds.has(m.findId)));

  const mediaExport = await Promise.all(
    relatedMedia.map(async m => ({ ...m, blob: await blobToBase64(m.blob) }))
  );

  const exportData: ClubDayExport = {
    type: "findspot-club-day-export",
    version: 1,
    sharedPermissionId,
    recorderId,
    recorderName,
    exportedAt: new Date().toISOString(),
    sessions,
    finds,
    significantFinds,
    media: mediaExport,
  };

  return JSON.stringify(exportData, null, 2);
}

export type ClubDayMergeResult = {
  permissionId: string;
  sharedPermissionId: string;
  recorderName: string;
  newSessions: number;
  newFinds: number;
  newSignificantFinds: number;
  alreadyPresent: number;
};

// ─── Import validation ────────────────────────────────────────────────────

const MAX_IMPORT_JSON_BYTES = 50 * 1024 * 1024; // 50 MB
const MAX_IMPORT_RECORDS = 5_000;
const MAX_MEDIA_BLOB_BYTES = 10 * 1024 * 1024; // 10 MB per blob
const ID_MAX_LEN = 128;

function validateClubDayExport(raw: string): ClubDayExport {
  if (raw.length > MAX_IMPORT_JSON_BYTES) {
    throw new Error("Import file is too large.");
  }

  let data: any;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error("Invalid Club Day export: could not parse file.");
  }

  if (!data || typeof data !== "object") throw new Error("Invalid export: not an object.");
  if (data.type !== "findspot-club-day-export") throw new Error("This file is not a Club Day export.");
  if (typeof data.sharedPermissionId !== "string" || !data.sharedPermissionId) throw new Error("Missing sharedPermissionId.");
  if (typeof data.recorderId !== "string" || !data.recorderId) throw new Error("Missing recorderId.");
  if (typeof data.recorderName !== "string") throw new Error("Missing recorderName.");

  if (!Array.isArray(data.sessions)) throw new Error("Invalid export: sessions is not an array.");
  if (!Array.isArray(data.finds)) throw new Error("Invalid export: finds is not an array.");
  if (!Array.isArray(data.media)) throw new Error("Invalid export: media is not an array.");
  if (data.significantFinds !== undefined && !Array.isArray(data.significantFinds)) throw new Error("Invalid export: significantFinds is not an array.");

  const totalRecords = data.sessions.length + data.finds.length + (data.significantFinds?.length ?? 0) + data.media.length;
  if (totalRecords > MAX_IMPORT_RECORDS) throw new Error(`Import contains ${totalRecords} records — maximum is ${MAX_IMPORT_RECORDS}.`);

  // Validate IDs and basic structure
  const allIds = new Set<string>();
  function checkId(id: unknown, label: string) {
    if (typeof id !== "string" || id.length === 0 || id.length > ID_MAX_LEN) throw new Error(`Invalid ${label} ID: ${String(id)}`);
    if (allIds.has(id)) throw new Error(`Duplicate ID in import: ${id}`);
    allIds.add(id);
  }

  for (const s of data.sessions) {
    if (!s || typeof s !== "object") throw new Error("Invalid session record.");
    checkId(s.id, "session");
  }
  for (const f of data.finds) {
    if (!f || typeof f !== "object") throw new Error("Invalid find record.");
    checkId(f.id, "find");
    if (f.lat != null && (typeof f.lat !== "number" || f.lat < -90 || f.lat > 90)) throw new Error("Invalid find latitude.");
    if (f.lon != null && (typeof f.lon !== "number" || f.lon < -180 || f.lon > 180)) throw new Error("Invalid find longitude.");
  }
  for (const sf of (data.significantFinds ?? [])) {
    if (!sf || typeof sf !== "object") throw new Error("Invalid significant find record.");
    checkId(sf.id, "significantFind");
  }
  const mediaOwnerIds = new Set<string>([
    ...data.finds.map((f: any) => f.id),
    ...(data.significantFinds ?? []).map((sf: any) => sf.id),
  ]);
  for (const m of data.media) {
    if (!m || typeof m !== "object") throw new Error("Invalid media record.");
    checkId(m.id, "media");
    if (typeof m.findId !== "string" || m.findId.length === 0 || m.findId.length > ID_MAX_LEN) {
      throw new Error("Invalid media find reference.");
    }
    if (!mediaOwnerIds.has(m.findId)) throw new Error("Media references a missing find.");
    if (typeof m.blob !== "string") throw new Error("Invalid media blob.");
    if (m.blob.length > MAX_MEDIA_BLOB_BYTES * 1.37) {
      throw new Error("Media blob exceeds size limit.");
    }
  }

  return data as ClubDayExport;
}

/**
 * Organiser: merges a member's Club Day export into the local database.
 * Matches by sharedPermissionId. Uses upsert — existing records are kept.
 */
export async function mergeClubDayData(json: string): Promise<ClubDayMergeResult> {
  const data = validateClubDayExport(json);

  // Duplicate check
  const hash = await hashString(json);
  const existingImport = await db.importedPackages.where("packageHash").equals(hash).first();
  if (existingImport) {
    throw new Error("ALREADY_IMPORTED");
  }

  // Verify the organiser has this shared permission
  const permission = await db.permissions
    .filter(p => p.sharedPermissionId === data.sharedPermissionId)
    .first();
  if (!permission) {
    throw new Error("No matching shared permission found on this device. Make sure you're importing into the organiser's device.");
  }

  // Dedup against all sessions/finds already under the organiser's permission
  // (includes their own sessions + any previously imported member sessions).
  const existingSessions = await db.sessions
    .where("permissionId").equals(permission.id)
    .toArray();
  const existingFinds = await db.finds
    .where("permissionId").equals(permission.id)
    .toArray();
  const existingSignificantFinds = await db.significantFinds
    .where("permissionId").equals(permission.id)
    .toArray();

  const existingSessionIds = new Set(existingSessions.map(s => s.id));
  const existingFindIds = new Set(existingFinds.map(f => f.id));
  const existingSignificantFindIds = new Set(existingSignificantFinds.map(f => f.id));

  const incomingSessions = data.sessions as any[];
  const incomingFinds = data.finds as any[];
  const incomingSignificantFinds = (data.significantFinds ?? []) as any[];

  const newSessions = incomingSessions.filter(s => !existingSessionIds.has(s.id));
  const newFinds = incomingFinds.filter(f => !existingFindIds.has(f.id));
  const newSignificantFinds = incomingSignificantFinds.filter(f => !existingSignificantFindIds.has(f.id));
  const alreadyPresent =
    incomingSessions.length + incomingFinds.length + incomingSignificantFinds.length -
    newSessions.length - newFinds.length - newSignificantFinds.length;

  // ── ID collision guard ──────────────────────────────────────────────────
  // Check incoming IDs against the *entire* database, not just the target
  // permission, to prevent cross-permission overwrites via bulkPut.
  const idMap = new Map<string, string>(); // oldId → newId (only for collisions)

  async function remapIfCollides(id: string, table: { get(id: string): Promise<any> }, checkOwnership = true): Promise<string> {
    const existing = await table.get(id);
    if (existing && (!checkOwnership || existing.permissionId !== permission!.id)) {
      const newId = uuid();
      idMap.set(id, newId);
      return newId;
    }
    return id;
  }

  for (const s of newSessions) {
    s.id = await remapIfCollides(s.id, db.sessions);
  }
  for (const f of newFinds) {
    f.id = await remapIfCollides(f.id, db.finds);
    // Rewrite sessionId reference if session was remapped
    if (f.sessionId && idMap.has(f.sessionId)) f.sessionId = idMap.get(f.sessionId)!;
  }
  for (const sf of newSignificantFinds) {
    sf.id = await remapIfCollides(sf.id, db.significantFinds);
    if (sf.sessionId && idMap.has(sf.sessionId)) sf.sessionId = idMap.get(sf.sessionId)!;
    if (sf.findId && idMap.has(sf.findId)) sf.findId = idMap.get(sf.findId)!;
  }

  // Normalise to organiser's permission so merged records appear in their session list,
  // the session page resolves the permission correctly, and a single query covers all data.
  const fixedSessions = newSessions.map((s: any) => ({ ...s, projectId: permission.projectId, permissionId: permission.id }));
  const fixedFinds = newFinds.map((f: any) => ({ ...f, projectId: permission.projectId, permissionId: permission.id }));
  const fixedSignificantFinds = newSignificantFinds.map((f: any) => ({ ...f, projectId: permission.projectId, permissionId: permission.id }));

  // Convert base64 blobs BEFORE opening the transaction — fetch() is not an
  // IndexedDB operation and awaiting it inside a transaction causes IDB to
  // auto-commit, silently dropping everything written afterwards.
  // Media rows often lack permissionId, so use find-level ownership instead:
  // only remap when the existing media points to a different find.
  const mediaItems: Media[] = data.media?.length
    ? await Promise.all((data.media as any[]).map(async m => {
        // Resolve the final findId first so we can compare ownership
        const fixedFindId = m.findId && idMap.has(m.findId) ? idMap.get(m.findId)! : m.findId;
        const existing = await db.media.get(m.id);
        const remappedId = existing && existing.findId !== fixedFindId ? uuid() : m.id;
        if (remappedId !== m.id) idMap.set(m.id, remappedId);
        const fixedM = { ...m, id: remappedId, findId: fixedFindId };
        if (fixedM.sessionId && idMap.has(fixedM.sessionId)) fixedM.sessionId = idMap.get(fixedM.sessionId)!;
        if (fixedM.significantFindId && idMap.has(fixedM.significantFindId)) fixedM.significantFindId = idMap.get(fixedM.significantFindId)!;
        return { ...fixedM, blob: await base64ToBlob(fixedM.blob) };
      }))
    : [];

  // Upsert by recorderId so re-exports from the same member don't create duplicate rows
  const existingEntry = data.recorderId
    ? await db.importedPackages.filter(p => p.sharedPermissionId === data.sharedPermissionId && p.recorderId === data.recorderId).first()
    : undefined;

  await db.transaction("rw", [db.sessions, db.finds, db.significantFinds, db.media, db.importedPackages], async () => {
    if (fixedSessions.length > 0) await db.sessions.bulkPut(fixedSessions);
    if (fixedFinds.length > 0) await db.finds.bulkPut(fixedFinds);
    if (fixedSignificantFinds.length > 0) await db.significantFinds.bulkPut(fixedSignificantFinds as SignificantFind[]);
    if (mediaItems.length > 0) await db.media.bulkPut(mediaItems);
    await db.importedPackages.put({
      id: existingEntry?.id ?? uuid(),
      packageHash: hash,
      importedAt: new Date().toISOString(),
      sharedPermissionId: data.sharedPermissionId,
      recorderId: data.recorderId,
      recorderName: data.recorderName || "Unnamed detectorist",
    } as ImportedPackage);
  });

  return {
    permissionId: permission.id,
    sharedPermissionId: data.sharedPermissionId,
    recorderName: data.recorderName || "Unnamed detectorist",
    newSessions: newSessions.length,
    newFinds: newFinds.length,
    newSignificantFinds: newSignificantFinds.length,
    alreadyPresent,
  };
}

async function hashString(str: string): Promise<string> {
  const buffer = new TextEncoder().encode(str);
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}
