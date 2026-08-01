package uk.findspot.companion;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

final class RecordingJson {
    static final String MIME_TYPE = "application/vnd.findspot.companion+json";

    private RecordingJson() {}

    static String export(RecordingModels.Snapshot snapshot) {
        RecordingModels.Summary summary = snapshot.summary();
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("schemaVersion", 1);
        payload.put("startedAtUtc", summary.startedAtUtc());
        payload.put("stoppedAtUtc", summary.stoppedAtUtc());
        payload.put("state", summary.state());
        payload.put("interruptionReason", summary.interruptionReason());
        payload.put("segments", segmentValues(snapshot.segments()));

        Map<String, Object> producer = new LinkedHashMap<>();
        producer.put("name", "FindSpot Companion");
        producer.put("version", BuildConfig.VERSION_NAME);
        producer.put("platform", "android");

        Map<String, Object> envelope = new LinkedHashMap<>();
        envelope.put("schemaVersion", 1);
        envelope.put("producer", producer);
        envelope.put("recordingUuid", summary.uuid());
        envelope.put("contentHash", "sha256:" + sha256(CanonicalJson.encode(payload)));
        envelope.put("createdAtUtc", summary.createdAtUtc());
        envelope.put("startedAtUtc", summary.startedAtUtc());
        envelope.put("stoppedAtUtc", summary.stoppedAtUtc());
        envelope.put("state", summary.state());
        envelope.put("interruptionReason", summary.interruptionReason());
        envelope.put("segments", payload.get("segments"));
        return CanonicalJson.encode(envelope);
    }

    private static List<Object> segmentValues(List<RecordingModels.Segment> segments) {
        List<Object> values = new ArrayList<>();
        for (RecordingModels.Segment segment : segments) {
            Map<String, Object> value = new LinkedHashMap<>();
            value.put("segmentIndex", segment.segmentIndex());
            value.put("startedAtUtc", segment.startedAtUtc());
            value.put("endedAtUtc", segment.endedAtUtc());
            List<Object> observations = new ArrayList<>();
            for (RecordingModels.Point point : segment.observations()) {
                Map<String, Object> observation = new LinkedHashMap<>();
                observation.put("type", "trackPoint");
                observation.put("sequence", point.sequence());
                observation.put("timestampUtc", point.timestampUtc());
                observation.put("monotonicTimestampNs", point.monotonicTimestampNs());
                observation.put("receivedTimestampUtc", point.receivedTimestampUtc());
                observation.put("latitude", point.latitude());
                observation.put("longitude", point.longitude());
                observation.put("altitudeM", point.altitudeM());
                observation.put("horizontalAccuracyM", point.horizontalAccuracyM());
                observation.put("verticalAccuracyM", point.verticalAccuracyM());
                observation.put("headingDegrees", point.headingDegrees());
                observation.put("speedMps", point.speedMps());
                observation.put("provider", point.provider());
                observations.add(observation);
            }
            value.put("observations", observations);
            values.add(value);
        }
        return values;
    }

    private static String sha256(String value) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256")
                .digest(value.getBytes(StandardCharsets.UTF_8));
            StringBuilder output = new StringBuilder(digest.length * 2);
            for (byte item : digest) output.append(String.format("%02x", item & 0xff));
            return output.toString();
        } catch (NoSuchAlgorithmException impossible) {
            throw new IllegalStateException("Android does not provide SHA-256.", impossible);
        }
    }
}
