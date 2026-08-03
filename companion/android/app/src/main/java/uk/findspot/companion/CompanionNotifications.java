package uk.findspot.companion;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;

final class CompanionNotifications {
    static final String RECORDING_CHANNEL = "recording";
    static final String RECOVERY_CHANNEL = "recovery";
    static final int RECORDING_ID = 41;
    static final int RECOVERY_ID = 42;

    private CompanionNotifications() {}

    static void createChannels(Context context) {
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        NotificationChannel recording = new NotificationChannel(
            RECORDING_CHANNEL,
            "GPS recording",
            NotificationManager.IMPORTANCE_LOW
        );
        recording.setDescription("Required while FindSpot Companion records location.");
        recording.setSound(null, null);
        manager.createNotificationChannel(recording);

        NotificationChannel recovery = new NotificationChannel(
            RECOVERY_CHANNEL,
            "Recording recovery",
            NotificationManager.IMPORTANCE_DEFAULT
        );
        recovery.setDescription("Offers recovery after a reboot or interrupted recording.");
        manager.createNotificationChannel(recovery);
    }

    static Notification recording(Context context, RecordingModels.Summary summary) {
        boolean paused = "paused".equals(summary.state());
        Intent open = new Intent(
            Intent.ACTION_VIEW,
            Uri.parse("https://fenlanddavid.github.io/findspot/")
        );
        PendingIntent openIntent = PendingIntent.getActivity(
            context, 0, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        Notification.Builder builder = new Notification.Builder(context, RECORDING_CHANNEL)
            .setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setContentTitle(paused ? "Companion recording paused" : "Companion is recording")
            .setContentText(summary.pointCount() + " observations saved · Tap FindSpot to stop")
            .setContentIntent(openIntent)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setCategory(Notification.CATEGORY_SERVICE);

        return builder.build();
    }

    static void showRecovery(Context context) {
        Intent open = new Intent(context, MainActivity.class)
            .putExtra(MainActivity.EXTRA_SHOW_RECOVERY, true);
        PendingIntent openIntent = PendingIntent.getActivity(
            context, 3, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        Notification notification = new Notification.Builder(context, RECOVERY_CHANNEL)
            .setSmallIcon(android.R.drawable.ic_dialog_alert)
            .setContentTitle("FindSpot recording was interrupted")
            .setContentText("Tap to resume, close or discard the local recording.")
            .setContentIntent(openIntent)
            .setAutoCancel(true)
            .build();
        context.getSystemService(NotificationManager.class).notify(RECOVERY_ID, notification);
    }

    static void showSafetyStop(Context context) {
        Intent open = new Intent(context, MainActivity.class)
            .putExtra(MainActivity.EXTRA_SHOW_RECOVERY, true);
        PendingIntent openIntent = PendingIntent.getActivity(
            context, 4, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        Notification notification = new Notification.Builder(context, RECOVERY_CHANNEL)
            .setSmallIcon(android.R.drawable.ic_dialog_alert)
            .setContentTitle("Companion stopped after 12 hours")
            .setContentText("Your trail is safe. Tap to close, export or resume it.")
            .setContentIntent(openIntent)
            .setAutoCancel(true)
            .build();
        context.getSystemService(NotificationManager.class).notify(RECOVERY_ID, notification);
    }

}
