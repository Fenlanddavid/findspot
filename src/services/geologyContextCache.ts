import { db } from '../db';
import type { GeologyContext } from '../engines/geologyContext/geologyContextTypes';
import {
    GEOLOGY_CACHE_TTL_MS,
    GEOLOGY_CLASSIFIER_VERSION,
    GEOLOGY_SOURCE_VERSION,
} from '../engines/geologyContext/geologyContextTypes';
import { safeParseGeologyContextRecord } from './persistenceValidation';
import { reportNonFatal } from './diagLog';

export async function getCachedGeologyContext(tileKey: string): Promise<GeologyContext | null> {
    try {
        const persisted = await db.geologyContext.get(tileKey);
        if (!persisted) return null;
        const record = safeParseGeologyContextRecord(persisted);
        if (!record) {
            await db.geologyContext.delete(tileKey);
            return null;
        }

        if (Date.now() - record.fetchedAt > GEOLOGY_CACHE_TTL_MS) {
            await db.geologyContext.delete(tileKey);
            return null;
        }

        return record.context;
    } catch {
        return null;
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
