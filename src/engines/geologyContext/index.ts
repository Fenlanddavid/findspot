// GEOLOGY_RULE:
// Geology is modifier-only.
// It may alter interpretation, confidence and explanation.
// It must never create hotspots or targets.
// It must never elevate a location above threshold without support from existing primary signals.

export type { GeologyContext, GeologyAuditEntry, GeologyLandscapeClass } from './geologyContextTypes';
export { GEOLOGY_CLASSIFIER_VERSION, GEOLOGY_SOURCE_VERSION } from './geologyContextTypes';
export { buildGeologyDisplay } from './geologyExplain';
export type { GeologyDisplayData } from './geologyExplain';
export { sweepStaleGeologyCache } from './geologyCache';

import { fetchBgsGeology } from './geologyContextClient';
import { classifyGeology } from './geologyClassifier';
import { computeGeologyModifiers } from './geologyModifiers';
import { buildTileKey, getCachedGeologyContext, cacheGeologyContext } from './geologyCache';
import {
    GEOLOGY_CLASSIFIER_VERSION,
    GEOLOGY_SOURCE_VERSION,
} from './geologyContextTypes';
import type { GeologyContext, GeologyAuditEntry } from './geologyContextTypes';

// ─── Options ──────────────────────────────────────────────────────────────────

export type RunGeologyContextOptions = {
    onAudit?: (entry: GeologyAuditEntry) => void;
};

// ─── Main orchestrator ────────────────────────────────────────────────────────
// Called by FieldGuide after terrain scan completes.
// Returns null on any failure — scan always continues normally.

export async function runGeologyContext(
    centroid: { lat: number; lon: number },
    opts?: RunGeologyContextOptions,
): Promise<GeologyContext | null> {
    const { onAudit } = opts ?? {};
    const tileKey     = buildTileKey(centroid.lat, centroid.lon);

    function audit(entry: Omit<GeologyAuditEntry, 'timestamp' | 'tileKey'>): void {
        onAudit?.({ timestamp: Date.now(), tileKey, ...entry });
    }

    // ── 1. Cache check ──
    const cached = await getCachedGeologyContext(tileKey);
    if (cached) {
        audit({ action: 'cache_hit', reason: 'Valid geology context found in local cache.' });
        return cached;
    }

    // ── 2. Fetch from BGS 625k ──
    const { data, timedOut, corsError } = await fetchBgsGeology(centroid);

    if (timedOut) {
        audit({
            action: 'timeout',
            reason: `BGS lookup timed out after 8000ms. Geology modifier not applied.`,
        });
        return null;
    }

    if (corsError) {
        audit({
            action: 'cors_fail',
            reason: 'BGS request blocked by CORS. Check proxy configuration — see docs/bgs/bgs-queryable-layers.md.',
        });
        return null;
    }

    if (!data) {
        audit({
            action: 'empty_response',
            reason: 'BGS returned no data for this tile. Geology context unavailable.',
        });
        return null;
    }

    // ── 3. Classify ──
    const { landscapeClass, confidence, explanation } = classifyGeology(data);

    // ── 4. Compute modifiers (Phase 1: all zero) ──
    const modifiers = computeGeologyModifiers(landscapeClass, data);

    // ── 5. Build context object ──
    const context: GeologyContext = {
        tileKey,
        centroid,
        source: {
            bedrock:     data.bedrockName || data.bedrockLithology ? 'BGS_625K' : undefined,
            superficial: data.superficialName || data.superficialLithology ? 'BGS_625K' : undefined,
        },
        raw:              data,
        landscapeClass,
        confidence,
        modifiers,
        explanation,
        fetchedAt:         Date.now(),
        classifierVersion: GEOLOGY_CLASSIFIER_VERSION,
        sourceVersion:     GEOLOGY_SOURCE_VERSION,
    };

    // ── 6. Cache ──
    await cacheGeologyContext(context);

    // ── 7. Audit ──
    audit({
        action:      'not_applied',
        reason:      `Phase 1 — geology context recorded (${landscapeClass}, ${confidence} confidence). Scoring modifiers deferred to Phase 2.`,
        scoreEffect: 0,
    });

    return context;
}
