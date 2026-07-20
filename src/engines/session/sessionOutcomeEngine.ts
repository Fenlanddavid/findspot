// ─── Session outcome engine ───────────────────────────────────────────────────
// Rule-based outcome analysis and next-move suggestions after a detecting session.
// Uses only data already held in the app — no external calls, no AI.

export type FindSpread = 'clustered' | 'linear' | 'scattered' | null;

export interface SessionOutcome {
  label:    string;
  colour:   'emerald' | 'amber' | 'gray';
  subtitle: string;
}

export interface NextMove {
  action: string;
  reason: string;
}

export interface SessionOutcomeResult {
  outcome:  SessionOutcome;
  spread:   FindSpread;
  nextMove: NextMove | null;
}

interface FindPoint       { lat: number; lon: number; }
interface PrevSessionData { findsCount: number; }

// ─── Geometry helpers ─────────────────────────────────────────────────────────

function haversineDist(a: FindPoint, b: FindPoint): number {
  const R    = 6371000;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLon = (b.lon - a.lon) * Math.PI / 180;
  const lat1 = a.lat * Math.PI / 180;
  const lat2 = b.lat * Math.PI / 180;
  const s    = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function centroid(pts: FindPoint[]): FindPoint {
  return {
    lat: pts.reduce((s, p) => s + p.lat, 0) / pts.length,
    lon: pts.reduce((s, p) => s + p.lon, 0) / pts.length,
  };
}

function computeSpread(pts: FindPoint[]): FindSpread {
  if (pts.length < 2) return null;
  const c   = centroid(pts);
  const avg = pts.reduce((s, p) => s + haversineDist(p, c), 0) / pts.length;
  if (avg < 25) return 'clustered';
  // Check for a linear pattern: high bounding-box aspect ratio = directional spread
  const lons   = pts.map(p => p.lon);
  const lats   = pts.map(p => p.lat);
  const lonSpan = Math.max(...lons) - Math.min(...lons);
  const latSpan = Math.max(...lats) - Math.min(...lats);
  const aspect  = Math.max(lonSpan, latSpan) / (Math.min(lonSpan, latSpan) + 1e-10);
  if (aspect > 3 && avg < 80) return 'linear';
  return 'scattered';
}

// Returns the cardinal name of the direction from centroid to the outermost find.
// Used in "work the [direction] edge" next-move text.
function edgeDirection(pts: FindPoint[]): 'eastern' | 'western' | 'northern' | 'southern' {
  const c = centroid(pts);
  let furthest = pts[0];
  let maxD = 0;
  for (const p of pts) {
    const d = haversineDist(p, c);
    if (d > maxD) { maxD = d; furthest = p; }
  }
  const dLat = furthest.lat - c.lat;
  const dLon = furthest.lon - c.lon;
  if (Math.abs(dLon) > Math.abs(dLat)) return dLon > 0 ? 'eastern' : 'western';
  return dLat > 0 ? 'northern' : 'southern';
}

// ─── Public entry point ───────────────────────────────────────────────────────

export function computeSessionOutcomeResult(
  findsCount:   number,
  coverage:     number,
  durationMins: number | null,
  findPoints:   FindPoint[],
  prevSessions: PrevSessionData[],
): SessionOutcomeResult {
  const spread      = computeSpread(findPoints);
  const geoCount    = findPoints.length;
  const hasCoverage = coverage > 0;
  const prevTotal   = prevSessions.reduce((s, p) => s + p.findsCount, 0);
  const quietBefore = prevSessions.length >= 2 && prevTotal === 0;

  // ─── Outcome label ──────────────────────────────────────────────────────────

  let outcome: SessionOutcome;

  if (findsCount >= 5 && (!hasCoverage || coverage >= 50)) {
    outcome = {
      label:    'Strong session',
      colour:   'emerald',
      subtitle: 'Solid find rate — this area is producing.',
    };
  } else if (findsCount >= 5 && hasCoverage && coverage < 50) {
    outcome = {
      label:    'Productive — incomplete coverage',
      colour:   'emerald',
      subtitle: 'Finds are coming but significant ground remains unsearched.',
    };
  } else if (findsCount >= 3) {
    outcome = {
      label:    'Developing area',
      colour:   'amber',
      subtitle: 'Activity present — worth returning to continue.',
    };
  } else if (findsCount >= 1 && hasCoverage && coverage < 60) {
    outcome = {
      label:    'Coverage incomplete',
      colour:   'amber',
      subtitle: 'Some activity recorded but much of the field is still unsearched.',
    };
  } else if (findsCount === 0 && quietBefore) {
    outcome = {
      label:    'Low activity so far',
      colour:   'gray',
      subtitle: 'Multiple visits with limited results — other areas may be worth trying.',
    };
  } else if (findsCount === 0) {
    outcome = {
      label:    'Quiet session',
      colour:   'gray',
      subtitle: 'No finds this visit. Conditions, ground type, or area choice may be factors.',
    };
  } else {
    outcome = {
      label:    'Good hunt',
      colour:   'emerald',
      subtitle: `${findsCount} find${findsCount !== 1 ? 's' : ''} recorded this session.`,
    };
  }

  // ─── Next move ──────────────────────────────────────────────────────────────

  let nextMove: NextMove | null = null;

  if (geoCount >= 3 && spread === 'clustered') {
    nextMove = {
      action: 'Continue around the cluster',
      reason: 'Your finds are tightly grouped — there is likely more activity in the immediate surrounding ground.',
    };
  } else if (geoCount >= 3 && spread === 'linear') {
    const dir = edgeDirection(findPoints);
    nextMove = {
      action: `Follow the ${dir} line`,
      reason: 'Finds follow a clear direction — likely a boundary, route, or feature edge. Extend along it.',
    };
  } else if (geoCount >= 2 && spread === 'scattered' && hasCoverage && coverage < 80) {
    nextMove = {
      action: 'Widen your coverage',
      reason: 'Activity is spread across the field. Continue covering ground to build a clearer picture.',
    };
  } else if (hasCoverage && coverage < 60 && findsCount > 0) {
    nextMove = {
      action: 'Complete your coverage',
      reason: 'You have less than 60% field coverage. Finish the ground before drawing conclusions about its potential.',
    };
  } else if (geoCount >= 2) {
    const dir = edgeDirection(findPoints);
    nextMove = {
      action: `Work the ${dir} edge`,
      reason: `Your most active finds are towards the ${dir} side — extend your search in that direction.`,
    };
  } else if (findsCount === 0 && quietBefore) {
    nextMove = {
      action: 'Move to a stronger target',
      reason: 'Multiple visits with no finds — deprioritise this area and check your FieldGuide targets for a better starting point.',
    };
  } else if (findsCount === 0 && prevSessions.length === 0) {
    nextMove = {
      action: 'Try a FieldGuide scan',
      reason: 'Scan this area with FieldGuide before your next visit to identify the strongest starting points.',
    };
  }

  return { outcome, spread, nextMove };
}
