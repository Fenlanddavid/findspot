import type { Field } from '../db';

export const CLUB_DAY_LIMITS = {
  encodedPayloadChars: 64 * 1024,
  decodedJsonBytes: 256 * 1024,
  fields: 100,
  ringsPerPolygon: 16,
  pointsPerRing: 5_000,
  totalCoordinates: 20_000,
  id: 128,
  name: 200,
  email: 320,
  contactNumber: 80,
  notes: 8_000,
  isoDateTime: 64,
} as const;

export type ClubDayPackField = Pick<Field, 'id' | 'name' | 'boundary'> &
  Partial<Pick<Field, 'notes' | 'createdAt' | 'updatedAt'>>;

export type ClubDayPack = {
  type: 'findspot-club-day-pack';
  version: 1;
  sharedPermissionId: string;
  eventName: string;
  eventDate: string;
  organiserName?: string;
  organiserContactNumber?: string;
  organiserEmail?: string;
  significantFindInstructions?: string;
  publicNotes?: string;
  boundary?: Field['boundary'];
  fields: ClubDayPackField[];
  createdAt: string;
};

type JsonObject = Record<string, unknown>;
type EncodedPolygon = number[][];
type CompactClubDayField = [id: string, name: string, boundary: EncodedPolygon];

type CompactClubDayPack = {
  t: 'cdp';
  v: 1;
  s: string;
  n: string;
  d: string;
  o?: string;
  c?: string;
  e?: string;
  i?: string;
  p?: string;
  b?: EncodedPolygon;
  f: CompactClubDayField[];
  a: string;
};

const COORD_SCALE = 1_000_000;
const ID_PATTERN = /^[A-Za-z0-9._:-]+$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+={0,2}$/;

export class ClubDayValidationError extends Error {
  constructor(message = 'This Club Day link is invalid or too large to import.') {
    super(message);
    this.name = 'ClubDayValidationError';
  }
}

function fail(message?: string): never {
  throw new ClubDayValidationError(message);
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string') fail(`Invalid ${label}.`);
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max) fail(`Invalid ${label}.`);
  return trimmed;
}

function optionalString(value: unknown, label: string, max: number): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  return requiredString(value, label, max);
}

function identifier(value: unknown, label: string): string {
  const id = requiredString(value, label, CLUB_DAY_LIMITS.id);
  if (!ID_PATTERN.test(id)) fail(`Invalid ${label}.`);
  return id;
}

function eventDate(value: unknown): string {
  const date = requiredString(value, 'event date', 10);
  if (!DATE_PATTERN.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
    fail('Invalid event date.');
  }
  return date;
}

function isoDateTime(value: unknown, label: string): string {
  const result = requiredString(value, label, CLUB_DAY_LIMITS.isoDateTime);
  if (!Number.isFinite(Date.parse(result))) fail(`Invalid ${label}.`);
  return result;
}

function optionalEmail(value: unknown): string | undefined {
  const email = optionalString(value, 'organiser email', CLUB_DAY_LIMITS.email);
  if (email && (!email.includes('@') || /[\s\r\n]/.test(email))) fail('Invalid organiser email.');
  return email;
}

function point(value: unknown): [number, number] {
  if (!Array.isArray(value) || value.length < 2) fail('Invalid Club Day boundary.');
  const [lon, lat] = value;
  if (typeof lon !== 'number' || !Number.isFinite(lon) || lon < -180 || lon > 180) {
    fail('Invalid Club Day longitude.');
  }
  if (typeof lat !== 'number' || !Number.isFinite(lat) || lat < -90 || lat > 90) {
    fail('Invalid Club Day latitude.');
  }
  return [Number(lon.toFixed(6)), Number(lat.toFixed(6))];
}

function samePoint(a: readonly number[], b: readonly number[]): boolean {
  return a[0] === b[0] && a[1] === b[1];
}

function polygon(value: unknown, coordinateBudget: { used: number }): Field['boundary'] {
  if (!isObject(value) || value.type !== 'Polygon' || !Array.isArray(value.coordinates)) {
    fail('Invalid Club Day boundary.');
  }
  if (value.coordinates.length === 0 || value.coordinates.length > CLUB_DAY_LIMITS.ringsPerPolygon) {
    fail('Club Day boundary is too complex.');
  }

  const coordinates = value.coordinates.map(rawRing => {
    if (!Array.isArray(rawRing) || rawRing.length < 4 || rawRing.length > CLUB_DAY_LIMITS.pointsPerRing) {
      fail('Club Day boundary is too complex.');
    }
    coordinateBudget.used += rawRing.length;
    if (coordinateBudget.used > CLUB_DAY_LIMITS.totalCoordinates) fail('Club Day geometry is too large.');
    const ring = rawRing.map(point);
    if (!samePoint(ring[0], ring[ring.length - 1])) fail('Club Day boundary ring is not closed.');
    return ring;
  });

  return { type: 'Polygon', coordinates };
}

