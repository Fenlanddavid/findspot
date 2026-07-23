import { readFileSync, readdirSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import ts from 'typescript';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const SOURCE_ROOT = resolve(ROOT, 'src');
const BASELINE_PATH = resolve(ROOT, 'scripts/anyBaseline.json');

function sourceFiles(directory = SOURCE_ROOT) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(?:ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

function anyKeywordCount(path) {
  const source = readFileSync(path, 'utf8');
  const scriptKind = path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const syntax = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, scriptKind);
  let count = 0;

  function visit(node) {
    if (node.kind === ts.SyntaxKind.AnyKeyword) count += 1;
    ts.forEachChild(node, visit);
  }

  visit(syntax);
  return count;
}

export function currentAnyInventory() {
  const files = Object.fromEntries(sourceFiles()
    .map(path => [
      relative(ROOT, path).replaceAll('\\', '/'),
      anyKeywordCount(path),
    ])
    .filter(([, count]) => count > 0)
    .sort(([left], [right]) => left.localeCompare(right)));
  return {
    total: Object.values(files).reduce((sum, count) => sum + count, 0),
    files,
  };
}

export function checkAnyBaseline(
  inventory = currentAnyInventory(),
  baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8')),
) {
  const violations = [];
  for (const [path, count] of Object.entries(inventory.files)) {
    const ceiling = baseline.files[path] ?? 0;
    if (count > ceiling) violations.push(`${path}: ${count} > ${ceiling}`);
  }
  if (inventory.total > baseline.total) {
    violations.push(`total: ${inventory.total} > ${baseline.total}`);
  }
  if (violations.length) {
    throw new Error([
      'Explicit any baseline increased. New files default to zero:',
      ...violations,
    ].join('\n'));
  }
  return inventory;
}

if (process.argv.includes('--print')) {
  console.log(JSON.stringify(currentAnyInventory(), null, 2));
} else {
  try {
    const inventory = checkAnyBaseline();
    console.log(`Explicit any baseline OK: ${inventory.total} AnyKeyword nodes`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
