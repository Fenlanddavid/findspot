import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
let latestTag;
try {
  latestTag = execFileSync('git', ['describe', '--tags', '--abbrev=0', '--match', 'v[0-9]*'], { encoding: 'utf8' }).trim();
} catch (error) {
  const captured = typeof error === 'object' && error && 'stdout' in error
    ? String(error.stdout ?? '').trim()
    : '';
  if (captured) latestTag = captured;
}
if (!latestTag) {
  console.log('Release-note guard skipped: no semantic release tag exists yet.');
  process.exit(0);
}

const nextTag = `v${pkg.version}`;
if (latestTag === nextTag) {
  console.error(`Release version ${nextTag} already exists; bump package.json before deployment.`);
  process.exit(1);
}

let previousNotes;
try {
  previousNotes = execFileSync('git', ['show', `${latestTag}:src/version.ts`], { encoding: 'utf8' });
} catch (error) {
  const captured = typeof error === 'object' && error && 'stdout' in error
    ? String(error.stdout ?? '')
    : '';
  if (captured) previousNotes = captured;
}
if (!previousNotes) {
  console.log(`Release-note guard skipped: ${latestTag} does not contain src/version.ts.`);
  process.exit(0);
}

const currentNotes = readFileSync(new URL('../src/version.ts', import.meta.url), 'utf8');
if (currentNotes === previousNotes) {
  console.error(`src/version.ts is unchanged since ${latestTag}; update UPDATE_NOTES before deployment.`);
  process.exit(1);
}
console.log(`Release notes and version are ready for ${nextTag} (previous: ${latestTag}).`);
