import {
    GEOLOGY_CLASSIFIER_VERSION,
    GEOLOGY_SOURCE_VERSION,
} from './geologyContextTypes';

// Geohash precision 6 is approximately a 1.2 km by 0.6 km cell, matching the
// scale of the BGS 1:625k geology source without adding another dependency.
const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';

function geohashEncode(lat: number, lon: number, precision = 6): string {
    let hash = '';
    let minLat = -90;
    let maxLat = 90;
    let minLon = -180;
    let maxLon = 180;
    let isEven = true;
    let bits = 0;
    let hashValue = 0;

    while (hash.length < precision) {
        if (isEven) {
            const mid = (minLon + maxLon) / 2;
            if (lon >= mid) {
                hashValue = (hashValue << 1) | 1;
                minLon = mid;
            } else {
                hashValue <<= 1;
                maxLon = mid;
            }
        } else {
            const mid = (minLat + maxLat) / 2;
            if (lat >= mid) {
                hashValue = (hashValue << 1) | 1;
                minLat = mid;
            } else {
                hashValue <<= 1;
                maxLat = mid;
            }
        }
        isEven = !isEven;
        bits++;
        if (bits === 5) {
            hash += BASE32[hashValue];
            bits = 0;
            hashValue = 0;
        }
    }
    return hash;
}

export function buildTileKey(lat: number, lon: number): string {
    const geohash = geohashEncode(lat, lon, 6);
    return `geology:${geohash}:classifier:v${GEOLOGY_CLASSIFIER_VERSION}:source:${GEOLOGY_SOURCE_VERSION}`;
}
