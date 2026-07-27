// GEOLOGY_RULE:
// Geology is modifier-only.
// It may alter interpretation, confidence and explanation.
// It must never create hotspots or targets.
// It must never elevate a location above threshold without support from existing primary signals.

export type { GeologyContext, GeologyAuditEntry, GeologyLandscapeClass } from './geologyContextTypes';
export { GEOLOGY_CLASSIFIER_VERSION, GEOLOGY_SOURCE_VERSION } from './geologyContextTypes';
export { buildGeologyDisplay } from './geologyExplain';
export type { GeologyDisplayData } from './geologyExplain';

import { fetchBgsGeology } from './geologyContextClient';
import { classifyGeology } from './geologyClassifier';
import { computeGeologyModifier } from './geologyModifiers';
import { buildTileKey } from './geologyTileKey';
import {
    cacheEmptyGeologyContext,
    cacheGeologyContext,
    getCachedGeologyContext,
} from '../../services/geologyContextCache';
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
    if (cached.kind === 'context') {
        audit({ action: 'cache_hit', reason: 'Valid geology context found in local cache.' });
        return cached.context;
    }
    if (cached.kind === 'empty') {
        audit({ action: 'cache_hit', reason: 'Valid empty geology result found in local cache.' });
        return null;
    }

    // ── 2. Fetch from BGS 625k ──
    const fetched = await fetchBgsGeology(centroid);

    if (!fetched.ok && fetched.kind === 'timeout') {
        audit({
            action: 'timeout',
            reason: `BGS lookup timed out after 8000ms. Geology modifier not applied.`,
        });
        return null;
    }

    if (!fetched.ok && fetched.kind === 'request_fail') {
        audit({
            action: 'request_fail',
            reason: 'BGS request failed before a valid response was received. Check network and proxy availability.',
        });
        return null;
    }

    if (!fetched.ok && fetched.kind === 'invalid_response') {
        audit({
            action: 'invalid_response',
            reason: 'BGS returned a response that could not be read as valid geology data.',
        });
        return null;
    }

    if (!fetched.ok) {
        await cacheEmptyGeologyContext(tileKey, centroid);
        audit({
            action: 'empty_response',
            reason: 'BGS returned no data for this tile. Geology context unavailable.',
        });
        return null;
    }
    const data = fetched.data;

    // ── 3. Classify ──
    const { landscapeClass, confidence, explanation } = classifyGeology(data);

    // ── 4. Compute the bounded class-level geology modifier ──
    const scoreModifier = computeGeologyModifier(landscapeClass, data);

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
        scoreModifier,
        explanation,
        fetchedAt:         Date.now(),
        classifierVersion: GEOLOGY_CLASSIFIER_VERSION,
        sourceVersion:     GEOLOGY_SOURCE_VERSION,
    };

    // ── 6. Cache ──
    await cacheGeologyContext(context);

    // ── 7. Audit ──
    audit({
        action:      'applied',
        reason:      `Geology modifier computed: ${landscapeClass}, ${confidence} confidence. Modifier: ${scoreModifier > 0 ? '+' : ''}${scoreModifier}. Applied to hotspots when primary signals are present.`,
        scoreEffect: scoreModifier,
    });

    return context;
}
