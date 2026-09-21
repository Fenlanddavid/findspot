import { countPrediction, emptyPredictionCounts } from '../../shared/predictionEvidence';

type Row = Record<string, unknown>;
function object(value: unknown): value is Row {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function strings(value: unknown, keys = false): value is string[] {
  return Array.isArray(value) && value.length <= (keys ? 256 : 100_000) && value.every(item =>
    typeof item === 'string' && item.length > 0 && item.length <= 200
    && (!keys || /^[a-z][a-z0-9_.:-]*$/.test(item))) && new Set(value).size === value.length;
}

/** Optional on old rows. Never manufacture missing capture from display tags. */
export function assertPredictionCapture(row: Row): void {
  const invalid = (field: string): never => { throw new Error(`Invalid prediction evidence: ${field}`); };
  for (const name of ['captureVersion', 'evidenceVersion']) {
    if (row[name] !== undefined && (!Number.isInteger(row[name]) || (row[name] as number) < 1)) invalid(name);
  }
  if (row.score !== undefined && (!Number.isFinite(row.score) || (row.score as number) < 0 || (row.score as number) > 98)) invalid('score');
  for (const name of ['scanId', 'hotspotId']) {
    if (row[name] !== undefined && (typeof row[name] !== 'string' || !(row[name] as string).trim())) invalid(name);
  }
  if (row.explanationTags !== undefined && !strings(row.explanationTags, true)) invalid('explanationTags');
  if (row.evidenceCapture !== undefined) {
    const capture = row.evidenceCapture;
    if (!object(capture)) return invalid('evidenceCapture');
    if (!strings(capture.tags, true) || !strings(capture.suppression, true) || !strings(capture.context, true)) invalid('keys');
    if (!object(capture.scoring) || Object.keys(capture.scoring).length > 256) return invalid('scoring');
    for (const [key, value] of Object.entries(capture.scoring)) {
      if (!/^[a-z][a-z0-9_.:-]{0,199}$/.test(key) || !Number.isFinite(value)) invalid('contribution');
    }
  }
  if (row.captureVersion !== undefined && (row.evidenceCapture === undefined || row.score === undefined
    || row.scanId === undefined || row.hotspotId === undefined)) invalid('incomplete capture');
}

export function assertFrozenPredictionEvidence(row: Row): void {
  if (row.formatVersion === undefined) return;
  if (row.formatVersion !== 2 || !object(row.snapshot) || !object(row.counts)) {
    throw new Error('Invalid frozen prediction evidence format');
  }
  assertPredictionCapture({ ...row.snapshot, evidenceVersion: row.evidenceVersion });
  const snapshot = row.snapshot;
  if (typeof snapshot.predictionId !== 'string' || !snapshot.predictionId
    || row.id !== `v2:${snapshot.predictionId}` || snapshot.captureVersion !== row.captureVersion
    || !Number.isFinite(snapshot.surfacedAt) || !Number.isFinite(row.updatedAt)
    || (row.updatedAt as number) < (snapshot.surfacedAt as number)
    || !strings(snapshot.associatedFindIds) || !strings(snapshot.reportSessionIds)) {
    throw new Error('Invalid frozen prediction snapshot');
  }
  for (const name of ['permissionId', 'sessionId']) {
    if (snapshot[name] !== null && (typeof snapshot[name] !== 'string' || !snapshot[name])) {
      throw new Error('Invalid frozen prediction scope');
    }
  }
  const pair = (value: unknown) => Array.isArray(value) && value.length === 2
    && value.every(Number.isFinite) && Math.abs(value[0]) <= 180 && Math.abs(value[1]) <= 90;
  if (!pair(snapshot.center) || !Array.isArray(snapshot.bounds) || snapshot.bounds.length !== 2
    || !snapshot.bounds.every(pair)) throw new Error('Invalid frozen prediction geometry');
  if (!['unvisited', 'visited_tracked', 'search_reported', 'no_relevant_find_reported', 'find_recorded'].includes(String(snapshot.outcome))
    || (snapshot.resolutionEvidence !== undefined && !['find', 'tracked', 'reported', 'mixed'].includes(String(snapshot.resolutionEvidence)))) {
    throw new Error('Invalid frozen prediction outcome');
  }
  const expected = countPrediction({
    outcome: snapshot.outcome as string,
    resolutionEvidence: snapshot.resolutionEvidence as string | undefined,
    permissionId: snapshot.permissionId as string | null,
    sessionId: snapshot.sessionId as string | null,
  });
  const counts = row.counts;
  for (const key of Object.keys(expected) as Array<keyof typeof expected>) {
    if (counts[key] !== expected[key]) throw new Error('Frozen counts disagree with outcome');
  }
  for (const key of Object.keys(emptyPredictionCounts())) {
    if (!Number.isInteger(counts[key]) || (counts[key] as number) < 0 || (counts[key] as number) > 1) {
      throw new Error('Invalid frozen prediction counts');
    }
  }
  if (counts.surfacedCount !== 1 || counts.surfacedCount !== row.surfacedCount
    || counts.searchedCount !== row.searchedCount || counts.hitCount !== row.hitCount
    || (counts.hitCount as number) > (counts.searchedCount as number)
    || (counts.reportedSearchedCount as number) + (counts.mixedSearchedCount as number) !== counts.searchedCount
    || (counts.reportedHitCount as number) + (counts.mixedHitCount as number) !== counts.hitCount) {
    throw new Error('Inconsistent frozen prediction counts');
  }
}
