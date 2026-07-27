import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../src/db';

const { deriveSectionCandidates } = vi.hoisted(() => ({
  deriveSectionCandidates: vi.fn(),
}));

vi.mock('../../src/engines/coverage/sectionCoverageEngine', async importOriginal => {
  const actual = await importOriginal<
    typeof import('../../src/engines/coverage/sectionCoverageEngine')
  >();
  deriveSectionCandidates.mockImplementation(actual.deriveSectionCandidates);
  return { ...actual, deriveSectionCandidates };
});

import { ensurePermissionSections } from '../../src/services/coverageMutations';

const ISO = '2026-07-27T08:00:00.000Z';

describe('coverage section derivation fast path', () => {
  beforeEach(async () => {
    deriveSectionCandidates.mockClear();
    await db.open();
    await Promise.all([
      db.projects.clear(),
      db.permissions.clear(),
      db.fields.clear(),
      db.permissionSections.clear(),
      db.sessionCoverage.clear(),
    ]);
    await db.projects.put({
      id: 'project-1',
      name: 'Project',
      region: 'England',
      createdAt: ISO,
    });
    await db.permissions.put({
      id: 'permission-1',
      projectId: 'project-1',
      name: 'Permission',
      type: 'individual',
      lat: 52,
      lon: 0,
      gpsAccuracyM: 5,
      collector: 'Tester',
      landType: 'arable',
      permissionGranted: true,
      notes: '',
      createdAt: ISO,
      updatedAt: ISO,
    });
    await db.fields.put({
      id: 'field-1',
      projectId: 'project-1',
      permissionId: 'permission-1',
      name: 'North field',
      boundary: {
        type: 'Polygon',
        coordinates: [[
          [0, 52], [0.01, 52], [0.01, 52.01],
          [0, 52.01], [0, 52],
        ]],
      },
      notes: '',
      createdAt: ISO,
      updatedAt: ISO,
    });
  });

  it('derives once, then performs zero derivations for an unchanged field', async () => {
    const first = await ensurePermissionSections('permission-1', ISO);
    expect(first.length).toBeGreaterThan(0);
    expect(deriveSectionCandidates).toHaveBeenCalledTimes(1);

    deriveSectionCandidates.mockClear();
    const startedAt = performance.now();
    const second = await ensurePermissionSections('permission-1', ISO);
    const elapsedMs = performance.now() - startedAt;

    expect(second).toEqual(first);
    expect(deriveSectionCandidates).not.toHaveBeenCalled();
    expect(elapsedMs).toBeLessThan(50);
  });

  it('falls back to derivation when the field name changes', async () => {
    await ensurePermissionSections('permission-1', ISO);
    await db.fields.update('field-1', { name: 'Renamed field' });
    deriveSectionCandidates.mockClear();

    const sections = await ensurePermissionSections('permission-1', ISO);

    expect(deriveSectionCandidates).toHaveBeenCalledTimes(1);
    expect(sections.every(section => section.label.startsWith('Renamed field · ')))
      .toBe(true);
  });
});
