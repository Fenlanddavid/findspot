package uk.findspot.companion;

import android.app.Application;

public final class CompanionApplication extends Application {
    private RecordingStore recordingStore;

    @Override
    public void onCreate() {
        super.onCreate();
        recordingStore = new RecordingStore(this);
        recordingStore.getWritableDatabase();
        recordingStore.purgeExpiredExports(30L * 24L * 60L * 60L * 1_000L);
        CompanionNotifications.createChannels(this);
    }

    public RecordingStore recordings() {
        return recordingStore;
    }
}
