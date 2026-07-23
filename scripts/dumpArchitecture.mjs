import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const SELF = 'scripts/dumpArchitecture.mjs';

const INCLUDED_DIRECTORIES = [
  '.github/workflows/',
  'docs/',
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

const TEXT_EXTENSIONS = new Set([
  '.cjs', '.css', '.d.ts', '.html', '.js', '.json', '.jsonc', '.jsx',
  '.md', '.mjs', '.sh', '.toml', '.ts', '.tsx', '.txt', '.yaml', '.yml',
]);

function extensionOf(path) {
  if (path.endsWith('.d.ts')) return '.d.ts';
  const dot = path.lastIndexOf('.');
  return dot === -1 ? '' : path.slice(dot);
}

const EXCLUDED_DIRECTORIES = new Set([
  '.git',
  '.wrangler',
  'coverage',
  'dist',
  'node_modules',
  'out',
  'playwright-report',
  'test-results',
]);

function candidateFiles(directory = ROOT) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (entry.isDirectory() && EXCLUDED_DIRECTORIES.has(entry.name)) return [];
    const absolute = resolve(directory, entry.name);
    if (entry.isDirectory()) return candidateFiles(absolute);
    if (!entry.isFile()) return [];
    return [relative(ROOT, absolute).replaceAll('\\', '/')];
  });
}

export function listDumpFiles() {
  return candidateFiles()
    .filter(path => (
      INCLUDED_ROOT_FILES.has(path)
      || INCLUDED_DIRECTORIES.some(directory => path.startsWith(directory))
    ))
    .filter(path => TEXT_EXTENSIONS.has(extensionOf(path)))
    .sort();
}

export function requiredDumpFiles() {
  const candidates = candidateFiles();
  return candidates.filter(path => (
    path === SELF
    || path.startsWith('docs/')
    || path.startsWith('.github/workflows/')
    || /(^|\/)wrangler\.(?:toml|json|jsonc)$/.test(path)
    || path.endsWith('.d.ts')
  )).filter(path => TEXT_EXTENSIONS.has(extensionOf(path))).sort();
}

export function verifyDumpCoverage(files = listDumpFiles()) {
  const included = new Set(files);
  const missing = requiredDumpFiles().filter(path => !included.has(path));
  if (missing.length) {
    throw new Error(`Architecture dump is missing required files:\n${missing.join('\n')}`);
  }
  return files;
}

export function renderDump(files = verifyDumpCoverage()) {
  return files.map(path => {
    const contents = readFileSync(resolve(ROOT, path), 'utf8');
    return `===== BEGIN ${path} =====\n${contents}\n===== END ${path} =====`;
  }).join('\n\n');
}

function usage() {
  return [
    'Usage:',
    '  node scripts/dumpArchitecture.mjs --list',
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
