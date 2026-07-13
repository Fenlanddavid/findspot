import { describe, expect, it, vi } from 'vitest';
import type { Permission } from '../../src/db';
import {
  getPermissionScanTarget,
  positionMapForPermissionScan,
} from '../../src/outstandingQuestions/permissionScanTarget';

function permission(overrides: Partial<Permission> = {}): Permission {
  return {
    id: 'permission-1',
    projectId: 'project-1',
    name: 'Test permission',
    status: 'active',
    createdAt: Date.now(),
    ...overrides,
  } as Permission;
}

describe('permission question scan positioning', () => {
  it('uses the centre of the saved boundary', () => {
    const target = getPermissionScanTarget(permission({
      boundary: {
        type: 'Polygon',
        coordinates: [[
          [-1.83, 51.17],
          [-1.81, 51.17],
          [-1.81, 51.19],
          [-1.83, 51.19],
          [-1.83, 51.17],
        ]],
      },
    }));

    expect(target?.lat).toBeCloseTo(51.18);
    expect(target?.lon).toBeCloseTo(-1.82);
  });

  it('chooses a point inside a concave permission instead of its outside bounding-box centre', () => {
    const target = getPermissionScanTarget(permission({
      boundary: {
        type: 'Polygon',
        coordinates: [[
          [0, 0], [2, 0], [2, 0.5], [0.5, 0.5],
          [0.5, 2], [0, 2], [0, 0],
        ]],
      },
    }));

    expect(target).toBeTruthy();
    expect(target!.lon <= 0.5 || target!.lat <= 0.5).toBe(true);
  });

  it('stops an in-flight flyTo and synchronously jumps before scanning', () => {
    const stop = vi.fn();
    const jumpTo = vi.fn();
    const map = { stop, jumpTo, getZoom: () => 5.5 };
    const positioned = positionMapForPermissionScan(map, permission({ lat: 52.2, lon: 0.12 }));

    expect(positioned).toBe(true);
    expect(stop).toHaveBeenCalledOnce();
    expect(jumpTo).toHaveBeenCalledWith({ center: [0.12, 52.2], zoom: 14 });
    expect(stop.mock.invocationCallOrder[0]).toBeLessThan(jumpTo.mock.invocationCallOrder[0]);
  });

  it('does not start when the permission has no usable location', () => {
    const map = { stop: vi.fn(), jumpTo: vi.fn(), getZoom: () => 14 };
    expect(positionMapForPermissionScan(map, permission(),)).toBe(false);
    expect(map.jumpTo).not.toHaveBeenCalled();
  });
});
