/**
 * Converts generated per-cell SM shards into range-addressable R2 bundles.
 * Each prefix has a concatenated data object and a small JSON byte-offset index,
 * allowing the Worker to fetch one cell without parsing the complete bundle.
 */

import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const INDEX_DIR = join(__dirname, 'out', 'sm-index');
const BUNDLE_DIR = join(INDEX_DIR, 'bundles');
const CELL_RE = /^[0-9bcdefghjkmnpqrstuvwxyz]{6}\.json$/;
const PREFIX_LENGTH = 4;

async function main() {
    const cellFiles = (await readdir(INDEX_DIR)).filter(name => CELL_RE.test(name)).sort();
    if (cellFiles.length === 0) throw new Error('No SM cell shards found to bundle');

    const groups = new Map();
    for (const filename of cellFiles) {
        const prefix = filename.slice(0, PREFIX_LENGTH);
        if (!groups.has(prefix)) groups.set(prefix, []);
        groups.get(prefix).push(filename);
    }

    await rm(BUNDLE_DIR, { recursive: true, force: true });
    await mkdir(BUNDLE_DIR, { recursive: true });

    let bundledCells = 0;
    let maxBundleBytes = 0;
    for (const [prefix, filenames] of groups) {
        const chunks = [];
        const offsets = {};
        let offset = 0;

        for (const filename of filenames) {
            const cell = filename.slice(0, -'.json'.length);
            const chunk = await readFile(join(INDEX_DIR, filename));
            offsets[cell] = [offset, chunk.byteLength];
            chunks.push(chunk);
            offset += chunk.byteLength;
        }

        await Promise.all([
            writeFile(join(BUNDLE_DIR, `${prefix}.bin`), Buffer.concat(chunks, offset)),
            writeFile(join(BUNDLE_DIR, `${prefix}.index.json`), JSON.stringify(offsets)),
        ]);
        bundledCells += filenames.length;
        maxBundleBytes = Math.max(maxBundleBytes, offset);
    }

    const metaPath = join(INDEX_DIR, '_meta.json');
    const meta = JSON.parse(await readFile(metaPath, 'utf8'));
    if (meta.generationVersion !== 'v2') {
        throw new Error(`Expected v2 SM metadata, received ${meta.generationVersion ?? 'no generation'}`);
    }
    if (meta.cellCount !== bundledCells) {
        throw new Error(`Metadata expects ${meta.cellCount} cells but bundled ${bundledCells}`);
    }
    meta.storage = {
        type: 'geohash-range-bundles',
        prefixLength: PREFIX_LENGTH,
        bundleCount: groups.size,
        objectCount: groups.size * 2,
    };
    await writeFile(metaPath, JSON.stringify(meta, null, 2));

    console.log(`Bundled ${bundledCells} SM cells into ${groups.size * 2} R2 objects`);
    console.log(`Largest data bundle: ${maxBundleBytes} bytes`);
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
