package uk.findspot.companion;

import static org.junit.Assert.assertTrue;

import org.junit.Test;

import java.util.List;

public final class RecordingJsonTest {
    @Test
    public void matchesTheCrossPlatformCanonicalHashFixture() {
        RecordingModels.Point point = new RecordingModels.Point(
            0, 1000, "500", 1001, 52.2, 0.12, 8d, 4d, 6d, 90d, 1.1d, "gps", 0
        );
        RecordingModels.Segment segment = new RecordingModels.Segment(0, 1000, 2000L, List.of(point));
        RecordingModels.Summary summary = new RecordingModels.Summary(
            "00000000-0000-4000-8000-000000000001",
            "stopped", null, 900, 1000, 2000L, 0, 1, null
        );
        String exported = RecordingJson.export(new RecordingModels.Snapshot(summary, List.of(segment)));
        assertTrue(exported.contains(
            "\"contentHash\":\"sha256:620f272a33301657a760f8a34fcd01aef6f434223d3876459da53696f07ddcb2\""
        ));
    }
}
