import type { TerrainMeasurement } from '../../engines/terrain/elevationAnalysis';
import type { Cluster } from '../../pages/fieldGuideTypes';
import { mergeEvidenceProvenance } from '../../types/evidenceProvenance';
import { getDistance } from '../../utils/fieldGuideAnalysis';

function valuesShareScale(values: number[], tolerance = 0.1): boolean {
    if (values.length === 0 || values.some(value => !Number.isFinite(value) || value <= 0)) return false;
    const smallest = Math.min(...values);
    const largest = Math.max(...values);
    return largest / smallest <= 1 + tolerance;
}

/** Interpolation is only valid when all samples describe the same measurement space. */
function interpolationSupportIsCompatible(support: TerrainMeasurement[]): boolean {
    if (!support.every(item => item.role === 'landscape_context' && item.method === 'grid_sample')) return false;
    if (!valuesShareScale(support.map(item => item.analysisWindowRadiusM))) return false;
    if (!valuesShareScale(support.map(item => item.outputPixelSpacingM))) return false;

    const resolutions = support.map(item => item.sourceResolutionM);
    const allUnknownResolution = resolutions.every(value => value === null);
    const allKnownCompatibleResolution = resolutions.every((value): value is number => value !== null)
        && valuesShareScale(resolutions as number[]);
    if (!allUnknownResolution && !allKnownCompatibleResolution) return false;

    const provenance = support.flatMap(item => item.provenance);
    if (provenance.length === 0 || support.some(item => item.provenance.length === 0)) return false;
    const coordinateSystems = new Set(provenance.map(item => item.horizontalCrs).filter(Boolean));
    if (coordinateSystems.size !== 1 || provenance.some(item => !item.horizontalCrs)) return false;
    const verticalUnits = new Set(provenance.map(item => item.verticalUnits).filter(Boolean));
    if (verticalUnits.size !== 1 || provenance.some(item => !item.verticalUnits)) return false;

    const lineages = new Set(provenance.map(item =>
        item.sourceLineageIdentity ?? item.parentSourceIdentity));
    if (lineages.size !== 1) return false;

    const datums = new Set(provenance.map(item => item.verticalDatum).filter(Boolean));
    // An unknown datum remains compatible only within one known dataset
    // lineage. A mixture of known and unknown, or conflicting known datums,
    // cannot safely be interpolated.
    if (datums.size > 1 || (datums.size === 1 && provenance.some(item => !item.verticalDatum))) return false;
    return true;
}

function weightedSupportSamples(support: TerrainMeasurement[], weights: number[]) {
    const samples = new Map<string, {
        coordinate: [number, number];
        weight: number;
        provenance: TerrainMeasurement['provenance'];
    }>();
    support.forEach((measurement, index) => {
        if (weights[index] <= 1e-12) return;
        const contributors = measurement.supportSamples.length > 0
            ? measurement.supportSamples
            : [{
                coordinate: [measurement.lon, measurement.lat] as [number, number],
                weight: 1,
                provenance: measurement.provenance,
            }];
        for (const contributor of contributors) {
            const weight = weights[index] * contributor.weight;
            if (weight <= 1e-12) continue;
            const key = contributor.coordinate.join(',');
            const existing = samples.get(key);
            if (existing) {
                existing.weight += weight;
                existing.provenance = mergeEvidenceProvenance(existing.provenance, contributor.provenance);
            } else {
                samples.set(key, {
                    coordinate: contributor.coordinate,
                    weight,
                    provenance: mergeEvidenceProvenance(contributor.provenance),
                });
            }
        }
    });
    return [...samples.values()];
}

function circularInterpolate(values: Array<{ value: number | null; weight: number }>): number | null {
    const known = values.filter((item): item is { value: number; weight: number } => item.value !== null);
    if (known.length !== values.length) return null;
    const vector = known.reduce((sum, item) => {
        const radians = item.value * Math.PI / 180;
        return { x: sum.x + Math.cos(radians) * item.weight, y: sum.y + Math.sin(radians) * item.weight };
    }, { x: 0, y: 0 });
    if (Math.hypot(vector.x, vector.y) < 1e-6) return null;
    return (Math.atan2(vector.y, vector.x) * 180 / Math.PI + 360) % 360;
}

