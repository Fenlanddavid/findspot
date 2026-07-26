#!/usr/bin/env node
// Builds the browser-ready Roman-road asset from a manually supplied,
// WGS84-reprojected GeoJSON source. RRRA Digital Britannia v1.0 and the legacy
// Itiner-e extract share the same geometry cleanup and stable-ID pipeline.
//
// Usage:
//   node scripts/build-roman-roads.mjs <input.geojson> [output.geojson]

import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const MIN_SEGMENT_LENGTH_METRES = 20;
export const COORDINATE_DECIMAL_PLACES = 5;
export const MAX_SINGLE_ASSET_BYTES = 3 * 1024 * 1024;
export const RRRA_V1_EXPECTED_FEATURE_COUNT = 3_572;
export const RRRA_V1_CONFIDENCE_DOMAIN = [0, 1, 2, 3, null];

export const RRRA_V1_PROPERTY_SCHEMA = {
    fid: ['number'],
    'Road number ': ['string'],
    'Road name (if any)': ['null', 'string'],
    'Road - Start and End': ['null', 'string'],
    'Segment Confidence': ['null', 'number'],
    'Segment identified by': ['null', 'string'],
    'Link 1.': ['null', 'string'],
    'Link 2.': ['null', 'string'],
    'Link 3.': ['null', 'string'],
    'Main References': ['null', 'string'],
    'Primary HER records': ['null', 'string'],
    'Segment HER records': ['null', 'string'],
    Reports: ['null', 'string'],
    'Segment length (m)': ['null', 'number'],
};

function hash32(value, seed) {
    let hash = seed;
    for (let index = 0; index < value.length; index++) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(36).padStart(7, '0');
}

function coordinateKey([lon, lat]) {
    return `${lon.toFixed(COORDINATE_DECIMAL_PLACES)},${lat.toFixed(COORDINATE_DECIMAL_PLACES)}`;
}

function stableSegmentId(prefix, name, coordinates) {
    const normalized = coordinates.map(coordinateKey);
    const forwards = normalized.join(';');
    const backwards = [...normalized].reverse().join(';');
    const canonicalGeometry = forwards < backwards ? forwards : backwards;
    const content = `${name?.trim() ?? ''}|${canonicalGeometry}`;
    return `${prefix}-${hash32(content, 0x811c9dc5)}${hash32(content, 0x9e3779b9)}`;
}

function assertCoordinate(coordinate, label) {
    if (
        !Array.isArray(coordinate)
        || coordinate.length < 2
        || !Number.isFinite(coordinate[0])
        || !Number.isFinite(coordinate[1])
    ) {
        throw new TypeError(`${label} must be a finite [longitude, latitude] coordinate`);
    }
    const [lon, lat] = coordinate;
    if (lon < -180 || lon > 180 || lat < -90 || lat > 90) {
        throw new RangeError(`${label} is outside WGS84 longitude/latitude bounds`);
    }
}

function quantizeLine(coordinates, label) {
    if (!Array.isArray(coordinates)) {
        throw new TypeError(`${label} coordinates must be an array`);
    }
    return coordinates.map((coordinate, coordinateIndex) => {
        assertCoordinate(coordinate, `${label} coordinate ${coordinateIndex}`);
        return [
            Number(coordinate[0].toFixed(COORDINATE_DECIMAL_PLACES)),
            Number(coordinate[1].toFixed(COORDINATE_DECIMAL_PLACES)),
        ];
    });
}

function lineLengthMetres(coordinates) {
    const earthRadiusMetres = 6_371_000;
    const radians = Math.PI / 180;
    let length = 0;

    for (let index = 1; index < coordinates.length; index++) {
        const [lon1, lat1] = coordinates[index - 1];
        const [lon2, lat2] = coordinates[index];
        const deltaLat = (lat2 - lat1) * radians;
        const deltaLon = (lon2 - lon1) * radians;
        const a = Math.sin(deltaLat / 2) ** 2
            + Math.cos(lat1 * radians) * Math.cos(lat2 * radians)
            * Math.sin(deltaLon / 2) ** 2;
        length += 2 * earthRadiusMetres * Math.asin(Math.sqrt(a));
    }

    return length;
}

function featureLines(feature, featureIndex) {
    const geometry = feature?.geometry;
    if (!geometry || !['LineString', 'MultiLineString'].includes(geometry.type)) {
        throw new TypeError(`Feature ${featureIndex} must have LineString or MultiLineString geometry`);
    }
    return geometry.type === 'LineString' ? [geometry.coordinates] : geometry.coordinates;
}

function domainValueType(value) {
    if (value === null) return 'null';
    if (Array.isArray(value)) return 'array';
    return typeof value;
}

