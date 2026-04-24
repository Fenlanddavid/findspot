import { db, Permission, Field, Track } from "../db";
import { calculateCoverage } from "./coverage";
import { area as turfArea } from "@turf/turf";

export type EnrichedPermission = Permission & {
  fields: Field[];
  cumulativePercent: number | null;
  totalAcres: number | null;
  tracks: Track[];
  sessionCount: number;
  lastSessionDate: string | null;
  findCount: number;
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

  const [allFields, allSessions, allFinds] = await Promise.all([
    db.fields.where("permissionId").anyOf(permissionIds).toArray(),
    db.sessions.where("permissionId").anyOf(permissionIds).toArray(),
    db.finds.where("permissionId").anyOf(permissionIds).toArray(),
  ]);

  const allSessionIds = allSessions.map(s => s.id);
  const allTracks = allSessionIds.length > 0
    ? await db.tracks.where("sessionId").anyOf(allSessionIds).toArray()
    : [];

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

  // Group finds by permission
  const findsByPermission = new Map<string, typeof allFinds>();
  for (const f of allFinds) {
    if (!findsByPermission.has(f.permissionId)) findsByPermission.set(f.permissionId, []);
    findsByPermission.get(f.permissionId)!.push(f);
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
      ? [...sessions].sort((a, b) => (b.date || "").localeCompare(a.date || ""))[0].date 
      : null;

    let totalAreaM2 = 0;
    let totalDetectedM2 = 0;

    if (fields.length > 0) {
      // Coverage per sub-field
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
    } else if (p.boundary) {
      // No sub-fields — use the permission boundary itself
      const result = calculateCoverage(p.boundary, permissionTracks);
      if (result) {
        totalAreaM2 += result.totalAreaM2;
        totalDetectedM2 += result.detectedAreaM2;
      }
    }

    const cumulativePercent = totalAreaM2 > 0 ? (totalDetectedM2 / totalAreaM2) * 100 : null;

    // Multi-layered coordinate fallback
    let lat = typeof p.lat === "number" ? p.lat : null;
    let lon = typeof p.lon === "number" ? p.lon : null;

    // Fallback 1: derive from permission's own boundary
    if ((!lat || !lon) && p.boundary?.coordinates?.[0]?.[0]) {
      const coords = p.boundary.coordinates[0];
      lon = coords[0][0];
      lat = coords[0][1];
    }

    // Fallback 2: first sub-field boundary
    const fieldWithBoundary = fields.find(f => f.boundary?.coordinates?.[0]);
    if ((!lat || !lon) && fieldWithBoundary) {
      const coords = fieldWithBoundary.boundary.coordinates[0];
      lat = coords[0][1];
      lon = coords[0][0];
    }

    // Fallback 3: most recent find
    if (!lat || !lon) {
      const recentFind = recentFindByPermission.get(p.id);
      if (recentFind?.lat && recentFind?.lon) {
        lat = recentFind.lat;
        lon = recentFind.lon;
      }
    }

    const permissionFinds = findsByPermission.get(p.id) ?? [];
    const findCount = permissionFinds.filter(f => !f.isPending).length;

    const fieldsWithBoundary = fields.filter(f => f.boundary);
    let totalAcres: number | null = null;
    if (fieldsWithBoundary.length > 0) {
      const totalM2 = fieldsWithBoundary.reduce((sum, f) => sum + turfArea(f.boundary), 0);
      totalAcres = totalM2 / 4046.86;
    } else if (p.boundary) {
      totalAcres = turfArea(p.boundary) / 4046.86;
    }

    return {
      ...p,
      lat,
      lon,
      fields,
      cumulativePercent,
      totalAcres,
      tracks: permissionTracks,
      sessionCount: sessions.length,
      lastSessionDate,
      findCount
    };
  });
}
