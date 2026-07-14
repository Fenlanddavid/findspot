import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  questions: [] as any[],
  permissionUpdates: [] as Array<[string, Record<string, unknown>]>,
}));

vi.mock('../../src/db', () => ({
  db: {
    finds: { where: () => ({ equals: () => ({ toArray: async () => [] }) }) },
    sessions: { where: () => ({ equals: () => ({ toArray: async () => [] }) }) },
    tracks: { where: () => ({ anyOf: () => ({ toArray: async () => [] }) }) },
    outstandingQuestions: {
      where: () => ({ equals: () => ({ toArray: async () => [...state.questions] }) }),
      bulkPut: async (rows: any[]) => { state.questions = rows; },
    },
    questionNotes: {
      where: () => ({ anyOf: () => ({ toArray: async () => [] }) }),
    },
    permissions: {
      get: async () => ({ id: 'permission-1' }),
      update: async (id: string, changes: Record<string, unknown>) => {
        state.permissionUpdates.push([id, changes]);
      },
    },
    transaction: async (_mode: string, _tables: unknown[], callback: () => Promise<void>) => callback(),
  },
}));

vi.mock('../../src/services/coverage', () => ({
  calculateCoverage: () => null,
}));

import { updateQuestionsAfterScan } from '../../src/outstandingQuestions/updateAfterScan';

const boundary = {
  type: 'Polygon' as const,
  coordinates: [[
    [-0.01, 51.99], [0.01, 51.99], [0.01, 52.01],
    [-0.01, 52.01], [-0.01, 51.99],
  ]],
};

const scheduledMonument = {
  type: 'Feature' as const,
  geometry: {
    type: 'Polygon' as const,
    coordinates: [[
      [-0.002, 51.998], [0.002, 51.998], [0.002, 52.002],
      [-0.002, 52.002], [-0.002, 51.998],
    ]],
  },
  properties: { Name: 'Test scheduled monument' },
};

describe('Roman-road question pipeline', () => {
  beforeEach(() => {
    state.questions = [];
    state.permissionUpdates = [];
  });

  it('persists a visible question when a Roman road crosses a permission containing a separate SM', async () => {
    await updateQuestionsAfterScan({
      permissionId: 'permission-1',
      scanCenter: { lat: 52, lng: 0 },
      hotspots: [],
      clusters: [],
      routes: [{
        id: 'roman-1',
        type: 'roman_road',
        source: 'itinere',
        name: 'Test Roman road',
        confidenceClass: 'A',
        certaintyScore: 0.9,
        geometry: [[-0.008, 52], [0, 52], [0.008, 52]],
        bbox: [[-0.008, 52], [0.008, 52]],
        period: 'roman',
      }],
      scanBounds: { west: -0.02, south: 51.98, east: 0.02, north: 52.02 },
      sourceAvailability: {
        terrain: false,
        terrain_global: false,
        slope: false,
        hydrology: false,
        satellite_spring: false,
        satellite_summer: false,
        scheduled_monuments: true,
        aim: false,
        historic_context: false,
        historic_routes: true,
        pas_density: true,
      },
      permissions: [{ id: 'permission-1', boundary } as any],
      scheduledMonuments: { features: [scheduledMonument], available: true },
      pasRecordCountInScanCell: 18,
    });

    // After Phase A: only ROMAN_ROUTE_ACTIVITY survives (PUBLIC_RECORD_CONTEXT
    // and PROTECTED_AREA_EXCLUSION retired — their info is on the permission row).
    expect(state.questions).toHaveLength(1);
    expect(state.questions[0]).toMatchObject({
      permissionId: 'permission-1',
      ruleId: 'ROMAN_ROUTE_ACTIVITY',
      status: 'NEEDS_EVIDENCE',
    });
    expect(state.questions[0].anchor.lon).toBeLessThan(-0.002);
    // Two permission updates: protectionStatus/pasContext write + questionsEvaluatedAt.
    expect(state.permissionUpdates).toEqual([
      ['permission-1', expect.objectContaining({ protectionStatus: expect.any(Object) })],
      ['permission-1', { questionsEvaluatedAt: expect.any(String) }],
    ]);
  });

  it('persists a non-location protected-context question when the road section is entirely scheduled', async () => {
    const roadMonument = {
      ...scheduledMonument,
      geometry: {
        type: 'Polygon' as const,
        coordinates: [[
          [-0.009, 51.998], [0.009, 51.998], [0.009, 52.002],
          [-0.009, 52.002], [-0.009, 51.998],
        ]],
      },
    };

    await updateQuestionsAfterScan({
      permissionId: 'permission-2',
      scanCenter: { lat: 52, lng: 0 },
      hotspots: [],
      clusters: [],
      routes: [{
        id: 'roman-protected', type: 'roman_road', source: 'itinere',
        confidenceClass: 'A', certaintyScore: 0.9,
        geometry: [[-0.008, 52], [0, 52], [0.008, 52]],
        bbox: [[-0.008, 52], [0.008, 52]], period: 'roman',
      }],
      scanBounds: { west: -0.02, south: 51.98, east: 0.02, north: 52.02 },
      sourceAvailability: {
        terrain: false, terrain_global: false, slope: false, hydrology: false,
        satellite_spring: false, satellite_summer: false,
        scheduled_monuments: true, aim: false, historic_context: false,
        historic_routes: true, pas_density: true,
      },
      permissions: [{ id: 'permission-2', boundary } as any],
      scheduledMonuments: { features: [roadMonument], available: true },
      pasRecordCountInScanCell: 18,
    });

    // After Phase A retirement, only ROMAN_ROUTE_ACTIVITY remains from the
    // permission-wide pass. The SM exclusion is now a banner on the permission.
    const romanQ = state.questions.find(question => question.ruleId === 'ROMAN_ROUTE_ACTIVITY');
    expect(romanQ).toMatchObject({
      permissionId: 'permission-2',
      ruleId: 'ROMAN_ROUTE_ACTIVITY',
      status: 'NEEDS_EVIDENCE',
      locationActionAllowed: false,
    });
    expect(romanQ!.description).toContain('must remain excluded from detecting');
    expect(isPointInsideRoadMonument(romanQ!.anchor)).toBe(false);
    // No PROTECTED_AREA_EXCLUSION question generated (retired in Phase A).
    expect(state.questions.find(question => question.ruleId === 'PROTECTED_AREA_EXCLUSION')).toBeUndefined();
  });
});

function isPointInsideRoadMonument(anchor: { lat: number; lon: number }): boolean {
  return anchor.lon >= -0.009 && anchor.lon <= 0.009 && anchor.lat >= 51.998 && anchor.lat <= 52.002;
}
