import { readdir, readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const SRC_DIRECTORY = new URL('../../src/', import.meta.url);

async function sourceFiles(directory: URL): Promise<URL[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async entry => {
    const url = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory);
    if (entry.isDirectory()) return sourceFiles(url);
    return /\.tsx?$/.test(entry.name) ? [url] : [];
  }));
  return nested.flat();
}

describe('worker architecture', () => {
  it('centralizes application worker construction in the factory', async () => {
    const violations: string[] = [];
    for (const file of await sourceFiles(SRC_DIRECTORY)) {
      if (file.pathname.endsWith('/workers/factory.ts')) continue;
      const source = await readFile(file, 'utf8');
      if (/\bnew\s+Worker\s*\(/.test(source)) {
        violations.push(file.pathname.split('/src/')[1]);
      }
    }

    expect(violations).toEqual([]);
  });

  it('keeps worker event plumbing out of terrain and UI consumers', async () => {
    const consumerFiles = [
      new URL('../../src/engines/landscape/terrainEngine.ts', import.meta.url),
      new URL('../../src/components/fieldGuide/HistoricLayerManager.tsx', import.meta.url),
    ];

    for (const file of consumerFiles) {
      const source = await readFile(file, 'utf8');
      expect(source).not.toMatch(/\.(?:onmessage|onerror|postMessage)\s*=/);
    }
  });

  it('routes both worker hosts through the shared protocol dispatcher', async () => {
    const workerFiles = [
      new URL('../../src/workers/terrainScanWorker.ts', import.meta.url),
      new URL('../../src/workers/landscapeInterpretation.worker.ts', import.meta.url),
    ];

    for (const file of workerFiles) {
      const source = await readFile(file, 'utf8');
      expect(source).toContain('dispatchWorkerRequest');
      expect(source).toMatch(/MessageEvent<unknown>/);
    }
  });
});
