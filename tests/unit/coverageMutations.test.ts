import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db, type Field, type Find, type Permission, type Session } from '../../src/db';
import {
  ensurePermissionSections,
  prepareSessionCoverageEvidence,
  saveReportedSessionCoverage,
} from '../../src/services/coverageMutations';
import { deriveSectionCandidates } from '../../src/engines/coverage/sectionCoverageEngine';

const ISO = '2026-07-24T08:00:00.000Z';

function permission(): Permission {
  return {
    id: 'permission-1',
    projectId: 'project-1',
    name: 'Test permission',
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
  };
}

function field(boundaryEast = 0.001): Field {
  return {
    id: 'field-1',
    projectId: 'project-1',
    permissionId: 'permission-1',
    name: 'Small field',
    boundary: {
      type: 'Polygon',
      coordinates: [[
        [0, 52], [boundaryEast, 52], [boundaryEast, 52.001],
        [0, 52.001], [0, 52],
      ]],
    },
    notes: '',
    createdAt: ISO,
    updatedAt: ISO,
  };
}

function session(): Session {
  return {
    id: 'session-1',
    projectId: 'project-1',
    permissionId: 'permission-1',
    fieldId: 'field-1',
    date: ISO,
    lat: null,
    lon: null,
    gpsAccuracyM: null,
    landUse: '',
    cropType: '',
    isStubble: false,
    notes: '',
    isFinished: true,
    endTime: ISO,
    createdAt: ISO,
    updatedAt: ISO,
  };
}

beforeEach(async () => {
  await db.open();
  await db.transaction('rw', [
    db.projects, db.permissions, db.fields, db.sessions, db.finds,
    db.permissionSections, db.sessionCoverage,
  ], async () => {
    await Promise.all([
      db.projects.clear(),
      db.permissions.clear(),
      db.fields.clear(),
      db.sessions.clear(),
      db.finds.clear(),
      db.permissionSections.clear(),
      db.sessionCoverage.clear(),
    ]);
  });
  await db.projects.put({
    id: 'project-1',
    name: 'Project',
    region: 'England',
    createdAt: ISO,
  });
  await db.permissions.put(permission());
  await db.fields.put(field());
  await db.sessions.put(session());
});

afterEach(async () => {
  await db.permissionSections.clear();
  await db.sessionCoverage.clear();
});

