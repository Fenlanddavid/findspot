// Build a portable text snapshot of the repository's permanent architecture.
// External verification must use `CI=1 npx vitest run` so missing or stale
// snapshots fail instead of being silently written into the extracted dump.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const SELF = 'scripts/dumpArchitecture.mjs';

const INCLUDED_DIRECTORIES = [
  '.github/workflows/',
  'companion/',
  'docs/',
  'public/',
  'scripts/',
  'src/',
  'tests/',
  'workers/',
];

const INCLUDED_ROOT_FILES = new Set([
  '.gitignore',
  'LICENSE',
  'NOTICE',
  'README.md',
  'package-lock.json',
  'package.json',
  'playwright.config.ts',
  'postcss.config.js',
  'tailwind.config.js',
  'tsconfig.json',
  'vite.config.ts',
  'vitest.config.ts',
  'vitest.worker.config.ts',
]);

const DUMP_EXTENSIONS = new Set([
  '.cjs', '.css', '.d.ts', '.geojson', '.html', '.js', '.json', '.jsonc', '.jsx',
  '.java', '.kts', '.md', '.mjs', '.png', '.pro', '.sh', '.snap', '.toml', '.ts',
  '.tsx', '.txt', '.svg', '.xml', '.yaml', '.yml',
]);
const BASE64_EXTENSIONS = new Set(['.png']);

const REQUIRED_PRODUCTION_ASSETS = new Set([
  'public/apple-touch-icon.png',
  'public/logo.svg',
  'public/logo-2.png',
  'public/pas-density-gb.json',
  'public/roman-roads-gb.geojson',
]);

function extensionOf(path) {
  if (path.endsWith('.d.ts')) return '.d.ts';
  const dot = path.lastIndexOf('.');
  return dot === -1 ? '' : path.slice(dot);
}

// These names are never legitimate source directories at any depth.
const EXCLUDED_NAMES_ANYWHERE = new Set([
  '.git',
  '.gradle',
  '.wrangler',
  'node_modules',
]);

// Generated outputs at the repository root. Keep these root-relative so a
// deeper source domain such as src/engines/coverage remains eligible.
const EXCLUDED_ROOT_PATHS = new Set([
  'coverage',
  'dev-dist',
  'dist',
  'out',
  'playwright-report',
  'test-results',
]);

// Generated subtrees whose names are otherwise too broad to exclude at every
// depth. scripts/out contains generated dataset shards, not source.
const EXCLUDED_GENERATED_PATHS = new Set([
  'scripts/out',
]);

function isExcludedDirectory(relativePath, name) {
  if (EXCLUDED_NAMES_ANYWHERE.has(name)) return true;
  if (EXCLUDED_ROOT_PATHS.has(relativePath)) return true;
  if (EXCLUDED_GENERATED_PATHS.has(relativePath)) return true;
  // Gradle module outputs; "build" is unambiguous only inside companion/.
  if (relativePath.startsWith('companion/') && name === 'build') return true;
  return false;
}

function candidateFiles(directory = ROOT) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const absolute = resolve(directory, entry.name);
    const relativePath = relative(ROOT, absolute).replaceAll('\\', '/');
    if (entry.isDirectory() && isExcludedDirectory(relativePath, entry.name)) return [];
    if (entry.isDirectory()) return candidateFiles(absolute);
    if (!entry.isFile()) return [];
    return [relativePath];
  });
}

export function listDumpFiles() {
  return candidateFiles()
    .filter(path => (
      INCLUDED_ROOT_FILES.has(path)
      || INCLUDED_DIRECTORIES.some(directory => path.startsWith(directory))
    ))
    .filter(path => DUMP_EXTENSIONS.has(extensionOf(path)))
    .sort();
}

export function requiredDumpFiles() {
  const candidates = candidateFiles();
  return candidates.filter(path => (
    path === SELF
    || REQUIRED_PRODUCTION_ASSETS.has(path)
    || path.startsWith('companion/')
    || path.startsWith('docs/')
    || path.startsWith('.github/workflows/')
    || /(^|\/)wrangler\.(?:toml|json|jsonc)$/.test(path)
    || path.endsWith('.d.ts')
  )).filter(path => DUMP_EXTENSIONS.has(extensionOf(path))).sort();
}

export function verifyDumpCoverage(files = listDumpFiles()) {
  const included = new Set(files);
  const missing = requiredDumpFiles().filter(path => !included.has(path));
  if (missing.length) {
    throw new Error(`Architecture dump is missing required files:\n${missing.join('\n')}`);
  }
  return files;
}

export function renderDumpManifest(files = verifyDumpCoverage()) {
  const entries = files.map(path => {
    const contents = readFileSync(resolve(ROOT, path));
    return {
      path,
      bytes: contents.byteLength,
      encoding: BASE64_EXTENSIONS.has(extensionOf(path)) ? 'base64' : 'utf8',
      sha256: createHash('sha256').update(contents).digest('hex'),
    };
  });
  const fileSetSha256 = createHash('sha256')
    .update(entries.map(entry => `${entry.path}\0${entry.bytes}\0${entry.sha256}`).join('\n'))
    .digest('hex');
  return JSON.stringify({
    format: 'findspot-architecture-dump',
    formatVersion: 1,
    generatedBy: SELF,
    selection: 'generator-verified',
    fileCount: entries.length,
    fileSetSha256,
    files: entries,
  }, null, 2);
}

export function renderDump(files = verifyDumpCoverage()) {
  const manifest = `===== BEGIN __MANIFEST__ =====\n${renderDumpManifest(files)}\n===== END __MANIFEST__ =====`;
  const fileBlocks = files.map(path => {
    const contents = BASE64_EXTENSIONS.has(extensionOf(path))
      ? readFileSync(resolve(ROOT, path)).toString('base64')
      : readFileSync(resolve(ROOT, path), 'utf8');
    return `===== BEGIN ${path} =====\n${contents}\n===== END ${path} =====`;
  });
  return [manifest, ...fileBlocks].join('\n\n');
}

function usage() {
  return [
    'Usage:',
    '  node scripts/dumpArchitecture.mjs --list',
    '  node scripts/dumpArchitecture.mjs --manifest',
    '  node scripts/dumpArchitecture.mjs --verify',
    '  node scripts/dumpArchitecture.mjs [--output <path>]',
  ].join('\n');
}

function main(args) {
  if (args.includes('--help')) {
    console.log(usage());
    return;
  }

  const files = verifyDumpCoverage();
  if (args.includes('--verify')) {
    console.log(`Architecture dump coverage OK: ${files.length} files`);
    return;
  }
  if (args.includes('--list')) {
    console.log(files.join('\n'));
    return;
  }
  if (args.includes('--manifest')) {
    console.log(renderDumpManifest(files));
    return;
  }

  const outputIndex = args.indexOf('--output');
  const dump = renderDump(files);
  if (outputIndex !== -1) {
    const outputPath = args[outputIndex + 1];
    if (!outputPath) throw new Error('--output requires a path');
    writeFileSync(resolve(process.cwd(), outputPath), dump);
    console.log(`Architecture dump written to ${outputPath} (${files.length} files)`);
    return;
  }
  process.stdout.write(dump);
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
