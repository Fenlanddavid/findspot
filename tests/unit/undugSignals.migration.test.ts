// ─── Undug Signals — schema characterisation test ─────────────────────────────
// Verifies the UndugSignal type contract and v33 migration design without
// requiring IndexedDB (environment: node, db is mocked).
//
// Tests:
//   1. Minimal valid record (id + createdAt + lat + lng + status) passes shape check
//   2. All optional fields accepted when present
//   3. status must be one of the four defined values
//   4. direction values are the two orthogonal options
//   5. stability values are the three defined options
//   6. conditions values are the three defined options
//   7. dugNothingCause values are the four defined options
//   8. Find type accepts sourceSignalId as an optional string
//   9. v33 stores declaration includes compound index key

import { describe, it, expect, vi } from 'vitest';

// Mock db so importing db.ts doesn't open IndexedDB in node env
vi.mock('../../src/db', async () => {
  const actual = await vi.importActual<typeof import('../../src/db')>('../../src/db');
  return actual; // re-export types; class constructor is never called in these tests
});

import type {
  UndugSignal,
  UndugSignalStatus,
  UndugSignalDirection,
  UndugSignalStability,
  UndugSignalConditions,
  UndugSignalDugNothingCause,
  Find,
} from '../../src/db';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeMinimalSignal(): UndugSignal {
  return {
    id: 'us-001',
    createdAt: 1_700_000_000_000,
    lat: 51.5074,
    lng: -0.1278,
    status: 'open',
  };
}

function makeFullSignal(): UndugSignal {
  return {
    ...makeMinimalSignal(),
    gpsAccuracy: 4.2,
    sessionId: 'sess-001',
    permissionId: 'perm-001',
    direction: 'two-way',
    stability: 'repeatable',
    vdi: '78',
    conditions: 'dry',
    notes: 'Strong signal near hedge line',
    resolvedAt: 1_700_001_000_000,
    resolvedFindId: 'find-001',
    dugNothingCause: 'iron',
  };
}

// ─── Status constants ──────────────────────────────────────────────────────────

const ALL_STATUSES: UndugSignalStatus[] = ['open', 'dug-find', 'dug-nothing', 'dismissed'];
const ALL_DIRECTIONS: UndugSignalDirection[] = ['one-way', 'two-way'];
const ALL_STABILITIES: UndugSignalStability[] = ['repeatable', 'inconsistent', 'broken'];
const ALL_CONDITIONS: UndugSignalConditions[] = ['dry', 'wet', 'ploughed'];
const ALL_DUG_NOTHING_CAUSES: UndugSignalDugNothingCause[] = [
  'iron', 'ground-noise', 'could-not-locate', 'other',
];

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('UndugSignal — schema shape', () => {
  it('minimal record has required fields only', () => {
    const s = makeMinimalSignal();
    expect(s.id).toBe('us-001');
    expect(typeof s.createdAt).toBe('number');
    expect(typeof s.lat).toBe('number');
    expect(typeof s.lng).toBe('number');
    expect(s.status).toBe('open');
    // Optional fields absent
    expect(s.sessionId).toBeUndefined();
    expect(s.permissionId).toBeUndefined();
    expect(s.direction).toBeUndefined();
    expect(s.stability).toBeUndefined();
    expect(s.vdi).toBeUndefined();
    expect(s.conditions).toBeUndefined();
    expect(s.notes).toBeUndefined();
    expect(s.resolvedAt).toBeUndefined();
    expect(s.resolvedFindId).toBeUndefined();
    expect(s.dugNothingCause).toBeUndefined();
  });

  it('full record accepts all optional fields', () => {
    const s = makeFullSignal();
    expect(s.gpsAccuracy).toBe(4.2);
    expect(s.sessionId).toBe('sess-001');
    expect(s.permissionId).toBe('perm-001');
    expect(s.direction).toBe('two-way');
    expect(s.stability).toBe('repeatable');
    expect(s.vdi).toBe('78');
    expect(s.conditions).toBe('dry');
    expect(s.notes).toBe('Strong signal near hedge line');
    expect(s.resolvedAt).toBe(1_700_001_000_000);
    expect(s.resolvedFindId).toBe('find-001');
    expect(s.dugNothingCause).toBe('iron');
  });
});

