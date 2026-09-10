import Dexie, { type Table } from 'dexie';
import type { FindSpotDB, Media } from '../../db';
import { BACKED_UP_TABLE_NAMES } from './tableRegistry';
import { reportNonFatal } from '../diagLog';

const PREFIX = 'findspot_export_staging_';

class ExportSnapshotDB extends Dexie {
  media!: Table<Media, string>;
  constructor() {
    super(`${PREFIX}${Date.now()}_${crypto.randomUUID()}`);
    this.version(1).stores({ media: 'id' });
  }
}

export async function cleanupStaleExportSnapshots(): Promise<void> {
  try {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    for (const name of await Dexie.getDatabaseNames()) {
      if (name.startsWith(PREFIX) && Number(name.slice(PREFIX.length).split('_')[0]) < cutoff) {
        await Dexie.delete(name);
      }
    }
  } catch (error) {
    reportNonFatal('backup', 'Export snapshot cleanup failed', error);
  }
}

/** Capture all records and disk-backed media under one source read lock.
 * Only one media row is retained at a time. Compression happens after the
 * source transaction finishes, so field saves can continue during archiving.
 * The separate staging database is never a recovery backup.
 */
export async function withExportSnapshot<T, R>(
  database: FindSpotDB,
  includeMedia: boolean,
  collect: () => Promise<T>,
  consume: (manifest: T, snapshot?: Pick<FindSpotDB, 'media'>) => Promise<R>,
): Promise<R> {
  const snapshot = includeMedia ? new ExportSnapshotDB() : undefined;
  try {
    if (snapshot) await snapshot.open();
    const manifest = await database.transaction('r', BACKED_UP_TABLE_NAMES.map(name => database.table(name)), async () => {
      const records = await collect();
      if (snapshot) {
        const ids = await database.media.toCollection().primaryKeys();
        for (const id of ids) {
          const media = await database.media.get(id);
          if (!media) throw new Error('A photo could not be captured. Please retry the backup.');
          // waitFor only wraps work on the OTHER database, never source reads.
          await Dexie.waitFor(snapshot.media.put(media));
        }
      }
      return records;
    });
    return await consume(manifest, snapshot);
  } finally {
    if (snapshot) {
      snapshot.close();
      try { await snapshot.delete(); }
      catch (error) { reportNonFatal('backup', 'Export snapshot cleanup failed', error); }
    }
  }
}
