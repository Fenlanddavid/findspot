import type { GeologyAuditEntry } from './geologyContextTypes';

export function geologyAuditWarning(entry: GeologyAuditEntry): string | null {
    if (entry.action === 'timeout') {
        return 'BGS geology lookup timed out. Scan unaffected.';
    }
    if (entry.action === 'request_fail' || entry.action === 'invalid_response') {
        return 'BGS geology unavailable via proxy. Scan unaffected.';
    }
    return null;
}
