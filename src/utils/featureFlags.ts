// ─── Feature flags ────────────────────────────────────────────────────────────
// Flags controlling cutover between live APIs and R2-backed static datasets.
// Each flag has a versioned removal marker — remove the flag AND the legacy
// code path together once the R2 path is verified against a live sample.

/**
 * When true, fetchScheduledMonuments and fetchAIMData read from the
 * findspot-static R2 worker instead of live ArcGIS FeatureServers.
 *
 * REMOVE_AFTER_RELEASE: v4.3.0
 * Removal trigger: the "zero ArcGIS FeatureServer calls on normal scan" test
 * must pass (it asserts no services-eu1.arcgis.com/FeatureServer hits when
 * this flag is deleted). Do not remove until R2 path is verified against live
 * ArcGIS for a sample of SM cells (run diff-sm-index.mjs first).
 */
export const USE_R2_DESIGNATIONS = true;

/**
 * Base URL for the findspot-static Cloudflare Worker.
 * Update this after deploying workers/findspot-static/.
 */
export const FINDSPOT_STATIC_BASE_URL = 'https://findspot-static.trials-uk.workers.dev';
