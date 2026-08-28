import { z } from 'zod';
import type { Find, Session, SignificantFind } from '../db';

export const CLUB_DAY_EXPORT_LIMITS = {
  jsonBytes: 50 * 1024 * 1024,
  records: 5_000,
  mediaBytes: 10 * 1024 * 1024,
  id: 128,
  name: 200,
  text: 32_000,
  filename: 512,
  mime: 128,
  listItems: 1_000,
} as const;

const bounded = (max: number = CLUB_DAY_EXPORT_LIMITS.text) => z.string().max(max);
const nonEmpty = (max: number = CLUB_DAY_EXPORT_LIMITS.id) => z.string().trim().min(1).max(max);
const id = nonEmpty().regex(/^[A-Za-z0-9._:-]+$/);
const date = z.string().max(64).refine(value => Number.isFinite(Date.parse(value)), 'Invalid date');
const finite = z.number().finite();
const nullableFinite = finite.nullable();
const latitude = finite.min(-90).max(90).nullable();
const longitude = finite.min(-180).max(180).nullable();

const attribution = {
  sharedPermissionId: id.optional(),
  recorderId: id.optional(),
  recorderName: bounded(CLUB_DAY_EXPORT_LIMITS.name).optional(),
};

const sessionSchema = z.object({
  id,
  projectId: id,
  permissionId: id,
  fieldId: id.nullable(),
  date,
  lat: latitude,
  lon: longitude,
  gpsAccuracyM: nullableFinite,
  landUse: bounded(500),
  cropType: bounded(500),
  isStubble: z.boolean(),
  notes: bounded(),
  isFinished: z.boolean(),
  startTime: date.optional(),
  endTime: date.optional(),
  sessionStartedAt: date.optional(),
  activatedAt: date.optional(),
  keyNotes: z.array(bounded(2_000)).max(100).optional(),
  ...attribution,
  createdAt: date,
  updatedAt: date,
}).strict();

const findSchema = z.object({
  id,
  projectId: id,
  permissionId: id,
  fieldId: id.nullable(),
  sessionId: id.nullable(),
  findCode: bounded(500),
  objectType: bounded(1_000),
  findCategory: z.enum(['Coin', 'Artefact', 'Jewellery', 'Button / Fastener', 'Token / Jetton', 'Other']).optional(),
  coinType: bounded(1_000).optional(),
  coinDenomination: bounded(1_000).optional(),
  coinSpink: bounded(500).optional(),
  pasId: bounded(500).optional(),
  isFavorite: z.boolean().optional(),
  isPending: z.boolean().optional(),
  scatterId: id.optional(),
  isNotableFind: z.boolean().optional(),
  lat: latitude,
  lon: longitude,
  gpsAccuracyM: nullableFinite,
  osGridRef: bounded(100),
  w3w: bounded(200),
  period: z.enum(['Prehistoric', 'Bronze Age', 'Iron Age', 'Celtic', 'Roman', 'Anglo-Saxon', 'Early Medieval', 'Medieval', 'Post-medieval', 'Modern', 'Unknown']),
  material: z.enum(['Gold', 'Silver', '50% Silver', 'Copper alloy', 'Copper', 'Cupro-Nickel', 'Lead', 'Iron', 'Tin', 'Pewter', 'Pottery', 'Flint', 'Stone', 'Glass', 'Bone', 'Other']),
  weightG: nullableFinite,
  widthMm: nullableFinite,
  heightMm: nullableFinite,
  depthMm: nullableFinite,
  decoration: bounded(),
  completeness: z.enum(['Complete', 'Incomplete', 'Fragment']),
  findContext: bounded(),
  detector: bounded(500).optional(),
  targetId: finite.optional(),
  depthCm: finite.optional(),
  ruler: bounded(500).optional(),
  mint: bounded(500).optional(),
  dateRange: bounded(500).optional(),
  storageLocation: bounded(2_000),
  notes: bounded(),
  foundAt: date.optional(),
  ...attribution,
  sourceSignalId: id.optional(),
  createdAt: date,
  updatedAt: date,
}).strict();

