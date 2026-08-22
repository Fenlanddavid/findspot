import { readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { ESLint } from 'eslint';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const BASELINE_PATH = resolve(ROOT, 'scripts/hooksBaseline.json');
const RULE_ID = 'react-hooks/exhaustive-deps';

export async function currentHooksInventory() {
  const eslint = new ESLint({
    allowInlineConfig: false,
    cwd: ROOT,
  });
  const results = await eslint.lintFiles(['src/**/*.{ts,tsx}']);
  const files = Object.fromEntries(results
    .map(result => [
      relative(ROOT, result.filePath).replaceAll('\\', '/'),
      result.messages.filter(message => message.ruleId === RULE_ID).length,
    ])
    .filter(([, count]) => count > 0)
    .sort(([left], [right]) => left.localeCompare(right)));

  return {
    total: Object.values(files).reduce((sum, count) => sum + count, 0),
    files,
  };
}

export function checkHooksBaseline(
  inventory,
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
      'React hooks dependency baseline increased. New files default to zero:',
      ...violations,
    ].join('\n'));
  }
  return inventory;
}

const inventory = await currentHooksInventory();
if (process.argv.includes('--print')) {
  console.log(JSON.stringify(inventory, null, 2));
} else {
  try {
    checkHooksBaseline(inventory);
    console.log(`React hooks dependency baseline OK: ${inventory.total} warnings`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
