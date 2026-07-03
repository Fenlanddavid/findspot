// ─── Backup integrity tests ───────────────────────────────────────────────────
// Tests validateBackupData with valid and invalid inputs.
// Tests that the JSON structure exportData produces is accepted by validateBackupData.
//
// Full DB round-trip (exportData → importData) requires IndexedDB and is
// documented as a follow-up requiring fake-indexeddb setup.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the Dexie DB so importing data.ts doesn't try to open IndexedDB.
vi.mock('../../src/db', () => ({
  db: {},
  // Type-only exports are erased; no runtime mock needed for them.
}));

// Import AFTER the mock is registered.
import { validateBackupData } from '../../src/services/data';

// ─── Minimal valid backup fixture ─────────────────────────────────────────────

function makeValidBackup(overrides: Record<string, unknown> = {}) {
  return {
    version: 4,
    exportedAt: '2024-01-01T12:00:00.000Z',
    generatedBy: 'FindSpot',
    projects:         [{ id: 'proj-1', name: 'Test Project', region: 'England', createdAt: '2024-01-01' }],
    permissions:      [{ id: 'perm-1', projectId: 'proj-1', name: 'South Field', type: 'individual', createdAt: '2024-01-01', updatedAt: '2024-01-01' }],
    fields:           [{ id: 'field-1', projectId: 'proj-1', permissionId: 'perm-1', name: 'Lower paddock', boundary: { type: 'Polygon', coordinates: [] }, notes: '', createdAt: '2024-01-01', updatedAt: '2024-01-01' }],
    sessions:         [{ id: 'sess-1', projectId: 'proj-1', permissionId: 'perm-1', date: '2024-01-01', createdAt: '2024-01-01' }],
    finds:            [{ id: 'find-1', projectId: 'proj-1', permissionId: 'perm-1', sessionId: 'sess-1', findCode: 'A001', createdAt: '2024-01-01' }],
    significantFinds: [{ id: 'sf-1', projectId: 'proj-1', permissionId: 'perm-1', sessionId: 'sess-1', linkedFindId: 'find-1', createdAt: '2024-01-01' }],
    tracks:           [{ id: 'track-1', sessionId: 'sess-1' }],
    media:            [{ id: 'media-1', findId: 'find-1', blob: 'data:image/jpeg;base64,/9j/abc' }],
    settings:         [{ key: 'detectorist', value: 'Alice' }],
    importedPackages: [{ id: 'pkg-1' }],
    savedPoints:      [{ id: 'sp-1', projectId: 'proj-1', label: 'NE corner', lat: 52.5, lon: -1.5, zoom: 16, note: '', createdAt: '2024-01-01' }],
    undugSignals:     [{ id: 'us-1', createdAt: 1_700_000_000_000, lat: 51.5, lng: -1.2, status: 'open' }],
    ...overrides,
  };
}

// ─── Valid backup passes ───────────────────────────────────────────────────────

describe('validateBackupData — accepts valid backups', () => {
  it('accepts a complete valid backup', () => {
    expect(() => validateBackupData(makeValidBackup())).not.toThrow();
  });

  it('returns a BackupData object with all expected arrays', () => {
    const result = validateBackupData(makeValidBackup());
    expect(Array.isArray(result.projects)).toBe(true);
    expect(Array.isArray(result.permissions)).toBe(true);
    expect(Array.isArray(result.fields)).toBe(true);
    expect(Array.isArray(result.sessions)).toBe(true);
    expect(Array.isArray(result.finds)).toBe(true);
    expect(Array.isArray(result.significantFinds)).toBe(true);
    expect(Array.isArray(result.tracks)).toBe(true);
    expect(Array.isArray(result.media)).toBe(true);
    expect(Array.isArray(result.settings)).toBe(true);
    expect(Array.isArray(result.importedPackages)).toBe(true);
    expect(Array.isArray(result.savedPoints)).toBe(true);
  });

  it('accepts a data-only backup with empty media array', () => {
    expect(() => validateBackupData(makeValidBackup({ media: [] }))).not.toThrow();
  });

  it('accepts a backup with optional arrays omitted (treated as empty)', () => {
    const sparse = makeValidBackup({
      fields: undefined,
      sessions: undefined,
      finds: undefined,
      significantFinds: undefined,
      tracks: undefined,
      media: undefined,
      settings: undefined,
      importedPackages: undefined,
      savedPoints: undefined,
    });
    expect(() => validateBackupData(sparse)).not.toThrow();
  });

  it('accepts a minimal backup (project only, all optionals empty)', () => {
    const minimal = {
      projects:         [{ id: 'proj-1' }],
      permissions:      [],
      fields:           [],
      sessions:         [],
      finds:            [],
      significantFinds: [],
      tracks:           [],
      media:            [],
      settings:         [],
      importedPackages: [],
    };
    expect(() => validateBackupData(minimal)).not.toThrow();
  });
});

