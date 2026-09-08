import { z } from 'zod';
import type {
  FieldGuideScanCache,
  GeologyContextRecord,
  LandscapeInterpretationRecord,
} from '../db';
import type { Cluster, HistoricRoute, ModernWay } from '../pages/fieldGuideTypes';
import type {
  AIMResponse,
  NHLEResponse,
  NominatimResponse,
  OverpassResponse,
} from './historicScanService';
import type { GeologyContext } from '../engines/geologyContext/geologyContextTypes';
import type { LandscapeInterpretation } from '../types/landscapeInterpretation';

const finite = z.number().finite();
const lonLat = z.tuple([finite, finite]);
const evidenceProvenanceSchema = z.object({
  observationId: z.string().min(1),
  requestedSource: z.string().min(1),
  deliveredSource: z.string().min(1),
  datasetIdentity: z.string().min(1),
  parentSourceIdentity: z.string().min(1),
  sourceLineageIdentity: z.string().min(1).optional(),
  lineageConfidence: z.enum(['verified', 'unknown']).optional(),
  contentIdentity: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  decodedContentIdentity: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  deliveredDataType: z.enum([
    'rendered_hillshade', 'rendered_relief', 'rendered_slope',
    'rgb_imagery', 'elevation_dem', 'historic_record',
  ]),
  resolutionM: finite.positive().optional(),
  sourceResolutionM: finite.positive().optional(),
  horizontalCrs: z.string().optional(),
  verticalUnits: z.literal('metres').optional(),
  verticalDatum: z.string().min(1).optional(),
  acquisitionDate: z.string().optional(),
  retrievalDate: z.string().min(1),
  fallbackStatus: z.enum(['requested', 'fallback', 'offline_cache']),
  coverageStatus: z.enum(['complete', 'partial', 'unknown']).optional(),
  limitations: z.array(z.string().min(1)).optional(),
  tile: z.object({ z: finite.int(), x: finite.int(), y: finite.int() }).optional(),
});

const clusterSchema = z.object({
  id: z.string().min(1),
  points: z.array(z.object({ x: finite, y: finite })),
  minX: finite,
  maxX: finite,
  minY: finite,
  maxY: finite,
  type: z.string(),
  score: finite,
  number: finite,
  isProtected: z.boolean(),
  confidence: z.enum(['High', 'Medium', 'Subtle']),
  findPotential: finite,
  center: lonLat,
  source: z.enum([
    'terrain', 'satellite', 'historic', 'terrain_global', 'slope',
    'hydrology', 'satellite_spring', 'satellite_summer', 'elevation_dem',
  ]),
  sources: z.array(z.enum([
    'terrain', 'satellite', 'historic', 'terrain_global', 'slope',
    'hydrology', 'satellite_spring', 'satellite_summer', 'elevation_dem',
  ])),
  provenance: z.array(evidenceProvenanceSchema).optional(),
  observationKind: z.enum(['image_anomaly', 'elevation_measurement', 'historic_record']).optional(),
  terrainMeasured: z.boolean().optional(),
  elevationM: finite.optional(),
  slopePercent: finite.nonnegative().optional(),
  aspect: finite.min(0).max(360).optional(),
  relativeReliefM: finite.optional(),
  relativeReliefNorm: finite.optional(),
  withinScanMergeCount: finite.int().nonnegative().optional(),
  terrainMeasurementSupport: z.object({
    role: z.enum(['feature_location', 'feature_footprint_summary']),
    method: z.enum(['direct_sample', 'bilinear_interpolation', 'footprint_summary']),
    coordinate: lonLat,
    supportCoordinates: z.array(lonLat).min(1),
    // Optional only for backwards-compatible validation of pre-v4 cached
    // records. New derived measurements always write complete support lineage;
    // the engine-version boundary prevents old records from being rescored.
    supportSamples: z.array(z.object({
      coordinate: lonLat,
      weight: finite.positive().max(1),
      provenance: z.array(evidenceProvenanceSchema).min(1),
    })).min(1).optional(),
    distanceFromFeatureM: finite.nonnegative(),
    maxSupportDistanceM: finite.nonnegative(),
    analysisWindowRadiusM: finite.positive(),
    outputPixelSpacingM: finite.positive(),
    sourceResolutionM: finite.positive().nullable(),
    limitations: z.array(z.string().min(1)),
  }).optional(),
}).passthrough();

const modernWaySchema = z.object({
  geometry: z.array(lonLat),
  bbox: z.tuple([lonLat, lonLat]),
  highwayTag: z.string(),
}).passthrough();

