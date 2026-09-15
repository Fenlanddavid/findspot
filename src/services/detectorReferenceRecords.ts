import Dexie from 'dexie';
import type { Find, FindSpotDB } from '../db';
import { projectDetectorRecord, type DetectorReferenceRecord } from './detectorReferenceQuery';

/** Native getAll batches avoid thousands of cursor IPC round trips. The compound
 * index scopes each batch to one project; unrelated record text is released
 * after projection instead of retaining the complete find library in the UI. */
export async function readDetectorReferenceRecords(projectId: string, database: Pick<FindSpotDB, 'finds'>): Promise<DetectorReferenceRecord[]> {
  const rows: DetectorReferenceRecord[] = [];
  let after: string | number = Dexie.minKey;
  while (true) {
    const batch: Find[] = await database.finds.where('[projectId+id]')
      .between([projectId, after], [projectId, Dexie.maxKey], false, true).limit(500).toArray();
    for (const find of batch) rows.push(projectDetectorRecord(find));
    if (batch.length < 500) return rows;
    after = batch[batch.length - 1].id;
  }
}
