import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('install tracking removal', () => {
  it('does not count installations at startup or from Settings', async () => {
    const [app, settings, clientStorage] = await Promise.all([
      readFile(new URL('../../src/App.tsx', import.meta.url), 'utf8'),
      readFile(new URL('../../src/pages/Settings.tsx', import.meta.url), 'utf8'),
      readFile(new URL('../../src/services/clientStorage.ts', import.meta.url), 'utf8'),
    ]);
    const production = `${app}\n${settings}\n${clientStorage}`;

    expect(production).not.toContain('findspot-counter');
    expect(production).not.toContain('fs_installed');
    expect(production).not.toContain('installCount');
  });

  it('shows the V5 release and fixed community copy', async () => {
    const [pkg, settings] = await Promise.all([
      readFile(new URL('../../package.json', import.meta.url), 'utf8').then(JSON.parse),
      readFile(new URL('../../src/pages/Settings.tsx', import.meta.url), 'utf8'),
    ]);

    expect(pkg.version).toBe('5.0.4');
    expect(settings).toContain("replace(/^([0-9]+\\.[0-9]+)\\.0$/, 'V$1')");
    expect(settings).toContain('Trusted by +10,000 Detectorists');
  });
});
