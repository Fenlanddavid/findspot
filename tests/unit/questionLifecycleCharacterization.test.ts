import { describe, expect, it } from 'vitest';
import { diffQuestions } from '../../src/outstandingQuestions/differ';
import type {
  OutstandingQuestion,
  QuestionCandidate,
  QuestionStatus,
} from '../../src/outstandingQuestions/types';

function question(overrides: Partial<OutstandingQuestion> = {}): OutstandingQuestion {
  return {
    id: 'question-1',
    permissionId: 'permission-1',
    ruleId: 'MOVEMENT_NO_FINDS',
    hypothesisId: 'activity_follows_route',
    anchor: { lat: 52, lon: 0 },
    title: 'Existing question',
    description: 'Existing description',
    category: 'MOVEMENT',
    status: 'UNRESOLVED',
    confidence: 0.8,
    createdAt: 100,
    updatedAt: 100,
    generatedByScanId: 'scan-1',
    supportingEvidence: [{ label: 'Shared A', sourceScanId: 'scan-1' }],
    contradictingEvidence: [],
    metrics: { localCoveragePct: 40, findsNearCount: 0, bufferM: 200 },
    ...overrides,
  };
}

function candidate(overrides: Partial<QuestionCandidate> = {}): QuestionCandidate {
  return {
    ruleId: 'MOVEMENT_NO_FINDS',
    hypothesisId: 'activity_follows_route',
    anchor: { lat: 52, lon: 0 },
    title: 'Current question',
    description: 'Current description',
    category: 'MOVEMENT',
    status: 'UNRESOLVED',
    confidence: 0.8,
    scanId: 'scan-2',
    supportingEvidence: [{ label: 'Shared A', sourceScanId: 'scan-2' }],
    contradictingEvidence: [],
    metrics: { localCoveragePct: 40, findsNearCount: 0, bufferM: 200 },
    ...overrides,
  };
}

describe('question lifecycle characterization', () => {
  it.each([
    ['UNRESOLVED', 'NEEDS_EVIDENCE', 'NEEDS_EVIDENCE'],
    ['NEEDS_EVIDENCE', 'UNRESOLVED', 'UNRESOLVED'],
    ['WEAKENING', 'UNRESOLVED', 'UNRESOLVED'],
  ] as Array<[QuestionStatus, QuestionCandidate['status'], QuestionStatus]>) (
    'moves %s to %s when matching evidence requests it',
    (from, candidateStatus, expected) => {
      const result = diffQuestions(
        [question({ status: from })],
        [candidate({ status: candidateStatus })],
        200,
      );

      expect(result.upserts[0]).toMatchObject({ id: 'question-1', status: expected });
      expect(result.resolved).toEqual([]);
    },
  );

  it('moves any active question through WEAKENING to preconditions-cleared resolution', () => {
    const first = diffQuestions([question({ status: 'NEEDS_EVIDENCE' })], [], 200);
    expect(first.upserts[0]).toMatchObject({
      id: 'question-1', status: 'WEAKENING', consecutiveMisses: 1,
    });

    const second = diffQuestions(first.upserts, [], 300);
    expect(second.resolved[0]).toMatchObject({
      id: 'question-1',
      status: 'RESOLVED',
      resolvedReason: 'preconditions_cleared',
      resolvedAt: 300,
      consecutiveMisses: 2,
    });
  });

  it('revives cap-evicted records with their stable identity', () => {
    const deferred = question({
      status: 'RESOLVED', resolvedReason: 'cap_evicted', resolvedAt: 150,
    });

    const result = diffQuestions([deferred], [candidate()], 200);

    expect(result.upserts[0]).toMatchObject({
      id: deferred.id,
      createdAt: deferred.createdAt,
      status: 'UNRESOLVED',
      resolvedReason: undefined,
      resolvedAt: undefined,
    });
  });

  it.each(['preconditions_cleared', 'superseded'] as const)(
    'keeps %s resolution terminal when similar evidence returns',
    resolvedReason => {
      const terminal = question({ status: 'RESOLVED', resolvedReason, resolvedAt: 150 });

      const result = diffQuestions([terminal], [candidate()], 200);

      expect(result.upserts).toHaveLength(1);
      expect(result.upserts[0].id).not.toBe(terminal.id);
      expect(result.upserts[0].status).toBe('UNRESOLVED');
    },
  );

  it('resolves a lower-confidence active question to its immediate superseding survivor', () => {
    const existing = question({
      confidence: 0.5,
      supportingEvidence: [
        { label: 'Shared A', sourceScanId: 'scan-1' },
        { label: 'Shared B', sourceScanId: 'scan-1' },
      ],
    });
    const survivor = candidate({
      ruleId: 'SETTLEMENT_QUIET',
      hypothesisId: 'settlement_signal_reflects_activity',
      category: 'CONTRADICTION',
      confidence: 0.9,
      supportingEvidence: [
        { label: 'Shared A', sourceScanId: 'scan-2' },
        { label: 'Shared B', sourceScanId: 'scan-2' },
      ],
    });

    const result = diffQuestions([existing], [survivor], 200);
    const kept = result.upserts[0];

    expect(kept.ruleId).toBe('SETTLEMENT_QUIET');
    expect(result.resolved).toContainEqual(expect.objectContaining({
      id: existing.id,
      status: 'RESOLVED',
      resolvedReason: 'superseded',
      supersededByIds: [kept.id],
    }));
  });
});
