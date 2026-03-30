import { db, Permission, Field, Track } from "../db";
import { calculateCoverage } from "./coverage";

export type EnrichedPermission = Permission & {
  fields: Field[];
  cumulativePercent: number | null;
  tracks: Track[];
  sessionCount: number;
  lastSessionDate: string | null;
};

/**
 * Enriches a list of permissions with fields, sessions, tracks, coverage %,
 * and coordinate fallbacks. Uses 4 batched queries regardless of how many
 * permissions are in the list, avoiding the previous N+1 pattern.
 */
export async function enrichPermissions(
  projectId: string,
  rows: Permission[]
): Promise<EnrichedPermission[]> {
  if (rows.length === 0) return [];

  const permissionIds = rows.map(p => p.id);

  const [allFields, allSessions, allTracks, allFinds] = await Promise.all([
    db.fields.where("permissionId").anyOf(permissionIds).toArray(),
    db.sessions.where("permissionId").anyOf(permissionIds).toArray(),
    db.tracks.where("projectId").equals(projectId).toArray(),
    db.finds.where("permissionId").anyOf(permissionIds).toArray(),
  ]);

  // Group everything in memory
  const fieldsByPermission = new Map<string, Field[]>();
  for (const f of allFields) {
    if (!fieldsByPermission.has(f.permissionId)) fieldsByPermission.set(f.permissionId, []);
    fieldsByPermission.get(f.permissionId)!.push(f);
  }

  const sessionsByPermission = new Map<string, typeof allSessions>();
  for (const s of allSessions) {
    if (!sessionsByPermission.has(s.permissionId)) sessionsByPermission.set(s.permissionId, []);
    sessionsByPermission.get(s.permissionId)!.push(s);
  }

  // Most recent find per permission for coordinate fallback
  const sortedFinds = [...allFinds].sort((a, b) => {
    const bDate = b?.createdAt || "";
    const aDate = a?.createdAt || "";
    return bDate.localeCompare(aDate);
  });
  const recentFindByPermission = new Map<string, typeof allFinds[0]>();
  for (const f of sortedFinds) {
    if (!recentFindByPermission.has(f.permissionId)) recentFindByPermission.set(f.permissionId, f);
  }

  return rows.map(p => {
    const fields = fieldsByPermission.get(p.id) ?? [];
    const sessions = sessionsByPermission.get(p.id) ?? [];
    const sessionIds = new Set(sessions.map(s => s.id));
    const permissionTracks = allTracks.filter(t => t.sessionId && sessionIds.has(t.sessionId));
    const unassignedSessionIds = new Set(sessions.filter(s => !s.fieldId).map(s => s.id));

    // Sort sessions to find the latest date
    const lastSessionDate = sessions.length > 0 
      ? [...sessions].sort((a, b) => b.date.localeCompare(a.date))[0].date 
      : null;

    let totalAreaM2 = 0;
    let totalDetectedM2 = 0;

    for (const f of fields) {
      const fieldSessionIds = new Set(sessions.filter(s => s.fieldId === f.id).map(s => s.id));
      const fieldTracks = permissionTracks.filter(t =>
        t.sessionId && (fieldSessionIds.has(t.sessionId) || unassignedSessionIds.has(t.sessionId))
      );
      const result = calculateCoverage(f.boundary, fieldTracks);
      if (result) {
        totalAreaM2 += result.totalAreaM2;
        totalDetectedM2 += result.detectedAreaM2;
      }
    }

    const cumulativePercent = totalAreaM2 > 0 ? (totalDetectedM2 / totalAreaM2) * 100 : null;

    // Multi-layered coordinate fallback
    let lat = typeof p.lat === "number" ? p.lat : null;
    let lon = typeof p.lon === "number" ? p.lon : null;

    if ((!lat || !lon) && fields.length > 0 && fields[0].boundary?.coordinates?.[0]) {
      const coords = fields[0].boundary.coordinates[0];
      lat = coords[0][1];
      lon = coords[0][0];
    }

    if (!lat || !lon) {
      const recentFind = recentFindByPermission.get(p.id);
      if (recentFind?.lat && recentFind?.lon) {
        lat = recentFind.lat;
        lon = recentFind.lon;
      }
    }

    return { 
      ...p, 
      lat, 
      lon, 
      fields, 
      cumulativePercent, 
      tracks: permissionTracks,
      sessionCount: sessions.length,
      lastSessionDate
    };
  });
}
