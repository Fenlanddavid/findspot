export type RecordedTrackGap = { start: number; end: number };
export type TimestampedTrackPoint = { timestamp: number };

/** True when a segment bridges the far edge of an explicitly recorded outage. */
export function segmentCrossesRecordedGap(
  previousTimestamp: number,
  currentTimestamp: number,
  gaps: RecordedTrackGap[] | undefined,
): boolean {
  return (gaps ?? []).some(gap =>
    previousTimestamp <= gap.end
    && currentTimestamp >= gap.end
    && currentTimestamp > gap.start
  );
}

/** Splits a track so geometry code can never draw a line across a GPS outage. */
export function splitTrackPointsAtGaps<T extends TimestampedTrackPoint>(
  input: T[],
  gaps: RecordedTrackGap[] | undefined,
): T[][] {
  const points = [...input].sort((left, right) => left.timestamp - right.timestamp);
  if (points.length === 0) return [];
  const segments: T[][] = [[points[0]]];
  for (let index = 1; index < points.length; index++) {
    const previous = points[index - 1];
    const current = points[index];
    if (segmentCrossesRecordedGap(previous.timestamp, current.timestamp, gaps)) {
      segments.push([current]);
    } else {
      segments[segments.length - 1].push(current);
    }
  }
  return segments.filter(segment => segment.length > 0);
}

export type GeoTrackPoint = TimestampedTrackPoint & { lat: number; lon: number };

function approximateDistanceM(left: GeoTrackPoint, right: GeoTrackPoint): number {
  const meanLat = (left.lat + right.lat) * Math.PI / 360;
  const dx = (right.lon - left.lon) * 111_320 * Math.cos(meanLat);
  const dy = (right.lat - left.lat) * 111_320;
  return Math.hypot(dx, dy);
}

/** Shared accepted-track geometry for coverage and prediction exposure. */
export function interpolateAcceptedTrackPoints(
  points: GeoTrackPoint[],
  gaps: RecordedTrackGap[] | undefined,
  options: { fromTimestamp?: number; sampleSpacingM: number; maxTimeGapMs?: number; maxDistanceGapM?: number },
): Array<[number, number]> {
  const filtered = points
    .filter(point => point.timestamp >= (options.fromTimestamp ?? Number.NEGATIVE_INFINITY))
    .sort((left, right) => left.timestamp - right.timestamp);
  const samples: Array<[number, number]> = [];
  for (const segment of splitTrackPointsAtGaps(filtered, gaps)) {
    if (segment.length === 1) samples.push([segment[0].lon, segment[0].lat]);
    for (let index = 1; index < segment.length; index++) {
      const previous = segment[index - 1];
      const current = segment[index];
      const distanceM = approximateDistanceM(previous, current);
      if (current.timestamp - previous.timestamp > (options.maxTimeGapMs ?? 120_000)) continue;
      if (distanceM > (options.maxDistanceGapM ?? 200)) continue;
      const steps = Math.max(1, Math.ceil(distanceM / options.sampleSpacingM));
      for (let step = 0; step <= steps; step++) {
        const fraction = step / steps;
        samples.push([
          previous.lon + (current.lon - previous.lon) * fraction,
          previous.lat + (current.lat - previous.lat) * fraction,
        ]);
      }
    }
  }
  return samples;
}
