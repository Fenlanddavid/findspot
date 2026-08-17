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