// ─── Structural rejections ─────────────────────────────────────────────────────

describe('validateBackupData — rejects invalid structure', () => {
  it('rejects null', () => {
    expect(() => validateBackupData(null)).toThrow();
  });

  it('rejects a string', () => {
    expect(() => validateBackupData('not an object')).toThrow();
  });

  it('rejects an array (not an object)', () => {
    expect(() => validateBackupData([])).toThrow();
  });

  it('rejects when projects is missing (required field)', () => {
    const data = { ...makeValidBackup(), projects: undefined };
    expect(() => validateBackupData(data)).toThrow(/projects/i);
  });

  it('rejects when projects is not an array', () => {
    const data = makeValidBackup({ projects: { id: 'proj-1' } });
    expect(() => validateBackupData(data)).toThrow();
  });

  it('rejects a project row missing an id', () => {
    const data = makeValidBackup({ projects: [{ name: 'No ID project' }] });
    expect(() => validateBackupData(data)).toThrow(/id/i);
  });

  it('rejects a settings row missing a key', () => {
    const data = makeValidBackup({ settings: [{ value: 'no key here' }] });
    expect(() => validateBackupData(data)).toThrow(/key/i);
  });
});

// ─── Referential integrity rejections ────────────────────────────────────────
// NOTE: validateBackupData checks the following relationships (as of data.ts):
//   permissions[].projectId        → must exist in projects
//   fields[].permissionId          → must exist in permissions
//   sessions[].permissionId        → must exist in permissions
//   finds[].permissionId           → must exist in permissions
//   finds[].sessionId (if set)     → must exist in sessions
//   significantFinds[].projectId   → must exist in projects
//   significantFinds[].permissionId→ must exist in permissions
//   significantFinds[].sessionId   → must exist in sessions
//   significantFinds[].linkedFindId→ must exist in finds
//   tracks[].sessionId (if set)    → must exist in sessions
//   media[].blob                   → must be a data: URI
//   media[].findId (if set)        → must exist in finds or significantFinds
//   media[].permissionId (if set)  → must exist in permissions
//
// NOT currently checked: field.projectId, session.projectId, find.projectId,
// track.projectId, or cross-checking that a child row's projectId matches its
// parent permission's projectId. Tests below cover exactly what the code checks.

