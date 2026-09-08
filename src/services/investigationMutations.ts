import { db } from '../db';
import type {
  UndugSignalConditions,
  UndugSignalDirection,
  UndugSignalDugNothingCause,
  UndugSignalStability,
} from '../db';
import { isControlledObservation } from '../outstandingQuestions/investigationState';
import type { QuestionNote } from '../outstandingQuestions/types';
import { refreshHotspotPredictionOutcomes } from './hotspotPredictionService';

export async function saveQuestionInvestigationNote(note: QuestionNote): Promise<void> {
  const previous = await db.questionNotes.get(note.id);
  const [question, previousQuestion] = await Promise.all([
    db.outstandingQuestions.get(note.questionId),
    previous ? db.outstandingQuestions.get(previous.questionId) : undefined,
  ]);
  await db.transaction('rw', [db.questionNotes, db.outstandingQuestions], async () => {
    await db.questionNotes.put(note);
    if (isControlledObservation(note)) {
      await db.outstandingQuestions.update(note.questionId, {
        priorityState: { scansSinceEvidenceChange: 0 },
      });
    }
  });
  const affectsPrediction = (value: QuestionNote | undefined) =>
    value?.author === 'user' && (value.type === 'searched_nothing' || value.type === 'found_something');
  if (affectsPrediction(note) || affectsPrediction(previous)) {
    for (const permissionId of new Set([question?.permissionId, previousQuestion?.permissionId].filter((id): id is string => !!id))) {
      await refreshHotspotPredictionOutcomes(permissionId);
    }
  }
}

/** Removes a user report and immediately re-derives any prediction it supported. */
export async function deleteQuestionInvestigationNote(noteId: string): Promise<void> {
  const note = await db.questionNotes.get(noteId);
  if (!note) return;
  const question = await db.outstandingQuestions.get(note.questionId);
  await db.questionNotes.delete(noteId);
  if (question && note.author === 'user'
    && (note.type === 'searched_nothing' || note.type === 'found_something')) {
    await refreshHotspotPredictionOutcomes(question.permissionId);
  }
}

export async function setQuestionDismissed(questionId: string, dismissedByUser: boolean): Promise<void> {
  await db.outstandingQuestions.update(questionId, { dismissedByUser });
}

export async function recordUndugSignal(signal: Parameters<typeof db.undugSignals.add>[0]): Promise<void> {
  await db.undugSignals.add(signal);
}

export async function editUndugSignal(
  signalId: string,
  updates: {
    direction?: UndugSignalDirection;
    stability?: UndugSignalStability;
    conditions?: UndugSignalConditions;
    vdi?: string;
    notes?: string;
  },
): Promise<void> {
  await db.undugSignals.update(signalId, updates);
}

export async function dismissUndugSignal(signalId: string, resolvedAt: number): Promise<void> {
  await db.undugSignals.update(signalId, { status: 'dismissed', resolvedAt });
}

export async function resolveUndugSignalAsNothing(
  signalId: string,
  cause: UndugSignalDugNothingCause,
  resolvedAt: number,
): Promise<void> {
  await db.undugSignals.update(signalId, {
    status: 'dug-nothing',
    resolvedAt,
    dugNothingCause: cause,
  });
}
