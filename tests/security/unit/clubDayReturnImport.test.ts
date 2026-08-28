import { describe, expect, it } from 'vitest';
import { validateClubDayExport } from '../../../src/services/clubDayExportValidation';
import { base64ToBlob } from '../../../src/services/backup/mediaEncoding';

function validExport(overrides: Record<string, unknown> = {}) {
  return {
    type: 'findspot-club-day-export',
    version: 1,
    sharedPermissionId: 'shared-event-1',
    recorderId: 'recorder-1',
    recorderName: 'Detectorist',
    exportedAt: '2026-08-28T12:00:00.000Z',
    sessions: [],
    finds: [],
    significantFinds: [],
    media: [],
    ...overrides,
  };
}

describe('Club Day organiser return import', () => {
  it('requires the exact supported version and complete strict top-level schema', () => {
    expect(validateClubDayExport(JSON.stringify(validExport())).version).toBe(1);
    expect(() => validateClubDayExport(JSON.stringify(validExport({ version: 2 })))).toThrow();
    expect(() => validateClubDayExport(JSON.stringify(validExport({ unexpected: true })))).toThrow();
  });

  it('rejects non-finite coordinates after JSON decoding', () => {
    const record = validExport({ sessions: [{ id: 'session-1', lat: null }] });
    expect(() => validateClubDayExport(JSON.stringify(record))).toThrow();
  });

  it('never treats an imported media string as a URL to fetch', async () => {
    await expect(base64ToBlob('https://attacker.example/tracking-pixel')).rejects.toThrow('Invalid encoded media');
    await expect(base64ToBlob('data:text/plain;base64,aGVsbG8=')).resolves.toMatchObject({ size: 5, type: 'text/plain' });
  });
});