const treasureOutcomes = [
  'not_treasure_returned', 'disclaimed_returned', 'museum_acquiring',
  'donated_reward_waived', 'reward_paid', 'transferred_to_museum', 'closed',
] as const;

const significantFindSchema = z.object({
  id,
  projectId: id,
  permissionId: id,
  sessionId: id.nullable(),
  path: z.enum(['stop_secure', 'map_scatter', 'notable_find']),
  status: z.enum(['in_progress', 'awaiting_excavation', 'excavation_complete', 'coroner_notified', 'pas_recorded']),
  jurisdiction: z.enum(['england_wales', 'scotland', 'northern_ireland', 'unknown']),
  lat: latitude,
  lon: longitude,
  gpsAccuracyM: nullableFinite,
  osGridRef: bounded(100),
  w3w: bounded(200),
  preExcavationNotes: bounded(),
  soilObservations: bounded(),
  secureCoverNotes: bounded().optional(),
  groundSurfacePhotoCaptured: z.boolean(),
  scatterId: id.nullable(),
  scatterFindIds: z.array(id).max(CLUB_DAY_EXPORT_LIMITS.listItems),
  linkedFindId: id.nullable(),
  treasureActResult: z.enum(['may_be_reportable', 'probably_not', 'unknown']).nullable().optional(),
  treasureActDraft: bounded(),
  landownerSummary: bounded(),
  findDescription: bounded().optional(),
  landownerNotified: z.boolean().optional(),
  excavationFindings: bounded().optional(),
  initialObservations: bounded().optional(),
  firstPersonAccount: bounded().optional(),
  depthCm: nullableFinite.optional(),
  periodEstimate: bounded(1_000).optional(),
  orientationNotes: bounded().optional(),
  coRecorderName: bounded(CLUB_DAY_EXPORT_LIMITS.name).optional(),
  coRecorderContact: bounded(500).optional(),
  allFindsRecovered: z.enum(['yes', 'partial', 'no']).optional(),
  floContactDate: date.optional(),
  pasRecordNumber: bounded(500).optional(),
  treasureReference: bounded(500).optional(),
  treasureOutcome: z.enum(treasureOutcomes).optional(),
  coronerDecisionDate: date.optional(),
  museumName: bounded(1_000).optional(),
  valuationAmount: bounded(500).optional(),
  rewardStatus: z.enum(['not_applicable', 'pending', 'waived', 'paid']).optional(),
  rewardReceivedDate: date.optional(),
  rewardSplitNotes: bounded().optional(),
  finalDispositionNotes: bounded().optional(),
  outcomeDate: date.optional(),
  scatterOutcome: z.enum(['pas_recorded', 'research_complete', ...treasureOutcomes]).optional(),
  notableOutcome: z.enum(['pas_recorded', 'identified_not_recorded', 'returned', 'museum_interest', ...treasureOutcomes]).optional(),
  currentLocation: z.enum(['with_finder', 'with_flo', 'at_museum', 'other']).optional(),
  preliminaryId: bounded(1_000).optional(),
  pasRecordUrl: bounded(2_000).optional(),
  workflowStep: bounded(500).nullable().optional(),
  createdAt: date,
  updatedAt: date,
}).strict();

const mediaSchema = z.object({
  id,
  projectId: id,
  findId: id,
  permissionId: id.optional(),
  surfaceObservationId: id.optional(),
  type: z.enum(['photo', 'document']),
  photoType: z.enum(['in-situ', 'cleaned', 'photo1', 'photo2', 'photo3', 'photo4', 'other']).optional(),
  filename: bounded(CLUB_DAY_EXPORT_LIMITS.filename),
  mime: bounded(CLUB_DAY_EXPORT_LIMITS.mime),
  blob: z.string(),
  caption: bounded(),
  scalePresent: z.boolean(),
  pxPerMm: finite.positive().optional(),
  createdAt: date,
}).strict();

