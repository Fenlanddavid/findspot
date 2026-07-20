import { execFileSync } from 'node:child_process';

function gitPaths(args) {
  try {
    return execFileSync('git', args, { encoding: 'utf8' });
  } catch (error) {
    // Some restricted development sandboxes report EPERM after git exits while
    // still returning its complete stdout. Keep the check usable there, while
    // allowing genuine git failures (which have no usable output) to fail.
    if (error?.status === 0 && typeof error.stdout === 'string') {
      return error.stdout;
    }
    throw error;
  }
}

const parsePaths = (output) => output.split('\0').filter(Boolean);
const deleted = new Set(parsePaths(gitPaths(['ls-files', '--deleted', '-z'])));
const files = [
  ...parsePaths(gitPaths(['ls-files', '-z'])).filter((path) => !deleted.has(path)),
  ...parsePaths(gitPaths(['ls-files', '--others', '--exclude-standard', '-z'])),
];

const collisions = new Set();

function recordCollision(kind, seen, path) {
  const key = path.toLowerCase();
  const previous = seen.get(key);
  if (previous && previous !== path) {
    collisions.add(`${kind}: ${previous} vs ${path}`);
  } else {
    seen.set(key, path);
  }
}

const seenFiles = new Map();
const seenDirectories = new Map();

for (const file of files) {
  recordCollision('File case collision', seenFiles, file);

  const parts = file.split('/');
  for (let index = 1; index < parts.length; index += 1) {
    recordCollision(
      'Directory case collision',
      seenDirectories,
      parts.slice(0, index).join('/'),
    );
  }
}

if (collisions.size > 0) {
  for (const collision of collisions) console.error(collision);
  process.exit(1);
}

console.log(`Casing OK: ${files.length} tracked and pending paths checked`);
