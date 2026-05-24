export type RallyReviewConfidence = "strong" | "developing" | "tentative";

export type RallyReviewStatus = "empty" | "insufficient" | "ready";

export type RallyReviewPoint = {
  id: string;
  lat: number | null;
  lon: number | null;
  fieldId?: string | null;
  recorderId?: string;
  recorderName?: string;
  objectType?: string;
  findCategory?: string;
  period?: string;
  material?: string;
  createdAt?: string;
  foundAt?: string;
};

export type RallyReviewSession = {
  id: string;
  fieldId?: string | null;
  recorderId?: string;
  recorderName?: string;
};

export type RallyReviewTrack = {
  sessionId: string | null;
  points: Array<{ lat: number; lon: number; timestamp?: number; accuracy?: number }>;
};

export type RallyReviewField = {
  id: string;
  name: string;
};

export type RallyActivityZone = {
  id: string;
  label: string;
  fieldName: string | null;
  center: [number, number];
  bounds: [[number, number], [number, number]];
  findCount: number;
  recorderCount: number;
  dominantRecorderName: string | null;
  dominantRecorderShare: number;
  confidence: RallyReviewConfidence;
  pattern: "concentration" | "linear_scatter";
  radiusM: number;
  spreadM: number;
  topPeriod: { value: string; count: number; share: number } | null;
  topMaterial: { value: string; count: number; share: number } | null;
  topCategory: { value: string; count: number; share: number } | null;
  summary: string;
  caveat: string | null;
};

export type RallyLinearPattern = {
  id: string;
  label: string;
  fieldName: string | null;
  findCount: number;
  recorderCount: number;
  lengthM: number;
  bearingDeg: number;
  confidence: RallyReviewConfidence;
  summary: string;
};

export type RallyQuietArea = {
  fieldId: string;
  fieldName: string;
  sessionCount: number;
  findCount: number;
  recorderCount: number;
  summary: string;
};

export type RallyFieldSummary = {
  fieldId: string | null;
  fieldName: string;
  findCount: number;
  geolocatedFinds: number;
  recorderCount: number;
  topPeriod: { value: string; count: number; share: number } | null;
};

export type RallyDayReview = {
  status: RallyReviewStatus;
  title: string;
  summary: string;
  totalFinds: number;
  geolocatedFinds: number;
  recorderCount: number;
  importedRecorderCount: number;
  trackedSessionCount: number;
  zones: RallyActivityZone[];
  linearPatterns: RallyLinearPattern[];
  quietAreas: RallyQuietArea[];
  fieldSummaries: RallyFieldSummary[];
  caveats: string[];
};

type GeoPoint = RallyReviewPoint & {
  lat: number;
  lon: number;
};

type ProjectedPoint = GeoPoint & {
  x: number;
  y: number;
};

const CLUSTER_RADIUS_M = 45;
const CLUSTER_MIN_POINTS = 3;
const MAX_ZONES = 5;

function isValidGeoFind(f: RallyReviewPoint): f is GeoPoint {
  return (
    typeof f.lat === "number" &&
    typeof f.lon === "number" &&
    Number.isFinite(f.lat) &&
    Number.isFinite(f.lon) &&
    Math.abs(f.lat) <= 90 &&
    Math.abs(f.lon) <= 180
  );
}

