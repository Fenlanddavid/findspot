import { db } from '../../db';
import {
    GEOLOGY_CACHE_TTL_MS,
    GEOLOGY_CLASSIFIER_VERSION,
    GEOLOGY_SOURCE_VERSION,
} from './geologyContextTypes';
import type { GeologyContext } from './geologyContextTypes';
import { safeParseGeologyContextRecord } from '../../services/persistenceValidation';

// ─── Geohash encoder (precision 6) ───────────────────────────────────────────
// Minimal inline implementation — avoids adding a dependency for ~50 lines.
// Precision 6 = ~1.2km × 0.6km cell, appropriate for 1:625k geology scale.

const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';

function geohashEncode(lat: number, lon: number, precision = 6): string {
    let hash      = '';
    let minLat    = -90,  maxLat = 90;
    let minLon    = -180, maxLon = 180;
    let isEven    = true;
    let bits      = 0;
    let hashValue = 0;

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

// ─── Tile key ─────────────────────────────────────────────────────────────────
// Format: geology:{geohash6}:classifier:{v}:source:{sv}
// Version components ensure cache invalidation when logic or source changes.

export function buildTileKey(lat: number, lon: number): string {
    const gh = geohashEncode(lat, lon, 6);
    return `geology:${gh}:classifier:v${GEOLOGY_CLASSIFIER_VERSION}:source:${GEOLOGY_SOURCE_VERSION}`;
}

// ─── Cache read ───────────────────────────────────────────────────────────────

export async function getCachedGeologyContext(
    tileKey: string,
): Promise<GeologyContext | null> {
    try {
        const persisted = await db.geologyContext.get(tileKey);
        if (!persisted) return null;
        const record = safeParseGeologyContextRecord(persisted);
        if (!record) {
            await db.geologyContext.delete(tileKey);
            return null;
        }

        const age = Date.now() - record.fetchedAt;
        if (age > GEOLOGY_CACHE_TTL_MS) {
            // Stale — delete and re-fetch
            await db.geologyContext.delete(tileKey);
            return null;
        }

        return record.context;
    } catch {
        return null;
    }
}

// ─── Cache write ──────────────────────────────────────────────────────────────

export async function cacheGeologyContext(context: GeologyContext): Promise<void> {
    try {
        await db.geologyContext.put({
            tileKey:           context.tileKey,
            centroid:          context.centroid,
            context,
            fetchedAt:         context.fetchedAt,
            classifierVersion: context.classifierVersion,
            sourceVersion:     context.sourceVersion,
        });
    } catch {
        // Cache write failure is non-fatal
    }
}

// ─── Stale cache sweep ────────────────────────────────────────────────────────
// Deletes records that are:
//   (a) older than 90 days, or
//   (b) recorded with a mismatched classifier or source version key
//       (these will never be queried again — they become orphans on version bump).
//
// Called once at DB open / app startup to prevent accumulation.

export async function sweepStaleGeologyCache(): Promise<void> {
    try {
        const cutoff = Date.now() - GEOLOGY_CACHE_TTL_MS;
        await db.geologyContext
            .where('fetchedAt')
            .below(cutoff)
            .delete();

        // Sweep version orphans: records whose tileKey doesn't match current versions
        const versionSuffix = `:classifier:v${GEOLOGY_CLASSIFIER_VERSION}:source:${GEOLOGY_SOURCE_VERSION}`;
        const orphans = await db.geologyContext
            .filter(r => !r.tileKey.endsWith(versionSuffix))
            .primaryKeys();
        if (orphans.length > 0) {
            await db.geologyContext.bulkDelete(orphans as string[]);
        }
    } catch {
        // Sweep failure is non-fatal
    }
}
