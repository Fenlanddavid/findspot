import { db } from '../db';
import type { Find, Media, SignificantFind } from '../db';

export async function createSignificantFindRecord(
  record: SignificantFind,
  linkedFindIdToMark?: string | null,
): Promise<void> {
  const tables = linkedFindIdToMark
    ? [db.significantFinds, db.finds]
    : [db.significantFinds];
  await db.transaction('rw', tables, async () => {
    await db.significantFinds.add(record);
    if (linkedFindIdToMark) {
      await db.finds.update(linkedFindIdToMark, {
        isNotableFind: true,
        updatedAt: record.updatedAt,
      });
    }
  });
}

export async function saveSignificantFindProgress(
  significantFindId: string,
  patch: Partial<SignificantFind>,
): Promise<void> {
  await db.significantFinds.update(significantFindId, {
    ...patch,
    updatedAt: patch.updatedAt ?? new Date().toISOString(),
  });
}

export async function setSignificantFindStatus(
  significantFindId: string,
  status: SignificantFind['status'],
): Promise<void> {
  await saveSignificantFindProgress(significantFindId, {
    status,
    ...(status !== 'in_progress' ? { workflowStep: null } : {}),
  });
}

export async function addSignificantFindMedia(media: Media): Promise<void> {
  await db.media.add(media);
}

export async function addScatterFind(find: Find): Promise<void> {
  await db.finds.add(find);
}

export async function saveLinkedFindDepth(findId: string, depthCm: number): Promise<void> {
  await db.finds.update(findId, { depthCm });
}

export async function completeNotableFindRecord(
  significantFindId: string,
  linkedFind: Find | null,
  updatedAt: string,
): Promise<void> {
  await db.transaction('rw', [db.significantFinds, db.finds], async () => {
    if (linkedFind) await db.finds.add(linkedFind);
    await db.significantFinds.update(significantFindId, {
      ...(linkedFind ? { linkedFindId: linkedFind.id } : {}),
      workflowStep: null,
      updatedAt,
    });
  });
}

export async function deleteSignificantFindAggregate(significantFindId: string): Promise<void> {
  const record = await db.significantFinds.get(significantFindId);
  const linkedFindIds = [
    ...(record?.scatterFindIds ?? []),
    ...(record?.linkedFindId ? [record.linkedFindId] : []),
  ];

  await db.transaction('rw', [db.significantFinds, db.finds, db.media], async () => {
    await db.media.where('findId').equals(significantFindId).delete();
    if (linkedFindIds.length) {
      await db.media.where('findId').anyOf(linkedFindIds).delete();
      await db.finds.bulkDelete(linkedFindIds);
    }
    await db.significantFinds.delete(significantFindId);
  });
}
