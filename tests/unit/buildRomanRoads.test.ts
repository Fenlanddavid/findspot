import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  MAX_SINGLE_ASSET_BYTES,
  MIN_SEGMENT_LENGTH_METRES,
  RRRA_V1_CONFIDENCE_DOMAIN,
  RRRA_V1_PROPERTY_SCHEMA,
  buildRomanRoads,
  validateRrraV1Schema,
  validateBuiltRomanRoads,
} from '../../scripts/build-roman-roads.mjs';

const RRRA_BASE_PROPERTIES = {
  fid: 1,
  'Road number ': '25',
  'Road name (if any)': 'The Fen Causeway',
  'Road - Start and End': 'Water Newton to Downham Market',
  'Segment Confidence': 3,
  'Segment identified by': 'Example',
  'Link 1.': 'https://example.test/1',
  'Link 2.': 'https://example.test/2',
  'Link 3.': 'https://example.test/3',
  'Main References': 'Reference',
  'Primary HER records': 'HER 1',
  'Segment HER records': 'HER 2',
  Reports: 'Report',
  'Segment length (m)': 100,
};

function rrraSchemaFixture() {
  return {
    type: 'FeatureCollection',
    features: RRRA_V1_CONFIDENCE_DOMAIN.map((confidence, index) => ({
      type: 'Feature',
      properties: index === 1
        ? {
            ...RRRA_BASE_PROPERTIES,
            fid: index + 1,
            'Road name (if any)': null,
            'Road - Start and End': null,
            'Segment Confidence': confidence,
            'Segment identified by': null,
            'Link 1.': null,
            'Link 2.': null,
            'Link 3.': null,
            'Main References': null,
            'Primary HER records': null,
            'Segment HER records': null,
            Reports: null,
            'Segment length (m)': null,
          }
        : {
            ...RRRA_BASE_PROPERTIES,
            fid: index + 1,
            'Segment Confidence': confidence,
          },
      geometry: {
        type: 'LineString',
        coordinates: [[-0.35 + index * 0.01, 52.56], [-0.34 + index * 0.01, 52.57]],
      },
    })),
  };
}

function pointToSegmentMetres(point, start, end) {
  const latitude = point[1] * Math.PI / 180;
  const longitudeScale = 111_320 * Math.cos(latitude);
  const project = ([lon, lat]) => [
    (lon - point[0]) * longitudeScale,
    (lat - point[1]) * 111_320,
  ];
  const [startX, startY] = project(start);
  const [endX, endY] = project(end);
  const deltaX = endX - startX;
  const deltaY = endY - startY;
  const lengthSquared = deltaX ** 2 + deltaY ** 2;
  const fraction = lengthSquared === 0
    ? 0
    : Math.max(0, Math.min(1, -(startX * deltaX + startY * deltaY) / lengthSquared));
  return Math.hypot(startX + fraction * deltaX, startY + fraction * deltaY);
}

function pointToLineMetres(point, coordinates) {
  return Math.min(...coordinates.slice(1).map((end, index) => (
    pointToSegmentMetres(point, coordinates[index], end)
  )));
}