function sortedDomain(values) {
    return [...values].sort((left, right) => String(left).localeCompare(String(right)));
}

function sameDomain(actual, expected) {
    return JSON.stringify(sortedDomain(actual)) === JSON.stringify(sortedDomain(expected));
}

function isRawRrraSource(source) {
    return source.features.some(feature => (
        feature?.properties
        && Object.hasOwn(feature.properties, 'Segment Confidence')
        && Object.hasOwn(feature.properties, 'Road number ')
    ));
}

export function validateRrraV1Schema(
    source,
    expectedFeatureCount = RRRA_V1_EXPECTED_FEATURE_COUNT,
) {
    if (source?.type !== 'FeatureCollection' || !Array.isArray(source.features)) {
        throw new TypeError('RRRA source must be a GeoJSON FeatureCollection');
    }
    if (source.features.length !== expectedFeatureCount) {
        throw new Error(
            `RRRA v1.0 feature count changed: ${source.features.length}; `
            + `expected ${expectedFeatureCount}`,
        );
    }

    const expectedFields = Object.keys(RRRA_V1_PROPERTY_SCHEMA).sort();
    const observedTypes = Object.fromEntries(
        expectedFields.map(field => [field, new Set()]),
    );
    const confidenceValues = new Set();
    const sourceIds = new Set();

    for (const [featureIndex, feature] of source.features.entries()) {
        if (feature?.type !== 'Feature' || feature.geometry?.type !== 'LineString') {
            throw new TypeError(`RRRA feature ${featureIndex} must be a LineString Feature`);
        }
        const properties = feature.properties;
        if (!properties || typeof properties !== 'object' || Array.isArray(properties)) {
            throw new TypeError(`RRRA feature ${featureIndex} must have properties`);
        }
        const actualFields = Object.keys(properties).sort();
        if (JSON.stringify(actualFields) !== JSON.stringify(expectedFields)) {
            throw new Error(
                `RRRA feature ${featureIndex} property schema changed: `
                + `${actualFields.join(', ')}`,
            );
        }

        for (const field of expectedFields) {
            const valueType = domainValueType(properties[field]);
            if (!RRRA_V1_PROPERTY_SCHEMA[field].includes(valueType)) {
                throw new TypeError(
                    `RRRA feature ${featureIndex} field ${field} has unexpected type ${valueType}`,
                );
            }
            observedTypes[field].add(valueType);
        }

        const sourceId = properties.fid;
        if (sourceIds.has(sourceId)) {
            throw new Error(`RRRA feature ${featureIndex} duplicates fid ${sourceId}`);
        }
        sourceIds.add(sourceId);
        confidenceValues.add(properties['Segment Confidence']);
    }

    for (const field of expectedFields) {
        if (!sameDomain(observedTypes[field], RRRA_V1_PROPERTY_SCHEMA[field])) {
            throw new Error(
                `RRRA v1.0 type domain changed for ${field}: `
                + `${sortedDomain(observedTypes[field]).join(', ')}`,
            );
        }
    }
    if (!sameDomain(confidenceValues, RRRA_V1_CONFIDENCE_DOMAIN)) {
        throw new Error(
            `RRRA v1.0 Segment Confidence domain changed: `
            + `${sortedDomain(confidenceValues).join(', ')}`,
        );
    }
}

