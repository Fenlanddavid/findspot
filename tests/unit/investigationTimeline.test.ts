import { describe, expect, it } from 'vitest';
import { buildInvestigationTimeline } from '../../src/outstandingQuestions/investigationTimeline';
import type { OutstandingQuestion, QuestionNote } from '../../src/outstandingQuestions/types';

function question(overrides: Partial<OutstandingQuestion> = {}): OutstandingQuestion {
  return {
    id: 'q-1', permissionId: 'p-1', ruleId: 'MOVEMENT_NO_FINDS',
    hypothesisId: 'activity_follows_route', anchor: { lat: 52, lon: 0 },
    title: 'Question', description: 'Description', category: 'MOVEMENT',
    status: 'UNRESOLVED', confidence: 0.7, createdAt: 100, updatedAt: 100,
    generatedByScanId: 'scan-1', supportingEvidence: [], contradictingEvidence: [],
    metrics: { localCoveragePct: 20, findsNearCount: 0, bufferM: 200 },
    ...overrides,
  };
}

describe('investigation timeline', () => {
  it('interleaves creation, notes, finds and closure chronologically, newest last', () => {
    const notes: QuestionNote[] = [{
      id: 'n-1', questionId: 'q-1', author: 'user', type: 'freeform',
      text: 'Observed conditions.', createdAt: 200,
    }];
    const events = buildInvestigationTimeline(
      question({ status: 'RESOLVED', resolvedAt: 400, resolvedOutcome: 'inconclusive_adequate' }),
      notes,
      [{
        id: 'f-1', permissionId: 'p-1', lat: 52.0005, lon: 0,
        objectType: 'Coin', foundAt: new Date(300).toISOString(), createdAt: new Date(350).toISOString(),
      } as any],
    );

    expect(events.map(event => event.kind)).toEqual(['creation', 'note', 'find', 'closure']);
    expect(events.map(event => event.at)).toEqual([100, 200, 300, 400]);
  });

  it('renders creation alone when no other events exist', () => {
    const events = buildInvestigationTimeline(question(), [], []);
    expect(events.map(event => event.kind)).toEqual(['creation']);
  });

  it('excludes finds outside the investigation buffer', () => {
    const events = buildInvestigationTimeline(question(), [], [{
      id: 'far', permissionId: 'p-1', lat: 52.01, lon: 0,
      objectType: 'Coin', createdAt: new Date(300).toISOString(),
    } as any]);
    expect(events.some(event => event.kind === 'find')).toBe(false);
  });

  it('uses creation time when a legacy find has an invalid foundAt value', () => {
    const events = buildInvestigationTimeline(question(), [], [{
      id: 'legacy', permissionId: 'p-1', lat: 52, lon: 0,
      objectType: 'Coin', foundAt: 'invalid', createdAt: new Date(300).toISOString(),
    } as any]);
    expect(events.find(event => event.kind === 'find')?.at).toBe(300);
  });
});
