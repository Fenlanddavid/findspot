import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  fetchScheduledMonuments: vi.fn(),
  fetchRomanRoadsResult: vi.fn(),
  getPASDensityNear: vi.fn(),
  updateQuestionsAfterScan: vi.fn(),
}));

vi.mock('../../src/services/historicScanService', () => ({
  fetchScheduledMonuments: mocks.fetchScheduledMonuments,
}));
vi.mock('../../src/services/romanRoadService', () => ({
  fetchRomanRoadsResult: mocks.fetchRomanRoadsResult,
}));
vi.mock('../../src/services/pasDensityService', () => ({
  getPASDensityNear: mocks.getPASDensityNear,
}));
vi.mock('../../src/outstandingQuestions/updateAfterScan', () => ({
  updateQuestionsAfterScan: mocks.updateQuestionsAfterScan,
}));

import { updatePermissionIntelligenceQuestions } from '../../src/outstandingQuestions/protectionScan';

const permission = {
  id: 'permission-1',
  boundary: {
    type: 'Polygon' as const,
    coordinates: [[
      [-0.01, 51.99], [0.01, 51.99], [0.01, 52.01],
      [-0.01, 52.01], [-0.01, 51.99],
    ]],
  },
} as any;

describe('permission intelligence protection scan', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchRomanRoadsResult.mockResolvedValue({ available: true, routes: [] });
    mocks.getPASDensityNear.mockResolvedValue({ c: 8, p: ['ROMAN'], t: ['COIN'] });
    mocks.updateQuestionsAfterScan.mockResolvedValue(undefined);
  });

  it('records an unavailable monument check without claiming rule ownership', async () => {
    mocks.fetchScheduledMonuments.mockResolvedValue({
      features: [], available: false, unavailableReason: 'network',
    });

    await expect(updatePermissionIntelligenceQuestions(permission)).resolves.toBe(false);

    expect(mocks.updateQuestionsAfterScan).toHaveBeenCalledWith(expect.objectContaining({
      permissionId: 'permission-1',
      sourceAvailability: expect.objectContaining({ scheduled_monuments: false }),
      ruleIds: ['ROMAN_ROUTE_ACTIVITY'],
    }));
  });

  it('owns the permission-wide pass when monument coverage is available', async () => {
    mocks.fetchScheduledMonuments.mockResolvedValue({ features: [], available: true });

    await expect(updatePermissionIntelligenceQuestions(permission)).resolves.toBe(true);

    expect(mocks.updateQuestionsAfterScan).toHaveBeenCalledWith(expect.objectContaining({
      sourceAvailability: expect.objectContaining({
        scheduled_monuments: true,
        historic_routes: true,
        pas_density: true,
      }),
    }));
  });
});
