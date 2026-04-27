import { db, Media, Field, ImportedPackage } from "../db";
import { v4 as uuid } from "uuid";

export async function exportData(): Promise<string> {
  const projects = await db.projects.toArray();
  const permissions = await db.permissions.toArray();
  const sessions = await db.sessions.toArray();
  const finds = await db.finds.toArray();
  const settings = await db.settings.toArray();
  
  const media = await db.media.toArray();
  const mediaExport = await Promise.all(media.map(async (m) => {
    return {
      ...m,
      blob: await blobToBase64(m.blob)
    };
  }));

  const fields = await db.fields.toArray();

  const data = {
    version: 2,
    exportedAt: new Date().toISOString(),
    projects,
    permissions,
    fields,
    sessions,
    finds,
    media: mediaExport,
    settings
  };

  return JSON.stringify(data, null, 2);
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

export async function importData(json: string) {
  let data: any;
  try {
    data = JSON.parse(json);
  } catch {
    throw new Error("Invalid backup file: could not parse JSON.");
  }

  if (!data.projects || !Array.isArray(data.projects)) throw new Error("Invalid format: missing projects");

  // Convert base64 blobs BEFORE opening the transaction — fetch() is not an
  // IndexedDB operation and awaiting it inside a transaction causes IDB to
  // auto-commit, silently dropping everything written afterwards.
  const mediaItems: Media[] = data.media
    ? await Promise.all(data.media.map(async (m: any) => ({
        ...m,
        blob: await base64ToBlob(m.blob)
      })))
    : [];

  await db.transaction("rw", [db.projects, db.permissions, db.fields, db.sessions, db.finds, db.media, db.settings], async () => {
    await db.projects.bulkPut(data.projects);
    if (data.permissions) await db.permissions.bulkPut(data.permissions);
    if (data.fields) await db.fields.bulkPut(data.fields);
    if (data.sessions) await db.sessions.bulkPut(data.sessions);
    if (data.finds) await db.finds.bulkPut(data.finds);
    if (data.settings) await db.settings.bulkPut(data.settings);
    if (mediaItems.length) await db.media.bulkPut(mediaItems as Media[]);
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
 * Checks if storage is already persistent
 */
export async function isStoragePersistent() {
  if (navigator.storage && navigator.storage.persisted) {
    return await navigator.storage.persisted();
  }
  return false;
}

/**
 * Requests persistent storage from the browser
 */
export async function requestPersistentStorage() {
  if (navigator.storage && navigator.storage.persist) {
    const isPersisted = await navigator.storage.persist();
    console.log(`Persisted storage granted: ${isPersisted}`);
    return isPersisted;
  }
  return false;
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
  boundary?: object;
  fields: Field[];
  createdAt: string;
};

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

  if (!permission.sharedPermissionId) {
    await db.permissions.update(permissionId, {
      sharedPermissionId,
      isSharedPermission: true,
      updatedAt: now,
    });
  } else if (!permission.isSharedPermission) {
    await db.permissions.update(permissionId, {
      isSharedPermission: true,
      updatedAt: now,
    });
  }

  const allFields = await db.fields.where("permissionId").equals(permissionId).toArray();
  const selectedFields = allFields.filter(f => selectedFieldIds.includes(f.id));

  const pack: ClubDayPack = {
    type: "findspot-club-day-pack",
    version: 1,
    sharedPermissionId,
    eventName: permission.name,
    eventDate: permission.validFrom ?? now.slice(0, 10),
    organiserName: permission.collector || undefined,
    organiserContactNumber: permission.organiserContactNumber,
    organiserEmail: permission.organiserEmail,
    significantFindInstructions: permission.significantFindInstructions,
    publicNotes: permission.clubDayPublicNotes,
    boundary: permission.boundary,
    fields: selectedFields,
    createdAt: now,
  };

  return JSON.stringify(pack, null, 2);
}

export type ClubDayImportResult = {
  eventName: string;
  eventDate: string;
  alreadyImported: boolean;
};

/**
 * Member: imports a Club Day Pack and creates a read-only synthetic permission.
 * The synthetic permission's ID = sharedPermissionId so sessions/finds
 * recorded against it can be merged back by the organiser.
 */
export async function importClubDayPack(json: string): Promise<ClubDayImportResult> {
  let pack: ClubDayPack;
  try {
    pack = JSON.parse(json);
  } catch {
    throw new Error("Invalid Club Day Pack: could not parse file.");
  }

  if (pack.type !== "findspot-club-day-pack") {
    throw new Error("This file is not a Club Day Pack.");
  }

  // Duplicate check: hash first (exact match), then by sharedPermissionId (re-scan)
  const hash = await hashString(json);
  const existingByHash = await db.importedPackages.where("packageHash").equals(hash).first();
  if (existingByHash) {
    return { eventName: pack.eventName, eventDate: pack.eventDate, alreadyImported: true };
  }

  // Check if already joined (different hash each scan due to fresh createdAt)
  const existingPermission = await db.permissions
    .filter(p => !!(p as any).isClubDayMember && p.sharedPermissionId === pack.sharedPermissionId)
    .first();
  if (existingPermission) {
    return { eventName: pack.eventName, eventDate: pack.eventDate, alreadyImported: true };
  }

  const project = await db.projects.toCollection().first();
  if (!project) throw new Error("No project found on this device.");

  const now = new Date().toISOString();
  // Use a local UUID for the permission record — sharedPermissionId is the merge anchor,
  // not the local record ID. This avoids conflating local identity with event identity.
  const localPermissionId = uuid();

  {
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
    const fieldRecords = pack.fields.map(f => ({
      ...f,
      permissionId: pack.sharedPermissionId,
    }));
    if (fieldRecords.length > 0) {
      await db.fields.bulkPut(fieldRecords);
    }
  }

  // Record the import to prevent duplicates
  await db.importedPackages.put({
    id: uuid(),
    packageHash: hash,
    importedAt: now,
    sharedPermissionId: pack.sharedPermissionId,
  } as ImportedPackage);

  return { eventName: pack.eventName, eventDate: pack.eventDate, alreadyImported: false };
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
    .filter(p => !!(p as any).isClubDayMember && p.sharedPermissionId === sharedPermissionId)
    .first();
  if (!localPermission) throw new Error("Not a Club Day permission — cannot export.");

  const sessions = await db.sessions
    .where("permissionId").equals(localPermission.id)
    .toArray();

  const finds = await db.finds
    .where("permissionId").equals(localPermission.id)
    .toArray();

  // Prefer recorder name already stamped on sessions (recorded at detection time),
  // then the modal override, then current settings — avoids mid-event name change drift.
  const sessionRecorderName = (sessions as any[]).find(s => s.recorderName)?.recorderName as string | undefined;
  const recorderName = nameOverride?.trim() || sessionRecorderName || await getSetting<string>("recorderName", "Unnamed detectorist");

  const findIds = new Set(finds.map(f => f.id));
  const allMedia = await db.media.toArray();
  const relatedMedia = allMedia.filter(m => m.findId && findIds.has(m.findId));

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
    media: mediaExport,
  };

  return JSON.stringify(exportData, null, 2);
}

export type ClubDayMergeResult = {
  recorderName: string;
  newSessions: number;
  newFinds: number;
  alreadyPresent: number;
};

/**
 * Organiser: merges a member's Club Day export into the local database.
 * Matches by sharedPermissionId. Uses upsert — existing records are kept.
 */
export async function mergeClubDayData(json: string): Promise<ClubDayMergeResult> {
  let data: ClubDayExport;
  try {
    data = JSON.parse(json);
  } catch {
    throw new Error("Invalid Club Day export: could not parse file.");
  }

  if (data.type !== "findspot-club-day-export") {
    throw new Error("This file is not a Club Day export.");
  }

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

  const existingSessionIds = new Set(existingSessions.map(s => s.id));
  const existingFindIds = new Set(existingFinds.map(f => f.id));

  const incomingSessions = data.sessions as any[];
  const incomingFinds = data.finds as any[];

  const newSessions = incomingSessions.filter(s => !existingSessionIds.has(s.id));
  const newFinds = incomingFinds.filter(f => !existingFindIds.has(f.id));
  const alreadyPresent = incomingSessions.length + incomingFinds.length - newSessions.length - newFinds.length;

  // Normalise to organiser's permission so merged records appear in their session list,
  // the session page resolves the permission correctly, and a single query covers all data.
  const fixedSessions = newSessions.map((s: any) => ({ ...s, projectId: permission.projectId, permissionId: permission.id }));
  const fixedFinds = newFinds.map((f: any) => ({ ...f, projectId: permission.projectId, permissionId: permission.id }));

  // Convert base64 blobs BEFORE opening the transaction — fetch() is not an
  // IndexedDB operation and awaiting it inside a transaction causes IDB to
  // auto-commit, silently dropping everything written afterwards.
  const mediaItems: Media[] = data.media?.length
    ? await Promise.all((data.media as any[]).map(async m => ({ ...m, blob: await base64ToBlob(m.blob) })))
    : [];

  // Upsert by recorderId so re-exports from the same member don't create duplicate rows
  const existingEntry = data.recorderId
    ? await db.importedPackages.filter(p => p.sharedPermissionId === data.sharedPermissionId && p.recorderId === data.recorderId).first()
    : undefined;

  await db.transaction("rw", [db.sessions, db.finds, db.media, db.importedPackages], async () => {
    if (fixedSessions.length > 0) await db.sessions.bulkPut(fixedSessions);
    if (fixedFinds.length > 0) await db.finds.bulkPut(fixedFinds);
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
    recorderName: data.recorderName || "Unnamed detectorist",
    newSessions: newSessions.length,
    newFinds: newFinds.length,
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