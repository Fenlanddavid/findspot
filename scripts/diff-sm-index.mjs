/**
 * diff-sm-index.mjs
 *
 * Compares the current local SM index build against the live NHLE FeatureServer/6
 * to detect newly designated or de-listed Scheduled Monuments.
 *
 * With two directory arguments, compares an old local shard build against a new
 * local shard build and verifies unchanged shard bytes except cells that gained
 * supplemental non-NHLE entries (Cadw/HES alphanumeric refs).
 *
 * Usage:
 *   node scripts/diff-sm-index.mjs
 *   node scripts/diff-sm-index.mjs old-sm-index-dir new-sm-index-dir
 *
 * Exit codes:
 *   0  — no changes detected
 *   1  — additions or removals found (rebuild recommended)
 *   2  — error (missing meta file, network failure, etc.)
 *
 * Requirements: Node 18+ (global fetch, fs/promises)
 * Attribution: NHLE © Historic England, CC BY 4.0
 */

import { readFile, readdir } from 'fs/promises';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const META_PATH = join(__dirname, 'out', 'sm-index', '_meta.json');

const FEATURE_SERVER =
  'https://services-eu1.arcgis.com/ZOdPfBS3aqqDYPUQ/arcgis/rest/services/' +
  'National_Heritage_List_for_England_NHLE_v02_VIEW/FeatureServer/6/query';

const PAGE_SIZE = 1000;

// ── Local build-to-build diff ─────────────────────────────────────────────────

async function readShardFiles(dir) {
  const files = await readdir(dir);
  const shardFiles = files.filter((file) =>
    file.endsWith('.json') &&
    file !== '_meta.json' &&
    file !== '_entries.json',
  );
  const map = new Map();
  for (const file of shardFiles) {
    map.set(file.replace(/\.json$/, ''), await readFile(join(dir, file), 'utf8'));
  }
  return map;
}

function parseShard(raw, cell, label) {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    throw new Error(`Cannot parse ${label} shard ${cell}: ${err.message}`);
  }
}

function idsFor(entries) {
  return entries
    .map((entry) => String(entry?.listEntry ?? '').trim())
    .filter(Boolean);
}

async function diffLocalBuilds(oldDirArg, newDirArg) {
  const oldDir = resolve(oldDirArg);
  const newDir = resolve(newDirArg);
  const oldShards = await readShardFiles(oldDir);
  const newShards = await readShardFiles(newDir);

  let unchanged = 0;
  const removed = [];
  const addedCells = [];
  const changedWithoutSupplemental = [];
  const borderCells = [];

  for (const cell of oldShards.keys()) {
    if (!newShards.has(cell)) {
      removed.push(cell);
      continue;
    }
    const oldRaw = oldShards.get(cell);
    const newRaw = newShards.get(cell);
    if (oldRaw === newRaw) {
      unchanged++;
      continue;
    }

    const oldEntries = parseShard(oldRaw, cell, 'old');
    const newEntries = parseShard(newRaw, cell, 'new');
    const oldIds = idsFor(oldEntries);
    const oldSet = new Set(oldIds);
    const newIds = idsFor(newEntries);
    const addedIds = newIds.filter((id) => !oldSet.has(id));
    const removedIds = oldIds.filter((id) => !newIds.includes(id));
    const supplementalAdded = addedIds.filter((id) => !/^\d/.test(id));
    const oldOrderPreserved = oldIds.every((id, index) => newIds[index] === id);

    if (removedIds.length === 0 && addedIds.length === supplementalAdded.length && oldOrderPreserved) {
      borderCells.push({ cell, supplementalAdded });
    } else {
      changedWithoutSupplemental.push({ cell, addedIds, removedIds });
    }
  }

  for (const cell of newShards.keys()) {
    if (!oldShards.has(cell)) addedCells.push(cell);
  }

  console.log('SM Index Diff — old vs new local builds');
  console.log(`Old build: ${oldDir}`);
  console.log(`New build: ${newDir}`);
  console.log('');
  console.log(`Unchanged existing shard files: ${unchanged}`);
  console.log(`New shard files: ${addedCells.length}`);
  console.log(`Removed old shard files: ${removed.length}`);
  console.log(`Existing cells with supplemental additions only: ${borderCells.length}`);
  console.log(`Cells changed beyond supplemental additions: ${changedWithoutSupplemental.length}`);
  console.log('');

  if (borderCells.length === 0) {
    console.log('Cells that gained supplemental entries (0): none');
  } else {
    console.log(`Cells that gained supplemental entries (${borderCells.length}):`);
    for (const { cell, supplementalAdded } of borderCells) {
      console.log(`  ${cell}: ${supplementalAdded.join(', ')}`);
    }
  }

  if (removed.length > 0) {
    console.log('');
    console.log(`Removed cells (${removed.length}): ${removed.join(', ')}`);
  }
  if (changedWithoutSupplemental.length > 0) {
    console.log('');
    console.log('Changed cells not explained by supplemental additions:');
    for (const { cell, addedIds, removedIds } of changedWithoutSupplemental) {
      console.log(`  ${cell}: added [${addedIds.join(', ')}], removed [${removedIds.join(', ')}]`);
    }
  }

  if (removed.length > 0 || changedWithoutSupplemental.length > 0) process.exit(1);
  process.exit(0);
}

// ── Local index reader ────────────────────────────────────────────────────────

/**
 * Read all ListEntry values from the local index shards by scanning _meta.json.
 * Because _meta.json only stores counts (not entries), we must re-read all shard
 * files to reconstruct the full ListEntry set. However, to avoid reading thousands
 * of files, we instead store the ListEntry set in a companion _entries.json that
 * build-sm-index.mjs writes alongside _meta.json.
 *
 * Fallback: if _entries.json is absent (index built before this script existed),
 * we report the meta counts only and cannot compute a per-entry diff.
 *
 * @returns {Promise<{ builtAt: string, featureCount: number, entries: Set<string>|null }>}
 */