function normalizedText(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function mappedProperties(sourceKind, properties) {
    if (sourceKind === 'rrra') {
        return {
            source: 'rrra',
            name: normalizedText(properties.name ?? properties['Road name (if any)']),
            reference: normalizedText(properties.reference ?? properties['Road number ']),
            confidenceClass: 'A',
        };
    }
    const confidenceClass = ['A', 'B', 'C'].includes(properties.confidenceClass)
        ? properties.confidenceClass
        : 'C';
    return {
        source: 'itinere',
        name: normalizedText(properties.Name),
        reference: null,
        confidenceClass,
    };
}

export function validateBuiltRomanRoads(collection) {
    if (collection?.type !== 'FeatureCollection' || !Array.isArray(collection.features)) {
        throw new TypeError('Built Roman roads must be a GeoJSON FeatureCollection');
    }

    const ids = new Set();
    for (const [featureIndex, feature] of collection.features.entries()) {
        if (feature?.type !== 'Feature' || feature.geometry?.type !== 'LineString') {
            throw new TypeError(`Built feature ${featureIndex} must be a LineString Feature`);
        }
        const source = feature.properties?.source;
        if (!['itinere', 'rrra'].includes(source)) {
            throw new TypeError(`Built feature ${featureIndex} must identify its source`);
        }
        if (typeof feature.id !== 'string' || !feature.id.startsWith(`${source}-`)) {
            throw new TypeError(`Built feature ${featureIndex} must have a stable ${source} ID`);
        }
        if (ids.has(feature.id)) {
            throw new Error(`Built feature ${featureIndex} duplicates route ID ${feature.id}`);
        }
        ids.add(feature.id);

        const coordinates = feature.geometry.coordinates;
        for (const [coordinateIndex, coordinate] of coordinates.entries()) {
            assertCoordinate(coordinate, `Built feature ${featureIndex} coordinate ${coordinateIndex}`);
        }
        if (new Set(coordinates.map(coordinateKey)).size < 2) {
            throw new Error(`Built feature ${featureIndex} has fewer than two distinct coordinates`);
        }
        const lengthMetres = lineLengthMetres(coordinates);
        if (lengthMetres < MIN_SEGMENT_LENGTH_METRES) {
            throw new Error(
                `Built feature ${featureIndex} is ${lengthMetres.toFixed(2)} m; `
                + `minimum is ${MIN_SEGMENT_LENGTH_METRES} m`,
            );
        }
    }
}

export function buildRomanRoads(source, options = {}) {
    if (source?.type !== 'FeatureCollection' || !Array.isArray(source.features)) {
        throw new TypeError('Roman-road source must be a GeoJSON FeatureCollection');
    }

    const rawRrraSource = isRawRrraSource(source);
    const builtRrraSource = source.features.some(feature => feature?.properties?.source === 'rrra');
    const sourceKind = rawRrraSource || builtRrraSource ? 'rrra' : 'itinere';
    if (rawRrraSource) {
        validateRrraV1Schema(
            source,
            options.expectedRrraFeatureCount ?? RRRA_V1_EXPECTED_FEATURE_COUNT,
        );
    }

    const features = [];
    let inputSegments = 0;
    let droppedShortSegments = 0;
    let droppedDegenerateSegments = 0;

    for (const [featureIndex, feature] of source.features.entries()) {
        if (feature?.type !== 'Feature' || !feature.properties || typeof feature.properties !== 'object') {
            throw new TypeError(`Feature ${featureIndex} must have GeoJSON properties`);
        }

        const lines = featureLines(feature, featureIndex);
        for (const [lineIndex, rawCoordinates] of lines.entries()) {
            inputSegments++;
            const coordinates = quantizeLine(
                rawCoordinates,
                `Feature ${featureIndex} line ${lineIndex}`,
            );
            const distinctCoordinateCount = new Set(coordinates.map(coordinateKey)).size;
            const lengthMetres = lineLengthMetres(coordinates);
            if (
                distinctCoordinateCount < 2
                || lengthMetres < MIN_SEGMENT_LENGTH_METRES
            ) {
                droppedShortSegments++;
                if (distinctCoordinateCount < 2) droppedDegenerateSegments++;
                continue;
            }

            const properties = mappedProperties(sourceKind, feature.properties);
            features.push({
                type: 'Feature',
                id: stableSegmentId(sourceKind, properties.name, coordinates),
                properties,
                geometry: {
                    type: 'LineString',
                    coordinates,
                },
            });
        }
    }

    const collection = { type: 'FeatureCollection', features };
    validateBuiltRomanRoads(collection);
    return {
        collection,
        stats: {
            source: sourceKind,
            inputFeatures: source.features.length,
            inputSegments,
            outputSegments: features.length,
            droppedShortSegments,
            droppedDegenerateSegments,
        },
    };
}

async function main(args) {
    const [inputArgument, outputArgument] = args;
    if (!inputArgument) {
        throw new Error('Usage: node scripts/build-roman-roads.mjs <input.geojson> [output.geojson]');
    }

    const inputPath = resolve(inputArgument);
    const outputPath = resolve(outputArgument ?? 'public/roman-roads-gb.geojson');
    const source = JSON.parse(await readFile(inputPath, 'utf8'));
    const { collection, stats } = buildRomanRoads(source);
    const serialized = JSON.stringify(collection);
    const outputBytes = Buffer.byteLength(serialized);
    if (outputBytes > MAX_SINGLE_ASSET_BYTES) {
        throw new Error(
            `Built Roman-road asset is ${outputBytes} bytes; `
            + `single-file budget is ${MAX_SINGLE_ASSET_BYTES} bytes`,
        );
    }
    await writeFile(outputPath, `${serialized}\n`);
    console.log(JSON.stringify({ inputPath, outputPath, outputBytes, ...stats }, null, 2));
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) {
    main(process.argv.slice(2)).catch(error => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
    });
}
