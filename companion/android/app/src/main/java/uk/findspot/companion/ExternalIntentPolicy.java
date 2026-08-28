package uk.findspot.companion;

import java.util.List;
import java.util.Set;
import java.util.regex.Pattern;

final class ExternalIntentPolicy {
    static final int MAX_CONTROL_URI_CHARS = 2_048;
    static final int MAX_SESSION_ID_CHARS = 128;
    private static final Pattern SESSION_ID = Pattern.compile("[A-Za-z0-9._:-]{1," + MAX_SESSION_ID_CHARS + "}");
    private static final Set<String> CONTROL_PARAMETERS = Set.of("session", "finish");

    private ExternalIntentPolicy() {}

    static boolean isValidControl(
        String action,
        String scheme,
        String encodedAuthority,
        String encodedPath,
        String encodedQuery,
        String encodedFragment,
        Set<String> parameterNames,
        List<String> sessions,
        List<String> finishes,
        int encodedUriLength
    ) {
        if (!"android.intent.action.VIEW".equals(action)
            || !"findspot-companion".equals(scheme)
            || !"record".equals(encodedAuthority)
            || (!"/start".equals(encodedPath) && !"/stop".equals(encodedPath))
            || encodedFragment != null
            || encodedUriLength <= 0
            || encodedUriLength > MAX_CONTROL_URI_CHARS
            || !hasOnlyPlainControlParameters(encodedQuery)
            || !CONTROL_PARAMETERS.containsAll(parameterNames)
            || sessions.size() > 1
            || finishes.size() > 1) return false;

        if (!sessions.isEmpty() && !SESSION_ID.matcher(sessions.get(0)).matches()) return false;
        if ("/start".equals(encodedPath) && !finishes.isEmpty()) return false;
        return finishes.isEmpty() || "1".equals(finishes.get(0));
    }

    private static boolean hasOnlyPlainControlParameters(String encodedQuery) {
        if (encodedQuery == null) return true;
        if (encodedQuery.isEmpty()) return false;
        for (String part : encodedQuery.split("&", -1)) {
            if ("finish=1".equals(part)) continue;
            if (part.startsWith("session=")
                && SESSION_ID.matcher(part.substring("session=".length())).matches()) continue;
            return false;
        }
        return true;
    }

    static boolean isBootCompleted(String action) {
        return "android.intent.action.BOOT_COMPLETED".equals(action);
    }
}
