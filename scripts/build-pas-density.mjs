#!/usr/bin/env node
// ─── PAS Density Index Builder ────────────────────────────────────────────────
// Generates public/pas-density-gb.json from a PAS daily CSV export.
//
// USAGE
//   node scripts/build-pas-density.mjs <path/to/pas-dump.csv> [output/path.json]
//
// DATA SOURCE
//   Download the public four-figure grid-ref tier dump manually from:
//   https://finds.org.uk/database/data
//   The page is bot-blocked for automated fetches — grab the URL by hand,
//   download once, then run this script locally against the saved file.
//   The file is the "All records" CSV export with at minimum these columns:
//     fourFigureLat, fourFigureLon, broadperiod, objecttype
//
// OUTPUT FORMAT
//   {
//     schemaVersion: 2,
//     resolution: 6,           ← H3 resolution (≈36 km²/cell)
//     generatedAt: "...",
//     recordCount: N,
//     sourceDumpUrl: "",        ← fill in manually before committing
//     license: "CC-BY",        ← confirm exact version on finds.org.uk
//     attribution: "...",
//     cells: {
//       "<h3Index>": {
//         c: count,
//         p: [top-5 period labels],
//         t: [top-5 type labels],
//         pc: [[period, count], ...],
//         tc: [[type, count], ...]
//       }
//     }
//   }
//
// SIZE NOTE
//   England+Wales at H3 res 6 with real PAS distribution produces
//   a few thousand non-empty cells. If the output file exceeds ~1 MB,
//   reduce H3_RESOLUTION to 5 (~250 km²/cell) or reduce TOP_N before
//   committing — every user downloads this asset regardless of scan location.
//   Check actual size after generation.
//
// LICENSE
//   Confirm the current CC-BY version against finds.org.uk/terms before
//   shipping. The placeholder below assumes CC-BY 4.0 — verify this.

import { createReadStream } from 'fs';
import { writeFileSync, existsSync } from 'fs';
import { createInterface } from 'readline';
import { latLngToCell } from 'h3-js';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── Configuration ────────────────────────────────────────────────────────────

const H3_RESOLUTION = 6;  // ~36 km²/cell — coarser than R2 design to keep bundle small
const TOP_N = 5;           // top N periods + object types per cell
const MAX_FILE_SIZE_MB = 1.5;  // warn if output exceeds this

// UK coordinate sanity bounds (same as buildPasIndex.mjs)
const BOUNDS = { minLat: 49.5, maxLat: 61.0, minLon: -8.5, maxLon: 2.1 };

// ─── CLI args ─────────────────────────────────────────────────────────────────

const [,, csvPath, outPath] = process.argv;
if (!csvPath) {
    console.error('Usage: node scripts/build-pas-density.mjs <pas-dump.csv> [output.json]');
    process.exit(1);
}
if (!existsSync(csvPath)) {
    console.error(`File not found: ${csvPath}`);
    process.exit(1);
}
const outputPath = outPath ?? join(__dirname, '..', 'public', 'pas-density-gb.json');

// ─── Parse + aggregate ────────────────────────────────────────────────────────

console.log(`Reading ${csvPath}...`);

const cells = new Map();  // h3Index → { count, periods: Map, types: Map }

function getOrCreate(h3Index) {
    if (!cells.has(h3Index)) {
        cells.set(h3Index, { count: 0, periods: new Map(), types: new Map() });
    }
    return cells.get(h3Index);
}

function increment(m, key) {
    if (!key) return;
    m.set(key, (m.get(key) ?? 0) + 1);
}

function topN(m, n) {
    return [...m.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, n)
        .map(([k, c]) => [k, c]);
}

function topLabels(entries) {
    return entries.map(([label]) => label);
}

/**
 * RFC-4180-compliant CSV line splitter.
 * Handles fields enclosed in double-quotes (which may contain commas or escaped
 * double-quotes). The PAS dump wraps description/notes in quotes with internal
 * commas, which breaks naive split(',').
 */
function parseCSVLine(line) {
    const fields = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
            if (inQuotes && line[i + 1] === '"') {
                current += '"'; // escaped quote ""
                i++;
            } else {
                inQuotes = !inQuotes;
            }
        } else if (ch === ',' && !inQuotes) {
            fields.push(current);
            current = '';
        } else {
            current += ch;
        }
    }
    fields.push(current);
    return fields;
}

const rl = createInterface({
    input:     createReadStream(csvPath),
    crlfDelay: Infinity,
});

let header = null;
let parsed = 0;
let skipped = 0;
let lineNum = 0;
let recordBuffer = '';

function hasOpenQuotedField(record) {
    let inQuotes = false;
    for (let i = 0; i < record.length; i++) {
        if (record[i] !== '"') continue;
        if (inQuotes && record[i + 1] === '"') {
            i++;
        } else {
            inQuotes = !inQuotes;
        }
    }
    return inQuotes;
}

