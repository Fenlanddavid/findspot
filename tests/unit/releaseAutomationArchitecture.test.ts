import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('release automation architecture', () => {
  it('keeps package and lockfile version surfaces consistent', async () => {
    const [pkg, lock] = await Promise.all([
      readFile(new URL('../../package.json', import.meta.url), 'utf8').then(JSON.parse),
      readFile(new URL('../../package-lock.json', import.meta.url), 'utf8').then(JSON.parse),
    ]);
    expect(lock.version).toBe(pkg.version);
    expect(lock.packages[''].version).toBe(pkg.version);
    expect(pkg.scripts['release:prepare']).toBe('node scripts/prepareRelease.mjs');
  });

  it('uses atomic writes and restores all version surfaces when preparation fails', async () => {
    const source = await readFile(new URL('../../scripts/prepareRelease.mjs', import.meta.url), 'utf8');
    expect(source).toContain('renameSync(temporary, path)');
    expect(source).toContain("atomicWrite(packagePath, originalPackage)");
    expect(source).toContain("atomicWrite(lockPath, originalLock)");
    expect(source).toContain("execFileSync('npm', ['run', 'check:release']");
  });

  it('has a retrospective programme record through 4.12.24', async () => {
    const ledger = await readFile(new URL('../../docs/programmes/v4.12-review-remediation.md', import.meta.url), 'utf8');
    for (let patch = 11; patch <= 24; patch++) expect(ledger).toContain(`4.12.${patch}`);
  });
});
