package uk.findspot.companion;

import java.util.List;

final class RecordingModels {
    private RecordingModels() {}

    record Summary(
        String uuid,
        String state,
        String interruptionReason,
        long createdAtUtc,
        long startedAtUtc,
        Long stoppedAtUtc,
        int currentSegment,
        long pointCount,
        Long exportedAtUtc
    ) {}

    record Point(
        long sequence,
        long timestampUtc,
        String monotonicTimestampNs,
        long receivedTimestampUtc,
        double latitude,
        double longitude,
        Double altitudeM,
        Double horizontalAccuracyM,
        Double verticalAccuracyM,
        Double headingDegrees,
        Double speedMps,
        String provider,
        int segmentIndex
    ) {}

    record Segment(
        int segmentIndex,
        long startedAtUtc,
        Long endedAtUtc,
        List<Point> observations
    ) {}

    record Snapshot(Summary summary, List<Segment> segments) {}
}
