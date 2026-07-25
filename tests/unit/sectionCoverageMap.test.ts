import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { PermissionSection } from '../../src/shared/coverageTypes';
import { SectionCoverageMap } from '../../src/components/coverage/SectionCoverageMap';

const ISO = '2026-07-25T10:00:00.000Z';

describe('SectionCoverageMap', () => {
  it('preserves metre edge ratios and draws the authoritative outline last', () => {
    const latitude = 52.6;
    const longitudeSpan = 60 / (111_320 * Math.cos(latitude * Math.PI / 180));
    const latitudeSpan = 100 / 111_320;
    const boundary = {
      type: 'Polygon' as const,
      coordinates: [[
        [0, latitude],
        [longitudeSpan, latitude],
        [0, latitude + latitudeSpan],
        [0, latitude],
      ]],
    };
    const section: PermissionSection = {
      id: 'triangle:h3:test',
      permissionId: 'permission-1',
      fieldId: 'triangle',
      layoutKey: 'h3:test',
      label: 'Triangle · 1',
      currentGeometryVersion: 1,
      geometryVersions: [{
        version: 1,
        boundaryHash: 'h3-adaptive-v4:test',
        geometry: boundary,
        areaM2: 3_000,
        effectiveFrom: ISO,
      }],
      createdAt: ISO,
      updatedAt: ISO,
    };

    const markup = renderToStaticMarkup(React.createElement(SectionCoverageMap, {
      sections: [section],
      observations: [],
      fieldBoundaries: [boundary],
    }));
    const outline = markup.match(/<path[^>]*data-testid="coverage-field-outline"[^>]*>/)?.[0];
    expect(outline).toBeDefined();
    const pathData = outline?.match(/\sd="([^"]+)"/)?.[1] ?? '';
    const points = [...pathData.matchAll(/[ML]([0-9.]+),([0-9.]+)/g)]
      .map(match => [Number(match[1]), Number(match[2])] as const);
    const horizontal = Math.hypot(
      points[1][0] - points[0][0],
      points[1][1] - points[0][1],
    );
    const vertical = Math.hypot(
      points[2][0] - points[0][0],
      points[2][1] - points[0][1],
    );

    expect(horizontal / vertical).toBeCloseTo(0.6, 2);
    expect(outline).toContain('fill="none"');
    expect(outline).toContain('pointer-events="none"');
    expect(markup.indexOf('coverage-field-outline'))
      .toBeGreaterThan(markup.indexOf('coverage-section-triangle:h3:test'));
  });
});
