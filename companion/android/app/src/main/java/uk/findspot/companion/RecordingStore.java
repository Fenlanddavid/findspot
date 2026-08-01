package uk.findspot.companion;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;
import android.location.Location;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

final class RecordingStore extends SQLiteOpenHelper {
    private static final String DATABASE_NAME = "findspot_companion.db";
    private static final int DATABASE_VERSION = 1;

    RecordingStore(Context context) {
        super(context, DATABASE_NAME, null, DATABASE_VERSION);
        setWriteAheadLoggingEnabled(true);
    }

    @Override
    public void onConfigure(SQLiteDatabase database) {
        super.onConfigure(database);
        database.setForeignKeyConstraintsEnabled(true);
    }

    @Override
    public void onCreate(SQLiteDatabase database) {
        database.execSQL("""
            CREATE TABLE recordings (
                uuid TEXT PRIMARY KEY NOT NULL,
                state TEXT NOT NULL,
                interruption_reason TEXT,
                created_at_utc INTEGER NOT NULL,
                started_at_utc INTEGER NOT NULL,
                stopped_at_utc INTEGER,
                current_segment INTEGER NOT NULL,
                current_segment_started_at_utc INTEGER NOT NULL,
                next_sequence INTEGER NOT NULL,
                exported_at_utc INTEGER
            )
            """);
        database.execSQL("""
            CREATE TABLE segments (
                recording_uuid TEXT NOT NULL,
                segment_index INTEGER NOT NULL,
                started_at_utc INTEGER NOT NULL,
                ended_at_utc INTEGER,
                PRIMARY KEY (recording_uuid, segment_index),
                FOREIGN KEY (recording_uuid) REFERENCES recordings(uuid) ON DELETE CASCADE
            )
            """);
        database.execSQL("""
            CREATE TABLE observations (
                recording_uuid TEXT NOT NULL,
                sequence INTEGER NOT NULL,
                timestamp_utc INTEGER NOT NULL,
                monotonic_timestamp_ns TEXT,
                received_timestamp_utc INTEGER NOT NULL,
                latitude REAL NOT NULL,
                longitude REAL NOT NULL,
                altitude_m REAL,
                horizontal_accuracy_m REAL,
                vertical_accuracy_m REAL,
                heading_degrees REAL,
                speed_mps REAL,
                provider TEXT NOT NULL,
                segment_index INTEGER NOT NULL,
                PRIMARY KEY (recording_uuid, sequence),
                FOREIGN KEY (recording_uuid) REFERENCES recordings(uuid) ON DELETE CASCADE
            )
            """);
        database.execSQL("CREATE INDEX observations_recording_segment ON observations(recording_uuid, segment_index, sequence)");
    }

    @Override
    public void onUpgrade(SQLiteDatabase database, int oldVersion, int newVersion) {
        throw new IllegalStateException("No database migration exists from " + oldVersion + " to " + newVersion);
    }

    RecordingModels.Summary startNew() {
        SQLiteDatabase database = getWritableDatabase();
        RecordingModels.Summary active = activeRecording();
        if (active != null && !"stopped".equals(active.state())) {
            throw new IllegalStateException("A recording is already open.");
        }
        long now = System.currentTimeMillis();
        String uuid = UUID.randomUUID().toString();
        ContentValues values = new ContentValues();
        values.put("uuid", uuid);
        values.put("state", "recording");
        values.putNull("interruption_reason");
        values.put("created_at_utc", now);
        values.put("started_at_utc", now);
        values.putNull("stopped_at_utc");
        values.put("current_segment", 0);
        values.put("current_segment_started_at_utc", now);
        values.put("next_sequence", 0);
        values.putNull("exported_at_utc");
        database.beginTransaction();
        try {
            database.insertOrThrow("recordings", null, values);
            ContentValues segment = new ContentValues();
            segment.put("recording_uuid", uuid);
            segment.put("segment_index", 0);
            segment.put("started_at_utc", now);
            segment.putNull("ended_at_utc");
            database.insertOrThrow("segments", null, segment);
            database.setTransactionSuccessful();
        } finally {
            database.endTransaction();
        }
        return get(uuid);
    }

