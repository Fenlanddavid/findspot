import { db } from '../db';
import type {
  UndugSignalConditions,
  UndugSignalDirection,
  UndugSignalDugNothingCause,
  UndugSignalStability,
} from '../db';
import { isControlledObservation } from '../outstandingQuestions/investigationState';
import type { QuestionNote } from '../outstandingQuestions/types';

export async function saveQuestionInvestigationNote(note: QuestionNote): Promise<void> {
  await db.transaction('rw', [db.questionNotes, db.outstandingQuestions], async () => {
    await db.questionNotes.put(note);
    if (isControlledObservation(note)) {
      await db.outstandingQuestions.update(note.questionId, {
        priorityState: { scansSinceEvidenceChange: 0 },
      });
    }
  });
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
