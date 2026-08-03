import { describe, expect, it } from 'vitest';
import { resolveStaticMapPreviewAnchor } from '../../src/components/StaticMapPreview';

describe('StaticMapPreview location', () => {
  it('uses a mapped boundary instead of an unrelated saved permission point', () => {
    const boundary = {
      type: 'Polygon',
      coordinates: [[
        [-0.1910875459, 52.5735870972],
        [-0.1877474067, 52.5735870972],
        [-0.1877474067, 52.5758921454],
        [-0.1910875459, 52.5758921454],
        [-0.1910875459, 52.5735870972],
      ]],
    };

    expect(resolveStaticMapPreviewAnchor(54.5, -2, boundary)).toEqual({
      lat: 52.5747396213,
      lon: -0.1894174763,
    });
  });

  it('supports MultiPolygon boundaries', () => {
    const boundary = {
      type: 'MultiPolygon',
      coordinates: [
        [[[0, 50], [1, 50], [1, 51], [0, 50]]],
        [[[2, 52], [3, 52], [3, 53], [2, 52]]],
      ],
    };

    expect(resolveStaticMapPreviewAnchor(null, null, boundary)).toEqual({ lat: 51.5, lon: 1.5 });
  });

  it('falls back to saved coordinates when no usable boundary exists', () => {
    expect(resolveStaticMapPreviewAnchor(52.5, -0.2, null)).toEqual({ lat: 52.5, lon: -0.2 });
    expect(resolveStaticMapPreviewAnchor(null, null, { type: 'Polygon', coordinates: [] })).toBeNull();
  });
});
