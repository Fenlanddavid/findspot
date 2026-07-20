import { describe, expect, it } from 'vitest';
import { mediaExt } from '../../src/services/data';

describe('backup media filename extensions', () => {
  it.each([
    ['image/jpeg', 'jpg'],
    ['image/heif', 'heif'],
    ['application/msword', 'doc'],
    ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'docx'],
    ['application/rtf', 'rtf'],
    ['text/plain; charset=utf-8', 'txt'],
  ])('maps %s to .%s', (mime, extension) => {
    expect(mediaExt(mime)).toBe(extension);
  });

  it('does not turn arbitrary MIME subtypes into filenames', () => {
    expect(mediaExt('application/x-shady')).toBe('bin');
    expect(mediaExt(undefined)).toBe('bin');
  });
});
