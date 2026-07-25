import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as turf from '@turf/turf';
import type { Feature, MultiPolygon, Polygon } from 'geojson';
import {
  POLYGON_TO_CELLS_FLAGS,
  cellToBoundary,
  polygonToCellsExperimental,
} from 'h3-js';
import { db, type Field, type Find, type Permission, type Session } from '../../src/db';
import {
  ensurePermissionSections,
  prepareSessionCoverageEvidence,
  saveReportedSessionCoverage,
} from '../../src/services/coverageMutations';
import {
  deriveSectionCandidates,
  evidenceObservationId,
} from '../../src/engines/coverage/sectionCoverageEngine';
import type { GeoJSONArea, GeoJSONPolygon } from '../../src/shared/coverageTypes';
import { deleteFieldAndUnlinkRecords } from '../../src/services/permissionMutations';

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

function legacyV3TriangleSections(boundary: GeoJSONPolygon) {
  const fieldFeature = turf.feature(boundary);
  return polygonToCellsExperimental(
    boundary.coordinates,
    11,
    POLYGON_TO_CELLS_FLAGS.containmentOverlapping,
    true,
  ).sort().flatMap((cell, index) => {
    const ring = cellToBoundary(cell, true);
    const hex = turf.polygon([[...ring, ring[0]]]);
    const clipped = turf.intersect(
      turf.featureCollection([fieldFeature, hex]),
    ) as Feature<Polygon | MultiPolygon> | null;
    if (!clipped) return [];
    const areaM2 = turf.area(clipped);
    if (areaM2 < 25) return [];
    return [{
      id: `field-1:h3:${cell}`,
      permissionId: 'permission-1',
      fieldId: 'field-1',
      layoutKey: `h3:${cell}`,
      label: `Small triangle · ${index + 1}`,
      currentGeometryVersion: 1,
      geometryVersions: [{
        version: 1,
        boundaryHash: 'h3-adaptive-v3:triangle-fixture',
        geometry: clipped.geometry as GeoJSONArea,
        areaM2,
        effectiveFrom: ISO,
      }],
      createdAt: ISO,
      updatedAt: ISO,
    }];
  });
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
  it('does not create sections from a permission boundary without mapped fields', async () => {
    await db.permissions.update('permission-1', { boundary: field().boundary });
    await db.fields.clear();

    await expect(ensurePermissionSections('permission-1', ISO)).resolves.toEqual([]);
    expect(await db.permissionSections.count()).toBe(0);
  });

  it('creates only field-scoped sections after a mapped field is added', async () => {
    await db.permissions.update('permission-1', { boundary: field().boundary });
    await db.fields.clear();
    expect(await ensurePermissionSections('permission-1', ISO)).toEqual([]);

    await db.fields.put(field());
    const sections = await ensurePermissionSections('permission-1', ISO);

    expect(sections.length).toBeGreaterThanOrEqual(2);
    expect(sections.every(section => section.fieldId === 'field-1')).toBe(true);
    expect(sections.some(section => section.fieldId === null)).toBe(false);
  });

  it('does not let an unassigned session create reports across mapped fields', async () => {
    await db.sessions.update('session-1', { fieldId: null });
    const sections = await ensurePermissionSections('permission-1', ISO);
    expect(sections.length).toBeGreaterThan(0);

    await expect(saveReportedSessionCoverage(
      'session-1',
      new Set([sections[0].id]),
      Date.parse('2026-07-24T10:00:00.000Z'),
    )).rejects.toThrow('Add a mapped field');
    expect(await db.sessionCoverage.count()).toBe(0);
  });

  it('rejects active sections belonging to a different session field', async () => {
    await db.fields.put({
      ...field(0.003),
      id: 'field-2',
      name: 'Second field',
      boundary: {
        type: 'Polygon',
        coordinates: [[
          [0.002, 52], [0.003, 52], [0.003, 52.001],
          [0.002, 52.001], [0.002, 52],
        ]],
      },
    });
    const sections = await ensurePermissionSections('permission-1', ISO);
    const otherFieldSection = sections.find(section => section.fieldId === 'field-2');
    expect(otherFieldSection).toBeDefined();
    if (!otherFieldSection) throw new Error('Expected a section for the second field');

    await expect(saveReportedSessionCoverage(
      'session-1',
      new Set([otherFieldSection.id]),
      Date.parse('2026-07-24T10:00:00.000Z'),
    )).rejects.toThrow('does not belong to this session field');
    expect(await db.sessionCoverage.count()).toBe(0);
  });

  it('retires legacy permission sections without deleting their observations', async () => {
    const legacySectionId = 'permission-1:whole';
    await db.fields.clear();
    await db.sessions.update('session-1', { fieldId: null });
    await db.permissionSections.put({
      id: legacySectionId,
      permissionId: 'permission-1',
      fieldId: null,
      layoutKey: 'whole',
      label: 'Test permission',
      currentGeometryVersion: 1,
      geometryVersions: [{
        version: 1,
        boundaryHash: 'legacy:permission',
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

    expect(await ensurePermissionSections(
      'permission-1',
      '2026-07-25T08:00:00.000Z',
    )).toEqual([]);
    expect((await db.permissionSections.get(legacySectionId))?.retiredAt)
      .toBe('2026-07-25T08:00:00.000Z');
    expect(await db.sessionCoverage.get(`session-1:${legacySectionId}:v1:reported`))
      .toBeDefined();
  });

  it('preserves a deleted field report but prevents the unlinked session extending it', async () => {
    const sections = await ensurePermissionSections('permission-1', ISO);
    await saveReportedSessionCoverage(
      'session-1',
      new Set([sections[0].id]),
      Date.parse('2026-07-24T10:00:00.000Z'),
    );
    const reportId = (await db.sessionCoverage
      .where('sessionId')
      .equals('session-1')
      .first())?.id;
    expect(reportId).toBeDefined();

    await deleteFieldAndUnlinkRecords(
      'field-1',
      '2026-07-25T09:00:00.000Z',
    );

    expect((await db.sessions.get('session-1'))?.fieldId).toBeNull();
    expect((await db.permissionSections.get(sections[0].id))?.retiredAt)
      .toBe('2026-07-25T09:00:00.000Z');
    expect(reportId ? await db.sessionCoverage.get(reportId) : undefined)
      .toBeDefined();
    await expect(saveReportedSessionCoverage(
      'session-1',
      new Set([sections[0].id]),
      Date.parse('2026-07-25T10:00:00.000Z'),
    )).rejects.toThrow('Add a mapped field');
  });

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
    const originalIds = new Set(originals.map(section => section.id));
    const edited = editedSections.find(section => originalIds.has(section.id));
    expect(edited).toBeDefined();
    if (!edited) throw new Error('Expected an H3 section to survive the boundary edit');
    const previous = originals.find(section => section.id === edited.id);
    expect(previous).toBeDefined();
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

    expect(sections.length).toBeGreaterThanOrEqual(3);
    expect(sections.length).toBeLessThanOrEqual(6);
    expect((await db.permissionSections.get(oldCandidate.id))?.retiredAt).toBeDefined();
    expect(reports.length).toBeGreaterThan(0);
    const activeReports = reports.filter(report =>
      sections.some(section => section.id === report.sectionId)
    );
    expect(activeReports.length).toBeGreaterThan(0);
    expect(activeReports.every(report =>
      report.evidence === 'reported'
      && report.sectionId !== oldCandidate.id
    )).toBe(true);
    const storedSections = await db.permissionSections.toArray();
    expect(reports.every(report => {
      const section = storedSections.find(candidate => candidate.id === report.sectionId);
      return section?.geometryVersions.some(
        geometry => geometry.version === report.sectionGeometryVersion,
      );
    })).toBe(true);
  });

  it('reconciles genuine v3 triangle cells without orphaning reported evidence', async () => {
    const latitude = 52.6;
    const longitudeSpan = 60 / (111_320 * Math.cos(latitude * Math.PI / 180));
    const latitudeSpan = 100 / 111_320;
    const boundary: GeoJSONPolygon = {
      type: 'Polygon',
      coordinates: [[
        [0, latitude],
        [longitudeSpan, latitude],
        [0, latitude + latitudeSpan],
        [0, latitude],
      ]],
    };
    await db.fields.put({
      ...field(),
      name: 'Small triangle',
      boundary,
    });
    const legacySections = legacyV3TriangleSections(boundary);
    expect(legacySections.length).toBeGreaterThanOrEqual(5);
    await db.permissionSections.bulkPut(legacySections);
    await db.sessionCoverage.bulkPut(legacySections.map(section => ({
      id: evidenceObservationId('session-1', section.id, 1, 'reported'),
      sessionId: 'session-1',
      permissionId: 'permission-1',
      sectionId: section.id,
      sectionGeometryVersion: 1,
      evidence: 'reported' as const,
      startedAt: Date.parse(ISO),
      observedAt: Date.parse(ISO),
      createdAt: ISO,
      updatedAt: ISO,
    })));

    const current = await ensurePermissionSections(
      'permission-1',
      '2026-07-25T11:00:00.000Z',
    );
    const allSections = await db.permissionSections.toArray();
    const reports = await db.sessionCoverage
      .where('sessionId')
      .equals('session-1')
      .toArray();
    const activeIds = new Set(current.map(section => section.id));

    expect(current.length).toBeGreaterThanOrEqual(3);
    expect(current.length).toBeLessThanOrEqual(6);
    expect(legacySections.some(section =>
      !activeIds.has(section.id)
      && allSections.find(candidate => candidate.id === section.id)?.retiredAt
    )).toBe(true);
    expect(reports.some(report => activeIds.has(report.sectionId))).toBe(true);
    expect(reports.every(report => {
      const section = allSections.find(candidate => candidate.id === report.sectionId);
      return section?.geometryVersions.some(
        geometry => geometry.version === report.sectionGeometryVersion,
      );
    })).toBe(true);
  });
});
