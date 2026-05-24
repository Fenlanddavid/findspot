import { db } from "../db";
import {
  computeRallyDayReview,
  RallyDayReview,
  RallyReviewField,
  RallyReviewPoint,
  RallyReviewSession,
  RallyReviewTrack,
} from "../utils/rallyDayReviewEngine";

export async function loadRallyDayReview(permissionId: string): Promise<RallyDayReview> {
  const [finds, sessions, fields, importedPackages] = await Promise.all([
    db.finds.where("permissionId").equals(permissionId).filter(f => !f.isPending).toArray(),
    db.sessions.where("permissionId").equals(permissionId).toArray(),
    db.fields.where("permissionId").equals(permissionId).toArray(),
    db.permissions.get(permissionId).then(permission => {
      if (!permission?.sharedPermissionId) return [];
      return db.importedPackages.where("sharedPermissionId").equals(permission.sharedPermissionId).toArray();
    }),
  ]);

  const sessionIds = sessions.map(s => s.id);
  const tracks = sessionIds.length > 0
    ? await db.tracks.where("sessionId").anyOf(sessionIds).toArray()
    : [];

  return computeRallyDayReview({
    finds: finds.map((find): RallyReviewPoint => ({
      id: find.id,
      lat: find.lat,
      lon: find.lon,
      fieldId: find.fieldId,
      recorderId: find.recorderId,
      recorderName: find.recorderName,
      objectType: find.objectType,
      findCategory: find.findCategory,
      period: find.period,
      material: find.material,
      createdAt: find.createdAt,
      foundAt: find.foundAt,
    })),
    sessions: sessions.map((session): RallyReviewSession => ({
      id: session.id,
      fieldId: session.fieldId,
      recorderId: session.recorderId,
      recorderName: session.recorderName,
    })),
    tracks: tracks.map((track): RallyReviewTrack => ({
      sessionId: track.sessionId,
      points: track.points ?? [],
    })),
    fields: fields.map((field): RallyReviewField => ({
      id: field.id,
      name: field.name,
    })),
    importedRecorderCount: new Set(importedPackages.map(pkg => pkg.recorderId || pkg.recorderName || pkg.id)).size,
  });
}
