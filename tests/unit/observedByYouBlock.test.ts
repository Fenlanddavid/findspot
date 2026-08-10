import 'fake-indexeddb/auto';
import React from 'react';
import Dexie from 'dexie';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { FindSpotDB, type SurfaceObservation } from '../../src/db';
import {
  ObservedByYouBlock,
} from '../../src/components/surfaceScatter/ObservedByYouBlock';
import {
  surfaceObservationDetailText,
  surfaceObservationDistanceText,
  surfaceObservationText,
} from '../../src/components/surfaceScatter/surfaceScatterPresentation';
import {
  CAPTURE_DATING_CONFIDENCE,
  recentSurfacePeriods,
  reassessSurfaceObservation,
  recordSurfaceObservation,
  resolveEffectiveScatter,
  setSurfaceCapturePeriod,
  type EffectiveScatter,
  type SurfaceScope,
} from '../../src/services/surfaceScatter';

const ISO = '2026-08-10T10:00:00.000Z';
const databaseNames = new Set<string>();
const scope: SurfaceScope = {
  permissionId: 'permission-1',
  sectionId: null,
  point: { lat: 52.2053, lon: 0.1218 },
};

afterEach(async () => {
  await Promise.all([...databaseNames].map(name => Dexie.delete(name)));
  databaseNames.clear();
});

function observation(overrides: Partial<SurfaceObservation> = {}): SurfaceObservation {
  return {
    id: 'surface-1',
    projectId: 'project-1',
    permissionId: 'permission-1',
    fieldId: null,
    sectionId: null,
    sessionId: null,
    material: 'pottery',
    abundance: 'dense',
    materialConfidence: 'confident',
    periodImpression: 'unknown',
    datingConfidence: 'unsure',
    lat: scope.point.lat,
    lon: scope.point.lon,
    gpsAccuracyM: 4,
    observedAt: ISO,
    reassessments: [],
    createdAt: ISO,
    updatedAt: ISO,
    ...overrides,
  };
}

function scatter(rows: SurfaceObservation[], activeScope: SurfaceScope = scope): EffectiveScatter {
  return resolveEffectiveScatter({ observations: rows, sections: [], scope: activeScope });
}

async function captureDatabase(): Promise<FindSpotDB> {
  const name = `surface-capture-${crypto.randomUUID()}`;
  databaseNames.add(name);
  const database = new FindSpotDB(name);
  await database.open();
  await database.projects.put({
    id: 'project-1', name: 'Test project', region: 'England', createdAt: ISO,
  });
  await database.permissions.put({
    id: 'permission-1',
    projectId: 'project-1',
    name: 'Test permission',
    type: 'individual',
    lat: scope.point.lat,
    lon: scope.point.lon,
    gpsAccuracyM: 4,
    collector: 'Tester',
    landType: 'arable',
    permissionGranted: true,
    notes: '',
    createdAt: ISO,
    updatedAt: ISO,
  });
  return database;
}

async function capture(database: FindSpotDB): Promise<SurfaceObservation> {
  return recordSurfaceObservation({
    projectId: 'project-1',
    permissionId: 'permission-1',
    sessionId: null,
    material: 'pottery',
    abundance: 'dense',
    point: scope.point,
    gpsAccuracyM: 4,
  }, database);
}

