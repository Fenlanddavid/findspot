import { describe, expect, it, vi } from 'vitest';
import type { Permission } from '../../src/db';
import type { TerrainScanResult } from '../../src/hooks/useTerrainScan';
import {
  runFieldGuideScan,
  scanContextFromTerrain,
  type FieldGuideScanOrchestratorDependencies,
  type FieldGuideScanOrchestratorOptions,
} from '../../src/services/fieldguide/scanOrchestrator';

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
    createdAt: '2026-07-23T00:00:00.000Z',
    updatedAt: '2026-07-23T00:00:00.000Z',
  };
}

function terrainResult(): TerrainScanResult {
  return {
    terrainClusters: [],
    detectedFeatures: [],
    rawClusters: [],
    hotspots: [],
    nhleData: { features: [] },
    aimData: { features: [] },
    routes: [],
    modernWays: [],
    monumentPoints: [],
    heritageCount: 0,
    sourceAvailability: {},
    questionTerrainAvailability: { terrain: true },
    fromCache: false,
    noSignal: false,
    scanStartCenter: { lat: 52, lng: 0 },
    scanStartBounds: { west: -0.1, south: 51.9, east: 0.1, north: 52.1 },
    analysisBounds: { west: -0.2, south: 51.8, east: 0.2, north: 52.2 },
    historicRoutesAvailable: true,
  };
}

function options(overrides: Partial<FieldGuideScanOrchestratorOptions> = {}) {
  return {
    map: {
      getZoom: () => 16,
      jumpTo: vi.fn(),
      stop: vi.fn(),
    },
    isBusy: false,
    permissions: [permission()],
    runTerrainScan: vi.fn().mockResolvedValue(terrainResult()),
    runHistoricPhase: vi.fn().mockResolvedValue(true),
    onScanStart: vi.fn(),
    onTerrainResult: vi.fn(),
    onHistoricStart: vi.fn(),
    onScanFailure: vi.fn(),
    onScanComplete: vi.fn(),
    onNavigateToPermission: vi.fn(),
    ...overrides,
  } satisfies FieldGuideScanOrchestratorOptions;
}

function dependencies(
  overrides: Partial<FieldGuideScanOrchestratorDependencies> = {},
): FieldGuideScanOrchestratorDependencies {
  return {
    positionPermission: vi.fn().mockReturnValue(true),
    updatePermissionIntelligence: vi.fn().mockResolvedValue(true),
    questionRuleScope: vi.fn().mockReturnValue(['MOVEMENT_NO_FINDS']),
    markPermissionEvaluated: vi.fn().mockResolvedValue(undefined),
    recordError: vi.fn(),
    now: () => '2026-07-23T10:00:00.000Z',
    ...overrides,
  };
}

describe('FieldGuide scan orchestrator', () => {
  it('keeps the terrain-to-historic handoff deterministic and headless', async () => {
    const order: string[] = [];
    const scan = terrainResult();
    const opts = options({
      requestedPermissionId: 'permission-1',
      runTerrainScan: vi.fn(async () => {
        order.push('terrain');
        return scan;
      }),
      runHistoricPhase: vi.fn(async context => {
        order.push('historic');
        expect(context).toEqual(scanContextFromTerrain(scan));
        return false;
      }),
      onScanStart: () => order.push('start'),
      onTerrainResult: () => order.push('terrain-result'),
      onHistoricStart: () => order.push('historic-start'),
      onScanComplete: () => order.push('complete'),
    });
    const deps = dependencies({
      updatePermissionIntelligence: vi.fn(async () => {
        order.push('permission-intelligence');
        return true;
      }),
      markPermissionEvaluated: vi.fn(async () => {
        order.push('mark-evaluated');
      }),
    });

    const result = await runFieldGuideScan(opts, deps);
    expect(result.status).toBe('historic_started');
    if (result.status !== 'historic_started') throw new Error('Historic scan did not start');
    await result.completion;

    expect(order).toEqual([
      'permission-intelligence',
      'start',
      'terrain',
      'terrain-result',
      'historic-start',
      'historic',
      'mark-evaluated',
      'complete',
    ]);
    expect(deps.questionRuleScope).toHaveBeenCalledWith(true, true);
    expect(opts.onNavigateToPermission).toHaveBeenCalledWith('permission-1');
  });

  it('waits for permission intelligence before returning a terrain failure', async () => {
    const order: string[] = [];
    const opts = options({
      requestedPermissionId: 'permission-1',
      runTerrainScan: vi.fn().mockResolvedValue(null),
      onScanFailure: () => order.push('failed'),
      onNavigateToPermission: () => order.push('navigate'),
    });
    const deps = dependencies({
      updatePermissionIntelligence: vi.fn(async () => {
        order.push('permission-finished');
        return true;
      }),
    });

    await expect(runFieldGuideScan(opts, deps)).resolves.toEqual({
      status: 'terrain_failed',
    });
    expect(order).toEqual(['permission-finished', 'failed', 'navigate']);
    expect(opts.runHistoricPhase).not.toHaveBeenCalled();
  });

  it('rejects a permission scan that cannot be positioned without starting work', async () => {
    const opts = options({ requestedPermissionId: 'permission-1' });
    const deps = dependencies({
      positionPermission: vi.fn().mockReturnValue(false),
    });

    await expect(runFieldGuideScan(opts, deps)).resolves.toEqual({
      status: 'invalid_permission',
    });
    expect(opts.onScanStart).not.toHaveBeenCalled();
    expect(opts.runTerrainScan).not.toHaveBeenCalled();
    expect(deps.recordError).toHaveBeenCalledWith(
      'Permission question scan could not be positioned',
      'Permission permission-1 has no usable scan location',
    );
  });

  it('contains historic completion failures without navigating or completing the UI', async () => {
    const opts = options({
      requestedPermissionId: 'permission-1',
      runHistoricPhase: vi.fn().mockRejectedValue(new Error('historic offline')),
    });
    const deps = dependencies();

    const result = await runFieldGuideScan(opts, deps);
    if (result.status !== 'historic_started') throw new Error('Historic scan did not start');
    await result.completion;

    expect(deps.recordError).toHaveBeenCalledWith(
      'Permission question scan completion failed',
      'historic offline',
    );
    expect(opts.onScanComplete).not.toHaveBeenCalled();
    expect(opts.onNavigateToPermission).not.toHaveBeenCalled();
  });
});
