import { z } from 'zod';

export const COMPANION_RECORDING_SCHEMA_VERSION = 1 as const;
export const MAX_COMPANION_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_COMPANION_SEGMENTS = 1_000;
export const MAX_COMPANION_POINTS = 100_000;

const finite = z.number().finite();
const safeNonNegativeInteger = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const utcMilliseconds = safeNonNegativeInteger;
const nullableNonNegative = finite.nonnegative().nullable();

const trackPointSchema = z.object({
  type: z.literal('trackPoint'),
  sequence: safeNonNegativeInteger,
  timestampUtc: utcMilliseconds,
  monotonicTimestampNs: z.string().regex(/^\d+$/).nullable(),
  receivedTimestampUtc: utcMilliseconds,
  latitude: finite.min(-90).max(90),
  longitude: finite.min(-180).max(180),
  altitudeM: finite.nullable(),
  horizontalAccuracyM: nullableNonNegative,
  verticalAccuracyM: nullableNonNegative,
  headingDegrees: finite.min(0).lt(360).nullable(),
  speedMps: nullableNonNegative,
  provider: z.string().trim().min(1).max(100),
}).strict();

const segmentSchema = z.object({
  segmentIndex: safeNonNegativeInteger,
  startedAtUtc: utcMilliseconds,
  endedAtUtc: utcMilliseconds.nullable(),
  observations: z.array(trackPointSchema),
}).strict();

const producerSchema = z.object({
  name: z.literal('FindSpot Companion'),
  version: z.string().trim().min(1).max(50),
  platform: z.enum(['android', 'ios']),
}).strict();

export const companionRecordingSchema = z.object({
  schemaVersion: z.literal(COMPANION_RECORDING_SCHEMA_VERSION),
  producer: producerSchema,
  recordingUuid: z.string().uuid(),
  contentHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  createdAtUtc: utcMilliseconds,
  startedAtUtc: utcMilliseconds,
  stoppedAtUtc: utcMilliseconds.nullable(),
  state: z.enum(['stopped', 'interrupted']),
  interruptionReason: z.enum([
    'process_killed',
    'device_reboot',
    'permission_revoked',
    'location_disabled',
  ]).nullable(),
  segments: z.array(segmentSchema).min(1).max(MAX_COMPANION_SEGMENTS),
}).strict().superRefine((recording, context) => {
  if (recording.state === 'interrupted' && recording.interruptionReason === null) {
    context.addIssue({
      code: 'custom',
      path: ['interruptionReason'],
      message: 'Interrupted recordings require an interruption reason.',
    });
  }
  if (recording.state === 'stopped' && recording.stoppedAtUtc === null) {
    context.addIssue({
      code: 'custom',
      path: ['stoppedAtUtc'],
      message: 'Stopped recordings require a stop time.',
    });
  }

  let previousSequence = -1;
  let pointCount = 0;
  recording.segments.forEach((segment, segmentOffset) => {
    if (segment.segmentIndex !== segmentOffset) {
      context.addIssue({
        code: 'custom',
        path: ['segments', segmentOffset, 'segmentIndex'],
        message: 'Segment indexes must be contiguous and start at zero.',
      });
    }
    if (segment.endedAtUtc !== null && segment.endedAtUtc < segment.startedAtUtc) {
      context.addIssue({
        code: 'custom',
        path: ['segments', segmentOffset, 'endedAtUtc'],
        message: 'A segment cannot end before it starts.',
      });
    }
    segment.observations.forEach((observation, observationOffset) => {
      pointCount += 1;
      if (observation.sequence <= previousSequence) {
        context.addIssue({
          code: 'custom',
          path: ['segments', segmentOffset, 'observations', observationOffset, 'sequence'],
          message: 'Observation sequences must be strictly increasing across the recording.',
        });
      }
      previousSequence = observation.sequence;
    });
  });
  if (pointCount > MAX_COMPANION_POINTS) {
    context.addIssue({
      code: 'custom',
      path: ['segments'],
      message: `A recording cannot contain more than ${MAX_COMPANION_POINTS.toLocaleString()} observations.`,
    });
  }
});

export type CompanionTrackPoint = z.infer<typeof trackPointSchema>;
export type CompanionSegment = z.infer<typeof segmentSchema>;
export type CompanionRecording = z.infer<typeof companionRecordingSchema>;

function canonicalize(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Canonical JSON cannot contain a non-finite number.');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(',')}]`;
  }
  if (typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map(key => (
      `${JSON.stringify(key)}:${canonicalize(object[key])}`
    )).join(',')}}`;
  }
  throw new Error('Canonical JSON contains an unsupported value.');
}

export function canonicalCompanionPayload(recording: CompanionRecording): string {
  // Recording identity and producer metadata are deliberately excluded. The
  // hash identifies observation content, allowing a re-wrapped export with a
  // different UUID to be recognized as duplicate fieldwork.
  return canonicalize({
    schemaVersion: recording.schemaVersion,
    startedAtUtc: recording.startedAtUtc,
    stoppedAtUtc: recording.stoppedAtUtc,
    state: recording.state,
    interruptionReason: recording.interruptionReason,
    segments: recording.segments,
  });
}

export async function companionPayloadHash(recording: CompanionRecording): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalCompanionPayload(recording));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return `sha256:${Array.from(new Uint8Array(digest))
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('')}`;
}

export type ValidatedCompanionRecording = {
  recording: CompanionRecording;
  originalJson: string;
  pointCount: number;
};

export async function validateCompanionRecordingJson(
  originalJson: string,
): Promise<ValidatedCompanionRecording> {
  if (new TextEncoder().encode(originalJson).byteLength > MAX_COMPANION_FILE_BYTES) {
    throw new Error(`Companion recording exceeds the ${MAX_COMPANION_FILE_BYTES / (1024 * 1024)} MB limit.`);
  }

  let raw: unknown;
  try {
    raw = JSON.parse(originalJson);
  } catch {
    throw new Error('This is not valid Companion JSON.');
  }
  const result = companionRecordingSchema.safeParse(raw);
  if (!result.success) {
    const issue = result.error.issues[0];
    const location = issue?.path.length ? ` at ${issue.path.join('.')}` : '';
    throw new Error(`Invalid Companion recording${location}: ${issue?.message ?? 'schema validation failed'}`);
  }

  const expectedHash = await companionPayloadHash(result.data);
  if (expectedHash !== result.data.contentHash) {
    throw new Error('Companion recording content hash does not match its observations.');
  }

  return {
    recording: result.data,
    originalJson,
    pointCount: result.data.segments.reduce(
      (total, segment) => total + segment.observations.length,
      0,
    ),
  };
}
