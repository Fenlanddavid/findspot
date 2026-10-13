import { z } from 'zod';

const text = z.string().max(100_000);
const fields = z.record(z.string(), text);
export const hillfortRecordSchema = z.object({
    id: z.string().regex(/^[A-Za-z]+\d{4,}$/), atlasNumber: z.string().regex(/^\d+$/),
    name: text.min(1), alternativeNames: text, country: text,
    position: z.tuple([z.number().min(-11).max(2), z.number().min(49).max(62)]),
    recordUrl: z.string().regex(/^https?:\/\/hillforts\.arch\.ox\.ac\.uk\/records\/[A-Za-z]+\d+\.html$/),
    generation: z.string().min(1), interpretationStatus: text, interpretationComments: text,
    dataStatus: text, dataComments: text, classification: fields, dating: fields,
    description: text, references: text, identifiers: fields,
    sourceGrid: z.object({ system: text, x: text, y: text, ngr: text }),
});
export type HillfortRecord = z.infer<typeof hillfortRecordSchema>;

export const hillfortMetadataSchema = z.object({
    generation: z.string().min(1), schemaVersion: z.literal(1), edition: text,
    publicationDate: text, sourceModifiedDate: text, acquiredAt: text,
    sourceUrl: z.string().url(), doi: z.literal('https://doi.org/10.5284/1118744'),
    sourceSha256: z.string().regex(/^[a-f0-9]{64}$/), attribution: text,
    sourceLicence: z.literal('https://creativecommons.org/licenses/by/4.0/'),
    adaptationLicence: z.literal('https://creativecommons.org/licenses/by-sa/4.0/'),
    transformations: text, locationPrecision: text, limitations: text,
    recordCount: z.number().int().nonnegative().max(10_000),
    rejectedRecordCount: z.number().int().nonnegative(), coverage: z.array(text),
}).passthrough();
export type HillfortMetadata = z.infer<typeof hillfortMetadataSchema>;
export const hillfortDatasetSchema = z.object({ metadata: hillfortMetadataSchema, records: z.array(hillfortRecordSchema).max(10_000) });
export type HillfortDataset = z.infer<typeof hillfortDatasetSchema>;

export type HillfortScanGeometry = GeoJSON.Polygon | GeoJSON.MultiPolygon;
export const hillfortMatchSchema = z.object({
    source: z.literal('NHLE'), sourceId: z.string(),
    relationship: z.enum(['shared_identifier', 'unresolved_candidate']), reason: text,
});
export const hillfortResultSchema = z.object({
    record: hillfortRecordSchema, relationship: z.enum(['within_scan', 'surrounding_context']),
    distanceFromCentreM: z.number().finite().nonnegative(),
    distanceFromBoundaryM: z.number().finite().nonnegative(),
    matches: z.array(hillfortMatchSchema),
});
export type HillfortResult = z.infer<typeof hillfortResultSchema>;
export const hillfortContextSchema = z.object({
    status: z.enum(['loaded', 'empty', 'partial', 'unavailable_offline', 'load_failure', 'outside_coverage']),
    generation: z.string(), geometryFingerprint: z.string().min(1),
    centre: z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]),
    contextPaddingM: z.number().finite().positive(),
    metadata: hillfortMetadataSchema.optional(), results: z.array(hillfortResultSchema).max(10_000),
});
export type HillfortContext = z.infer<typeof hillfortContextSchema>;
