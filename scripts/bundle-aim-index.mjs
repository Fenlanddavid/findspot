/**
 * Converts the generated per-cell AIM index into upload-friendly R2 bundles.
 * The static Worker keeps exposing the same aim-index/{geohash6}.json contract.
 */

import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const INDEX_DIR = join(__dirname, 'out', 'aim-index');
const BUNDLE_DIR = join(INDEX_DIR, 'bundles');
const CELL_RE = /^[0-9bcdefghjkmnpqrstuvwxyz]{6}\.json$/;
const PREFIX_LENGTH = 4;

async function main() {
    const cellFiles = (await readdir(INDEX_DIR)).filter(name => CELL_RE.test(name)).sort();
    if (cellFiles.length === 0) throw new Error('No AIM cell shards found to bundle');

    const groups = new Map();
    for (const filename of cellFiles) {
        const prefix = filename.slice(0, PREFIX_LENGTH);
        if (!groups.has(prefix)) groups.set(prefix, []);
        groups.get(prefix).push(filename);
    }

    await mkdir(BUNDLE_DIR, { recursive: true });
    let bundledCells = 0;
    let maxBundleBytes = 0;
    for (const [prefix, filenames] of groups) {
        const cells = {};
        for (const filename of filenames) {
            const cell = filename.slice(0, -'.json'.length);
            cells[cell] = JSON.parse(await readFile(join(INDEX_DIR, filename), 'utf8'));
        }
        const body = JSON.stringify(cells);
        await writeFile(join(BUNDLE_DIR, `${prefix}.json`), body);
        bundledCells += filenames.length;
        maxBundleBytes = Math.max(maxBundleBytes, Buffer.byteLength(body));
    }

    const metaPath = join(INDEX_DIR, '_meta.json');
    const meta = JSON.parse(await readFile(metaPath, 'utf8'));
    if (meta.cellCount !== bundledCells) {
        throw new Error(`Metadata expects ${meta.cellCount} cells but bundled ${bundledCells}`);
    }
    meta.storage = {
        type: 'geohash-prefix-bundles',
        prefixLength: PREFIX_LENGTH,
        bundleCount: groups.size,
    };
    await writeFile(metaPath, JSON.stringify(meta, null, 2));

    console.log(`Bundled ${bundledCells} AIM cells into ${groups.size} R2 objects`);
    console.log(`Largest bundle: ${maxBundleBytes} bytes`);
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
