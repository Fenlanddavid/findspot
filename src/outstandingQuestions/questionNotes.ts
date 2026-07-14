import { db } from '../db';

/**
 * Delete generated question rows while applying the note-retention policy.
 * Migrations and generator-owned cleanup preserve user notes by default;
 * an explicit parent-record cascade can opt out and remove every note.
 */
export async function deleteQuestionsWithNotes(
  questionIds: readonly string[],
  options: { preserveUserNotes?: boolean } = {},
): Promise<void> {
  if (questionIds.length === 0) return;

  if (options.preserveUserNotes === false) {
    await db.questionNotes.where('questionId').anyOf([...questionIds]).delete();
  } else {
    const attachedNotes = await db.questionNotes
      .where('questionId')
      .anyOf([...questionIds])
      .toArray();
    const systemNoteIds = attachedNotes
      .filter(note => note.author === 'system')
      .map(note => note.id);
    if (systemNoteIds.length > 0) {
      await db.questionNotes.bulkDelete(systemNoteIds);
    }
  }

  await db.outstandingQuestions.bulkDelete([...questionIds]);
}
