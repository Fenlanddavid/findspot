import { db } from "../db";
import { v4 as uuid } from "uuid";

let defaultProjectPromise: Promise<string> | null = null;
const defaultPermissionPromises = new Map<string, Promise<void>>();

async function createOrFindDefaultProject(): Promise<string> {
  const existing = await db.projects.toArray();
  const valid = existing.filter(p => p.id && p.name);

  if (valid.length === 0) {
    const id = uuid();
    await db.projects.add({
      id,
      name: "UK Find Log",
      region: "UK",
      createdAt: new Date().toISOString(),
    });
    return id;
  }

  if (valid.length === 1) return valid[0].id;

  // Multiple projects exist — prefer the one that actually has data.
  // This recovers the case where a fresh-install placeholder project was
  // created just before a backup restore, leaving an orphaned empty project
  // alongside the real one and making all finds invisible.
  for (const p of valid) {
    const hasData =
      (await db.permissions.where("projectId").equals(p.id).count()) > 0 ||
      (await db.finds.where("projectId").equals(p.id).count()) > 0;
    if (hasData) return p.id;
  }

  // All projects are empty — return the first valid one (normal first-run path)
  return valid[0].id;
}

export function ensureDefaultProject(): Promise<string> {
  if (!defaultProjectPromise) {
    defaultProjectPromise = createOrFindDefaultProject().catch((error) => {
      defaultProjectPromise = null;
      throw error;
    });
  }
  return defaultProjectPromise;
}

async function createDefaultPermission(projectId: string): Promise<void> {
  const hasDefault = await db.permissions
    .where("projectId").equals(projectId)
    .filter(p => !!p.isDefault)
    .count() > 0;
  if (hasDefault) return;

  // Don't impose a default on existing users who already have real permissions
  const hasReal = await db.permissions
    .where("projectId").equals(projectId)
    .filter(p => !p.isDefault)
    .count() > 0;
  if (hasReal) return;

  const now = new Date().toISOString();
  await db.permissions.add({
    id: uuid(),
    projectId,
    name: "General Detecting",
    type: "individual",
    lat: null,
    lon: null,
    gpsAccuracyM: null,
    collector: "",
    landType: "other",
    permissionGranted: true,
    notes: "",
    isDefault: true,
    createdAt: now,
    updatedAt: now,
  });
}

export function ensureDefaultPermission(projectId: string): Promise<void> {
  const existing = defaultPermissionPromises.get(projectId);
  if (existing) return existing;

  const promise = createDefaultPermission(projectId).catch((error) => {
    defaultPermissionPromises.delete(projectId);
    throw error;
  });
  defaultPermissionPromises.set(projectId, promise);
  return promise;
}
