// ─── Geohash utilities (shared) ───────────────────────────────────────────────
// Single source for the precision-6 encoder and the bbox→cells coverage
// function used by historicScanService.ts (R2 lookups) and offlinePack.ts
// (pack build). Keeping them here prevents the two callers from drifting.

const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';

/**
 * Encode a lat/lon to a geohash string at the given precision.
 * Default precision 6 ≈ 1.2 km × 0.6 km cell.
 */
export function geohashEncode(lat: number, lon: number, precision = 6): string {
    let hash = '', minLat = -90, maxLat = 90, minLon = -180, maxLon = 180;
    let isEven = true, bits = 0, hashValue = 0;
    while (hash.length < precision) {
        if (isEven) {
            const mid = (minLon + maxLon) / 2;
            if (lon >= mid) { hashValue = (hashValue << 1) | 1; minLon = mid; }
            else            { hashValue = hashValue << 1;        maxLon = mid; }
        } else {
            const mid = (minLat + maxLat) / 2;
            if (lat >= mid) { hashValue = (hashValue << 1) | 1; minLat = mid; }
            else            { hashValue = hashValue << 1;        maxLat = mid; }
        }
        isEven = !isEven; bits++;
        if (bits === 5) { hash += BASE32[hashValue]; bits = 0; hashValue = 0; }
    }
    return hash;
}

/**
 * Returns the deduplicated set of geohash6 cells that a bbox touches.
 *
 * Samples the bbox at 0.004° intervals — finer than one precision-6 cell in
 * either dimension (~0.011° wide × 0.0055° tall at mid-latitudes), so no cell
 * is missed regardless of where the bbox edges fall within a cell.
 */
export function bboxToGeohash6Cells(
    west: number,
    south: number,
    east: number,
    north: number,
): string[] {
    const STEP = 0.004;
    const cells = new Set<string>();
    for (let lat = south; lat <= north + STEP; lat += STEP) {
        for (let lon = west; lon <= east + STEP; lon += STEP) {
            cells.add(geohashEncode(Math.min(lat, north), Math.min(lon, east)));
        }
    }
    return Array.from(cells);
}
