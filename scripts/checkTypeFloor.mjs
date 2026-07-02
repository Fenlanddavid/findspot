import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const TYPE_FLOOR_RE = /text-\[(?:[1-9]|10|11)px\]/g;

function countMatches(dir) {
  let count = 0;

  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stat = statSync(path);

    if (stat.isDirectory()) {
      count += countMatches(path);
      continue;
    }

    const text = readFileSync(path, 'utf8');
    count += text.match(TYPE_FLOOR_RE)?.length ?? 0;
  }

  return count;
}

const count = countMatches('src');
const baseline = parseInt(readFileSync('scripts/typeFloorBaseline.txt', 'utf8').trim(), 10);

if (count > baseline) {
  console.error(
    `Sub-12px arbitrary text sizes: ${count} (baseline ${baseline}). Use text-2xs / text-3xs tokens.`,
  );
  process.exit(1);
}

console.log(`Type floor OK: ${count} <= ${baseline}`);
