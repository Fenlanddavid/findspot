import { db, Media, Field, ImportedPackage, SignificantFind } from "../db";
import { v4 as uuid } from "uuid";
import {
  FINDSPOT_COPYRIGHT_NOTICE,
  REPORT_PROTECTION_NOTICE,
  TERMS_OF_USE_VERSION,
} from "../utils/legalCopy";

export async function markExternalBackupSaved() {
  const now = new Date().toISOString();
  await db.settings.put({ key: "lastBackupDate", value: now });
  return now;
}

// Threshold above which a media-included export triggers a UI size warning.
export const MEDIA_EXPORT_WARN_BYTES = 150 * 1024 * 1024; // 150 MB (base64-inflated estimate)

export async function estimateMediaSizeBytes(): Promise<{ count: number; bytes: number }> {
  const media = await db.media.toArray();
  // Sum raw blob sizes. Base64 encoding adds ~37% overhead; caller multiplies if needed.
  const bytes = media.reduce((sum, m) => sum + (m.blob instanceof Blob ? m.blob.size : 0), 0);
  return { count: media.length, bytes };
}

export async function exportData(options: { includeMedia?: boolean } = {}): Promise<string> {
  // Default is data-only to avoid OOM on mobile when photo libraries are large.
  // Pass { includeMedia: true } explicitly to include photos.
  const includeMedia = options.includeMedia === true;

  const projects = await db.projects.toArray();
  const permissions = await db.permissions.toArray();
  const sessions = await db.sessions.toArray();
  const finds = await db.finds.toArray();
  const tracks = await db.tracks.toArray();
  const settings = await db.settings.toArray();
  const importedPackages = await db.importedPackages.toArray();
  const fields = await db.fields.toArray();
  const significantFinds = await db.significantFinds.toArray();
  const savedPoints = await db.savedPoints.toArray();

  let mediaExport: any[] = [];
  if (includeMedia) {
    const media = await db.media.toArray();
    mediaExport = await Promise.all(media.map(async (m) => ({
      ...m,
      blob: await blobToBase64(m.blob)
    })));
  }

  const data = {
    version: 4,
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
    media: mediaExport,
    settings,
    importedPackages,
    savedPoints,
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

type BackupData = {
  projects: any[];
  permissions: any[];
  fields: any[];
  sessions: any[];
  finds: any[];
  significantFinds: any[];
  tracks: any[];
  media: any[];
  settings: any[];
  importedPackages: any[];
  savedPoints: any[];
};

function requireArray(data: any, key: keyof BackupData, required = false): any[] {
  const value = data[key];
  if (value === undefined || value === null) {
    if (required) throw new Error(`Invalid format: missing ${key}`);
    return [];
  }
  if (!Array.isArray(value)) throw new Error(`Invalid format: ${key} must be an array`);
  return value;
}

function assertRowsHaveId(rows: any[], table: string) {
  rows.forEach((row, index) => {
    if (!row || typeof row !== "object" || typeof row.id !== "string" || !row.id.trim()) {
      throw new Error(`Invalid format: ${table}[${index}] is missing an id`);
    }
  });
}

export function validateBackupData(data: any): BackupData {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Invalid backup file: expected an object.");
  }

  const backup: BackupData = {
    projects: requireArray(data, "projects", true),
    permissions: requireArray(data, "permissions"),
    fields: requireArray(data, "fields"),
    sessions: requireArray(data, "sessions"),
    finds: requireArray(data, "finds"),
    significantFinds: requireArray(data, "significantFinds"),
    tracks: requireArray(data, "tracks"),
    media: requireArray(data, "media"),
    settings: requireArray(data, "settings"),
    importedPackages: requireArray(data, "importedPackages"),
    savedPoints: requireArray(data, "savedPoints"),
  };

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

  const projectIds = new Set(backup.projects.map(p => p.id));
  const permissionIds = new Set(backup.permissions.map(p => p.id));
  const sessionIds = new Set(backup.sessions.map(s => s.id));
  const findIds = new Set(backup.finds.map(f => f.id));
  const significantFindIds = new Set(backup.significantFinds.map(f => f.id));

  backup.permissions.forEach((permission, index) => {
    if (!projectIds.has(permission.projectId)) {
      throw new Error(`Invalid format: permissions[${index}] references an unknown project`);
    }
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
    if (typeof media.blob !== "string" || !media.blob.startsWith("data:")) {
      throw new Error(`Invalid format: media[${index}] has an invalid blob`);
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

  return backup;
}

export async function importData(json: string) {
  let data: any;
  try {
    data = JSON.parse(json);
  } catch {
    throw new Error("Invalid backup file: could not parse JSON.");
  }

  const backup = validateBackupData(data);

  // Convert base64 blobs BEFORE opening the transaction — fetch() is not an
  // IndexedDB operation and awaiting it inside a transaction causes IDB to
  // auto-commit, silently dropping everything written afterwards.
  const mediaItems: Media[] = backup.media.length
    ? await Promise.all(backup.media.map(async (m: any) => ({
        ...m,
        blob: await base64ToBlob(m.blob)
      })))
    : [];

  await db.transaction("rw", [db.projects, db.permissions, db.fields, db.sessions, db.finds, db.significantFinds, db.media, db.tracks, db.settings, db.importedPackages, db.savedPoints], async () => {
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

    await db.projects.bulkPut(backup.projects);
    if (backup.permissions.length) await db.permissions.bulkPut(backup.permissions);
    if (backup.fields.length) await db.fields.bulkPut(backup.fields);
    if (backup.sessions.length) await db.sessions.bulkPut(backup.sessions);
    if (backup.finds.length) await db.finds.bulkPut(backup.finds);
    if (backup.significantFinds.length) await db.significantFinds.bulkPut(backup.significantFinds as SignificantFind[]);
    if (backup.tracks.length) await db.tracks.bulkPut(backup.tracks);
    if (backup.settings.length) await db.settings.bulkPut(backup.settings);
    if (backup.importedPackages.length) await db.importedPackages.bulkPut(backup.importedPackages);
    if (mediaItems.length) await db.media.bulkPut(mediaItems as Media[]);
    if (backup.savedPoints.length) await db.savedPoints.bulkPut(backup.savedPoints);
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
    organiserName: permission.collector || undefined,
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

  // Normalise to organiser's permission so merged records appear in their session list,
  // the session page resolves the permission correctly, and a single query covers all data.
  const fixedSessions = newSessions.map((s: any) => ({ ...s, projectId: permission.projectId, permissionId: permission.id }));
  const fixedFinds = newFinds.map((f: any) => ({ ...f, projectId: permission.projectId, permissionId: permission.id }));
  const fixedSignificantFinds = newSignificantFinds.map((f: any) => ({ ...f, projectId: permission.projectId, permissionId: permission.id }));

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
