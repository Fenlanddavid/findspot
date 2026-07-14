import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  notesToArray: vi.fn(),
  deleteAttachedNotes: vi.fn(),
  bulkDeleteNotes: vi.fn(),
  bulkDeleteQuestions: vi.fn(),
}));

vi.mock('../../src/db', () => ({
  db: {
    questionNotes: {
      where: () => ({
        anyOf: () => ({
          toArray: mocks.notesToArray,
          delete: mocks.deleteAttachedNotes,
        }),
      }),
      bulkDelete: mocks.bulkDeleteNotes,
    },
    outstandingQuestions: {
      bulkDelete: mocks.bulkDeleteQuestions,
    },
  },
}));

import { deleteQuestionsWithNotes } from '../../src/outstandingQuestions/questionNotes';

describe('generated question note retention', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.notesToArray.mockResolvedValue([
      { id: 'user-1', questionId: 'question-1', author: 'user' },
      { id: 'user-2', questionId: 'question-1', author: 'user' },
      { id: 'system-1', questionId: 'question-1', author: 'system' },
    ]);
  });

  it('preserves user notes and removes system notes when generated questions are deleted', async () => {
    await deleteQuestionsWithNotes(['question-1']);

    expect(mocks.bulkDeleteNotes).toHaveBeenCalledWith(['system-1']);
    expect(mocks.deleteAttachedNotes).not.toHaveBeenCalled();
    expect(mocks.bulkDeleteQuestions).toHaveBeenCalledWith(['question-1']);
  });

  it('removes all attached notes for an explicit parent-record cascade', async () => {
    await deleteQuestionsWithNotes(['question-1'], { preserveUserNotes: false });

    expect(mocks.deleteAttachedNotes).toHaveBeenCalledOnce();
    expect(mocks.notesToArray).not.toHaveBeenCalled();
    expect(mocks.bulkDeleteNotes).not.toHaveBeenCalled();
    expect(mocks.bulkDeleteQuestions).toHaveBeenCalledWith(['question-1']);
  });
});
