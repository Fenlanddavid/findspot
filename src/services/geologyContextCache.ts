import { db } from '../db';
import type { GeologyContext } from '../engines/geologyContext/geologyContextTypes';
import {
    GEOLOGY_CACHE_TTL_MS,
    GEOLOGY_CLASSIFIER_VERSION,
    GEOLOGY_SOURCE_VERSION,
} from '../engines/geologyContext/geologyContextTypes';
import { safeParseGeologyContextRecord } from './persistenceValidation';
import { reportNonFatal } from './diagLog';

export type GeologyCacheLookup =
    | { kind: 'miss' }
    | { kind: 'empty' }
    | { kind: 'context'; context: GeologyContext };

export async function getCachedGeologyContext(tileKey: string): Promise<GeologyCacheLookup> {
    try {
        const persisted = await db.geologyContext.get(tileKey);
        if (!persisted) return { kind: 'miss' };
        const record = safeParseGeologyContextRecord(persisted);
        if (!record) {
            await db.geologyContext.delete(tileKey);
            return { kind: 'miss' };
        }

        if (Date.now() - record.fetchedAt > GEOLOGY_CACHE_TTL_MS) {
            await db.geologyContext.delete(tileKey);
            return { kind: 'miss' };
        }

        return record.empty === true
            ? { kind: 'empty' }
            : { kind: 'context', context: record.context };
    } catch {
        return { kind: 'miss' };
    }
}

export async function cacheGeologyContext(context: GeologyContext): Promise<void> {
    try {
        await db.geologyContext.put({
            tileKey: context.tileKey,
            centroid: context.centroid,
            context,
            fetchedAt: context.fetchedAt,
            classifierVersion: context.classifierVersion,
            sourceVersion: context.sourceVersion,
        });
    } catch (error) {
        reportNonFatal('geology-cache', 'Context cache write failed', error);
    }
}

export async function cacheEmptyGeologyContext(
    tileKey: string,
    centroid: { lat: number; lon: number },
    fetchedAt = Date.now(),
): Promise<void> {
    try {
        await db.geologyContext.put({
            tileKey,
            centroid,
            empty: true,
            fetchedAt,
            classifierVersion: GEOLOGY_CLASSIFIER_VERSION,
            sourceVersion: GEOLOGY_SOURCE_VERSION,
        });
    } catch (error) {
        reportNonFatal('geology-cache', 'Empty context cache write failed', error);
    }
}

export async function sweepStaleGeologyCache(): Promise<void> {
    try {
        const cutoff = Date.now() - GEOLOGY_CACHE_TTL_MS;
        await db.geologyContext.where('fetchedAt').below(cutoff).delete();

        const versionSuffix = `:classifier:v${GEOLOGY_CLASSIFIER_VERSION}:source:${GEOLOGY_SOURCE_VERSION}`;
        const orphans = await db.geologyContext
            .filter(record => !record.tileKey.endsWith(versionSuffix))
            .primaryKeys();
        if (orphans.length > 0) {
            await db.geologyContext.bulkDelete(orphans as string[]);
        }
    } catch (error) {
        reportNonFatal('geology-cache', 'Stale context cache sweep failed', error);
    }
}
