package uk.findspot.companion;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.LinearGradient;
import android.graphics.Shader;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.view.Gravity;
import android.view.View;
import android.widget.Button;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import java.io.IOException;
import java.text.DateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;

public final class MainActivity extends Activity {
    static final String EXTRA_SHOW_RECOVERY = "showRecovery";
    private static final int LOCATION_REQUEST = 100;

    private final Handler refreshHandler = new Handler(Looper.getMainLooper());
    private RecordingStore store;
    private LinearLayout actions;
    private TextView status;
    private boolean pendingStart;
    private String selectedRecordingUuid;

    private final Runnable refreshTask = new Runnable() {
        @Override
        public void run() {
            render();
            refreshHandler.postDelayed(this, 2_000L);
        }
    };

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        store = ((CompanionApplication) getApplication()).recordings();
        pendingStart = isStartDeepLink(getIntent());
        setContentView(buildContent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        if (isStartDeepLink(intent)) {
            pendingStart = true;
            beginStart();
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        RecordingModels.Summary active = store.activeRecording();
        if (active != null && "recording".equals(active.state()) && !RecordingService.isRunningOrStarting()) {
            String reason = !hasFineLocation()
                ? "permission_revoked"
                : !getSystemService(android.location.LocationManager.class)
                    .isProviderEnabled(android.location.LocationManager.GPS_PROVIDER)
                    ? "location_disabled"
                    : "process_killed";
            store.interrupt(active.uuid(), reason);
        }
        refreshHandler.post(refreshTask);
        if (pendingStart) beginStart();
    }

    @Override
    protected void onPause() {
        refreshHandler.removeCallbacks(refreshTask);
        super.onPause();
    }

    private View buildContent() {
        LinearLayout page = new LinearLayout(this);
        page.setOrientation(LinearLayout.VERTICAL);
        page.setPadding(dp(24), dp(32), dp(24), dp(24));
        page.setBackgroundColor(Color.rgb(247, 250, 249));

        LinearLayout brand = new LinearLayout(this);
        brand.setOrientation(LinearLayout.HORIZONTAL);
        brand.setGravity(Gravity.CENTER_VERTICAL);
        brand.setPadding(0, 0, 0, dp(12));

        ImageView logo = new ImageView(this);
        logo.setImageResource(R.drawable.findspot_logo);
        logo.setContentDescription("FindSpot logo");
        logo.setAdjustViewBounds(true);
        LinearLayout.LayoutParams logoLayout = new LinearLayout.LayoutParams(dp(44), dp(44));
        logoLayout.setMarginEnd(dp(10));
        brand.addView(logo, logoLayout);

        LinearLayout brandCopy = new LinearLayout(this);
        brandCopy.setOrientation(LinearLayout.VERTICAL);

        TextView title = text("FindSpot", 24, Color.rgb(16, 185, 129));
        title.setTypeface(Typeface.create("sans-serif", Typeface.BOLD));
        title.setLetterSpacing(-0.025f);
        title.getPaint().setShader(new LinearGradient(
            0f,
            0f,
            dp(118),
            0f,
            new int[] {
                Color.rgb(16, 185, 129),
                Color.rgb(20, 184, 166),
                Color.rgb(14, 165, 233),
            },
            new float[] { 0f, 0.5f, 1f },
            Shader.TileMode.CLAMP
        ));
        brandCopy.addView(title);

        TextView companion = text("COMPANION", 10, Color.rgb(75, 85, 99));
        companion.setTypeface(Typeface.create("sans-serif", Typeface.BOLD));
        companion.setLetterSpacing(0.18f);
        brandCopy.addView(companion);
        brand.addView(brandCopy, new LinearLayout.LayoutParams(0, -2, 1f));
        page.addView(brand);

        TextView principle = text("Records hardware. FindSpot owns meaning.", 14, Color.DKGRAY);
        principle.setPadding(0, dp(4), 0, dp(28));
        page.addView(principle);

        status = text("Loading local recording…", 18, Color.rgb(17, 24, 39));
        status.setPadding(dp(18), dp(18), dp(18), dp(18));
        status.setBackgroundColor(Color.WHITE);
        page.addView(status, new LinearLayout.LayoutParams(-1, -2));

        actions = new LinearLayout(this);
        actions.setOrientation(LinearLayout.VERTICAL);
        actions.setPadding(0, dp(18), 0, 0);
        page.addView(actions, new LinearLayout.LayoutParams(-1, -2));

        TextView privacy = text(
            "No account · no analytics · no cloud · no application-level remote requests",
            12,
            Color.GRAY
        );
        privacy.setGravity(Gravity.CENTER);
        privacy.setPadding(0, dp(30), 0, 0);
        page.addView(privacy);
        ScrollView scroll = new ScrollView(this);
        scroll.addView(page);
        return scroll;
    }

    private void render() {
        RecordingModels.Summary current = selectedRecordingUuid == null
            ? store.latest()
            : selectedRecording();
        actions.removeAllViews();
        if (current == null) {
            status.setText("Ready\n\nNo recording is stored on this device.");
            addPrimary("Start recording", this::beginStart);
            return;
        }

        String details = switch (current.state()) {
            case "recording" -> "Recording";
            case "paused" -> "Paused";
            case "interrupted" -> "Interrupted · " + friendlyReason(current.interruptionReason());
            case "stopped" -> "Stopped";
            default -> current.state();
        };
        details += "\n\n" + current.pointCount() + " raw GPS observations"
            + "\n" + (current.currentSegment() + 1) + " segment" + (current.currentSegment() == 0 ? "" : "s")
            + "\nStarted " + DateFormat.getDateTimeInstance().format(new Date(current.startedAtUtc()));
        if (current.exportedAtUtc() != null) details += "\nExported " + DateFormat.getDateTimeInstance().format(new Date(current.exportedAtUtc()));
        status.setText(details);

        switch (current.state()) {
            case "recording" -> {
                addSecondary("Pause", () -> serviceAction(RecordingService.ACTION_PAUSE, current.uuid()));
                addDanger("Stop", () -> serviceAction(RecordingService.ACTION_STOP, current.uuid()));
            }
            case "paused" -> {
                addPrimary("Resume in a new segment", () -> serviceAction(RecordingService.ACTION_RESUME, current.uuid()));
                addDanger("Stop", () -> serviceAction(RecordingService.ACTION_STOP, current.uuid()));
            }
            case "interrupted" -> {
                addPrimary("Resume in a new segment", () -> resumeInterrupted(current));
                addSecondary("Close recording", () -> { store.stop(current.uuid()); render(); });
                addDanger("Discard recording", () -> confirmDiscard(current));
            }
            case "stopped" -> {
                addPrimary("Share JSON to FindSpot", () -> shareJson(current));
                addSecondary("Export GPX", () -> shareGpx(current));
                addSecondary("Start another recording", this::beginStart);
                addDanger("Delete local copy", () -> confirmDiscard(current));
            }
        }
        if (store.recent().size() > 1) addSecondary("Choose another local recording", this::chooseRecording);
    }

    private void beginStart() {
        if (!hasFineLocation()) {
            pendingStart = true;
            List<String> permissions = new ArrayList<>();
            permissions.add(Manifest.permission.ACCESS_FINE_LOCATION);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                permissions.add(Manifest.permission.POST_NOTIFICATIONS);
            }
            requestPermissions(permissions.toArray(new String[0]), LOCATION_REQUEST);
            return;
        }
        if (!getSystemService(android.location.LocationManager.class).isProviderEnabled(android.location.LocationManager.GPS_PROVIDER)) {
            new AlertDialog.Builder(this)
                .setTitle("Turn on location")
                .setMessage("GPS must be enabled before Companion can record.")
                .setPositiveButton("Open settings", (dialog, which) -> startActivity(new Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS)))
                .setNegativeButton("Cancel", null)
                .show();
            return;
        }
        pendingStart = false;
        RecordingModels.Summary active = store.activeRecording();
        if (active != null) {
            selectedRecordingUuid = active.uuid();
            if ("interrupted".equals(active.state()) || "paused".equals(active.state())) resumeInterrupted(active);
            return;
        }
        RecordingModels.Summary recording = store.startNew();
        selectedRecordingUuid = recording.uuid();
        serviceAction(RecordingService.ACTION_START, recording.uuid());
    }

    private void resumeInterrupted(RecordingModels.Summary recording) {
        if (!hasFineLocation()) {
            pendingStart = true;
            requestPermissions(new String[]{Manifest.permission.ACCESS_FINE_LOCATION}, LOCATION_REQUEST);
            return;
        }
        serviceAction(RecordingService.ACTION_RESUME, recording.uuid());
    }

    private void serviceAction(String action, String uuid) {
        Intent service = new Intent(this, RecordingService.class)
            .setAction(action)
            .putExtra(RecordingService.EXTRA_RECORDING_UUID, uuid);
        if (RecordingService.ACTION_START.equals(action) || RecordingService.ACTION_RESUME.equals(action)) {
            RecordingService.markStartRequested();
            try {
                startForegroundService(service);
            } catch (RuntimeException error) {
                RecordingService.clearStartRequested();
                throw error;
            }
        } else {
            startService(service);
        }
        refreshHandler.postDelayed(this::render, 250L);
    }

    private void shareJson(RecordingModels.Summary recording) {
        try {
            Uri uri = ExportFiles.json(this, store.snapshot(recording.uuid()));
            Intent share = new Intent(Intent.ACTION_SEND)
                .setType(RecordingJson.MIME_TYPE)
                .putExtra(Intent.EXTRA_STREAM, uri)
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            store.markExported(recording.uuid());
            startActivity(Intent.createChooser(share, "Import with FindSpot"));
            render();
        } catch (IOException | RuntimeException error) {
            Toast.makeText(this, "Could not create JSON export: " + error.getMessage(), Toast.LENGTH_LONG).show();
        }
    }

    private void shareGpx(RecordingModels.Summary recording) {
        try {
            Uri uri = ExportFiles.gpx(this, store.snapshot(recording.uuid()));
            Intent share = new Intent(Intent.ACTION_SEND)
                .setType(RecordingGpx.MIME_TYPE)
                .putExtra(Intent.EXTRA_STREAM, uri)
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            startActivity(Intent.createChooser(share, "Export GPX"));
        } catch (IOException | RuntimeException error) {
            Toast.makeText(this, "Could not create GPX export: " + error.getMessage(), Toast.LENGTH_LONG).show();
        }
    }

    private void confirmDiscard(RecordingModels.Summary recording) {
        new AlertDialog.Builder(this)
            .setTitle("Delete this recording?")
            .setMessage(recording.exportedAtUtc() == null
                ? "This recording has not been exported. Deletion cannot be undone."
                : "The local Companion copy will be deleted. FindSpot data is not changed.")
            .setPositiveButton("Delete", (dialog, which) -> {
                store.discard(recording.uuid());
                selectedRecordingUuid = null;
                render();
            })
            .setNegativeButton("Cancel", null)
            .show();
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(requestCode, permissions, results);
        if (requestCode != LOCATION_REQUEST) return;
        if (hasFineLocation()) beginStart();
        else {
            pendingStart = false;
            Toast.makeText(this, "Precise location permission is required to record a trail.", Toast.LENGTH_LONG).show();
        }
    }

    private boolean hasFineLocation() {
        return checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    private static boolean isStartDeepLink(Intent intent) {
        Uri data = intent == null ? null : intent.getData();
        return data != null && "findspot-companion".equals(data.getScheme())
            && "record".equals(data.getHost()) && "/start".equals(data.getPath());
    }

    private String friendlyReason(String reason) {
        if (reason == null) return "unknown reason";
        return switch (reason) {
            case "process_killed" -> "app process ended";
            case "device_reboot" -> "device rebooted";
            case "permission_revoked" -> "location permission removed";
            case "location_disabled" -> "location switched off";
            default -> reason;
        };
    }

    private RecordingModels.Summary selectedRecording() {
        try {
            return store.get(selectedRecordingUuid);
        } catch (RuntimeException missing) {
            selectedRecordingUuid = null;
            return store.latest();
        }
    }

    private void chooseRecording() {
        List<RecordingModels.Summary> recordings = store.recent();
        String[] labels = recordings.stream().map(recording -> (
            DateFormat.getDateTimeInstance().format(new Date(recording.startedAtUtc()))
                + " · " + recording.state()
                + " · " + recording.pointCount() + " points"
        )).toArray(String[]::new);
        new AlertDialog.Builder(this)
            .setTitle("Local recordings")
            .setItems(labels, (dialog, which) -> {
                selectedRecordingUuid = recordings.get(which).uuid();
                render();
            })
            .setNegativeButton("Cancel", null)
            .show();
    }

    private void addPrimary(String label, Runnable action) { addButton(label, action, Color.rgb(5, 150, 105), Color.WHITE); }
    private void addSecondary(String label, Runnable action) { addButton(label, action, Color.WHITE, Color.rgb(6, 95, 70)); }
    private void addDanger(String label, Runnable action) { addButton(label, action, Color.rgb(254, 242, 242), Color.rgb(185, 28, 28)); }

    private void addButton(String label, Runnable action, int background, int foreground) {
        Button button = new Button(this);
        button.setText(label);
        button.setTextColor(foreground);
        button.setBackgroundColor(background);
        button.setAllCaps(false);
        button.setTextSize(15);
        button.setOnClickListener(view -> action.run());
        LinearLayout.LayoutParams layout = new LinearLayout.LayoutParams(-1, dp(52));
        layout.bottomMargin = dp(10);
        actions.addView(button, layout);
    }

    private TextView text(String value, float size, int color) {
        TextView view = new TextView(this);
        view.setText(value);
        view.setTextSize(size);
        view.setTextColor(color);
        return view;
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }
}
