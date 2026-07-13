// ─── Outstanding Questions — diff engine ────────────────────────────────────
// Pure function: (existing, candidates) => DiffResult
// Handles identity matching, carry-forward, WEAKENING detection, cap eviction.
// Same pattern as maybeRecordGap() — testable without Dexie.

import { v4 as uuid } from 'uuid';
import type { OutstandingQuestion, QuestionCandidate, DiffResult } from './types';

// ─── Constants ──────────────────────────────────────────────────────────────

const MATCH_RADIUS_M = 100;
const WEAKENING_RELATIVE_THRESHOLD = 0.25; // ≥ 25% relative drop
const MAX_ACTIVE = 5;
const DEDUPE_SHARED_LABELS = 2;

export interface QuestionDiffScope {
  contains: (question: OutstandingQuestion) => boolean;
}

// ─── Distance helper ────────────────────────────────────────────────────────

function distM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── Diff engine ────────────────────────────────────────────────────────────

export function diffQuestions(
  existing: OutstandingQuestion[],
  candidates: QuestionCandidate[],
  now: number = Date.now(),
  scope: QuestionDiffScope = { contains: () => true },
): DiffResult {
  const active = existing.filter(q => q.status !== 'RESOLVED');
  const deferred = existing.filter(q =>
    q.status === 'RESOLVED' && q.resolvedReason === 'cap_evicted'
  );
  const matchable = [...active, ...deferred];

  // Track which existing questions matched
  const matchedExistingIds = new Set<string>();

  // 1. Match candidates to existing questions
  const matched: { candidate: QuestionCandidate; existing: OutstandingQuestion }[] = [];
  const unmatched: QuestionCandidate[] = [];

  for (const candidate of candidates) {
    // Find existing non-RESOLVED questions with same ruleId within radius
    const possibleMatches = matchable
      .filter(q =>
        q.ruleId === candidate.ruleId &&
        !matchedExistingIds.has(q.id) &&
        distM(q.anchor.lat, q.anchor.lon, candidate.anchor.lat, candidate.anchor.lon) < MATCH_RADIUS_M
      )
      .sort((a, b) => {
        const distA = distM(a.anchor.lat, a.anchor.lon, candidate.anchor.lat, candidate.anchor.lon);
        const distB = distM(b.anchor.lat, b.anchor.lon, candidate.anchor.lat, candidate.anchor.lon);
        if (Math.abs(distA - distB) < 0.01) return a.createdAt - b.createdAt; // Oldest wins tie
        return distA - distB;
      });

    if (possibleMatches.length > 0) {
      const match = possibleMatches[0];
      matchedExistingIds.add(match.id);
      matched.push({ candidate, existing: match });
    } else {
      unmatched.push(candidate);
    }
  }

  // 2. Build updated questions from matches (carry-forward)
  const updatedQuestions: OutstandingQuestion[] = [];

  for (const { candidate, existing: ex } of matched) {
    const relDrop = ex.confidence > 0
      ? (ex.confidence - candidate.confidence) / ex.confidence
      : 0;
    const isWeakening = relDrop >= WEAKENING_RELATIVE_THRESHOLD;

    const status = isWeakening ? 'WEAKENING' as const : candidate.status;

    updatedQuestions.push({
      ...ex,
      anchor: candidate.anchor,
      title: candidate.title,
      description: candidate.description,
      confidence: candidate.confidence,
      status,
      updatedAt: now,
      generatedByScanId: candidate.scanId,
      supportingEvidence: candidate.supportingEvidence,
      contradictingEvidence: candidate.contradictingEvidence,
      locationActionAllowed: candidate.locationActionAllowed,
      consecutiveMisses: 0,
      // Preserve id, createdAt, permissionId, ruleId, category
      resolvedReason: undefined,
      resolvedAt: undefined,
    });
  }

  // 3. Create new questions from unmatched candidates
  for (const candidate of unmatched) {
    updatedQuestions.push({
      id: uuid(),
      permissionId: '', // Set by caller
      ruleId: candidate.ruleId,
      anchor: candidate.anchor,
      title: candidate.title,
      description: candidate.description,
      category: candidate.category,
      status: candidate.status,
      confidence: candidate.confidence,
      createdAt: now,
      updatedAt: now,
      generatedByScanId: candidate.scanId,
      supportingEvidence: candidate.supportingEvidence,
      contradictingEvidence: candidate.contradictingEvidence,
      locationActionAllowed: candidate.locationActionAllowed,
      consecutiveMisses: 0,
    });
  }

  // 4. Only questions re-examined by this scan can weaken or resolve. Require
  // two consecutive scoped misses so a transient source change cannot close one.
  const newlyResolved: OutstandingQuestion[] = [];
  const untouched: OutstandingQuestion[] = [];
  for (const q of active) {
    if (matchedExistingIds.has(q.id)) continue;
    if (!scope.contains(q)) {
      untouched.push(q);
      continue;
    }

    const consecutiveMisses = (q.consecutiveMisses ?? 0) + 1;
    if (consecutiveMisses >= 2) {
      newlyResolved.push({
        ...q,
        status: 'RESOLVED',
        resolvedReason: 'preconditions_cleared',
        resolvedAt: now,
        updatedAt: now,
        consecutiveMisses,
      });
    } else {
      updatedQuestions.push({
        ...q,
        status: 'WEAKENING',
        updatedAt: now,
        consecutiveMisses,
      });
    }
  }

  // 5. Dedupe: if two candidates fire on overlapping evidence (≥ 2 shared labels),
  // keep higher confidence and resolve any active question it supersedes.
  const deduped = deduplicateCandidates(updatedQuestions);
  const dedupedIds = new Set(deduped.map(q => q.id));
  const superseded = updatedQuestions
    .filter(q => !dedupedIds.has(q.id))
    .map(q => ({
      ...q,
      status: 'RESOLVED' as const,
      resolvedReason: 'superseded' as const,
      resolvedAt: now,
      updatedAt: now,
    }));

  // 6. Apply cap — rank by confidence, evict excess
  // Questions outside this scan retain their place. New/scoped questions use
  // the remaining slots and cannot evict evidence that was not re-examined.
  const availableSlots = Math.max(0, MAX_ACTIVE - untouched.length);
  const { kept, evicted } = applyCap(deduped, now, availableSlots);

  return {
    upserts: [...untouched, ...kept],
    resolved: [...newlyResolved, ...superseded, ...evicted],
  };
}

