// ─── Scheduled Monument Gate ──────────────────────────────────────────────────
// The NHLE scan query targets FeatureServer/6 — the Scheduled Monuments layer
// ONLY. Every feature it returns IS a scheduled monument, so the presence of
// ANY feature in the scan area means overlap. There is no per-feature decision
// to make and no Name parsing to do.
//
// History: a previous version matched properties.Name against the literal string
// "scheduled". Real SM records are named for the asset ("Bowl barrow 350m north
// of...", "Roman fort and vicus") and never contain that word, so Name-matching
// FALSE-CLEARS genuine scheduled monuments. The gate must fail safe: presence
// == flag.
//
// If the query scope is ever widened beyond FeatureServer/6 to mixed
// designations, do NOT reintroduce Name matching. Add a real designation-type
// filter keyed on an actual type field (e.g. DESIG_TYPE) — which the current
// NHLE response does not expose.

import type { NHLEFeature } from '../../../services/historicScanService';

export function isScheduledMonumentOverlap(
    // _geohash6 retained for future cache keying — not used in current logic
    _geohash6: string,
    nhleFeatures: NHLEFeature[],
): boolean {
    return nhleFeatures.length > 0;
}