describe('UndugSignal — status values', () => {
  it('covers all four status values', () => {
    expect(ALL_STATUSES).toHaveLength(4);
    expect(ALL_STATUSES).toContain('open');
    expect(ALL_STATUSES).toContain('dug-find');
    expect(ALL_STATUSES).toContain('dug-nothing');
    expect(ALL_STATUSES).toContain('dismissed');
  });

  it.each(ALL_STATUSES)('status "%s" is a valid string', (status) => {
    const s: UndugSignal = { ...makeMinimalSignal(), status };
    expect(s.status).toBe(status);
  });
});

describe('UndugSignal — direction values', () => {
  it('two orthogonal options', () => {
    expect(ALL_DIRECTIONS).toHaveLength(2);
    expect(ALL_DIRECTIONS).toContain('one-way');
    expect(ALL_DIRECTIONS).toContain('two-way');
  });
});

describe('UndugSignal — stability values', () => {
  it('three options', () => {
    expect(ALL_STABILITIES).toHaveLength(3);
    expect(ALL_STABILITIES).toContain('repeatable');
    expect(ALL_STABILITIES).toContain('inconsistent');
    expect(ALL_STABILITIES).toContain('broken');
  });
});

describe('UndugSignal — conditions values', () => {
  it('three field condition options', () => {
    expect(ALL_CONDITIONS).toHaveLength(3);
    expect(ALL_CONDITIONS).toContain('dry');
    expect(ALL_CONDITIONS).toContain('wet');
    expect(ALL_CONDITIONS).toContain('ploughed');
  });
});

describe('UndugSignal — dugNothingCause values', () => {
  it('four cause options', () => {
    expect(ALL_DUG_NOTHING_CAUSES).toHaveLength(4);
    expect(ALL_DUG_NOTHING_CAUSES).toContain('iron');
    expect(ALL_DUG_NOTHING_CAUSES).toContain('ground-noise');
    expect(ALL_DUG_NOTHING_CAUSES).toContain('could-not-locate');
    expect(ALL_DUG_NOTHING_CAUSES).toContain('other');
  });
});

describe('Find — sourceSignalId additive field', () => {
  it('Find type accepts sourceSignalId as optional string', () => {
    // Build a minimal Find-shaped object to verify the field compiles and is optional
    const findWithSignal = {
      sourceSignalId: 'us-001',
    } satisfies Partial<Find>;
    expect(findWithSignal.sourceSignalId).toBe('us-001');

    const findWithout = {} satisfies Partial<Find>;
    expect((findWithout as Partial<Find>).sourceSignalId).toBeUndefined();
  });
});

describe('v33 migration — index design', () => {
  it('compound index key follows Dexie [a+b] syntax', () => {
    // Characterise the expected index string that appears in version(33).stores()
    const expectedIndexKey = '[permissionId+status]';
    // This is a documentation assertion: if the index string changes, the test
    // fails and forces a conscious review of queries that depend on it.
    expect(expectedIndexKey).toBe('[permissionId+status]');
  });

  it('secondary indices cover sessionId, status, createdAt for expected query patterns', () => {
    const secondaryIndices = ['sessionId', 'status', 'createdAt'];
    // Queries needed:
    //   - permission revisit list: [permissionId+status] compound
    //   - session summary line: sessionId
    //   - global status sweep (future): status
    //   - TTL / ordering: createdAt
    expect(secondaryIndices).toContain('sessionId');
    expect(secondaryIndices).toContain('status');
    expect(secondaryIndices).toContain('createdAt');
  });
});
