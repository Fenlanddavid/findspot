import { db } from "../db";
import { v4 as uuid } from "uuid";

export async function ensureDefaultProject(): Promise<string> {
  const existing = await db.projects.toArray();
  // Return the first project that has both a valid id and name
  const valid = existing.find(p => p.id && p.name);
  if (valid) return valid.id;

  const id = uuid();
  await db.projects.add({
    id,
    name: "UK Find Log",
    region: "UK",
    createdAt: new Date().toISOString(),
  });

  return id;
}

export async function ensureDefaultPermission(projectId: string): Promise<void> {
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