// ─── Deduplication ──────────────────────────────────────────────────────────

function deduplicateCandidates(questions: OutstandingQuestion[]): OutstandingQuestion[] {
  const result: OutstandingQuestion[] = [];
  const evictedIds = new Set<string>();

  // Sort by confidence desc for greedy selection
  const sorted = [...questions].sort((a, b) => b.confidence - a.confidence);

  for (const q of sorted) {
    if (evictedIds.has(q.id)) continue;

    const labelsA = new Set(q.supportingEvidence.map(e => e.label));
    // Check against already-kept questions
    let isDuplicate = false;
    for (const kept of result) {
      const labelsB = new Set(kept.supportingEvidence.map(e => e.label));
      let shared = 0;
      for (const l of labelsA) {
        if (labelsB.has(l)) shared++;
      }
      if (shared >= DEDUPE_SHARED_LABELS && kept.ruleId !== q.ruleId) {
        isDuplicate = true;
        break;
      }
    }

    if (!isDuplicate) {
      result.push(q);
    } else {
      evictedIds.add(q.id);
    }
  }

  return result;
}

// ─── Cap enforcement ────────────────────────────────────────────────────────

function applyCap(
  questions: OutstandingQuestion[],
  now: number,
  limit: number = MAX_ACTIVE,
): { kept: OutstandingQuestion[]; evicted: OutstandingQuestion[] } {
  // Sort by confidence descending, then oldest createdAt for stability
  const sorted = [...questions].sort((a, b) =>
    b.confidence - a.confidence || a.createdAt - b.createdAt
  );

  const kept = sorted.slice(0, limit);
  const evicted = sorted.slice(limit).map(q => ({
    ...q,
    status: 'RESOLVED' as const,
    resolvedReason: 'cap_evicted' as const,
    resolvedAt: now,
    updatedAt: now,
  }));

  return { kept, evicted };
}
