import {
  db,
  type Field,
  type Find,
  type ImportedPackage,
  type Media,
  type Permission,
  type Session,
  type SignificantFind,
} from "../db";
import { v4 as uuid } from "uuid";
import { blobToBase64, base64ToBlob } from "./backup/mediaEncoding";
import { MAX_BACKUP_RECORDS } from "./backup/schema";
import { validateBackupData } from "./backup/validation";
import {
  compactClubDayPack,
  CLUB_DAY_LIMITS,
  validateClubDayPack,
  type ClubDayPack,
  type ClubDayPackField,
} from "./clubDayValidation";
import { validateClubDayExport } from "./clubDayExportValidation";

export { normalizeClubDayPack } from "./clubDayValidation";
export type { ClubDayPack, ClubDayPackField } from "./clubDayValidation";

export { MAX_BACKUP_RECORDS, validateBackupData };
export { exportData } from "./backup/export";
export type { BackupExportOptions, BackupExportProgress } from "./backup/export";
export {
  drillRestore,
  importData,
  MAX_BACKUP_IN_MEMORY_BYTES,
  MAX_BACKUP_MANIFEST_BYTES,
  MAX_BACKUP_UNCOMPRESSED_BYTES,
  MAX_BACKUP_ZIP_ENTRIES,
  readBackupManifest,
} from "./backup/import";
export type {
  BackupImportOptions,
  BackupImportProgress,
  BackupRecoveryReport,
  BackupRecoveryTableReport,
} from "./backup/import";
export {
  estimateMediaSizeBytes,
  MAX_BACKUP_MEDIA_ENTRY_BYTES,
  MEDIA_EXPORT_WARN_BYTES,
  mediaExt,
} from "./backup/mediaArchive";
export type {
  RawBackupData,
  ValidatedBackupData,
  ValidatedBackupMedia,
} from "./backup/schema";