function consumeRecord(record) {
    if (!record.trim()) return;
    lineNum++;

    if (header === null) {
        header = parseCSVLine(record).map(h => h.trim().toLowerCase().replace(/[^a-z0-9_]/g, ''));
        console.log(`Header columns: ${header.slice(0, 8).join(', ')}...`);

        // Locate required columns
        const latIdx  = header.indexOf('fourFigurelat'.toLowerCase()) !== -1
            ? header.indexOf('fourFigurelat'.toLowerCase())
            : header.findIndex(h => h.includes('lat'));
        const lonIdx  = header.indexOf('fourFigurelon'.toLowerCase()) !== -1
            ? header.indexOf('fourFigurelon'.toLowerCase())
            : header.findIndex(h => h.includes('lon'));
        const perIdx  = header.findIndex(h => h.includes('period'));
        const typeIdx = header.findIndex(h => h.includes('objecttype') || h.includes('type'));

        if (latIdx === -1 || lonIdx === -1) {
            console.error('Could not find lat/lon columns. Expected: fourFigureLat, fourFigureLon');
            console.error('Found:', header.join(', '));
            process.exit(1);
        }
        header._latIdx  = latIdx;
        header._lonIdx  = lonIdx;
        header._perIdx  = perIdx;
        header._typeIdx = typeIdx;
        console.log(`Using lat=${header[latIdx]}, lon=${header[lonIdx]}, period=${header[perIdx] ?? 'not found'}, type=${header[typeIdx] ?? 'not found'}`);
        return;
    }

    // RFC-4180-compliant CSV split — description/notes fields contain quoted commas
    // and newlines, which shifted column positions when using naive split(',').
    const cols = parseCSVLine(record);
    const latStr  = cols[header._latIdx]?.trim();
    const lonStr  = cols[header._lonIdx]?.trim();
    const period  = cols[header._perIdx]?.trim()  ?? '';
    const objType = cols[header._typeIdx]?.trim() ?? '';

    const lat = parseFloat(latStr);
    const lon = parseFloat(lonStr);
    if (!isFinite(lat) || !isFinite(lon)) { skipped++; return; }
    if (lat < BOUNDS.minLat || lat > BOUNDS.maxLat || lon < BOUNDS.minLon || lon > BOUNDS.maxLon) { skipped++; return; }

    const h3Index = latLngToCell(lat, lon, H3_RESOLUTION);
    const cell = getOrCreate(h3Index);
    cell.count++;
    increment(cell.periods, period || null);
    increment(cell.types,   objType || null);

    parsed++;
    if (parsed % 100_000 === 0) process.stdout.write(`  parsed ${parsed.toLocaleString()} records...\r`);
}

for await (const line of rl) {
    recordBuffer = recordBuffer ? `${recordBuffer}\n${line}` : line;
    if (hasOpenQuotedField(recordBuffer)) continue;
    consumeRecord(recordBuffer);
    recordBuffer = '';
}

if (recordBuffer.trim()) {
    consumeRecord(recordBuffer);
}

console.log(`\nParsed ${parsed.toLocaleString()} records, skipped ${skipped.toLocaleString()}.`);
console.log(`Unique H3 cells at resolution ${H3_RESOLUTION}: ${cells.size.toLocaleString()}`);

// ─── Build output ─────────────────────────────────────────────────────────────

const compactCells = {};
for (const [h3Index, data] of cells.entries()) {
    const periods = topN(data.periods, TOP_N);
    const types = topN(data.types, TOP_N);
    compactCells[h3Index] = {
        c: data.count,
        p: topLabels(periods),
        t: topLabels(types),
        pc: periods,
        tc: types,
    };
}

const output = {
    schemaVersion: 2,
    resolution:    H3_RESOLUTION,
    generatedAt:   new Date().toISOString(),
    recordCount:   parsed,
    sourceDumpUrl: 'https://finds.org.uk/database/data',
    license:       'CC-BY',  // confirm exact version (3.0 vs 4.0) against finds.org.uk/terms
    attribution:   'Contains Portable Antiquities Scheme data, licensed under CC-BY. ' +
                   'Findspot precision limited to four-figure National Grid Reference (~1 km) ' +
                   'as published by the Scheme. Source: https://finds.org.uk/',
    cells:         compactCells,
};

const json    = JSON.stringify(output);
const sizeKB  = Buffer.byteLength(json, 'utf8') / 1024;
const sizeMB  = sizeKB / 1024;

writeFileSync(outputPath, json);

console.log(`\nWritten to ${outputPath}`);
console.log(`File size: ${sizeKB.toFixed(1)} KB (${sizeMB.toFixed(2)} MB)`);

if (sizeMB > MAX_FILE_SIZE_MB) {
    console.warn(`\n⚠  File is ${sizeMB.toFixed(2)} MB — larger than the ${MAX_FILE_SIZE_MB} MB guideline.`);
    console.warn('   Consider reducing H3_RESOLUTION to 5 (~250 km²/cell) or dropping TOP_N.');
    console.warn('   Every user downloads this asset regardless of scan location.');
} else {
    console.log(`Size is within the ${MAX_FILE_SIZE_MB} MB guideline. ✓`);
}

console.log('\nDone. Before committing:');
console.log('  1. Confirm license version (CC-BY 3.0 vs 4.0) on finds.org.uk/terms');
console.log('  2. Run: npm run build && check SW precache includes pas-density-gb.json');
