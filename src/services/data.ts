import { db, Media } from "../db";

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

  const data = {
    version: 2,
    exportedAt: new Date().toISOString(),
    projects,
    permissions,
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
    "Permission Name", "Permission Type", "Landowner Name", "Landowner Phone", "Landowner Email", "Landowner Address",
    "Latitude", "Longitude", "GPS Accuracy (m)", 
    "Land Type", "Land Use", "Crop Type", "Is Stubble", 
    "Date Observed", "Detectorist", "NCMD No", "NCMD Expiry", "Find Notes", "Permission Notes"
  ];

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
      l?.name ?? "", l?.type ?? "individual", l?.landownerName ?? "", l?.landownerPhone ?? "", l?.landownerEmail ?? "", l?.landownerAddress ?? "",
      s.lat ?? sess?.lat ?? l?.lat ?? "", s.lon ?? sess?.lon ?? l?.lon ?? "", s.gpsAccuracyM ?? sess?.gpsAccuracyM ?? l?.gpsAccuracyM ?? "",
      l?.landType ?? "", sess?.landUse ?? "", sess?.cropType ?? "", sess?.isStubble ? "Yes" : "No",
      sess?.date ? new Date(sess.date).toLocaleString() : (l?.createdAt ? new Date(l.createdAt).toLocaleString() : ""),
      l?.collector ?? "", ncmdNumber, ncmdExpiry, sNotes, lNotes
    ].map(val => `"${String(val).replace(/"/g, '""')}"`);
  });

  return [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
}

export async function importData(json: string) {
  const data = JSON.parse(json);
  
  if (!data.projects || !Array.isArray(data.projects)) throw new Error("Invalid format: missing projects");

  await db.transaction("rw", [db.projects, db.permissions, db.sessions, db.finds, db.media, db.settings], async () => {
    await db.projects.bulkPut(data.projects);
    if(data.permissions) await db.permissions.bulkPut(data.permissions);
    if(data.sessions) await db.sessions.bulkPut(data.sessions);
    if(data.finds) await db.finds.bulkPut(data.finds);
    if(data.settings) await db.settings.bulkPut(data.settings);
    
    if (data.media) {
      const mediaItems = await Promise.all(data.media.map(async (m: any) => ({
        ...m,
        blob: await base64ToBlob(m.blob)
      })));
      await db.media.bulkPut(mediaItems as Media[]);
    }
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