export async function markExternalBackupSaved() {
  const now = new Date().toISOString();
  await db.transaction('rw', db.settings, async () => {
    await db.settings.put({ key: "lastBackupDate", value: now });
    await db.settings.delete('backupSnoozedUntil');
  });
  return now;
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

export function compactClubDayPackJson(json: string): string {
  return JSON.stringify(compactClubDayPack(validateClubDayPack(JSON.parse(json) as unknown)));
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
  const [existingFields, existingSessions, existingFinds] = await Promise.all([
    db.fields.where("permissionId").equals(localPermissionId).toArray(),
    db.sessions.where("permissionId").equals(localPermissionId).toArray(),
    db.finds.where("permissionId").equals(localPermissionId).toArray(),
  ]);

  const existingBySharedId = new Map(
    existingFields.map(field => [field.sharedFieldId ?? field.id, field]),
  );
  const fieldRecords: Field[] = pack.fields.map(field => {
    const existing = existingBySharedId.get(field.id);
    return {
      id: existing?.id ?? uuid(),
      projectId,
      permissionId: localPermissionId,
      sharedFieldId: field.id,
      name: field.name,
      boundary: field.boundary,
      notes: field.notes ?? "",
      createdAt: existing?.createdAt ?? field.createdAt ?? now,
      updatedAt: field.updatedAt ?? now,
    };
  });

  const incomingFieldIds = new Set(fieldRecords.map(field => field.id));

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
  if (new TextEncoder().encode(json).byteLength > CLUB_DAY_LIMITS.decodedJsonBytes) {
    throw new Error("This Club Day Pack is too large to import.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("Invalid Club Day Pack: could not parse file.");
  }

  let pack: ClubDayPack;
  try {
    pack = validateClubDayPack(parsed);
  } catch {
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

  await db.transaction("rw", [db.permissions, db.fields, db.sessions, db.finds, db.importedPackages], async () => {
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
    await db.importedPackages.put({
      id: uuid(),
      packageHash: hash,
      importedAt: now,
      sharedPermissionId: pack.sharedPermissionId,
    } as ImportedPackage);
  });

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

  const memberFields = await db.fields
    .where("permissionId").equals(localPermission.id)
    .toArray();
  const sharedFieldIds = new Map(
    memberFields.map(field => [field.id, field.sharedFieldId ?? field.id]),
  );
  const sessionsForExport = sessions.map(session => ({
    ...session,
    fieldId: session.fieldId ? sharedFieldIds.get(session.fieldId) ?? null : null,
  }));
  const findsForExport = finds.map(find => ({
    ...find,
    fieldId: find.fieldId ? sharedFieldIds.get(find.fieldId) ?? null : null,
  }));

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
    sessions: sessionsForExport,
    finds: findsForExport,
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
    .filter(p => !!p.isSharedPermission && !p.isClubDayMember && p.sharedPermissionId === data.sharedPermissionId)
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

  const organiserFields = await db.fields.where("permissionId").equals(permission.id).toArray();
  const organiserFieldsBySharedId = new Map(
    organiserFields.map(field => [field.sharedFieldId ?? field.id, field.id]),
  );
  const resolveFieldId = (externalFieldId: string | null): string | null => {
    if (!externalFieldId) return null;
    const localFieldId = organiserFieldsBySharedId.get(externalFieldId);
    if (!localFieldId) throw new Error("Club Day export references a field outside this permission.");
    return localFieldId;
  };

  const existingSessionIds = new Set(existingSessions.map(s => s.id));
  const existingFindIds = new Set(existingFinds.map(f => f.id));
  const existingSignificantFindIds = new Set(existingSignificantFinds.map(f => f.id));

  const incomingSessions: Session[] = data.sessions.map(session => ({
    ...session,
    fieldId: resolveFieldId(session.fieldId),
  }));
  const incomingFinds: Find[] = data.finds.map(find => ({
    ...find,
    fieldId: resolveFieldId(find.fieldId),
  }));
  const incomingSignificantFinds: SignificantFind[] = data.significantFinds.map(find => ({ ...find }));

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
    if (sf.linkedFindId && idMap.has(sf.linkedFindId)) sf.linkedFindId = idMap.get(sf.linkedFindId)!;
    sf.scatterFindIds = sf.scatterFindIds.map(findId => idMap.get(findId) ?? findId);
  }

  // Normalise to organiser's permission so merged records appear in their session list,
  // the session page resolves the permission correctly, and a single query covers all data.
  const fixedSessions: Session[] = newSessions.map(session => ({
    ...session,
    projectId: permission.projectId,
    permissionId: permission.id,
  }));
  const fixedFinds: Find[] = newFinds.map(find => ({
    ...find,
    projectId: permission.projectId,
    permissionId: permission.id,
  }));
  const fixedSignificantFinds: SignificantFind[] = newSignificantFinds.map(find => ({
    ...find,
    projectId: permission.projectId,
    permissionId: permission.id,
  }));

  // Convert base64 blobs BEFORE opening the transaction — fetch() is not an
  // IndexedDB operation and awaiting it inside a transaction causes IDB to
  // auto-commit, silently dropping everything written afterwards.
  // Media rows often lack permissionId, so use find-level ownership instead:
  // only remap when the existing media points to a different find.
  const mediaItems: Media[] = data.media.length
    ? await Promise.all(data.media.map(async media => {
        // Resolve the final findId first so we can compare ownership
        const fixedFindId = idMap.get(media.findId) ?? media.findId;
        const existing = await db.media.get(media.id);
        const remappedId = existing && existing.findId !== fixedFindId ? uuid() : media.id;
        if (remappedId !== media.id) idMap.set(media.id, remappedId);
        return {
          id: remappedId,
          projectId: permission.projectId,
          findId: fixedFindId,
          permissionId: permission.id,
          type: media.type,
          photoType: media.photoType,
          filename: media.filename,
          mime: media.mime,
          blob: await base64ToBlob(media.blob),
          caption: media.caption,
          scalePresent: media.scalePresent,
          pxPerMm: media.pxPerMm,
          createdAt: media.createdAt,
        };
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
