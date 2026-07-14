import { describe, expect, it } from 'vitest';
import { calculateInvestigationSections } from '../../src/outstandingQuestions/sectionalStats';

const boundary = {
  type: 'Polygon' as const,
  coordinates: [[
    [-0.01, 51.99], [0.01, 51.99], [0.01, 52.01],
    [-0.01, 52.01], [-0.01, 51.99],
  ]],
};

describe('investigation sectional stats', () => {
  it('renders three equal corridor sections with local coverage and find counts', () => {
    const sections = calculateInvestigationSections({
      contextGeometry: [[-0.003, 52], [0.003, 52]],
      boundary,
      bufferM: 20,
      tracks: [],
      finds: [
        { id: 'west', lat: 52, lon: -0.002 } as any,
        { id: 'centre', lat: 52, lon: 0 } as any,
        { id: 'east', lat: 52, lon: 0.002 } as any,
      ],
    });

    expect(sections).toHaveLength(3);
    expect(sections.map(section => section.outsidePermission)).toEqual([false, false, false]);
    expect(sections.map(section => Math.round(section.coveragePct!))).toEqual([0, 0, 0]);
    expect(sections.map(section => section.findsCount)).toEqual([1, 1, 1]);
    expect(sections.map(section => section.label)).toEqual([
      'western part of this permission',
      'central part of this permission',
      'eastern part of this permission',
    ]);
  });

  it('suppresses the block when context geometry is absent', () => {
    expect(calculateInvestigationSections({
      boundary, bufferM: 20, tracks: [], finds: [],
    })).toEqual([]);
  });

  it('suppresses corridors shorter than 100 metres', () => {
    expect(calculateInvestigationSections({
      contextGeometry: [[0, 52], [0.0005, 52]],
      boundary, bufferM: 20, tracks: [], finds: [],
    })).toEqual([]);
  });

  it('marks a concave-boundary section whose midpoint is outside the permission', () => {
    const concaveBoundary = {
      type: 'Polygon' as const,
      coordinates: [[
        [-0.01, 51.99], [0.01, 51.99], [0.01, 52.01],
        [0.003, 52.01], [0.003, 51.999], [-0.003, 51.999],
        [-0.003, 52.01], [-0.01, 52.01], [-0.01, 51.99],
      ]],
    };
    const sections = calculateInvestigationSections({
      contextGeometry: [[-0.008, 52], [0.008, 52]],
      boundary: concaveBoundary,
      bufferM: 20,
      tracks: [],
      finds: [],
    });

    expect(sections).toHaveLength(3);
    expect(sections[1]).toMatchObject({ outsidePermission: true });
    expect(sections[1].coveragePct).toBeUndefined();
    expect(sections[1].findsCount).toBeUndefined();
  });
});