describe('Scatter capture UX', () => {
  it('T1 persists on abundance before optional period interaction', async () => {
    const database = await captureDatabase();
    const saved = await capture(database);

    expect(await database.surfaceObservations.get(saved.id)).toEqual(expect.objectContaining({
      periodImpression: 'unknown', datingConfidence: 'unsure', reassessments: [],
    }));
    database.close();
  });

  it('T2 treats capture-time period as original evidence with fairly-sure confidence', async () => {
    const database = await captureDatabase();
    const saved = await capture(database);
    await setSurfaceCapturePeriod(saved.id, 'roman', database);

    expect(CAPTURE_DATING_CONFIDENCE).toBe('fairly_sure');
    expect(await database.surfaceObservations.get(saved.id)).toEqual(expect.objectContaining({
      periodImpression: 'roman', datingConfidence: 'fairly_sure', reassessments: [],
    }));
    database.close();
  });

  it('T3 records a review-time period change as a reassessment', async () => {
    const database = await captureDatabase();
    const saved = await capture(database);
    await setSurfaceCapturePeriod(saved.id, 'roman', database);
    await reassessSurfaceObservation(saved.id, {
      material: 'pottery', abundance: 'dense', materialConfidence: 'confident',
      periodImpression: 'medieval', datingConfidence: 'confident',
    }, database);

    const reviewed = await database.surfaceObservations.get(saved.id);
    expect(reviewed?.reassessments).toHaveLength(1);
    expect(reviewed?.reassessments[0]).toEqual(expect.objectContaining({
      previous: expect.objectContaining({ periodImpression: 'roman' }),
      current: expect.objectContaining({ periodImpression: 'medieval' }),
    }));
    database.close();
  });

  it('T4 derives recent chips per permission and has a fixed empty fallback', () => {
    const rows = [
      observation({ id: 'old', periodImpression: 'roman', updatedAt: '2026-08-01T10:00:00Z' }),
      observation({ id: 'new', periodImpression: 'medieval', updatedAt: '2026-08-09T10:00:00Z' }),
      observation({ id: 'other', permissionId: 'permission-2', periodImpression: 'iron_age' }),
    ];
    expect(recentSurfacePeriods(rows, 'permission-1')).toEqual(['medieval', 'roman']);
    expect(recentSurfacePeriods([], 'permission-1')).toEqual(['roman', 'medieval', 'post_medieval']);
  });

  it('opens permissions containing multiple legacy numeric-timestamp observations', () => {
    const newer = observation({ id: 'newer', periodImpression: 'roman' }) as unknown as SurfaceObservation & {
      observedAt: number;
      updatedAt: number;
    };
    const older = observation({ id: 'older', periodImpression: 'medieval' }) as unknown as SurfaceObservation & {
      observedAt: number;
      updatedAt: number;
    };
    newer.observedAt = 1_754_819_200_000;
    newer.updatedAt = 1_754_819_200_000;
    older.observedAt = 1_754_732_800_000;
    older.updatedAt = 1_754_732_800_000;

    const resolved = scatter([
      older as unknown as SurfaceObservation,
      newer as unknown as SurfaceObservation,
    ]);
    expect(resolved.observations.map(row => row.source.id)).toEqual(['newer', 'older']);
    expect(recentSurfacePeriods([
      older as unknown as SurfaceObservation,
      newer as unknown as SurfaceObservation,
    ], 'permission-1')).toEqual(['roman', 'medieval']);
  });

  it('T5 renders only the record action at zero observations', () => {
    const markup = renderToStaticMarkup(React.createElement(ObservedByYouBlock, {
      scatter: scatter([]),
      recordButton: React.createElement('button', null, 'Record surface find'),
      recordIconButton: React.createElement('button', null, '+'),
    }));
    expect(markup).toContain('Record surface find');
    expect(markup).not.toContain('Your observations');
    expect(markup).not.toContain('no observations');
  });

  it('T6 renders a defaults-only record as exactly one content line', () => {
    const resolved = scatter([observation({ abundance: 'few' })]).observations[0]!;
    expect(surfaceObservationText(resolved)).toBe('Pottery · few');
    expect(surfaceObservationDetailText(resolved)).toBeNull();
  });

  it('T7 suppresses distance in the same section and shows it across sections', () => {
    const same = scatter([
      observation({ sectionId: 'section-a' }),
    ], { ...scope, sectionId: 'section-a' }).observations[0]!;
    const different = scatter([
      observation({ sectionId: 'section-b' }),
    ], { ...scope, sectionId: 'section-a' }).observations[0]!;
    expect(surfaceObservationDistanceText(same)).toBeNull();
    expect(surfaceObservationDistanceText(different)).toContain('Recorded about');
  });
});

describe('Scatter presentation invariants', () => {
  it('excludes retired observations from count and combination', () => {
    expect(scatter([
      observation({ id: 'pottery', retiredAt: ISO }),
      observation({ id: 'cbm', material: 'ceramic_building_material', retiredAt: ISO }),
    ])).toEqual({ observations: [], count: 0, combination: null });
  });

  it('shows a capture-time period as a possible user impression', () => {
    const resolved = scatter([observation({
      periodImpression: 'roman', datingConfidence: 'fairly_sure',
    })]).observations[0]!;
    expect(surfaceObservationDetailText(resolved)).toBe('Possible Roman — your impression');
  });

  it('combines unknown with Roman but rejects conflicting known periods', () => {
    const pottery = observation({ id: 'pottery', periodImpression: 'roman' });
    const unknownCbm = observation({ id: 'cbm', material: 'ceramic_building_material' });
    const medievalCbm = observation({
      ...unknownCbm, periodImpression: 'medieval', datingConfidence: 'confident',
    });
    expect(scatter([pottery, unknownCbm]).combination).not.toBeNull();
    expect(scatter([pottery, medievalCbm]).combination).toBeNull();
  });

  it('does not combine observations assigned to different known permission sections', () => {
    const pottery = observation({ id: 'pottery', sectionId: 'section-a' });
    const cbm = observation({
      id: 'cbm', material: 'ceramic_building_material', sectionId: 'section-b',
    });
    expect(scatter([pottery, cbm]).combination).toBeNull();
  });

  it('keeps reassessment provenance on the second line', () => {
    const previous = {
      material: 'ceramic_building_material' as const,
      abundance: 'dense' as const,
      materialConfidence: 'fairly_sure' as const,
      periodImpression: 'unknown' as const,
      datingConfidence: 'unsure' as const,
    };
    const current = {
      ...previous, material: 'field_drain' as const, materialConfidence: 'confident' as const,
    };
    const resolved = scatter([observation({
      ...current,
      reassessments: [{ previous, current, reassessedAt: ISO }],
    })]).observations[0]!;
    expect(surfaceObservationText(resolved)).toBe('Field drain · dense');
    expect(surfaceObservationDetailText(resolved))
      .toBe('Reassessed from Ceramic building material (CBM)');
  });

  it('keeps all FieldGuide component files free of surface observation integration', () => {
    const files = [
      'src/components/fieldGuide/GlanceCard.tsx',
      'src/components/fieldGuide/HistoricLayerManager.tsx',
      'src/components/fieldGuide/LandscapeInterpretationBlock.tsx',
    ];
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      expect(source).not.toMatch(/surfaceScatter|surfaceObservations|ObservedByYou|RecordSurfaceFind/);
    }
    const permissionCard = readFileSync('src/components/OutstandingQuestionsCard.tsx', 'utf8');
    expect(permissionCard).toContain('PermissionSurfaceObservations');
  });
});