describe('coverage mutation boundary', () => {
  it('versions section geometry and keeps reported and find-visit observations independent', async () => {
    const originals = await ensurePermissionSections('permission-1', ISO);
    expect(originals.length).toBeGreaterThanOrEqual(2);
    const original = originals[0];
    expect(original.currentGeometryVersion).toBe(1);

    await db.fields.put(field(0.0011));
    const editedSections = await ensurePermissionSections(
      'permission-1',
      '2026-07-24T09:00:00.000Z',
    );
    const edited = editedSections.find(section => section.id === original.id);
    expect(edited).toBeDefined();
    if (!edited) throw new Error('Expected an H3 section to survive the boundary edit');
    expect(edited.id).toBe(original.id);
    expect(edited.currentGeometryVersion).toBe(2);
    expect(edited.geometryVersions).toHaveLength(2);

    await saveReportedSessionCoverage(
      'session-1',
      new Set([edited.id]),
      Date.parse('2026-07-24T10:00:00.000Z'),
    );
    await db.finds.put({
      id: 'find-1',
      projectId: 'project-1',
      permissionId: 'permission-1',
      fieldId: 'field-1',
      sessionId: 'session-1',
      findCode: 'F1',
      objectType: 'Coin',
      lat: 52.0005,
      lon: 0.0005,
      gpsAccuracyM: 5,
      osGridRef: '',
      w3w: '',
      period: 'Roman',
      material: 'Copper alloy',
      weightG: null,
      widthMm: null,
      heightMm: null,
      depthMm: null,
      decoration: '',
      completeness: 'Complete',
      findContext: '',
      storageLocation: '',
      notes: '',
      createdAt: ISO,
      updatedAt: ISO,
    } satisfies Find);

    await prepareSessionCoverageEvidence(
      'session-1',
      '2026-07-24T10:01:00.000Z',
    );
    expect((await db.sessionCoverage.where('sessionId').equals('session-1').toArray())
      .map(row => row.evidence).sort()).toEqual(['find-visited', 'reported']);
  });

  it('replaces a legacy whole-field section and carries its reported evidence forward', async () => {
    const legacySectionId = 'field-1:whole';
    await db.permissionSections.put({
      id: legacySectionId,
      permissionId: 'permission-1',
      fieldId: 'field-1',
      layoutKey: 'whole',
      label: 'Small field',
      currentGeometryVersion: 1,
      geometryVersions: [{
        version: 1,
        boundaryHash: 'h3-r10-v1:legacy',
        geometry: field().boundary,
        areaM2: 7_500,
        effectiveFrom: ISO,
      }],
      createdAt: ISO,
      updatedAt: ISO,
    });
    await db.sessionCoverage.put({
      id: `session-1:${legacySectionId}:v1:reported`,
      sessionId: 'session-1',
      permissionId: 'permission-1',
      sectionId: legacySectionId,
      sectionGeometryVersion: 1,
      evidence: 'reported',
      startedAt: Date.parse(ISO),
      observedAt: Date.parse(ISO),
      createdAt: ISO,
      updatedAt: ISO,
    });

    const sections = await ensurePermissionSections(
      'permission-1',
      '2026-07-24T09:00:00.000Z',
    );
    const reports = await db.sessionCoverage
      .where('sessionId')
      .equals('session-1')
      .toArray();

    expect(sections.length).toBeGreaterThanOrEqual(2);
    expect(sections.every(section => section.layoutKey.startsWith('h3:'))).toBe(true);
    expect((await db.permissionSections.get(legacySectionId))?.retiredAt).toBeDefined();
    expect(reports).toHaveLength(sections.length);
    expect(reports.every(report =>
      report.evidence === 'reported'
      && sections.some(section => section.id === report.sectionId)
    )).toBe(true);
  });

  it('moves reports from the coarser v2 layout onto overlapping finer areas', async () => {
    const oldCandidate = deriveSectionCandidates({
      fieldId: 'field-1',
      permissionId: 'permission-1',
      name: 'Small field',
      boundary: field().boundary,
    }, 10)[0];
    expect(oldCandidate).toBeDefined();
    if (!oldCandidate) throw new Error('Expected an old section fixture');

    await db.permissionSections.put({
      id: oldCandidate.id,
      permissionId: oldCandidate.permissionId,
      fieldId: oldCandidate.fieldId,
      layoutKey: oldCandidate.layoutKey,
      label: oldCandidate.label,
      currentGeometryVersion: 1,
      geometryVersions: [{
        version: 1,
        boundaryHash: 'h3-adaptive-v2:old-boundary',
        geometry: oldCandidate.geometry,
        areaM2: oldCandidate.areaM2,
        effectiveFrom: ISO,
      }],
      createdAt: ISO,
      updatedAt: ISO,
    });
    await db.sessionCoverage.put({
      id: `session-1:${oldCandidate.id}:v1:reported`,
      sessionId: 'session-1',
      permissionId: 'permission-1',
      sectionId: oldCandidate.id,
      sectionGeometryVersion: 1,
      evidence: 'reported',
      startedAt: Date.parse(ISO),
      observedAt: Date.parse(ISO),
      createdAt: ISO,
      updatedAt: ISO,
    });

    const sections = await ensurePermissionSections(
      'permission-1',
      '2026-07-24T09:00:00.000Z',
    );
    const reports = await db.sessionCoverage
      .where('sessionId')
      .equals('session-1')
      .toArray();

    expect(sections.length).toBeGreaterThanOrEqual(6);
    expect((await db.permissionSections.get(oldCandidate.id))?.retiredAt).toBeDefined();
    expect(reports.length).toBeGreaterThan(0);
    expect(reports.every(report =>
      report.evidence === 'reported'
      && report.sectionId !== oldCandidate.id
      && sections.some(section => section.id === report.sectionId)
    )).toBe(true);
  });
});
