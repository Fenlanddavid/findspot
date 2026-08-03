package uk.findspot.companion;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.After;
import org.junit.Test;

public final class RecordingServiceLifecycleTest {
    @After
    public void resetLifecycleState() {
        RecordingService.isRunning = false;
        RecordingService.clearStartRequested();
    }

    @Test
    public void requestedForegroundStartCountsAsAliveDuringStartupGrace() {
        RecordingService.isRunning = false;
        RecordingService.markStartRequestedAt(1_000L);

        assertTrue(RecordingService.isRunningOrStartingAt(4_999_999_999L));
        assertFalse(RecordingService.isRunningOrStartingAt(5_000_001_000L));
    }

    @Test
    public void runningServiceCountsAsAliveWithoutPendingRequest() {
        RecordingService.clearStartRequested();
        RecordingService.isRunning = true;

        assertTrue(RecordingService.isRunningOrStartingAt(Long.MAX_VALUE));
    }

    @Test
    public void continuousRecordingHasATwelveHourSafetyLimit() {
        assertTrue(RecordingService.MAX_CONTINUOUS_RECORDING_MS == 43_200_000L);
    }
}