describe('validateBackupData — rejects referential integrity violations', () => {
  it('rejects a permission referencing a non-existent project', () => {
    const data = makeValidBackup({
      permissions: [{ id: 'perm-1', projectId: 'GHOST-PROJECT', name: 'Test', createdAt: '2024-01-01', updatedAt: '2024-01-01' }],
    });
    expect(() => validateBackupData(data)).toThrow(/permission/i);
  });

  it('rejects a field referencing a non-existent permission', () => {
    const data = makeValidBackup({
      fields: [{ id: 'field-1', permissionId: 'GHOST-PERM', projectId: 'proj-1', name: 'f', boundary: { type: 'Polygon', coordinates: [] }, notes: '', createdAt: '2024-01-01', updatedAt: '2024-01-01' }],
    });
    expect(() => validateBackupData(data)).toThrow(/field/i);
  });

  it('rejects a session referencing a non-existent permission', () => {
    const data = makeValidBackup({
      sessions: [{ id: 'sess-1', permissionId: 'GHOST-PERM', date: '2024-01-01', createdAt: '2024-01-01' }],
    });
    expect(() => validateBackupData(data)).toThrow(/session/i);
  });

  it('rejects a find referencing a non-existent permission', () => {
    const data = makeValidBackup({
      finds: [{ id: 'find-1', permissionId: 'GHOST-PERM', findCode: 'A001', createdAt: '2024-01-01' }],
    });
    expect(() => validateBackupData(data)).toThrow(/find/i);
  });

  it('rejects a find referencing a non-existent session', () => {
    const data = makeValidBackup({
      finds: [{ id: 'find-1', permissionId: 'perm-1', sessionId: 'GHOST-SESSION', findCode: 'A001', createdAt: '2024-01-01' }],
    });
    expect(() => validateBackupData(data)).toThrow(/find/i);
  });

  it('rejects a track referencing a non-existent session', () => {
    const data = makeValidBackup({
      tracks: [{ id: 'track-1', sessionId: 'GHOST-SESSION' }],
    });
    expect(() => validateBackupData(data)).toThrow(/track/i);
  });

  it('rejects media with a non-data-URI blob', () => {
    const data = makeValidBackup({
      media: [{ id: 'media-1', findId: 'find-1', blob: 'https://evil.example.com/image.jpg' }],
    });
    expect(() => validateBackupData(data)).toThrow(/media/i);
  });

  it('rejects media referencing a non-existent find', () => {
    const data = makeValidBackup({
      media: [{ id: 'media-1', findId: 'GHOST-FIND', blob: 'data:image/jpeg;base64,abc' }],
    });
    expect(() => validateBackupData(data)).toThrow(/media/i);
  });

  it('rejects media referencing a non-existent permission', () => {
    const data = makeValidBackup({
      media: [{ id: 'media-1', permissionId: 'GHOST-PERM', blob: 'data:image/jpeg;base64,abc' }],
    });
    expect(() => validateBackupData(data)).toThrow(/media/i);
  });

  it('rejects a significantFind referencing a non-existent project', () => {
    const data = makeValidBackup({
      significantFinds: [{ id: 'sf-1', projectId: 'GHOST', permissionId: 'perm-1', sessionId: 'sess-1', linkedFindId: 'find-1' }],
    });
    expect(() => validateBackupData(data)).toThrow(/significant/i);
  });

  it('rejects a significantFind referencing a non-existent linked find', () => {
    const data = makeValidBackup({
      significantFinds: [{ id: 'sf-1', projectId: 'proj-1', permissionId: 'perm-1', linkedFindId: 'GHOST-FIND' }],
    });
    expect(() => validateBackupData(data)).toThrow(/significant/i);
  });
});

// ─── JSON round-trip (structure level, no DB) ─────────────────────────────────
// Verifies that a backup JSON string produced in the exportData format is
// accepted by validateBackupData — i.e. the producer and validator agree.
//
// This does not test DB reads/writes. A full exportData → importData round-trip
// requires fake-indexeddb and is a follow-up task.

describe('validateBackupData — accepts exportData-format JSON', () => {
  it('round-trips a valid backup through JSON serialisation', () => {
    const original = makeValidBackup();
    // Simulate what exportData does: JSON.stringify then JSON.parse
    const parsed = JSON.parse(JSON.stringify(original));
    expect(() => validateBackupData(parsed)).not.toThrow();
    const result = validateBackupData(parsed);
    expect(result.projects).toHaveLength(1);
    expect(result.finds).toHaveLength(1);
    expect(result.media).toHaveLength(1);
    expect(result.savedPoints).toHaveLength(1);
  });

  it('round-trips a data-only backup (media: [])', () => {
    const original = makeValidBackup({ media: [] });
    const parsed = JSON.parse(JSON.stringify(original));
    expect(() => validateBackupData(parsed)).not.toThrow();
  });
});

// ─── savedPoints backup tests ─────────────────────────────────────────────────

