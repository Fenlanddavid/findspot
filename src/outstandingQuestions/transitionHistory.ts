import type { OutstandingQuestion, QuestionStatus } from './types';

export const MAX_SUPERSEDE_CHAIN_DEPTH = 5;

export const STATUS_TRANSITION_COPY: Record<`${QuestionStatus}:${QuestionStatus}`, string> = {
  'UNRESOLVED:UNRESOLVED': 'The investigation remained open.',
  'UNRESOLVED:NEEDS_EVIDENCE': 'The investigation now needs more fieldwork evidence.',
  'UNRESOLVED:WEAKENING': 'The landscape signal was not seen in the latest scan and is weakening.',
  'UNRESOLVED:RESOLVED': 'The investigation closed after the latest scan.',
  'NEEDS_EVIDENCE:UNRESOLVED': 'The investigation moved to open after new scan evidence.',
  'NEEDS_EVIDENCE:NEEDS_EVIDENCE': 'The investigation still needs more fieldwork evidence.',
  'NEEDS_EVIDENCE:WEAKENING': 'The landscape signal was not seen in the latest scan and is weakening.',
  'NEEDS_EVIDENCE:RESOLVED': 'The investigation closed after the latest scan.',
  'WEAKENING:UNRESOLVED': 'The landscape signal returned and the investigation is open again.',
  'WEAKENING:NEEDS_EVIDENCE': 'The landscape signal returned, but more fieldwork evidence is needed.',
  'WEAKENING:WEAKENING': 'The investigation remained in a weakening state.',
  'WEAKENING:RESOLVED': 'The investigation closed after two scans without the landscape signal.',
  'RESOLVED:UNRESOLVED': 'The investigation reopened after the landscape signal returned.',
  'RESOLVED:NEEDS_EVIDENCE': 'The investigation reopened and needs more fieldwork evidence.',
  'RESOLVED:WEAKENING': 'The investigation reopened in a weakening state.',
  'RESOLVED:RESOLVED': 'The investigation remained resolved.',
};

export function statusTransitionText(from: QuestionStatus, to: QuestionStatus): string {
  return STATUS_TRANSITION_COPY[`${from}:${to}`];
}

const MERGED_FROM_TEMPLATE = 'Merged from an earlier investigation ({title}).';

export function mergedFromText(title: string): string {
  return MERGED_FROM_TEMPLATE.replace('{title}', title);
}

export function terminalSupersedingQuestionId(
  startId: string,
  questions: ReadonlyMap<string, Pick<OutstandingQuestion, 'id' | 'supersededByIds'>>,
): string {
  let currentId = startId;
  const seen = new Set([startId]);
  for (let depth = 0; depth < MAX_SUPERSEDE_CHAIN_DEPTH; depth += 1) {
    const nextId = questions.get(currentId)?.supersededByIds?.[0];
    if (!nextId || seen.has(nextId)) return currentId;
    currentId = nextId;
    seen.add(currentId);
  }
  return currentId;
}
