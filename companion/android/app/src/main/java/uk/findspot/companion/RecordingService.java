package uk.findspot.companion;

import android.Manifest;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.location.LocationRequest;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;

public final class RecordingService extends Service implements LocationListener {
    static final String ACTION_START = "uk.findspot.companion.START";
    static final String ACTION_PAUSE = "uk.findspot.companion.PAUSE";
    static final String ACTION_RESUME = "uk.findspot.companion.RESUME";
    static final String ACTION_STOP = "uk.findspot.companion.STOP";
    static final String EXTRA_RECORDING_UUID = "recordingUuid";
    private static final long START_REQUEST_GRACE_NS = 5_000_000_000L;
    static final long MAX_CONTINUOUS_RECORDING_MS = 12L * 60L * 60L * 1_000L;

    static volatile boolean isRunning = false;
    private static volatile long startRequestedAtNs = Long.MIN_VALUE;

    private RecordingStore store;
    private LocationManager locations;
    private String recordingUuid;
    private boolean explicitShutdown;
    private final Handler safetyHandler = new Handler(Looper.getMainLooper());
    private final Runnable safetyStop = () -> {
        interruptAndStop("maximum_duration");
        CompanionNotifications.showSafetyStop(this);
    };

    @Override
    public void onCreate() {
        super.onCreate();
        store = ((CompanionApplication) getApplication()).recordings();
        locations = getSystemService(LocationManager.class);
        isRunning = true;
        clearStartRequested();
    }

    static void markStartRequested() {
        markStartRequestedAt(System.nanoTime());
    }

    static void markStartRequestedAt(long requestedAtNs) {
        startRequestedAtNs = requestedAtNs;
    }

    static void clearStartRequested() {
        startRequestedAtNs = Long.MIN_VALUE;
    }

    static boolean isRunningOrStarting() {
        return isRunningOrStartingAt(System.nanoTime());
    }

    static boolean isRunningOrStartingAt(long nowNs) {
        if (isRunning) return true;
        long requestedAt = startRequestedAtNs;
        return requestedAt != Long.MIN_VALUE
            && nowNs - requestedAt < START_REQUEST_GRACE_NS;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent == null ? null : intent.getAction();
        if (action == null) {
            interruptAndStop("process_killed");
            return START_NOT_STICKY;
        }
        try {
            if (ACTION_START.equals(action)) {
                recordingUuid = intent.getStringExtra(EXTRA_RECORDING_UUID);
                if (recordingUuid == null) throw new IllegalStateException("Recording UUID is required.");
                promoteToForeground();
                requestLocations();
            } else if (ACTION_PAUSE.equals(action)) {
                resolveRecordingUuid();
                locations.removeUpdates(this);
                safetyHandler.removeCallbacks(safetyStop);
                store.pause(recordingUuid);
                refreshNotification();
            } else if (ACTION_RESUME.equals(action)) {
                resolveRecordingUuid();
                store.resume(recordingUuid);
                promoteToForeground();
                requestLocations();
            } else if (ACTION_STOP.equals(action)) {
                resolveRecordingUuid();
                explicitShutdown = true;
                locations.removeUpdates(this);
                safetyHandler.removeCallbacks(safetyStop);
                store.stop(recordingUuid);
                stopForeground(STOP_FOREGROUND_REMOVE);
                stopSelf();
            }
        } catch (SecurityException error) {
            interruptAndStop("permission_revoked");
        } catch (RuntimeException error) {
            interruptAndStop("process_killed");
        }
        return START_NOT_STICKY;
    }

    private void resolveRecordingUuid() {
        if (recordingUuid != null) return;
        RecordingModels.Summary active = store.activeRecording();
        if (active == null) throw new IllegalStateException("No open recording.");
        recordingUuid = active.uuid();
    }

    private void promoteToForeground() {
        RecordingModels.Summary summary = store.get(recordingUuid);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(
                CompanionNotifications.RECORDING_ID,
                CompanionNotifications.recording(this, summary),
                ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION
            );
        } else {
            startForeground(
                CompanionNotifications.RECORDING_ID,
                CompanionNotifications.recording(this, summary)
            );
        }
    }

    private void requestLocations() {
        if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            throw new SecurityException("Fine location permission is required.");
        }
        if (!locations.isProviderEnabled(LocationManager.GPS_PROVIDER)) {
            interruptAndStop("location_disabled");
            return;
        }
        locations.removeUpdates(this);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            LocationRequest request = new LocationRequest.Builder(10_000L)
                .setMinUpdateIntervalMillis(5_000L)
                .setMinUpdateDistanceMeters(5f)
                .setMaxUpdateDelayMillis(10_000L)
                .setQuality(LocationRequest.QUALITY_HIGH_ACCURACY)
                .build();
            locations.requestLocationUpdates(
                LocationManager.GPS_PROVIDER,
                request,
                getMainExecutor(),
                this
            );
        } else {
            locations.requestLocationUpdates(LocationManager.GPS_PROVIDER, 5_000L, 5f, this);
        }
        safetyHandler.removeCallbacks(safetyStop);
        safetyHandler.postDelayed(safetyStop, MAX_CONTINUOUS_RECORDING_MS);
    }

    @Override
    public void onLocationChanged(Location location) {
        if (recordingUuid == null) return;
        try {
            // Every callback delivered to this listener is committed. There is
            // deliberately no accuracy, duplicate or movement filter here.
            store.appendLocation(recordingUuid, location, System.currentTimeMillis());
            refreshNotification();
        } catch (RuntimeException error) {
            interruptAndStop("process_killed");
        }
    }

    @Override
    public void onProviderDisabled(String provider) {
        if (LocationManager.GPS_PROVIDER.equals(provider)) interruptAndStop("location_disabled");
    }

    private void refreshNotification() {
        if (recordingUuid == null) return;
        getSystemService(NotificationManager.class).notify(
            CompanionNotifications.RECORDING_ID,
            CompanionNotifications.recording(this, store.get(recordingUuid))
        );
    }

    private void interruptAndStop(String reason) {
        explicitShutdown = true;
        try {
            resolveRecordingUuid();
            RecordingModels.Summary summary = store.get(recordingUuid);
            if (!"stopped".equals(summary.state()) && !"interrupted".equals(summary.state())) {
                store.interrupt(recordingUuid, reason);
            }
        } catch (RuntimeException ignored) {
            // Nothing recoverable remains to transition.
        }
        if (locations != null) locations.removeUpdates(this);
        safetyHandler.removeCallbacks(safetyStop);
        stopForeground(STOP_FOREGROUND_REMOVE);
        stopSelf();
    }

    @Override
    public void onDestroy() {
        if (!explicitShutdown && recordingUuid != null) {
            try {
                store.interrupt(recordingUuid, "process_killed");
            } catch (RuntimeException ignored) {}
        }
        isRunning = false;
        clearStartRequested();
        safetyHandler.removeCallbacks(safetyStop);
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