describe('Roman-road asset build', () => {
  it('retains the legacy cleanup path with stable Itiner-e IDs', () => {
    const source = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { Name: 'Example road', confidenceClass: 'B' },
          geometry: {
            type: 'LineString',
            coordinates: [[-0.1234567, 52.1234567], [-0.122, 52.124]],
          },
        },
        {
          type: 'Feature',
          properties: { Name: 'Join residue', confidenceClass: 'C' },
          geometry: {
            type: 'LineString',
            coordinates: [[-0.1, 52], [-0.099999, 52]],
          },
        },
      ],
    };

    const first = buildRomanRoads(source);
    const second = buildRomanRoads(structuredClone(source));

    expect(first.stats).toEqual({
      source: 'itinere',
      inputFeatures: 2,
      inputSegments: 2,
      outputSegments: 1,
      droppedShortSegments: 1,
      droppedDegenerateSegments: 1,
    });
    expect(first.collection).toEqual(second.collection);
    expect(first.collection.features[0]).toMatchObject({
      id: expect.stringMatching(/^itinere-[a-z0-9]{14}$/),
      geometry: {
        type: 'LineString',
        coordinates: [[-0.12346, 52.12346], [-0.122, 52.124]],
      },
      properties: {
        source: 'itinere',
        name: 'Example road',
        reference: null,
        confidenceClass: 'B',
      },
    });
  });

  it('pins the observed RRRA v1.0 schema and maps the whole layer to class A', () => {
    const source = rrraSchemaFixture();

    expect(Object.keys(RRRA_V1_PROPERTY_SCHEMA)).toEqual([
      'fid',
      'Road number ',
      'Road name (if any)',
      'Road - Start and End',
      'Segment Confidence',
      'Segment identified by',
      'Link 1.',
      'Link 2.',
      'Link 3.',
      'Main References',
      'Primary HER records',
      'Segment HER records',
      'Reports',
      'Segment length (m)',
    ]);
    expect(() => validateRrraV1Schema(source, 5)).not.toThrow();

    const built = buildRomanRoads(source, { expectedRrraFeatureCount: 5 });
    expect(built.collection.features).toHaveLength(5);
    expect(built.collection.features[0]).toMatchObject({
      id: expect.stringMatching(/^rrra-[a-z0-9]{14}$/),
      properties: {
        source: 'rrra',
        name: 'The Fen Causeway',
        reference: '25',
        confidenceClass: 'A',
      },
    });

    const changed = structuredClone(source);
    changed.features[0].properties['Confidence renamed'] = 3;
    delete changed.features[0].properties['Segment Confidence'];
    expect(() => validateRrraV1Schema(changed, 5)).toThrow(/property schema changed/);
  });

  it('rejects unreprojected British National Grid coordinates', () => {
    const source = {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        properties: { Name: 'BNG road', confidenceClass: 'A' },
        geometry: {
          type: 'LineString',
          coordinates: [[511547.29, 297772.7], [515067.79, 298779.95]],
        },
      }],
    };

    expect(() => buildRomanRoads(source)).toThrow(/outside WGS84/);
  });

  it('fails validation if a degenerate or sub-20m segment reaches output', () => {
    const invalid = {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        id: 'itinere-invalid',
        properties: {
          source: 'itinere',
          name: 'Invalid road',
          reference: null,
          confidenceClass: 'C',
        },
        geometry: {
          type: 'LineString',
          coordinates: [[-0.1, 52], [-0.1, 52]],
        },
      }],
    };

    expect(() => validateBuiltRomanRoads(invalid)).toThrow(/fewer than two distinct coordinates/);
    expect(MIN_SEGMENT_LENGTH_METRES).toBe(20);
    expect(MAX_SINGLE_ASSET_BYTES).toBe(3 * 1024 * 1024);
  });

  it('ratchets the checked-in RRRA asset and projection landmark', async () => {
    const source = JSON.parse(await readFile(
      new URL('../../public/roman-roads-gb.geojson', import.meta.url),
      'utf8',
    ));
    const built = buildRomanRoads(source);
    const landmark = source.features.find(feature => (
      feature.properties.name === 'The Fen Causeway'
      && feature.properties.reference === '25'
    ));
    const [lon, lat] = landmark.geometry.coordinates[0];
    const expected = [-0.35572, 52.56636];
    const latMetres = (lat - expected[1]) * 111_320;
    const lonMetres = (lon - expected[0])
      * 111_320 * Math.cos(expected[1] * Math.PI / 180);
    const landmarkErrorMetres = Math.hypot(latMetres, lonMetres);

    expect(source.features).toHaveLength(3_505);
    expect(built.stats.outputSegments).toBe(source.features.length);
    expect(built.stats.droppedShortSegments).toBe(0);
    expect(built.stats.droppedDegenerateSegments).toBe(0);
    expect(() => validateBuiltRomanRoads(built.collection)).not.toThrow();
    expect(source.features.every(feature => feature.id.startsWith('rrra-'))).toBe(true);
    expect(new Set(source.features.map(feature => feature.id)).size).toBe(source.features.length);
    expect(source.features.every(feature => feature.properties.confidenceClass === 'A')).toBe(true);
    expect(landmarkErrorMetres).toBeLessThanOrEqual(10);
  });

  it('contains accepted Fen Causeway and Ermine Street alignments', async () => {
    const source = JSON.parse(await readFile(
      new URL('../../public/roman-roads-gb.geojson', import.meta.url),
      'utf8',
    ));
    const fenCauseway = source.features.filter(feature => (
      feature.properties.name?.includes('Fen Causeway')
    ));
    const ermineStreet = source.features.filter(feature => (
      feature.properties.name === 'Ermine Street'
    ));
    const flagFen = [-0.189262, 52.574828];
    const flagFenDistanceMetres = Math.min(...fenCauseway.map(feature => (
      pointToLineMetres(flagFen, feature.geometry.coordinates)
    )));

    expect(fenCauseway.length).toBeGreaterThan(0);
    expect(flagFenDistanceMetres).toBeLessThan(100);
    expect(ermineStreet.length).toBeGreaterThan(0);
    expect(ermineStreet.every(feature => (
      feature.properties.source === 'rrra'
      && feature.properties.confidenceClass === 'A'
    ))).toBe(true);
  });
});