    void appendLocation(String recordingUuid, Location location, long receivedAtUtc) {
        SQLiteDatabase database = getWritableDatabase();
        database.beginTransaction();
        try (Cursor cursor = database.rawQuery(
            "SELECT state, current_segment, next_sequence FROM recordings WHERE uuid = ?",
            new String[]{recordingUuid}
        )) {
            if (!cursor.moveToFirst() || !"recording".equals(cursor.getString(0))) {
                throw new IllegalStateException("Recording is no longer active.");
            }
            int segment = cursor.getInt(1);
            long sequence = cursor.getLong(2);
            ContentValues observation = new ContentValues();
            observation.put("recording_uuid", recordingUuid);
            observation.put("sequence", sequence);
            observation.put("timestamp_utc", location.getTime());
            observation.put("monotonic_timestamp_ns", Long.toUnsignedString(location.getElapsedRealtimeNanos()));
            observation.put("received_timestamp_utc", receivedAtUtc);
            observation.put("latitude", location.getLatitude());
            observation.put("longitude", location.getLongitude());
            putNullable(observation, "altitude_m", location.hasAltitude() ? (double) location.getAltitude() : null);
            putNullable(observation, "horizontal_accuracy_m", location.hasAccuracy() ? (double) location.getAccuracy() : null);
            putNullable(observation, "vertical_accuracy_m", location.hasVerticalAccuracy() ? (double) location.getVerticalAccuracyMeters() : null);
            putNullable(observation, "heading_degrees", location.hasBearing() ? normalizeHeading(location.getBearing()) : null);
            putNullable(observation, "speed_mps", location.hasSpeed() ? Math.max(0d, location.getSpeed()) : null);
            observation.put("provider", location.getProvider() == null ? "unknown" : location.getProvider());
            observation.put("segment_index", segment);
            database.insertOrThrow("observations", null, observation);

            ContentValues next = new ContentValues();
            next.put("next_sequence", sequence + 1);
            database.update("recordings", next, "uuid = ?", new String[]{recordingUuid});
            database.setTransactionSuccessful();
        } finally {
            database.endTransaction();
        }
    }

    void pause(String uuid) {
        transition(uuid, "paused", null, false);
    }

    void resume(String uuid) {
        SQLiteDatabase database = getWritableDatabase();
        database.beginTransaction();
        try (Cursor cursor = database.rawQuery(
            "SELECT state, current_segment FROM recordings WHERE uuid = ?",
            new String[]{uuid}
        )) {
            if (!cursor.moveToFirst() || !("paused".equals(cursor.getString(0)) || "interrupted".equals(cursor.getString(0)))) {
                throw new IllegalStateException("Only paused or interrupted recordings can resume.");
            }
            ContentValues values = new ContentValues();
            values.put("state", "recording");
            values.putNull("interruption_reason");
            values.put("current_segment", cursor.getInt(1) + 1);
            long now = System.currentTimeMillis();
            int newSegmentIndex = cursor.getInt(1) + 1;
            values.put("current_segment", newSegmentIndex);
            values.put("current_segment_started_at_utc", now);
            database.update("recordings", values, "uuid = ?", new String[]{uuid});
            ContentValues segment = new ContentValues();
            segment.put("recording_uuid", uuid);
            segment.put("segment_index", newSegmentIndex);
            segment.put("started_at_utc", now);
            segment.putNull("ended_at_utc");
            database.insertOrThrow("segments", null, segment);
            database.setTransactionSuccessful();
        } finally {
            database.endTransaction();
        }
    }

    void stop(String uuid) {
        transition(uuid, "stopped", null, true);
    }

    void interrupt(String uuid, String reason) {
        transition(uuid, "interrupted", reason, false);
    }

    void interruptOpenRecording(String reason) {
        RecordingModels.Summary active = activeRecording();
        if (active != null && ("recording".equals(active.state()) || "paused".equals(active.state()))) {
            interrupt(active.uuid(), reason);
        }
    }

    private void transition(String uuid, String state, String reason, boolean terminal) {
        SQLiteDatabase database = getWritableDatabase();
        long now = System.currentTimeMillis();
        ContentValues values = new ContentValues();
        values.put("state", state);
        if (reason == null) values.putNull("interruption_reason"); else values.put("interruption_reason", reason);
        if (terminal) values.put("stopped_at_utc", now);
        database.beginTransaction();
        try {
            int changed = database.update("recordings", values, "uuid = ?", new String[]{uuid});
            if (changed != 1) throw new IllegalStateException("Recording does not exist.");
            ContentValues segment = new ContentValues();
            segment.put("ended_at_utc", now);
            database.update(
                "segments",
                segment,
                "recording_uuid = ? AND ended_at_utc IS NULL",
                new String[]{uuid}
            );
            database.setTransactionSuccessful();
        } finally {
            database.endTransaction();
        }
    }

    void markExported(String uuid) {
        ContentValues values = new ContentValues();
        values.put("exported_at_utc", System.currentTimeMillis());
        getWritableDatabase().update("recordings", values, "uuid = ?", new String[]{uuid});
    }

    void discard(String uuid) {
        getWritableDatabase().delete("recordings", "uuid = ?", new String[]{uuid});
    }

    int purgeExpiredExports(long retentionMs) {
        long cutoff = System.currentTimeMillis() - retentionMs;
        return getWritableDatabase().delete(
            "recordings",
            "exported_at_utc IS NOT NULL AND exported_at_utc < ? AND state = 'stopped'",
            new String[]{Long.toString(cutoff)}
        );
    }

    List<RecordingModels.Summary> recent() {
        List<RecordingModels.Summary> recordings = new ArrayList<>();
        try (Cursor cursor = getReadableDatabase().rawQuery("""
            SELECT r.uuid, r.state, r.interruption_reason, r.created_at_utc,
                   r.started_at_utc, r.stopped_at_utc, r.current_segment,
                   (SELECT COUNT(*) FROM observations o WHERE o.recording_uuid = r.uuid),
                   r.exported_at_utc
            FROM recordings r ORDER BY r.created_at_utc DESC
            """, null)) {
            while (cursor.moveToNext()) recordings.add(summary(cursor));
        }
        return recordings;
    }

