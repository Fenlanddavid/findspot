import { db } from "../db";
import { v4 as uuid } from "uuid";

export async function ensureDefaultProject(): Promise<string> {
  const existing = await db.projects.toArray();
  if (existing.length > 0) return existing[0].id;

  const id = uuid();
  await db.projects.add({
    id,
    name: "UK Find Log",
    region: "UK",
    createdAt: new Date().toISOString(),
  });

  return id;
}
