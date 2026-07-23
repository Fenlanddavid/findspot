import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { validateBackupData } from '../../src/services/backup/validation';
import { BACKED_UP_TABLE_NAMES } from '../../src/services/backup/tableRegistry';
import { BACKUP_FIXTURE_FACTORIES } from '../fixtures/backupFixtureFactories';

function completeValidBackup(): Record<string, unknown> {
  return {
    version: 6,
    exportedAt: '2026-07-23T12:00:00.000Z',
    generatedBy: 'FindSpot',
    ...Object.fromEntries(BACKED_UP_TABLE_NAMES.map(tableName => [
      tableName,
      [tableName === 'media'
        ? {
            ...BACKUP_FIXTURE_FACTORIES.media(),
            blob: 'data:image/jpeg;base64,/9gBAg==',
          }
        : BACKUP_FIXTURE_FACTORIES[tableName]()],
    ])),
  };
}

describe('backup validation properties', () => {
  it('accepts or rejects bounded arbitrary input only through the domain boundary', () => {
    const arbitraryInput = fc.oneof(
      { weight: 20, arbitrary: fc.anything({
        maxDepth: 4,
        maxKeys: 20,
        withMap: true,
        withSet: true,
        withTypedArray: true,
      }) },
      { weight: 1, arbitrary: fc.constant(completeValidBackup()) },
    );

    fc.assert(fc.property(arbitraryInput, input => {
      const before = structuredClone(input);
      try {
        const result = validateBackupData(input);
        expect(result.version).toEqual(expect.any(Number));
        for (const tableName of BACKED_UP_TABLE_NAMES) {
          expect(Array.isArray(result[tableName])).toBe(true);
        }
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect(error).not.toBeInstanceOf(TypeError);
        expect(error).not.toBeInstanceOf(RangeError);
        expect((error as Error).message).toMatch(/^Invalid (backup|format)/);
      }
      expect(input).toEqual(before);
    }), { numRuns: 500 });
  });
});
