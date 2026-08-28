package uk.findspot.companion;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.util.List;
import java.util.Set;
import org.junit.Test;

public final class ExternalIntentPolicyTest {
    private boolean valid(String action, String path, Set<String> names, List<String> sessions, List<String> finishes, int length) {
        String query = null;
        if (!sessions.isEmpty()) query = "session=" + String.join("&session=", sessions);
        if (!finishes.isEmpty()) {
            String finishQuery = "finish=" + String.join("&finish=", finishes);
            query = query == null ? finishQuery : query + "&" + finishQuery;
        }
        return ExternalIntentPolicy.isValidControl(
            action,
            "findspot-companion",
            "record",
            path,
            query,
            null,
            names,
            sessions,
            finishes,
            length
        );
    }

    @Test
    public void acceptsBoundedStartAndStopControls() {
        assertTrue(valid("android.intent.action.VIEW", "/start", Set.of("session"), List.of("session-1"), List.of(), 80));
        assertTrue(valid("android.intent.action.VIEW", "/stop", Set.of("finish"), List.of(), List.of("1"), 60));
    }

    @Test
    public void rejectsWrongActionsPathsAndUnexpectedParameters() {
        assertFalse(valid("android.intent.action.SEND", "/start", Set.of(), List.of(), List.of(), 40));
        assertFalse(valid("android.intent.action.VIEW", "/unexpected", Set.of(), List.of(), List.of(), 40));
        assertFalse(valid("android.intent.action.VIEW", "/start", Set.of("timestamp"), List.of(), List.of(), 40));
        assertFalse(ExternalIntentPolicy.isValidControl(
            "android.intent.action.VIEW", "findspot-companion", "user@record", "/start",
            null, null, Set.of(), List.of(), List.of(), 50
        ));
    }

    @Test
    public void rejectsDuplicatesMalformedIdsAndOversizedValues() {
        assertFalse(valid("android.intent.action.VIEW", "/start", Set.of("session"), List.of("one", "two"), List.of(), 80));
        assertFalse(valid("android.intent.action.VIEW", "/start", Set.of("session"), List.of("../encoded/slash"), List.of(), 80));
        assertFalse(valid("android.intent.action.VIEW", "/start", Set.of("session"), List.of("x".repeat(129)), List.of(), 200));
        assertFalse(valid("android.intent.action.VIEW", "/start", Set.of(), List.of(), List.of(), 2_049));
        assertFalse(valid("android.intent.action.VIEW", "/start", Set.of("finish"), List.of(), List.of("1"), 60));
        assertFalse(valid("android.intent.action.VIEW", "/stop", Set.of("finish"), List.of(), List.of("0"), 60));
    }

    @Test
    public void rejectsEncodedPathsQueriesAndFragments() {
        assertFalse(valid("android.intent.action.VIEW", "/st%61rt", Set.of(), List.of(), List.of(), 40));
        assertFalse(valid("android.intent.action.VIEW", "/start%2Fextra", Set.of(), List.of(), List.of(), 50));
        assertFalse(ExternalIntentPolicy.isValidControl(
            "android.intent.action.VIEW", "findspot-companion", "record", "/start",
            "session=abc%2Fdef", null, Set.of("session"), List.of("abc/def"), List.of(), 60
        ));
        assertFalse(ExternalIntentPolicy.isValidControl(
            "android.intent.action.VIEW", "findspot-companion", "record", "/start",
            null, "unexpected", Set.of(), List.of(), List.of(), 50
        ));
    }

    @Test
    public void rebootPolicyAcceptsOnlyBootCompleted() {
        assertTrue(ExternalIntentPolicy.isBootCompleted("android.intent.action.BOOT_COMPLETED"));
        assertFalse(ExternalIntentPolicy.isBootCompleted("android.intent.action.LOCKED_BOOT_COMPLETED"));
        assertFalse(ExternalIntentPolicy.isBootCompleted(null));
    }
}
