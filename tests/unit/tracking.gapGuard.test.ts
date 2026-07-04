// ─── Gap-guard unit tests ────────────────────────────────────────────────────
// Verifies that maybeRecordGap prevents duplicate gaps from repeated watchdog
// ticks while correctly recording legitimate new gaps.

import { describe, it, expect } from 'vitest';
import { maybeRecordGap } from '../../src/services/tracking';

describe('maybeRecordGap — duplicate gap guard', () => {
  it('records a gap into an empty list', () => {
    const gaps: { start: number; end: number }[] = [];
    const result = maybeRecordGap(gaps, 1000, 2000);
    expect(result).toBe(true);
    expect(gaps).toEqual([{ start: 1000, end: 2000 }]);
  });

  it('rejects a gap when gapStart is null', () => {
    const gaps: { start: number; end: number }[] = [];
    const result = maybeRecordGap(gaps, null, 2000);
    expect(result).toBe(false);
    expect(gaps).toEqual([]);
  });

  it('rejects a duplicate gap from the same anchor (repeated watchdog tick)', () => {
    const gaps = [{ start: 1000, end: 2000 }];
    // Same gapStart (1000) — watchdog fires again before any new fix
    const result = maybeRecordGap(gaps, 1000, 3000);
    expect(result).toBe(false);
    expect(gaps).toHaveLength(1);
  });

  it('rejects when last gap end equals gapStart exactly', () => {
    const gaps = [{ start: 1000, end: 2000 }];
    const result = maybeRecordGap(gaps, 2000, 3000);
    expect(result).toBe(false);
    expect(gaps).toHaveLength(1);
  });

  it('records a new gap when gapStart is after the last gap end', () => {
    const gaps = [{ start: 1000, end: 2000 }];
    // New accepted fix arrived at 2500, then went stale again
    const result = maybeRecordGap(gaps, 2500, 4000);
    expect(result).toBe(true);
    expect(gaps).toHaveLength(2);
    expect(gaps[1]).toEqual({ start: 2500, end: 4000 });
  });

  it('handles multiple legitimate gaps in sequence', () => {
    const gaps: { start: number; end: number }[] = [];
    // First gap
    maybeRecordGap(gaps, 1000, 2000);
    // Duplicate of first — rejected
    const dup = maybeRecordGap(gaps, 1000, 2500);
    expect(dup).toBe(false);
    // New fix at 3000, then stale again
    maybeRecordGap(gaps, 3000, 4000);
    // Duplicate of second — rejected
    const dup2 = maybeRecordGap(gaps, 3000, 4500);
    expect(dup2).toBe(false);
    // Third legitimate gap
    maybeRecordGap(gaps, 5000, 6000);

    expect(gaps).toEqual([
      { start: 1000, end: 2000 },
      { start: 3000, end: 4000 },
      { start: 5000, end: 6000 },
    ]);
  });
});