const historicRouteSchema = z.object({
  id: z.string(),
  type: z.enum([
    'roman_road', 'historic_trackway', 'holloway', 'green_lane',
    'droveway', 'suspected_route',
  ]),
  source: z.enum([
    'osm', 'itinere', 'rrra', 'historic_map_digitised', 'lidar_interpreted', 'manual',
  ]),
  confidenceClass: z.enum(['A', 'B', 'C', 'D']),
  certaintyScore: finite,
  geometry: z.array(lonLat),
  bbox: z.tuple([lonLat, lonLat]),
}).passthrough();

const overpassElementSchema = z.object({
  id: finite,
  type: z.enum(['node', 'way', 'relation']),
  lat: finite.optional(),
  lon: finite.optional(),
  center: z.object({ lat: finite, lon: finite }).optional(),
  tags: z.record(z.string(), z.string()).optional(),
  geometry: z.array(z.object({ lat: finite, lon: finite })).optional(),
  members: z.array(z.object({
    type: z.string(),
    ref: finite,
    role: z.string(),
  })).optional(),
}).passthrough();

const overpassResponseSchema = z.object({
  elements: z.array(overpassElementSchema),
}).passthrough();

const nominatimResponseSchema = z.object({
  address: z.record(z.string(), z.string()).optional(),
  display_name: z.string().optional(),
}).passthrough();

const featureResponseSchema = z.object({
  features: z.array(z.object({
    type: z.literal('Feature'),
    geometry: z.object({ type: z.string(), coordinates: z.unknown() }).passthrough(),
    properties: z.record(z.string(), z.unknown()),
  }).passthrough()),
  available: z.boolean().optional(),
  error: z.string().optional(),
}).passthrough();

export type HistoricLookupCache = {
  geoData: NominatimResponse | null;
  contextData: OverpassResponse | null;
  nhleData: NHLEResponse | null;
  aimData: AIMResponse | null;
  routeRaw: OverpassResponse | null;
  romanRoads: HistoricRoute[] | null;
};

const historicLookupSchema = z.object({
  geoData: nominatimResponseSchema.nullable(),
  contextData: overpassResponseSchema.nullable(),
  nhleData: featureResponseSchema.nullable(),
  aimData: featureResponseSchema.nullable(),
  routeRaw: overpassResponseSchema.nullable(),
  romanRoads: z.array(historicRouteSchema).nullable(),
}).passthrough();

export type ValidatedFieldGuideScanCache = Omit<
  FieldGuideScanCache,
  'rawClusters' | 'modernWays' | 'historicLookup'
> & {
  rawClusters: Cluster[];
  modernWays?: ModernWay[];
  historicLookup?: HistoricLookupCache;
};

const fieldGuideScanCacheSchema = z.object({
  id: z.string().min(1),
  createdAt: finite,
  rawClusters: z.array(clusterSchema),
  sourceAvailability: z.record(z.string(), z.boolean()),
  sourceCompleteness: z.record(z.string(), z.boolean()).optional(),
  modernWays: z.array(modernWaySchema).optional(),
  modernWaysFetchedAt: finite.optional(),
  engineVersion: z.string().optional(),
  historicLookup: historicLookupSchema.optional(),
}).passthrough();

export function safeParseFieldGuideScanCache(
  value: unknown,
): ValidatedFieldGuideScanCache | null {
  const result = fieldGuideScanCacheSchema.safeParse(value);
  return result.success ? result.data as ValidatedFieldGuideScanCache : null;
}

const geologyContextSchema = z.object({
  tileKey: z.string().min(1),
  centroid: z.object({ lat: finite, lon: finite }),
  source: z.object({
    bedrock: z.literal('BGS_625K').optional(),
    superficial: z.literal('BGS_625K').optional(),
  }),
  raw: z.object({
    bedrockName: z.string().optional(),
    bedrockLithology: z.string().optional(),
    bedrockAge: z.string().optional(),
    superficialName: z.string().optional(),
    superficialLithology: z.string().optional(),
    artificialGround: z.object({
      present: z.boolean(),
      type: z.enum(['made_ground', 'worked_ground', 'disturbed_ground', 'unknown']).optional(),
    }).optional(),
    massMovement: z.boolean().optional(),
    linearFeatures: z.array(z.string()).optional(),
  }),
  landscapeClass: z.enum([
    'peat_fen', 'alluvial_floodplain', 'river_gravel_terrace',
    'chalk_downland', 'heavy_clay', 'sand_gravel', 'foreshore',
    'mixed_uncertain', 'unknown',
  ]),
  confidence: z.enum(['low', 'medium', 'high']),
  scoreModifier: finite,
  explanation: z.array(z.string()),
  fetchedAt: finite,
  classifierVersion: finite,
  sourceVersion: z.string(),
}).passthrough();