function decodedPolygon(value: unknown, coordinateBudget: { used: number }): Field['boundary'] {
  if (!Array.isArray(value) || value.length === 0 || value.length > CLUB_DAY_LIMITS.ringsPerPolygon) {
    fail('Invalid compact Club Day boundary.');
  }
  const coordinates = value.map(rawRing => {
    if (!Array.isArray(rawRing) || rawRing.length < 8 || rawRing.length % 2 !== 0) {
      fail('Invalid compact Club Day boundary.');
    }
    const pointCount = rawRing.length / 2;
    if (pointCount > CLUB_DAY_LIMITS.pointsPerRing) fail('Club Day boundary is too complex.');
    coordinateBudget.used += pointCount;
    if (coordinateBudget.used > CLUB_DAY_LIMITS.totalCoordinates) fail('Club Day geometry is too large.');

    let encodedLon = 0;
    let encodedLat = 0;
    const ring: [number, number][] = [];
    for (let index = 0; index < rawRing.length; index += 2) {
      const lonValue = rawRing[index];
      const latValue = rawRing[index + 1];
      if (!Number.isSafeInteger(lonValue) || !Number.isSafeInteger(latValue)) {
        fail('Invalid compact Club Day coordinate.');
      }
      if (index === 0) {
        encodedLon = lonValue;
        encodedLat = latValue;
      } else {
        encodedLon += lonValue;
        encodedLat += latValue;
      }
      ring.push(point([encodedLon / COORD_SCALE, encodedLat / COORD_SCALE]));
    }
    if (!samePoint(ring[0], ring[ring.length - 1])) fail('Club Day boundary ring is not closed.');
    return ring;
  });
  return { type: 'Polygon', coordinates };
}

function optionalFullPolygon(value: unknown, budget: { used: number }): Field['boundary'] | undefined {
  return value === undefined || value === null ? undefined : polygon(value, budget);
}

function optionalEncodedPolygon(value: unknown, budget: { used: number }): Field['boundary'] | undefined {
  return value === undefined || value === null ? undefined : decodedPolygon(value, budget);
}

function fullPack(value: JsonObject): ClubDayPack {
  if (value.type !== 'findspot-club-day-pack' || value.version !== 1) fail();
  if (!Array.isArray(value.fields) || value.fields.length > CLUB_DAY_LIMITS.fields) {
    fail('Club Day contains too many fields.');
  }

  const budget = { used: 0 };
  const seenFieldIds = new Set<string>();
  const fields = value.fields.map(rawField => {
    if (!isObject(rawField)) fail('Invalid Club Day field.');
    const id = identifier(rawField.id, 'field ID');
    if (seenFieldIds.has(id)) fail('Club Day contains duplicate field IDs.');
    seenFieldIds.add(id);
    return {
      id,
      name: requiredString(rawField.name, 'field name', CLUB_DAY_LIMITS.name),
      boundary: polygon(rawField.boundary, budget),
      notes: optionalString(rawField.notes, 'field notes', CLUB_DAY_LIMITS.notes),
      createdAt: rawField.createdAt === undefined ? undefined : isoDateTime(rawField.createdAt, 'field created date'),
      updatedAt: rawField.updatedAt === undefined ? undefined : isoDateTime(rawField.updatedAt, 'field updated date'),
    };
  });

  return {
    type: 'findspot-club-day-pack',
    version: 1,
    sharedPermissionId: identifier(value.sharedPermissionId, 'shared permission ID'),
    eventName: requiredString(value.eventName, 'event name', CLUB_DAY_LIMITS.name),
    eventDate: eventDate(value.eventDate),
    organiserName: optionalString(value.organiserName, 'organiser name', CLUB_DAY_LIMITS.name),
    organiserContactNumber: optionalString(value.organiserContactNumber, 'organiser contact number', CLUB_DAY_LIMITS.contactNumber),
    organiserEmail: optionalEmail(value.organiserEmail),
    significantFindInstructions: optionalString(value.significantFindInstructions, 'significant-find instructions', CLUB_DAY_LIMITS.notes),
    publicNotes: optionalString(value.publicNotes, 'public notes', CLUB_DAY_LIMITS.notes),
    boundary: optionalFullPolygon(value.boundary, budget),
    fields,
    createdAt: isoDateTime(value.createdAt, 'pack creation date'),
  };
}