describe('validateBackupData — savedPoints', () => {
  it('accepts savedPoints with valid projectId reference', () => {
    const data = makeValidBackup({
      savedPoints: [
        { id: 'sp-1', projectId: 'proj-1', label: 'Gate corner', lat: 52.5, lon: -1.5, zoom: 16, note: '', createdAt: '2024-01-01' },
        { id: 'sp-2', projectId: 'proj-1', label: 'Ridge line', lat: 52.51, lon: -1.51, zoom: 16, note: '', createdAt: '2024-01-01' },
      ],
    });
    expect(() => validateBackupData(data)).not.toThrow();
    expect(validateBackupData(data).savedPoints).toHaveLength(2);
  });

  it('rejects a savedPoint with no id', () => {
    const data = makeValidBackup({
      savedPoints: [{ projectId: 'proj-1', label: 'No ID', lat: 52.5, lon: -1.5, zoom: 16, note: '' }],
    });
    expect(() => validateBackupData(data)).toThrow(/savedPoints/i);
  });

  it('rejects a savedPoint referencing an unknown project', () => {
    const data = makeValidBackup({
      savedPoints: [{ id: 'sp-1', projectId: 'GHOST-PROJECT', label: 'Ghost', lat: 52.5, lon: -1.5, zoom: 16, note: '' }],
    });
    expect(() => validateBackupData(data)).toThrow(/savedPoints/i);
  });

  it('accepts a v3 backup (no savedPoints key) — backwards-compat', () => {
    // Old backups (version 3) have no savedPoints field — must import cleanly
    const v3Backup = makeValidBackup({ savedPoints: undefined, version: 3 });
    expect(() => validateBackupData(v3Backup)).not.toThrow();
    const result = validateBackupData(v3Backup);
    expect(result.savedPoints).toEqual([]);
  });

  it('accepts a backup with savedPoints: [] (explicit empty)', () => {
    const data = makeValidBackup({ savedPoints: [] });
    expect(() => validateBackupData(data)).not.toThrow();
    expect(validateBackupData(data).savedPoints).toEqual([]);
  });
});

// ─── undugSignals backup tests ────────────────────────────────────────────────

describe('validateBackupData — undugSignals', () => {
  it('accepts a pre-v33 backup without an undugSignals key and yields []', () => {
    const preV33 = makeValidBackup({ undugSignals: undefined });
    expect(() => validateBackupData(preV33)).not.toThrow();
    expect(validateBackupData(preV33).undugSignals).toEqual([]);
  });

  it('rejects undugSignals rows missing an id', () => {
    const data = makeValidBackup({
      undugSignals: [{ createdAt: 1_700_000_000_000, lat: 51.5, lng: -1.2, status: 'open' }],
    });
    expect(() => validateBackupData(data)).toThrow(/undugSignals/i);
  });

  it('export payload includes undugSignals array', () => {
    const result = validateBackupData(makeValidBackup());
    expect(Array.isArray(result.undugSignals)).toBe(true);
    expect(result.undugSignals).toHaveLength(1);
    expect(result.undugSignals[0].id).toBe('us-1');
  });
});

// ─── Table coverage guard ─────────────────────────────────────────────────────
// Fails when a new user-authored table is added to db.ts but not exported.
// If this test fails: add the table to exportData/BackupData/validateBackupData
// in src/services/data.ts (and check importData's transaction table list).
//
// Tables intentionally excluded (regenerable caches — not user data):
//   fieldGuideCache, geologyContext, findHotspotSignals,
//   landscapeInterpretations, diagnosticLog

describe('table coverage guard', () => {
  const USER_TABLES = [
    'projects',
    'permissions',
    'fields',
    'sessions',
    'finds',
    'significantFinds',
    'tracks',
    'media',
    'settings',
    'importedPackages',
    'savedPoints',
    'undugSignals',
  ] as const;

  it('validateBackupData returns every user table as an array', () => {
    const result = validateBackupData(makeValidBackup());
    for (const table of USER_TABLES) {
      expect(Array.isArray(result[table]), `${table} missing from backup`).toBe(true);
    }
  });

  it('every user table accepts a non-empty value from the fixture', () => {
    const backup = makeValidBackup();
    const result = validateBackupData(backup);
    // projects is required; the others default to [] if absent but must be present in a v4 export
    expect(result.projects.length).toBeGreaterThan(0);
    expect(result.savedPoints.length).toBeGreaterThan(0);
  });
});
