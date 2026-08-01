package uk.findspot.companion;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public final class RebootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (!Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())) return;
        RecordingStore store = ((CompanionApplication) context.getApplicationContext()).recordings();
        RecordingModels.Summary active = store.activeRecording();
        if (active == null) return;
        store.interrupt(active.uuid(), "device_reboot");
        CompanionNotifications.showRecovery(context);
    }
}