    RecordingModels.Summary activeRecording() {
        try (Cursor cursor = getReadableDatabase().rawQuery("""
            SELECT r.uuid, r.state, r.interruption_reason, r.created_at_utc,
                   r.started_at_utc, r.stopped_at_utc, r.current_segment,
                   (SELECT COUNT(*) FROM observations o WHERE o.recording_uuid = r.uuid),
                   r.exported_at_utc
            FROM recordings r
            WHERE r.state != 'stopped'
            ORDER BY r.created_at_utc DESC LIMIT 1
            """, null)) {
            return cursor.moveToFirst() ? summary(cursor) : null;
        }
    }

    RecordingModels.Summary latest() {
        try (Cursor cursor = getReadableDatabase().rawQuery("""
            SELECT r.uuid, r.state, r.interruption_reason, r.created_at_utc,
                   r.started_at_utc, r.stopped_at_utc, r.current_segment,
                   (SELECT COUNT(*) FROM observations o WHERE o.recording_uuid = r.uuid),
                   r.exported_at_utc
            FROM recordings r ORDER BY r.created_at_utc DESC LIMIT 1
            """, null)) {
            return cursor.moveToFirst() ? summary(cursor) : null;
        }
    }

    RecordingModels.Summary get(String uuid) {
        try (Cursor cursor = getReadableDatabase().rawQuery("""
            SELECT r.uuid, r.state, r.interruption_reason, r.created_at_utc,
                   r.started_at_utc, r.stopped_at_utc, r.current_segment,
                   (SELECT COUNT(*) FROM observations o WHERE o.recording_uuid = r.uuid),
                   r.exported_at_utc
            FROM recordings r WHERE r.uuid = ?
            """, new String[]{uuid})) {
            if (!cursor.moveToFirst()) throw new IllegalStateException("Recording does not exist.");
            return summary(cursor);
        }
    }

    RecordingModels.Snapshot snapshot(String uuid) {
        RecordingModels.Summary summary = get(uuid);
        List<RecordingModels.Segment> segments = new ArrayList<>();
        try (Cursor segmentCursor = getReadableDatabase().rawQuery("""
            SELECT segment_index, started_at_utc, ended_at_utc
            FROM segments WHERE recording_uuid = ? ORDER BY segment_index
            """, new String[]{uuid})) {
          while (segmentCursor.moveToNext()) {
            int segmentIndex = segmentCursor.getInt(0);
            List<RecordingModels.Point> points = new ArrayList<>();
            try (Cursor cursor = getReadableDatabase().rawQuery("""
                SELECT sequence, timestamp_utc, monotonic_timestamp_ns,
                       received_timestamp_utc, latitude, longitude, altitude_m,
                       horizontal_accuracy_m, vertical_accuracy_m, heading_degrees,
                       speed_mps, provider, segment_index
                FROM observations
                WHERE recording_uuid = ? AND segment_index = ?
                ORDER BY sequence
                """, new String[]{uuid, Integer.toString(segmentIndex)})) {
                while (cursor.moveToNext()) points.add(point(cursor));
            }
            segments.add(new RecordingModels.Segment(
                segmentIndex,
                segmentCursor.getLong(1),
                nullableLong(segmentCursor, 2),
                points
            ));
          }
        }
        return new RecordingModels.Snapshot(summary, segments);
    }

    private static RecordingModels.Summary summary(Cursor cursor) {
        return new RecordingModels.Summary(
            cursor.getString(0), cursor.getString(1), nullableString(cursor, 2),
            cursor.getLong(3), cursor.getLong(4), nullableLong(cursor, 5),
            cursor.getInt(6), cursor.getLong(7), nullableLong(cursor, 8)
        );
    }

    private static RecordingModels.Point point(Cursor cursor) {
        return new RecordingModels.Point(
            cursor.getLong(0), cursor.getLong(1), nullableString(cursor, 2), cursor.getLong(3),
            cursor.getDouble(4), cursor.getDouble(5), nullableDouble(cursor, 6),
            nullableDouble(cursor, 7), nullableDouble(cursor, 8), nullableDouble(cursor, 9),
            nullableDouble(cursor, 10), cursor.getString(11), cursor.getInt(12)
        );
    }

    private static void putNullable(ContentValues values, String key, Double value) {
        if (value == null || !Double.isFinite(value)) values.putNull(key); else values.put(key, value);
    }

    private static Double nullableDouble(Cursor cursor, int column) {
        return cursor.isNull(column) ? null : cursor.getDouble(column);
    }

    private static Long nullableLong(Cursor cursor, int column) {
        return cursor.isNull(column) ? null : cursor.getLong(column);
    }

    private static String nullableString(Cursor cursor, int column) {
        return cursor.isNull(column) ? null : cursor.getString(column);
    }

    private static double normalizeHeading(float heading) {
        double normalized = heading % 360d;
        return normalized < 0 ? normalized + 360d : normalized;
    }
}
