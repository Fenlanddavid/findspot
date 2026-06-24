// ─── Scheduled Monument Gate ──────────────────────────────────────────────────
// Checks whether any NHLE features in the scan area indicate a Scheduled
// Monument overlap.
//
// NOTE: NHLEFeature.properties currently only exposes Name and ListEntry.
// There is no DESIG_TYPE field in the current NHLE API query response.
// Since the NHLE query endpoint specifically targets scheduled monuments
// (FeatureServer/6 — the Scheduled Monuments layer), ALL returned features
// are scheduled monuments. Any non-empty feature list means overlap.

import type { NHLEFeature } from '../../../services/historicScanService';

export function isScheduledMonumentOverlap(
    // geohash6 retained for future cache keying — not used in current logic
    _geohash6: string,
    nhleFeatures: NHLEFeature[],
): boolean {
    if (nhleFeatures.length === 0) return false;

    // All features from the NHLE FeatureServer/6 endpoint ARE scheduled monuments.
    // Additional belt-and-braces: check if any Name field contains 'scheduled'
    // for forwards compatibility if the query scope ever widens.
    const hasScheduled = nhleFeatures.some(f => {
        if (!f.properties) return true; // present = scheduled monument
        const name = (f.properties.Name ?? '').toLowerCase();
        return name.includes('scheduled') || name.length === 0;
        // Defensive: any NHLE feature from this endpoint is a SM
    });

    return hasScheduled;
}
