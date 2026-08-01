import { readFileSync, readdirSync } from 'node:fs';
import { relative, resolve, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// The operational script is JavaScript so it can run in plain Node without a
// build step. TypeScript intentionally checks its public values at usage sites.
// @ts-expect-error No separate declaration file is needed for this test import.
import {
  listDumpFiles,
  verifyDumpCoverage,
} from '../../scripts/dumpArchitecture.mjs';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));

function sourceFilesOnDisk(directory = resolve(ROOT, 'src')): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const absolute = resolve(directory, entry.name);
    if (entry.isDirectory()) return sourceFilesOnDisk(absolute);
    if (!entry.isFile()) return [];
    const path = relative(ROOT, absolute).replaceAll('\\', '/');
    return /(?:\.css|\.d\.ts|\.ts|\.tsx)$/.test(path) ? [path] : [];
  }).sort();
}

describe('architecture dump coverage', () => {
  it('includes every permanent verification file and the dump mechanism itself', () => {
    const files = new Set(listDumpFiles());

    expect(files).toContain('scripts/dumpArchitecture.mjs');
    expect(files).toContain('docs/adr/0001-local-only-data-model.md');
    expect(files).toContain('.github/workflows/deploy.yml');
    expect(files).toContain('src/vite-env.d.ts');
    expect(files).toContain('workers/geocode-proxy/wrangler.toml');
    expect(files).toContain('workers/findspot-static/worker-configuration.d.ts');
  });

  it('passes its dynamic coverage verification', () => {
    expect(verifyDumpCoverage()).toEqual(listDumpFiles());
  });

  it('includes source directories whose names overlap generated-output names', () => {
    const files = new Set(listDumpFiles());

    expect(files).toContain('src/engines/coverage/sectionCoverageEngine.ts');
    expect(files).toContain('src/components/coverage/SessionCoverageReview.tsx');
  });

  it('excludes generated output and dependency directories', () => {
    const generated = listDumpFiles().filter(path => (
      /^companion\/.*\/build\//.test(path)
      || /(^|\/)(?:node_modules|\.wrangler|\.gradle)\//.test(path)
      || path.startsWith('coverage/')
      || path.startsWith('scripts/out/')
    ));

    expect(generated).toEqual([]);
  });

  it('includes committed characterisation snapshots', () => {
    expect(listDumpFiles()).toContain(
      'tests/unit/__snapshots__/engine.snapshot.test.ts.snap',
    );
  });

  it('independently includes every source file eligible for the dump', () => {
    const dumped = new Set(listDumpFiles());
    const missing = sourceFilesOnDisk().filter(path => !dumped.has(path));

    expect(missing).toEqual([]);
  });

  it('resolves every relative source import to a file in the dump', () => {
    const files = listDumpFiles();
    const dumped = new Set(files);
    const unresolved: string[] = [];
    const patterns = [
      /from\s+['"](\.[^'"]+)['"]/g,
      /import\s*\(\s*['"](\.[^'"]+)['"]/g,
      /^import\s+['"](\.[^'"]+)['"]/gm,
    ];

    for (const importingPath of files.filter(path => (
      path.startsWith('src/') && /\.tsx?$/.test(path)
    ))) {
      const contents = readFileSync(resolve(ROOT, importingPath), 'utf8');
      for (const pattern of patterns) {
        pattern.lastIndex = 0;
        for (const match of contents.matchAll(pattern)) {
          const specifier = match[1].split('?')[0];
          const target = posix.normalize(posix.join(posix.dirname(importingPath), specifier));
          const candidates = [
            target,
            `${target}.ts`,
            `${target}.tsx`,
            `${target}.d.ts`,
            `${target}/index.ts`,
            `${target}/index.tsx`,
          ];
          if (!candidates.some(candidate => dumped.has(candidate))) {
            unresolved.push(`${importingPath}: ${specifier}`);
          }
        }
      }
    }

    expect(unresolved).toEqual([]);
  });
});