function distanceM(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 6371e3;
  const phi1 = a.lat * Math.PI / 180;
  const phi2 = b.lat * Math.PI / 180;
  const dPhi = (b.lat - a.lat) * Math.PI / 180;
  const dLambda = (b.lon - a.lon) * Math.PI / 180;
  const h = Math.sin(dPhi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function centroid(points: GeoPoint[]): { lat: number; lon: number } {
  return {
    lat: points.reduce((sum, p) => sum + p.lat, 0) / points.length,
    lon: points.reduce((sum, p) => sum + p.lon, 0) / points.length,
  };
}

function bounds(points: GeoPoint[]): [[number, number], [number, number]] {
  const lons = points.map(p => p.lon);
  const lats = points.map(p => p.lat);
  return [[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]];
}

function recorderKey(f: { recorderId?: string; recorderName?: string }): string {
  return f.recorderId || f.recorderName?.trim() || "organiser";
}

function recorderLabel(f: { recorderId?: string; recorderName?: string }): string {
  return f.recorderName?.trim() || "Organiser";
}

function countUniqueRecorders(items: Array<{ recorderId?: string; recorderName?: string }>): number {
  return new Set(items.map(recorderKey)).size;
}

function topValue(items: RallyReviewPoint[], key: "period" | "material" | "findCategory" | "objectType"): { value: string; count: number; share: number } | null {
  const counts = new Map<string, number>();
  for (const item of items) {
    const value = String(item[key] || "").trim();
    if (!value || value === "Unknown" || value === "Other") continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  if (!sorted.length) return null;
  const [value, count] = sorted[0];
  return { value, count, share: count / items.length };
}

function majorityField(points: RallyReviewPoint[], fieldNames: Map<string, string>): { id: string | null; name: string | null } {
  const counts = new Map<string, number>();
  for (const p of points) {
    if (!p.fieldId) continue;
    counts.set(p.fieldId, (counts.get(p.fieldId) ?? 0) + 1);
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  if (!sorted.length) return { id: null, name: null };
  const [id] = sorted[0];
  return { id, name: fieldNames.get(id) ?? null };
}

function project(points: GeoPoint[]): ProjectedPoint[] {
  const c = centroid(points);
  const latScale = 111320;
  const lonScale = 111320 * Math.cos(c.lat * Math.PI / 180);
  return points.map(p => ({
    ...p,
    x: (p.lon - c.lon) * lonScale,
    y: (p.lat - c.lat) * latScale,
  }));
}

function principalAxis(points: GeoPoint[]): {
  aspect: number;
  lengthM: number;
  residualM: number;
  bearingDeg: number;
} {
  if (points.length < 3) return { aspect: 1, lengthM: 0, residualM: 0, bearingDeg: 0 };
  const pts = project(points);
  const meanX = pts.reduce((sum, p) => sum + p.x, 0) / pts.length;
  const meanY = pts.reduce((sum, p) => sum + p.y, 0) / pts.length;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const p of pts) {
    const dx = p.x - meanX;
    const dy = p.y - meanY;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }
  sxx /= pts.length;
  syy /= pts.length;
  sxy /= pts.length;
  const trace = sxx + syy;
  const determinant = sxx * syy - sxy * sxy;
  const root = Math.sqrt(Math.max(0, trace * trace / 4 - determinant));
  const lambda1 = Math.max(0, trace / 2 + root);
  const lambda2 = Math.max(0, trace / 2 - root);
  const aspect = Math.sqrt(lambda1 / Math.max(lambda2, 1));

  const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const axisX = Math.cos(angle);
  const axisY = Math.sin(angle);
  const normalX = -axisY;
  const normalY = axisX;

  const projections = pts.map(p => (p.x - meanX) * axisX + (p.y - meanY) * axisY);
  const residuals = pts.map(p => Math.abs((p.x - meanX) * normalX + (p.y - meanY) * normalY));
  const lengthM = Math.max(...projections) - Math.min(...projections);
  const residualM = residuals.reduce((sum, value) => sum + value, 0) / residuals.length;
  const bearingDeg = (90 - angle * 180 / Math.PI + 360) % 180;

  return { aspect, lengthM, residualM, bearingDeg };
}

function neighbours(points: GeoPoint[], index: number, radiusM: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < points.length; i++) {
    if (distanceM(points[index], points[i]) <= radiusM) out.push(i);
  }
  return out;
}

function dbscan(points: GeoPoint[], radiusM: number, minPoints: number): GeoPoint[][] {
  const visited = new Set<number>();
  const assigned = new Set<number>();
  const clusters: GeoPoint[][] = [];

  for (let i = 0; i < points.length; i++) {
    if (visited.has(i)) continue;
    visited.add(i);

    const seedNeighbours = neighbours(points, i, radiusM);
    if (seedNeighbours.length < minPoints) continue;

    const clusterIndexes = new Set<number>();
    const queue = [...seedNeighbours];

    for (let cursor = 0; cursor < queue.length; cursor++) {
      const idx = queue[cursor];
      if (!visited.has(idx)) {
        visited.add(idx);
        const next = neighbours(points, idx, radiusM);
        if (next.length >= minPoints) {
          for (const n of next) {
            if (!queue.includes(n)) queue.push(n);
          }
        }
      }
      if (!assigned.has(idx)) {
        assigned.add(idx);
        clusterIndexes.add(idx);
      }
    }

    const cluster = [...clusterIndexes].map(idx => points[idx]);
    if (cluster.length >= minPoints) clusters.push(cluster);
  }

  return clusters;
}

function confidenceFor(points: RallyReviewPoint[], pattern: "concentration" | "linear_scatter"): RallyReviewConfidence {
  const recorderCount = countUniqueRecorders(points);
  const dominantShare = dominantRecorder(points).share;
  if (points.length >= 6 && recorderCount >= 3 && dominantShare <= 0.65) return "strong";
  if (points.length >= 4 && recorderCount >= 2 && dominantShare <= 0.8) return "developing";
  if (pattern === "linear_scatter" && points.length >= 5 && recorderCount >= 2) return "developing";
  return "tentative";
}

function dominantRecorder(points: RallyReviewPoint[]): { name: string | null; share: number } {
  const counts = new Map<string, { name: string; count: number }>();
  for (const p of points) {
    const key = recorderKey(p);
    const existing = counts.get(key);
    if (existing) existing.count++;
    else counts.set(key, { name: recorderLabel(p), count: 1 });
  }
  const sorted = [...counts.values()].sort((a, b) => b.count - a.count);
  if (!sorted.length) return { name: null, share: 0 };
  return { name: sorted[0].name, share: sorted[0].count / points.length };
}

function makeZoneLabel(points: RallyReviewPoint[], pattern: "concentration" | "linear_scatter"): string {
  const period = topValue(points, "period");
  const material = topValue(points, "material");
  const category = topValue(points, "findCategory") ?? topValue(points, "objectType");
  const noun = pattern === "linear_scatter" ? "linear scatter" : "concentration";

  if (period && material && period.share >= 0.45 && material.share >= 0.45) {
    return `${period.value} ${material.value.toLowerCase()} ${noun}`;
  }
  if (period && period.share >= 0.5) return `${period.value} ${noun}`;
  if (category && category.share >= 0.5) return `${category.value} ${noun}`;
  return pattern === "linear_scatter" ? "Possible linear scatter" : "Find concentration";
}

function describeZone(zone: {
  points: RallyReviewPoint[];
  recorderCount: number;
  confidence: RallyReviewConfidence;
  pattern: "concentration" | "linear_scatter";
  radiusM: number;
}): string {
  const countText = `${zone.points.length} geolocated find${zone.points.length === 1 ? "" : "s"}`;
  const recorderText = `${zone.recorderCount} recorder${zone.recorderCount === 1 ? "" : "s"}`;
  const patternText = zone.pattern === "linear_scatter" ? "forming a directional scatter" : `within about ${Math.round(zone.radiusM)} m`;
  return `${countText} from ${recorderText}, ${patternText}.`;
}

function zoneSortScore(zone: RallyActivityZone): number {
  const confidenceWeight = zone.confidence === "strong" ? 3 : zone.confidence === "developing" ? 2 : 1;
  const recorderWeight = Math.min(zone.recorderCount, 4) * 2;
  return zone.findCount * 2 + recorderWeight + confidenceWeight * 5 - zone.dominantRecorderShare * 3;
}

function buildZones(points: GeoPoint[], fieldNames: Map<string, string>): RallyActivityZone[] {
  const clusters = dbscan(points, CLUSTER_RADIUS_M, CLUSTER_MIN_POINTS);

  return clusters
    .map((cluster, index): RallyActivityZone => {
      const c = centroid(cluster);
      const axis = principalAxis(cluster);
      const pattern = axis.aspect >= 3.2 && axis.lengthM >= 50 && cluster.length >= 4 ? "linear_scatter" : "concentration";
      const recorderCount = countUniqueRecorders(cluster);
      const dominant = dominantRecorder(cluster);
      const confidence = confidenceFor(cluster, pattern);
      const field = majorityField(cluster, fieldNames);
      const radiusM = Math.max(...cluster.map(p => distanceM(p, c)));
      const spreadM = cluster.reduce((sum, p) => sum + distanceM(p, c), 0) / cluster.length;
      const topPeriod = topValue(cluster, "period");
      const topMaterial = topValue(cluster, "material");
      const topCategory = topValue(cluster, "findCategory") ?? topValue(cluster, "objectType");
      const label = makeZoneLabel(cluster, pattern);
      const caveat = dominant.share >= 0.75
        ? `Mostly recorded by ${dominant.name}; treat this as search-pattern sensitive.`
        : null;
      return {
        id: `zone-${index + 1}`,
        label,
        fieldName: field.name,
        center: [c.lon, c.lat],
        bounds: bounds(cluster),
        findCount: cluster.length,
        recorderCount,
        dominantRecorderName: dominant.name,
        dominantRecorderShare: dominant.share,
        confidence,
        pattern,
        radiusM,
        spreadM,
        topPeriod,
        topMaterial,
        topCategory,
        summary: describeZone({ points: cluster, recorderCount, confidence, pattern, radiusM }),
        caveat,
      };
    })
    .sort((a, b) => zoneSortScore(b) - zoneSortScore(a))
    .slice(0, MAX_ZONES);
}

function buildLinearPatterns(points: GeoPoint[], zones: RallyActivityZone[], fieldNames: Map<string, string>): RallyLinearPattern[] {
  const candidates: Array<{ points: GeoPoint[]; fieldName: string | null; scope: string }> = [];

  if (points.length >= 5) candidates.push({ points, fieldName: null, scope: "event" });

  const byField = new Map<string, GeoPoint[]>();
  for (const point of points) {
    if (!point.fieldId) continue;
    const list = byField.get(point.fieldId) ?? [];
    list.push(point);
    byField.set(point.fieldId, list);
  }
  for (const [fieldId, fieldPoints] of byField) {
    if (fieldPoints.length >= 5) {
      candidates.push({ points: fieldPoints, fieldName: fieldNames.get(fieldId) ?? null, scope: fieldId });
    }
  }

  const zoneKeys = new Set(zones.filter(z => z.pattern === "linear_scatter").map(z => z.label + z.findCount));
  const patterns: RallyLinearPattern[] = [];
  for (const candidate of candidates) {
    const axis = principalAxis(candidate.points);
    const recorderCount = countUniqueRecorders(candidate.points);
    const confidence = confidenceFor(candidate.points, "linear_scatter");
    if (axis.aspect < 3.4 || axis.lengthM < 80 || axis.residualM > 30 || recorderCount < 2) continue;
    const label = candidate.fieldName ? `Linear scatter in ${candidate.fieldName}` : "Event-wide linear scatter";
    const key = label + candidate.points.length;
    if (zoneKeys.has(key)) continue;
    patterns.push({
      id: `linear-${candidate.scope}`,
      label,
      fieldName: candidate.fieldName,
      findCount: candidate.points.length,
      recorderCount,
      lengthM: axis.lengthM,
      bearingDeg: axis.bearingDeg,
      confidence,
      summary: `${candidate.points.length} finds align over roughly ${Math.round(axis.lengthM)} m from ${recorderCount} recorders.`,
    });
  }
  return patterns
    .sort((a, b) => b.findCount - a.findCount || b.recorderCount - a.recorderCount)
    .slice(0, 3);
}

function buildFieldSummaries(points: RallyReviewPoint[], geoPoints: GeoPoint[], fields: RallyReviewField[]): RallyFieldSummary[] {
  const fieldNames = new Map(fields.map(f => [f.id, f.name]));
  const byField = new Map<string | null, RallyReviewPoint[]>();
  for (const point of points) {
    const key = point.fieldId || null;
    const list = byField.get(key) ?? [];
    list.push(point);
    byField.set(key, list);
  }

  return [...byField.entries()]
    .map(([fieldId, fieldPoints]) => ({
      fieldId,
      fieldName: fieldId ? fieldNames.get(fieldId) ?? "Field" : "Unassigned finds",
      findCount: fieldPoints.length,
      geolocatedFinds: geoPoints.filter(p => (p.fieldId || null) === fieldId).length,
      recorderCount: countUniqueRecorders(fieldPoints),
      topPeriod: topValue(fieldPoints, "period"),
    }))
    .sort((a, b) => b.findCount - a.findCount)
    .slice(0, 6);
}

function buildQuietAreas(
  points: RallyReviewPoint[],
  sessions: RallyReviewSession[],
  tracks: RallyReviewTrack[],
  fields: RallyReviewField[],
): RallyQuietArea[] {
  if (!fields.length || !tracks.some(t => t.points.length > 0)) return [];

  const trackSessionIds = new Set(tracks.filter(t => t.points.length > 0 && t.sessionId).map(t => t.sessionId as string));
  const sessionsByField = new Map<string, RallyReviewSession[]>();
  for (const session of sessions) {
    if (!session.fieldId || !trackSessionIds.has(session.id)) continue;
    const list = sessionsByField.get(session.fieldId) ?? [];
    list.push(session);
    sessionsByField.set(session.fieldId, list);
  }

  return fields
    .map(field => {
      const fieldSessions = sessionsByField.get(field.id) ?? [];
      const fieldFinds = points.filter(p => p.fieldId === field.id);
      const recorderCount = countUniqueRecorders(fieldSessions);
      return {
        fieldId: field.id,
        fieldName: field.name,
        sessionCount: fieldSessions.length,
        findCount: fieldFinds.length,
        recorderCount,
        summary: `${fieldSessions.length} tracked session${fieldSessions.length === 1 ? "" : "s"} and ${fieldFinds.length} recorded find${fieldFinds.length === 1 ? "" : "s"}.`,
      };
    })
    .filter(area => area.sessionCount >= 2 && area.recorderCount >= 2 && area.findCount <= 1)
    .sort((a, b) => b.sessionCount - a.sessionCount || a.findCount - b.findCount)
    .slice(0, 3);
}

function buildSummary(review: Omit<RallyDayReview, "summary" | "title">): string {
  if (review.status === "empty") return "No finds have been merged into this event yet.";
  if (review.status === "insufficient") {
    return `${review.geolocatedFinds} geolocated find${review.geolocatedFinds === 1 ? "" : "s"} recorded so far. More mapped finds are needed before a spatial pattern is useful.`;
  }
  if (review.zones.length > 0) {
    const zoneText = `${review.zones.length} activity zone${review.zones.length === 1 ? "" : "s"}`;
    const lineText = review.linearPatterns.length > 0 ? ` and ${review.linearPatterns.length} possible linear scatter${review.linearPatterns.length === 1 ? "" : "s"}` : "";
    return `${zoneText}${lineText} stand out from ${review.geolocatedFinds} geolocated finds across ${review.recorderCount} recorders.`;
  }
  if (review.linearPatterns.length > 0) {
    return `${review.linearPatterns.length} possible linear scatter${review.linearPatterns.length === 1 ? "" : "s"} stand out, but no tight find concentration has formed yet.`;
  }
  return `${review.geolocatedFinds} geolocated finds are mapped, but they are too dispersed for a reliable activity zone.`;
}

export function computeRallyDayReview(params: {
  finds: RallyReviewPoint[];
  sessions?: RallyReviewSession[];
  tracks?: RallyReviewTrack[];
  fields?: RallyReviewField[];
  importedRecorderCount?: number;
}): RallyDayReview {
  const finds = params.finds;
  const sessions = params.sessions ?? [];
  const tracks = params.tracks ?? [];
  const fields = params.fields ?? [];
  const geoPoints = finds.filter(isValidGeoFind);
  const fieldNames = new Map(fields.map(f => [f.id, f.name]));
  const recorderCount = countUniqueRecorders(finds);
  const importedRecorderCount = params.importedRecorderCount ?? Math.max(0, countUniqueRecorders(finds.filter(f => !!f.recorderId)));
  const trackedSessionCount = tracks.filter(t => t.points.length > 0).length;
  const base = {
    totalFinds: finds.length,
    geolocatedFinds: geoPoints.length,
    recorderCount,
    importedRecorderCount,
    trackedSessionCount,
    zones: [] as RallyActivityZone[],
    linearPatterns: [] as RallyLinearPattern[],
    quietAreas: [] as RallyQuietArea[],
    fieldSummaries: buildFieldSummaries(finds, geoPoints, fields),
    caveats: [
      "This is a find-record pattern, not a formal archaeological interpretation.",
      trackedSessionCount > 0
        ? "Quiet areas are only highlighted where tracked search sessions exist."
        : "Search coverage is not tracked here, so quiet ground may simply be under-searched.",
    ],
  };

  let review: RallyDayReview;
  if (finds.length === 0) {
    review = {
      ...base,
      status: "empty",
      title: "Rally Day Review",
      summary: "",
    };
  } else if (geoPoints.length < CLUSTER_MIN_POINTS) {
    review = {
      ...base,
      status: "insufficient",
      title: "Rally Day Review",
      summary: "",
    };
  } else {
    const zones = buildZones(geoPoints, fieldNames);
    const linearPatterns = buildLinearPatterns(geoPoints, zones, fieldNames);
    const quietAreas = buildQuietAreas(finds, sessions, tracks, fields);
    review = {
      ...base,
      status: "ready",
      title: "Rally Day Review",
      zones,
      linearPatterns,
      quietAreas,
      summary: "",
    };
  }

  return { ...review, summary: buildSummary(review) };
}