export function interpolateTerrainMeasurementAt(
    coordinate: [number, number],
    measurements: TerrainMeasurement[],
): TerrainMeasurement | null {
    const direct = measurements
        .map(measurement => ({ measurement, distance: getDistance(coordinate, [measurement.lon, measurement.lat]) }))
        .sort((a, b) => a.distance - b.distance)[0];
    if (direct && direct.distance <= Math.max(0.5, direct.measurement.outputPixelSpacingM / 2)) {
        return {
            ...direct.measurement,
            lon: coordinate[0], lat: coordinate[1], role: 'feature_location', method: 'direct_sample',
            supportCoordinates: [[direct.measurement.lon, direct.measurement.lat]],
            supportSamples: direct.measurement.supportSamples,
            distanceFromFeatureM: direct.distance,
            maxSupportDistanceM: direct.distance,
        };
    }

    const quadrants: Array<TerrainMeasurement | null> = [null, null, null, null];
    const distances = [Infinity, Infinity, Infinity, Infinity];
    for (const measurement of measurements) {
        const east = measurement.lon >= coordinate[0] ? 1 : 0;
        const north = measurement.lat >= coordinate[1] ? 1 : 0;
        const index = north * 2 + east;
        const distance = getDistance(coordinate, [measurement.lon, measurement.lat]);
        if (distance < distances[index]) {
            quadrants[index] = measurement;
            distances[index] = distance;
        }
    }
    if (quadrants.some(item => item === null)) return null;
    const support = quadrants as TerrainMeasurement[];
    if (!interpolationSupportIsCompatible(support)) return null;
    const maxSupportDistanceM = Math.max(...distances);
    const maxAllowedDistanceM = Math.min(30, Math.max(...support.map(item => item.outputPixelSpacingM)) * 10);
    if (maxSupportDistanceM > maxAllowedDistanceM) return null;
    const west = Math.max(support[0].lon, support[2].lon);
    const east = Math.min(support[1].lon, support[3].lon);
    const south = Math.max(support[0].lat, support[1].lat);
    const north = Math.min(support[2].lat, support[3].lat);
    if (!(west <= coordinate[0] && coordinate[0] <= east && south <= coordinate[1] && coordinate[1] <= north)) return null;
    const x = east === west ? 0.5 : (coordinate[0] - west) / (east - west);
    const y = north === south ? 0.5 : (coordinate[1] - south) / (north - south);
    const weights = [(1 - x) * (1 - y), x * (1 - y), (1 - x) * y, x * y];
    const weighted = (field: 'elevationM' | 'slopePercent' | 'relativeReliefM' | 'relativeReliefNorm') =>
        support.reduce((sum, item, index) => sum + item[field] * weights[index], 0);
    const outputPixelSpacingM = support.reduce((sum, item, index) => sum + item.outputPixelSpacingM * weights[index], 0);
    const sourceResolutions = support.map(item => item.sourceResolutionM);
    const sourceResolutionM = sourceResolutions.every(value => value !== null && value === sourceResolutions[0])
        ? sourceResolutions[0]
        : null;
    const retainedSupport = weightedSupportSamples(support, weights);
    const provenance = mergeEvidenceProvenance(...retainedSupport.map(item => item.provenance));
    if (retainedSupport.length === 0 || provenance.length === 0) return null;
    return {
        lon: coordinate[0], lat: coordinate[1],
        elevationM: weighted('elevationM'),
        slopePercent: weighted('slopePercent'),
        aspectDegrees: circularInterpolate(support.map((item, index) => ({ value: item.aspectDegrees, weight: weights[index] }))),
        relativeReliefM: weighted('relativeReliefM'),
        relativeReliefNorm: weighted('relativeReliefNorm'),
        role: 'feature_location', method: 'bilinear_interpolation',
        analysisWindowRadiusM: Math.min(...support.map(item => item.analysisWindowRadiusM)),
        outputPixelSpacingM,
        sourceResolutionM,
        supportCoordinates: support.map(item => [item.lon, item.lat]),
        supportSamples: retainedSupport,
        distanceFromFeatureM: 0,
        maxSupportDistanceM,
        limitations: [...new Set(support.flatMap(item => item.limitations))],
        provenance,
    };
}

export function attachRepresentativeTerrainMeasurements(
    clusters: Cluster[],
    measurements: TerrainMeasurement[],
): void {
    for (const cluster of clusters) {
        const measurement = interpolateTerrainMeasurementAt(cluster.center, measurements);
        if (!measurement) continue;
        cluster.terrainMeasured = true;
        cluster.elevationM = measurement.elevationM;
        cluster.slopePercent = measurement.slopePercent;
        cluster.slopeGradient = measurement.slopePercent / 100;
        cluster.aspect = measurement.aspectDegrees ?? undefined;
        cluster.relativeReliefM = measurement.relativeReliefM;
        cluster.relativeReliefNorm = measurement.relativeReliefNorm;
        cluster.terrainMeasurementSupport = {
            role: 'feature_location', method: measurement.method as 'direct_sample' | 'bilinear_interpolation',
            coordinate: cluster.center,
            supportCoordinates: measurement.supportCoordinates,
            supportSamples: measurement.supportSamples,
            distanceFromFeatureM: measurement.distanceFromFeatureM ?? 0,
            maxSupportDistanceM: measurement.maxSupportDistanceM ?? 0,
            analysisWindowRadiusM: measurement.analysisWindowRadiusM,
            outputPixelSpacingM: measurement.outputPixelSpacingM,
            sourceResolutionM: measurement.sourceResolutionM,
            limitations: measurement.limitations,
        };
        cluster.provenance = mergeEvidenceProvenance(cluster.provenance, measurement.provenance);
        if (!cluster.sources.includes('elevation_dem')) cluster.sources.push('elevation_dem');
    }
}