const populatedGeologyRecordSchema = z.object({
  tileKey: z.string().min(1),
  centroid: z.object({ lat: finite, lon: finite }),
  context: geologyContextSchema,
  empty: z.literal(false).optional(),
  fetchedAt: finite,
  classifierVersion: finite,
  sourceVersion: z.string(),
}).passthrough();

const emptyGeologyRecordSchema = z.object({
  tileKey: z.string().min(1),
  centroid: z.object({ lat: finite, lon: finite }),
  empty: z.literal(true),
  fetchedAt: finite,
  classifierVersion: finite,
  sourceVersion: z.string(),
}).passthrough();

const geologyRecordSchema = z.union([
  populatedGeologyRecordSchema,
  emptyGeologyRecordSchema,
]);

export type ValidatedGeologyContextRecord =
  | (Omit<GeologyContextRecord, 'context' | 'empty'> & {
      context: GeologyContext;
      empty?: false;
    })
  | (Omit<GeologyContextRecord, 'context' | 'empty'> & {
      empty: true;
    });

export function safeParseGeologyContextRecord(
  value: unknown,
): ValidatedGeologyContextRecord | null {
  const result = geologyRecordSchema.safeParse(value);
  return result.success ? result.data as ValidatedGeologyContextRecord : null;
}

const evidenceItemSchema = z.object({
  id: z.string(),
  label: z.string(),
  source: z.string(),
  strength: z.string(),
  polarity: z.string(),
  weight: finite,
}).passthrough();

const landscapeInterpretationSchema = z.object({
  geohash6: z.string().min(1),
  processScores: z.array(z.object({
    processId: z.string(),
    rawScore: finite,
    regionalMultiplier: finite,
    finalScore: finite,
    contributingSignals: z.array(z.string()),
  }).passthrough()),
  interpretationScores: z.array(z.object({
    interpretationId: z.string(),
    derivedScore: finite,
    periodAffinity: z.array(z.unknown()),
    confidenceTier: z.string(),
  }).passthrough()),
  evidenceAssessment: z.object({
    supportingEvidence: z.array(evidenceItemSchema),
    contradictingEvidence: z.array(evidenceItemSchema),
    missingEvidence: z.array(evidenceItemSchema),
    supportingPercent: finite,
    contradictingPercent: finite,
    confidenceSummary: z.string(),
    primaryInfluencingFactors: z.array(z.string()),
    suggestedInterpretation: z.string(),
    archaeologicalReasoning: z.string(),
    landscapeSummary: z.string(),
    landscapeEngines: z.array(z.unknown()),
    periodLikelihood: z.array(z.unknown()),
    behaviourInteractions: z.array(z.unknown()),
  }).passthrough(),
  primaryInterpretationId: z.string().nullable(),
  secondaryInterpretationId: z.string().nullable(),
  depositionAffinity: z.object({
    convergenceMet: z.boolean(),
    noteTemplateId: z.string().nullable(),
  }),
  temporalPersistence: z.string(),
  recordSparsity: z.boolean(),
  uncertainty: z.string(),
  scheduledMonumentOverlap: z.boolean(),
  narrative: z.object({
    templateId: z.string(),
    periodSubstitution: z.string().nullable(),
    signalSubstitutions: z.array(z.string()),
  }),
  engineVersion: z.string(),
  generatedAt: finite,
}).passthrough();

export type ValidatedLandscapeInterpretationRecord = Omit<
  LandscapeInterpretationRecord,
  'interpretation'
> & {
  interpretation: LandscapeInterpretation;
};

const landscapeRecordSchema = z.object({
  geohash6: z.string().min(1),
  generatedAt: finite,
  engineVersion: z.string().optional(),
  geologyTileKey: z.string().optional(),
  inputSignature: z.string().optional(),
  interpretation: landscapeInterpretationSchema,
}).passthrough();

export function safeParseLandscapeInterpretationRecord(
  value: unknown,
): ValidatedLandscapeInterpretationRecord | null {
  const result = landscapeRecordSchema.safeParse(value);
  return result.success ? result.data as ValidatedLandscapeInterpretationRecord : null;
}