const exportSchema = z.object({
  type: z.literal('findspot-club-day-export'),
  version: z.literal(1),
  sharedPermissionId: id,
  recorderId: id,
  recorderName: nonEmpty(CLUB_DAY_EXPORT_LIMITS.name),
  exportedAt: date,
  sessions: z.array(sessionSchema),
  finds: z.array(findSchema),
  significantFinds: z.array(significantFindSchema).optional().default([]),
  media: z.array(mediaSchema),
}).strict();

export type ValidatedClubDayExport = Omit<z.infer<typeof exportSchema>, 'sessions' | 'finds' | 'significantFinds' | 'media'> & {
  sessions: Session[];
  finds: Find[];
  significantFinds: SignificantFind[];
  media: Array<z.infer<typeof mediaSchema>>;
};

function dataUriDecodedBytes(value: string): number {
  const match = /^data:([A-Za-z0-9][A-Za-z0-9!#$&^_.+\/-]{0,127});base64,([A-Za-z0-9+/]*={0,2})$/.exec(value);
  if (!match || match[2].length % 4 !== 0) throw new Error('Invalid media data.');
  const payload = match[2];
  const padding = payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0;
  return (payload.length / 4) * 3 - padding;
}

function assertRelationships(data: z.infer<typeof exportSchema>): void {
  const ids = new Set<string>();
  const add = (value: string) => {
    if (ids.has(value)) throw new Error('Club Day export contains duplicate IDs.');
    ids.add(value);
  };
  data.sessions.forEach(record => add(record.id));
  data.finds.forEach(record => add(record.id));
  data.significantFinds.forEach(record => add(record.id));
  data.media.forEach(record => add(record.id));

  const sessionIds = new Set(data.sessions.map(record => record.id));
  const findIds = new Set(data.finds.map(record => record.id));
  const significantFindIds = new Set(data.significantFinds.map(record => record.id));
  for (const record of data.sessions) {
    if (record.sharedPermissionId && record.sharedPermissionId !== data.sharedPermissionId) {
      throw new Error('Session belongs to another Club Day.');
    }
  }
  for (const record of data.finds) {
    if (record.sessionId && !sessionIds.has(record.sessionId)) throw new Error('Find references a missing session.');
    if (record.sharedPermissionId && record.sharedPermissionId !== data.sharedPermissionId) {
      throw new Error('Find belongs to another Club Day.');
    }
  }
  for (const record of data.significantFinds) {
    if (record.sessionId && !sessionIds.has(record.sessionId)) throw new Error('Significant find references a missing session.');
    if (record.linkedFindId && !findIds.has(record.linkedFindId)) throw new Error('Significant find references a missing find.');
    if (record.scatterFindIds.some(findId => !findIds.has(findId))) throw new Error('Scatter references a missing find.');
  }
  for (const record of data.media) {
    if (!findIds.has(record.findId) && !significantFindIds.has(record.findId)) {
      throw new Error('Media references a missing find.');
    }
    if (dataUriDecodedBytes(record.blob) > CLUB_DAY_EXPORT_LIMITS.mediaBytes) {
      throw new Error('Media exceeds the Club Day import limit.');
    }
  }
}

export function validateClubDayExport(raw: string): ValidatedClubDayExport {
  if (new TextEncoder().encode(raw).byteLength > CLUB_DAY_EXPORT_LIMITS.jsonBytes) {
    throw new Error('Import file is too large.');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new Error('Invalid Club Day export.');
  }
  const result = exportSchema.safeParse(parsed);
  if (!result.success) throw new Error('Invalid Club Day export.');
  const total = result.data.sessions.length + result.data.finds.length + result.data.significantFinds.length + result.data.media.length;
  if (total > CLUB_DAY_EXPORT_LIMITS.records) throw new Error('Club Day export contains too many records.');
  assertRelationships(result.data);
  return result.data as ValidatedClubDayExport;
}