async function readLocalIndex() {
  let metaRaw;
  try {
    metaRaw = await readFile(META_PATH, 'utf8');
  } catch {
    throw new Error(
      `Cannot read ${META_PATH}\n` +
      'Run "node scripts/build-sm-index.mjs" first to generate the local index.',
    );
  }

  const meta = JSON.parse(metaRaw);

  // Try to load the companion entries file
  const entriesPath = join(dirname(META_PATH), '_entries.json');
  let entries = null;
  try {
    const entriesRaw = await readFile(entriesPath, 'utf8');
    const arr = JSON.parse(entriesRaw);
    entries = new Set(arr);
  } catch {
    // _entries.json absent — partial diff only (count-based)
  }

  return { builtAt: meta.builtAt, featureCount: meta.featureCount, entries };
}

// ── Live FeatureServer fetcher ────────────────────────────────────────────────

/**
 * Fetch one page of ListEntry values from FeatureServer/6 (no geometry needed).
 * @param {number} offset
 * @returns {Promise<Array<{ listEntry: string, name: string }>>}
 */
async function fetchLivePage(offset) {
  const params = new URLSearchParams({
    where:             '1=1',
    outFields:         'ListEntry,Name',
    returnGeometry:    'false',
    f:                 'json',
    resultOffset:      String(offset),
    resultRecordCount: String(PAGE_SIZE),
  });

  const url = `${FEATURE_SERVER}?${params}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'FindSpot-SM-Index-Diff/1.0' },
  });

  if (!res.ok) {
    throw new Error(`FeatureServer returned ${res.status} at offset ${offset}`);
  }

  const data = await res.json();

  if (data.error) {
    throw new Error(`FeatureServer error: ${JSON.stringify(data.error)}`);
  }

  const features = Array.isArray(data.features) ? data.features : [];
  return features.map((f) => ({
    listEntry: String(f.attributes?.ListEntry ?? '').trim(),
    name:      String(f.attributes?.Name      ?? '').trim(),
  })).filter((x) => x.listEntry);
}

/**
 * Fetch ALL ListEntry + Name pairs from FeatureServer/6.
 * @returns {Promise<Map<string, string>>}  listEntry → name
 */
async function fetchLiveEntries() {
  const all    = new Map();
  let   offset = 0;

  process.stdout.write('Fetching live ListEntry set from FeatureServer/6');

  while (true) {
    const page = await fetchLivePage(offset);
    if (page.length === 0) break;

    for (const { listEntry, name } of page) {
      all.set(listEntry, name);
    }

    process.stdout.write('.');

    if (page.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  process.stdout.write('\n');
  return all;
}

// ── Diff ──────────────────────────────────────────────────────────────────────

function computeDiff(localEntries, liveMap) {
  const added   = [];
  const removed = [];

  for (const [listEntry, name] of liveMap) {
    if (!localEntries.has(listEntry)) {
      added.push({ listEntry, name });
    }
  }

  for (const listEntry of localEntries) {
    if (!liveMap.has(listEntry)) {
      removed.push({ listEntry, name: '(name not in local index)' });
    }
  }

  return { added, removed };
}

// ── Printer ───────────────────────────────────────────────────────────────────

function printSection(title, items) {
  if (items.length === 0) {
    console.log(`${title} (0): none`);
  } else {
    console.log(`${title} (${items.length}):`);
    for (const { listEntry, name } of items) {
      console.log(`  SM${listEntry} — ${name}`);
    }
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  if (process.argv.length === 4) {
    await diffLocalBuilds(process.argv[2], process.argv[3]);
    return;
  }

  // 1. Read local index
  let localIndex;
  try {
    localIndex = await readLocalIndex();
  } catch (err) {
    console.error(`ERROR: ${err.message}`);
    process.exit(2);
  }

  // 2. Fetch live entries
  let liveMap;
  try {
    liveMap = await fetchLiveEntries();
  } catch (err) {
    console.error(`ERROR: ${err.message}`);
    process.exit(2);
  }

  // 3. Print header
  console.log('');
  console.log('SM Index Diff — live vs current R2 build');
  console.log(`Current build: ${localIndex.builtAt} (${localIndex.featureCount} features)`);
  console.log(`Live service:  ${liveMap.size} features`);
  console.log('');

  // 4. Diff
  if (!localIndex.entries) {
    // No _entries.json — count-only comparison
    const delta = liveMap.size - localIndex.featureCount;
    console.log(
      'Note: _entries.json not found — per-entry diff unavailable.\n' +
      '      Run "node scripts/build-sm-index.mjs" to generate it alongside the index.\n',
    );
    if (delta === 0) {
      console.log('Count unchanged. Assuming no changes (rebuild to confirm).');
      console.log('\nRecommendation: counts match, no rebuild needed.');
      process.exit(0);
    } else {
      console.log(`Count delta: ${delta > 0 ? '+' : ''}${delta}`);
      console.log('\nRecommendation: rebuild — count mismatch detected.');
      process.exit(1);
    }
  }

  const { added, removed } = computeDiff(localIndex.entries, liveMap);

  printSection('Added',   added);
  console.log('');
  printSection('Removed', removed);
  console.log('');

  const hasChanges = added.length > 0 || removed.length > 0;
  if (hasChanges) {
    console.log('Recommendation: rebuild — run "node scripts/build-sm-index.mjs" then upload to R2.');
    process.exit(1);
  } else {
    console.log('Recommendation: no rebuild needed.');
    process.exit(0);
  }
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(2);
});
