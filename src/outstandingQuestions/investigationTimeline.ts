import type { Find } from '../db';
import type { OutstandingQuestion, QuestionNote, ResolvedOutcome } from './types';

export const TIMELINE_FALLBACK_BUFFER_M = 250;

export const CLOSURE_OUTCOME_COPY: Record<ResolvedOutcome, string> = {
  likely_supported: 'Likely supported — recorded fieldwork added the expected evidence.',
  likely_unsupported: 'Likely unsupported — adequate fieldwork did not add the expected evidence. Closing this is a successful investigation outcome.',
  inconclusive_adequate: 'Inconclusive after adequate fieldwork — the evidence remains mixed.',
  not_applicable: 'No longer relevant — the landscape signal is not present in recent scans.',
};

export type InvestigationTimelineEvent =
  | { id: string; kind: 'creation'; at: number; text: string }
  | { id: string; kind: 'note'; at: number; note: QuestionNote }
  | { id: string; kind: 'find'; at: number; find: Find; text: string }
  | { id: string; kind: 'closure'; at: number; text: string };

function distM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function findTimestamp(find: Find): number | null {
  for (const raw of [find.foundAt, find.createdAt]) {
    if (!raw) continue;
    const parsed = Date.parse(raw);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

const FIND_EVENT_TEMPLATE = 'Recorded nearby find: {name}.';

export function buildInvestigationTimeline(
  question: OutstandingQuestion,
  notes: readonly QuestionNote[],
  permissionFinds: readonly Find[],
): InvestigationTimelineEvent[] {
  const events: InvestigationTimelineEvent[] = [{
    id: `creation:${question.id}`,
    kind: 'creation',
    at: question.createdAt,
    text: 'Investigation created from FieldGuide scan evidence.',
  }];

  for (const note of notes) {
    events.push({ id: `note:${note.id}`, kind: 'note', at: note.createdAt, note });
  }

  const bufferM = question.metrics?.bufferM ?? TIMELINE_FALLBACK_BUFFER_M;
  for (const find of permissionFinds) {
    if (find.lat == null || find.lon == null ||
        distM(question.anchor.lat, question.anchor.lon, find.lat, find.lon) > bufferM) continue;
    const at = findTimestamp(find);
    if (at == null) continue;
    const name = find.objectType?.trim() || 'Unnamed find';
    events.push({
      id: `find:${find.id}`,
      kind: 'find',
      at,
      find,
      text: FIND_EVENT_TEMPLATE.replace('{name}', name),
    });
  }

  if (question.status === 'RESOLVED' && question.resolvedAt != null) {
    events.push({
      id: `closure:${question.id}`,
      kind: 'closure',
      at: question.resolvedAt,
      text: question.resolvedOutcome
        ? CLOSURE_OUTCOME_COPY[question.resolvedOutcome]
        : 'Investigation resolved.',
    });
  }

  const kindOrder = { creation: 0, note: 1, find: 2, closure: 3 } as const;
  return events.sort((a, b) => a.at - b.at || kindOrder[a.kind] - kindOrder[b.kind] || a.id.localeCompare(b.id));
}
