import { CLUB_DAY_LIMITS, type ClubDayPack } from '../../../src/services/clubDayValidation';

export function validBoundary() {
  return {
    type: 'Polygon' as const,
    coordinates: [[[-1, 52], [-1.1, 52], [-1.1, 52.1], [-1, 52]]],
  };
}

export function validClubDayPack(overrides: Record<string, unknown> = {}): ClubDayPack {
  return {
    type: 'findspot-club-day-pack',
    version: 1,
    sharedPermissionId: 'shared-event-1',
    eventName: 'Fenland Club Day',
    eventDate: '2026-08-28',
    organiserName: 'Organiser',
    organiserEmail: 'organiser@example.test',
    publicNotes: 'Meet at the gate.',
    significantFindInstructions: 'Call the organiser.',
    fields: [{ id: 'external-field-1', name: 'North Field', boundary: validBoundary() }],
    createdAt: '2026-08-28T09:00:00.000Z',
    ...overrides,
  } as ClubDayPack;
}

export const hostileClubDayCorpus: Array<{ name: string; value: unknown }> = [
  { name: 'wrong top-level type', value: [] },
  { name: 'wrong version', value: validClubDayPack({ version: 2 }) },
  { name: 'missing shared ID', value: validClubDayPack({ sharedPermissionId: undefined }) },
  { name: 'non-string shared ID', value: validClubDayPack({ sharedPermissionId: {} }) },
  { name: 'event object', value: validClubDayPack({ eventName: {} }) },
  { name: 'event array', value: validClubDayPack({ eventName: [] }) },
  { name: 'organiser object', value: validClubDayPack({ organiserName: {} }) },
  { name: 'huge notes', value: validClubDayPack({ publicNotes: 'x'.repeat(CLUB_DAY_LIMITS.notes + 1) }) },
  { name: 'huge fields', value: validClubDayPack({ fields: Array.from({ length: CLUB_DAY_LIMITS.fields + 1 }, (_, index) => ({ id: `field-${index}`, name: 'Field', boundary: validBoundary() })) }) },
  { name: 'NaN coordinate', value: validClubDayPack({ fields: [{ id: 'field', name: 'Field', boundary: { type: 'Polygon', coordinates: [[[NaN, 52], [-1, 52], [-1, 53], [NaN, 52]]] } }] }) },
  { name: 'infinite coordinate', value: validClubDayPack({ fields: [{ id: 'field', name: 'Field', boundary: { type: 'Polygon', coordinates: [[[Infinity, 52], [-1, 52], [-1, 53], [Infinity, 52]]] } }] }) },
  { name: 'out-of-range coordinate', value: validClubDayPack({ fields: [{ id: 'field', name: 'Field', boundary: { type: 'Polygon', coordinates: [[[181, 52], [-1, 52], [-1, 53], [181, 52]]] } }] }) },
];
