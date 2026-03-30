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
