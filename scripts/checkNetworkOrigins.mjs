import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const approvedEntries = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/shared/networkOrigins.json'), 'utf8'));
const approved = new Set(approvedEntries.map(entry => entry.origin));
if (approved.size !== approvedEntries.length) {
  console.error('Network origin registry contains duplicate origins.');
  process.exit(1);
}

const roots = ['src', 'workers'];
const files = [];
function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(target);
    else if (/\.(ts|tsx|js|toml)$/.test(entry.name) && !/\.test\.[^.]+$/.test(entry.name)) files.push(target);
  }
}
roots.forEach(root => walk(path.join(ROOT, root)));
files.push(path.join(ROOT, 'index.html'), path.join(ROOT, 'vite.config.ts'));

const observed = new Map();
for (const filename of files) {
  const source = fs.readFileSync(filename, 'utf8');
  for (const match of source.matchAll(/https?:\/\/[A-Za-z0-9.-]+(?::\d+)?/g)) {
    const origin = match[0].toLowerCase();
    const references = observed.get(origin) ?? [];
    references.push(path.relative(ROOT, filename));
    observed.set(origin, references);
  }
}

const unknown = [...observed.entries()]
  .filter(([origin]) => !approved.has(origin))
  .map(([origin, references]) => ({ origin, files: [...new Set(references)].sort() }));
if (unknown.length) {
  console.error(`Unapproved network origins:\n${JSON.stringify(unknown, null, 2)}`);
  process.exit(1);
}

console.log(`Network-origin ratchet passed (${observed.size} configured origins, ${approved.size} reviewed origins).`);
