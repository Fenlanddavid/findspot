import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  parseOverpassContextRoutes,
  parseOverpassRoutes,
  type OverpassElement,
} from '../../src/services/historicScanService';

const CONJECTURAL_FEN_CAUSEWAY: OverpassElement[] = [
  {
    id: 7_612_846,
    type: 'relation',
    tags: {
      conjectural: 'yes',
      historic: 'roman_road',
      'historic:civilization': 'ancient_roman',
      name: 'ROMAN ROAD - Fen Causeway',
      route: 'historic',
      type: 'route',
    },
    members: [{ type: 'way', ref: 497_933_068, role: '' }],
  },
  {
    id: 497_933_068,
    type: 'way',
    tags: {
      fixme: 'Approximate location - needs to be mapped.',
      name: 'Fen Causeway',
      note: 'This is an estimated segment of the roman road "Fen Causeway".',
    },
    geometry: [
      { lat: 52.5891796, lon: -0.3814746 },
      { lat: 52.5703776, lon: -0.0446001 },
    ],
  },
  {
    id: 10,
    type: 'way',
    tags: { historic: 'trackway', name: 'Old track' },
    geometry: [
      { lat: 52.57, lon: -0.19 },
      { lat: 52.571, lon: -0.188 },
    ],
  },
  {
    id: 11,
    type: 'way',
    tags: { holloway: 'yes', name: 'Hollow lane' },
    geometry: [
      { lat: 52.572, lon: -0.187 },
      { lat: 52.573, lon: -0.185 },
    ],
  },
];

describe('historic route source policy', () => {
  it('excludes the conjectural OSM Fen Causeway while retaining non-Roman routes', () => {
    expect(parseOverpassRoutes(CONJECTURAL_FEN_CAUSEWAY)).toContainEqual(
      expect.objectContaining({
        id: 'route-497933068',
        type: 'roman_road',
        source: 'osm',
        name: 'ROMAN ROAD - Fen Causeway',
      }),
    );

    expect(parseOverpassContextRoutes(CONJECTURAL_FEN_CAUSEWAY)).toEqual([
      expect.objectContaining({
        id: 'route-10',
        type: 'historic_trackway',
        source: 'osm',
        name: 'Old track',
      }),
      expect.objectContaining({
        id: 'route-11',
        type: 'holloway',
        source: 'osm',
        name: 'Hollow lane',
      }),
    ]);
  });

  it('makes both scan coordinators consume the non-Roman OSM policy', async () => {
    const [historicCoordinator, terrainCoordinator, service] = await Promise.all([
      readFile(new URL(
        '../../src/services/fieldguide/historicScanCoordinator.ts',
        import.meta.url,
      ), 'utf8'),
      readFile(new URL(
        '../../src/services/fieldguide/terrainScanCoordinator.ts',
        import.meta.url,
      ), 'utf8'),
      readFile(new URL('../../src/services/historicScanService.ts', import.meta.url), 'utf8'),
    ]);

    expect(historicCoordinator).toContain('parseOverpassContextRoutes(routeRaw.elements)');
    expect(terrainCoordinator).toContain(
      'parseOverpassContextRoutes(routeRaw.elements as OverpassElement[])',
    );
    expect(service).not.toContain('way["historic"="roman_road"]');
    expect(service).not.toContain('relation["historic"="roman_road"]');
  });
});
