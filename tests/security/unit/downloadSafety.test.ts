import { describe, expect, it } from 'vitest';
import { checkDownloads, hasUnmanagedDownload } from '../../../scripts/checkDownloads.mjs';

describe('download safety ratchet', () => {
  it.each([
    `const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.click();`,
    `const a = Object.assign(document.createElement('a'), {href: URL.createObjectURL(blob)}); a.click();`,
    `const url = window.URL['createObjectURL'](blob); const link = document['createElement']('a'); link['click']();`,
    `const url = URL.createObjectURL(blob); existingAnchor.href = url; existingAnchor.click();`,
  ])('rejects unmanaged download activation: %s', source => {
    expect(hasUnmanagedDownload(source)).toBe(true);
  });
  it.each([
    `const url = URL.createObjectURL(photo); img.src = url;`,
    `triggerDownload(blob, filename);`,
    `// URL.createObjectURL(blob); document.createElement('a'); a.click();`,
    `const example = "URL.createObjectURL(blob); document.createElement('a'); a.click();";`,
  ])('allows previews, helper calls and non-code examples: %s', source => {
    expect(hasUnmanagedDownload(source)).toBe(false);
  });
  it('routes every current Blob download through the helper', () => {
    expect(checkDownloads()).toEqual([]);
  });
});
