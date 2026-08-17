import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const packagePath = resolve(root, 'package.json');
const lockPath = resolve(root, 'package-lock.json');
const notesPath = resolve(root, 'src/version.ts');
const semver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function releaseNotes() {
  const source = readFileSync(notesPath, 'utf8');
  const match = source.match(/UPDATE_NOTES\s*=\s*(['"])(.*?)\1\s*;/s);
  if (!match?.[2]?.trim()) throw new Error('src/version.ts must contain non-empty UPDATE_NOTES.');
  return match[2].trim();
}

function assertConsistent(pkg, lock) {
  if (pkg.version !== lock.version || pkg.version !== lock.packages?.['']?.version) {
    throw new Error(`Version mismatch: package=${pkg.version}, lock=${lock.version}, lock root=${lock.packages?.['']?.version}`);
  }
}

function atomicWrite(path, value) {
  const temporary = `${path}.release-prepare.tmp`;
  writeFileSync(temporary, value);
  renameSync(temporary, path);
}

const requested = process.argv[2];
if (!requested || !semver.test(requested)) {
  console.error('Usage: npm run release:prepare -- <semver>');
  process.exit(2);
}

const originalPackage = readFileSync(packagePath, 'utf8');
const originalLock = readFileSync(lockPath, 'utf8');
const pkg = JSON.parse(originalPackage);
const lock = JSON.parse(originalLock);
assertConsistent(pkg, lock);
if (pkg.version === requested) throw new Error(`${requested} is already the current version.`);

pkg.version = requested;
lock.version = requested;
lock.packages[''].version = requested;
const metadataPath = resolve(root, 'docs/releases', `${requested}.json`);
const metadataExisted = existsSync(metadataPath);
const originalMetadata = metadataExisted ? readFileSync(metadataPath, 'utf8') : null;
const metadata = JSON.stringify({
  version: requested,
  preparedAt: new Date().toISOString(),
  notes: releaseNotes(),
}, null, 2) + '\n';

try {
  mkdirSync(dirname(metadataPath), { recursive: true });
  atomicWrite(packagePath, JSON.stringify(pkg, null, 2) + '\n');
  atomicWrite(lockPath, JSON.stringify(lock, null, 2) + '\n');
  atomicWrite(metadataPath, metadata);
  assertConsistent(readJson(packagePath), readJson(lockPath));
  execFileSync('npm', ['run', 'check:release'], { cwd: root, stdio: 'inherit' });
  execFileSync('npm', ['run', 'typecheck'], { cwd: root, stdio: 'inherit' });
  console.log(`Release surfaces prepared consistently for ${requested}.`);
} catch (error) {
  atomicWrite(packagePath, originalPackage);
  atomicWrite(lockPath, originalLock);
  if (metadataExisted && originalMetadata !== null) atomicWrite(metadataPath, originalMetadata);
  else rmSync(metadataPath, { force: true });
  console.error('Release preparation failed; changed release surfaces were restored.');
  throw error;
}
