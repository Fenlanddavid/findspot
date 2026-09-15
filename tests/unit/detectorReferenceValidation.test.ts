import { describe, expect, it } from 'vitest';
import { assertTargetIdMutation, isUsableTargetId, parseTargetId, parseTargetRange } from '../../src/services/detectorReferenceValidation';
import { validateBackupData } from '../../src/services/backup/validation';

describe('target ID boundaries', () => {
  it('preserves zero and negative IDs separately from missing readings', () => {
    expect(parseTargetId('0')).toBe(0);
    expect(parseTargetId(' -19 ')).toBe(-19);
    expect(parseTargetId('')).toBeUndefined();
    expect(parseTargetId('  ')).toBeUndefined();
    expect(parseTargetRange('-19', '0')).toEqual([-19, 0]);
  });
  it.each(['12-15', '12x', '1.5', '1.0', 'NaN', 'Infinity', '1e2', '0x12', '9007199254740992'])('rejects the complete malformed input %s', value => {
    expect(() => parseTargetId(value)).toThrow();
  });
  it('rejects incomplete and reversed ranges', () => {
    expect(() => parseTargetRange('', '0')).toThrow();
    expect(() => parseTargetRange('0', '-1')).toThrow();
  });
  it('preserves legacy readings during unrelated edits but rejects new invalid readings', () => {
    expect(() => assertTargetIdMutation('12x', '12x')).not.toThrow();
    expect(() => assertTargetIdMutation('12x')).toThrow();
    expect(() => assertTargetIdMutation(1.5, 2)).toThrow();
    expect(() => assertTargetIdMutation(0, '12x')).not.toThrow();
    expect(isUsableTargetId('12')).toBe(false);
    expect(isUsableTargetId(null)).toBe(false);
    expect(isUsableTargetId(Infinity)).toBe(false);
  });
  it('restores malformed historical values without turning them into usable readings', () => {
    const backup = validateBackupData({ projects: [{ id: 'p' }], permissions: [{ id: 'l', projectId: 'p' }], finds: [{ id: 'f', projectId: 'p', permissionId: 'l', targetId: '12x' }] });
    expect(backup.finds[0].targetId).toBe('12x');
    expect(isUsableTargetId(backup.finds[0].targetId)).toBe(false);
  });
});