function compactPack(value: JsonObject): ClubDayPack {
  if (value.t !== 'cdp' || value.v !== 1) fail();
  if (!Array.isArray(value.f) || value.f.length > CLUB_DAY_LIMITS.fields) {
    fail('Club Day contains too many fields.');
  }
  const budget = { used: 0 };
  const seenFieldIds = new Set<string>();
  const createdAt = isoDateTime(value.a, 'pack creation date');
  const fields = value.f.map(rawField => {
    if (!Array.isArray(rawField) || rawField.length !== 3) fail('Invalid compact Club Day field.');
    const id = identifier(rawField[0], 'field ID');
    if (seenFieldIds.has(id)) fail('Club Day contains duplicate field IDs.');
    seenFieldIds.add(id);
    return {
      id,
      name: requiredString(rawField[1], 'field name', CLUB_DAY_LIMITS.name),
      boundary: decodedPolygon(rawField[2], budget),
      notes: '',
      createdAt,
      updatedAt: createdAt,
    };
  });

  return {
    type: 'findspot-club-day-pack',
    version: 1,
    sharedPermissionId: identifier(value.s, 'shared permission ID'),
    eventName: requiredString(value.n, 'event name', CLUB_DAY_LIMITS.name),
    eventDate: eventDate(value.d),
    organiserName: optionalString(value.o, 'organiser name', CLUB_DAY_LIMITS.name),
    organiserContactNumber: optionalString(value.c, 'organiser contact number', CLUB_DAY_LIMITS.contactNumber),
    organiserEmail: optionalEmail(value.e),
    significantFindInstructions: optionalString(value.i, 'significant-find instructions', CLUB_DAY_LIMITS.notes),
    publicNotes: optionalString(value.p, 'public notes', CLUB_DAY_LIMITS.notes),
    boundary: optionalEncodedPolygon(value.b, budget),
    fields,
    createdAt,
  };
}

export function validateClubDayPack(value: unknown): ClubDayPack {
  if (!isObject(value)) fail();
  if (value.type === 'findspot-club-day-pack') return fullPack(value);
  if (value.t === 'cdp') return compactPack(value);
  return fail();
}

export function normalizeClubDayPack(value: unknown): ClubDayPack | null {
  try {
    return validateClubDayPack(value);
  } catch {
    return null;
  }
}

export function decodeClubDayUrlPayload(encoded: string): ClubDayPack {
  if (!encoded || encoded.length > CLUB_DAY_LIMITS.encodedPayloadChars || !BASE64URL_PATTERN.test(encoded)) fail();
  try {
    const unpadded = encoded.replace(/=+$/, '');
    const padded = unpadded.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(unpadded.length / 4) * 4, '=');
    const binary = atob(padded);
    if (binary.length > CLUB_DAY_LIMITS.decodedJsonBytes) fail();
    const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
    const json = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (new TextEncoder().encode(json).byteLength > CLUB_DAY_LIMITS.decodedJsonBytes) fail();
    return validateClubDayPack(JSON.parse(json) as unknown);
  } catch (error) {
    if (error instanceof ClubDayValidationError) throw error;
    return fail();
  }
}

export function clubDayPackFromLegacyQuery(params: URLSearchParams): ClubDayPack {
  for (const name of ['sid', 'n', 'd', 'c', 'e', 'i', 'p']) {
    if (params.getAll(name).length > 1) fail();
  }
  const now = new Date().toISOString();
  return validateClubDayPack({
    type: 'findspot-club-day-pack',
    version: 1,
    sharedPermissionId: params.get('sid'),
    eventName: params.get('n') ?? 'Club Day Event',
    eventDate: params.get('d') || now.slice(0, 10),
    organiserContactNumber: params.get('c') || undefined,
    organiserEmail: params.get('e') || undefined,
    significantFindInstructions: params.get('i') || undefined,
    publicNotes: params.get('p') || undefined,
    fields: [],
    createdAt: now,
  });
}

export function encodePolygon(boundary?: Field['boundary']): EncodedPolygon | undefined {
  if (!boundary) return undefined;
  const trusted = polygon(boundary, { used: 0 });
  return trusted.coordinates.map(ring => {
    const encoded: number[] = [];
    let previousLon = 0;
    let previousLat = 0;
    ring.forEach(([longitude, latitude], index) => {
      const lon = Math.round(longitude * COORD_SCALE);
      const lat = Math.round(latitude * COORD_SCALE);
      encoded.push(index === 0 ? lon : lon - previousLon, index === 0 ? lat : lat - previousLat);
      previousLon = lon;
      previousLat = lat;
    });
    return encoded;
  });
}

export function compactClubDayPack(pack: ClubDayPack): CompactClubDayPack {
  const trusted = validateClubDayPack(pack);
  const compact: CompactClubDayPack = {
    t: 'cdp',
    v: 1,
    s: trusted.sharedPermissionId,
    n: trusted.eventName,
    d: trusted.eventDate,
    f: trusted.fields.map(field => [field.id, field.name, encodePolygon(field.boundary)!]),
    a: trusted.createdAt,
  };
  if (trusted.organiserName) compact.o = trusted.organiserName;
  if (trusted.organiserContactNumber) compact.c = trusted.organiserContactNumber;
  if (trusted.organiserEmail) compact.e = trusted.organiserEmail;
  if (trusted.significantFindInstructions) compact.i = trusted.significantFindInstructions;
  if (trusted.publicNotes) compact.p = trusted.publicNotes;
  const boundary = encodePolygon(trusted.boundary);
  if (boundary) compact.b = boundary;
  return compact;
}
