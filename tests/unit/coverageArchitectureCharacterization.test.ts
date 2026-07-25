import { readdir, readFile } from 'node:fs/promises';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const COVERAGE_UI_DIRECTORY = new URL(
  '../../src/components/coverage/',
  import.meta.url,
);

const FORBIDDEN_IMPORTS = [
  /(?:^|\/)db(?:\.ts)?$/,
  /(?:^|\/)coverageMutations$/,
  /(?:^|\/)hotspotPredictionService$/,
  /(?:^|\/).+Mutations$/,
];

function importedModules(source: string, fileName: string): string[] {
  const syntax = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  const imports: string[] = [];
  syntax.forEachChild(node => {
    if (
      ts.isImportDeclaration(node)
      && ts.isStringLiteral(node.moduleSpecifier)
    ) {
      imports.push(node.moduleSpecifier.text);
    }
  });
  return imports;
}

describe('coverage UI architecture', () => {
  it('keeps database and downstream mutation services behind the coverage command facade', async () => {
    const violations: string[] = [];
    const entries = await readdir(COVERAGE_UI_DIRECTORY, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.tsx')) continue;
      const file = new URL(entry.name, COVERAGE_UI_DIRECTORY);
      const source = await readFile(file, 'utf8');
      for (const imported of importedModules(source, file.pathname)) {
        if (FORBIDDEN_IMPORTS.some(pattern => pattern.test(imported))) {
          violations.push(`${entry.name}: ${imported}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it('keeps save consequences in the intent-named command', async () => {
    const [review, commands] = await Promise.all([
      readFile(
        new URL(
          '../../src/components/coverage/SessionCoverageReview.tsx',
          import.meta.url,
        ),
        'utf8',
      ),
      readFile(
        new URL('../../src/services/sessionCoverageCommands.ts', import.meta.url),
        'utf8',
      ),
    ]);

    expect(review).toContain('saveSessionSearchedAreas({');
    expect(review).not.toContain('saveReportedSessionCoverage(');
    expect(review).not.toContain('refreshHotspotPredictionOutcomes(');
    expect(commands).toContain('saveReportedSessionCoverage(');
    expect(commands).toContain('refreshHotspotPredictionOutcomes(');
  });
});
