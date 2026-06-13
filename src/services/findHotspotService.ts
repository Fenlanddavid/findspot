import { db } from '../db';
import type { Find } from '../db';
import type { Hotspot } from '../pages/fieldGuideTypes';
import { getDistance } from '../utils/fieldGuideAnalysis';
import { HOTSPOT_TITLES } from '../components/fieldGuide/FieldGuideContext';

// ─── Constants ────────────────────────────────────────────────────────────────

const NEARBY_RADIUS_M = 150;
const IDEMPOTENT_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours

// ─── Geohash encoder (precision 6) ───────────────────────────────────────────
// Copied from src/engines/geologyContext/geologyCache.ts — kept independent to
// avoid coupling the services layer to the engine layer.

const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';

function geohashEncode(lat: number, lon: number, precision = 6): string {
    let hash      = '';
    let minLat    = -90,  maxLat = 90;
    let minLon    = -180, maxLon = 180;
    let isEven    = true;
    let bits      = 0;
    let hashValue = 0;

    while (hash.length < precision) {
        if (isEven) {
            const mid = (minLon + maxLon) / 2;
            if (lon >= mid) { hashValue = (hashValue << 1) | 1; minLon = mid; }
            else            { hashValue = hashValue << 1;        maxLon = mid; }
        } else {
            const mid = (minLat + maxLat) / 2;
            if (lat >= mid) { hashValue = (hashValue << 1) | 1; minLat = mid; }
            else            { hashValue = hashValue << 1;        maxLat = mid; }
        }
        isEven = !isEven;
        bits++;
        if (bits === 5) {
            hash += BASE32[hashValue];
            bits = 0;
            hashValue = 0;
        }
    }
    return hash;
}

// ─── Public interfaces ────────────────────────────────────────────────────────

export interface HotspotFindFeedback {
    label:     string;
    note:      string;
    status:    'validates' | 'extends' | 'neutral';
    findCount: number;
    periods:   string[];
}

export interface FindHotspotAnnotation {
    hotspotTitle: string;
    status:       'within' | 'nearby';
    distanceM:    number | null;
    note:         string;
}

// ─── Period mapping for validation ───────────────────────────────────────────

// null entry = any period validates (Multi-Period Occupation Zone)
const CLASSIFICATION_PERIODS: Partial<Record<string, string[] | null>> = {
    'Crossing Point Candidate':         ['Roman', 'Medieval', 'Bronze Age'],
    'Burial / Barrow Candidate':        ['Bronze Age', 'Iron Age', 'Anglo-Saxon'],
    'Settlement Edge Candidate':        ['Roman', 'Medieval', 'Anglo-Saxon', 'Iron Age'],
    'Route-Side Activity Zone':         ['Roman', 'Medieval'],
    'Junction / Convergence Zone':      ['Roman', 'Medieval'],
    'Palaeochannel Activity Zone':      ['Bronze Age', 'Iron Age', 'Roman', 'Medieval'],
    'Wetland Margin Activity Zone':     ['Bronze Age', 'Iron Age', 'Roman'],
    'Multi-Period Occupation Zone':     null,
};

// ─── Shared helpers ───────────────────────────────────────────────────────────

function isWithinBounds(findLon: number, findLat: number, hotspot: Hotspot): boolean {
    return (
        findLon >= hotspot.bounds[0][0] &&
        findLon <= hotspot.bounds[1][0] &&
        findLat >= hotspot.bounds[0][1] &&
        findLat <= hotspot.bounds[1][1]
    );
}

function matchedFinds(hotspot: Hotspot, finds: Find[]): Find[] {
    const matched: Find[] = [];
    for (const f of finds) {
        if (f.lat == null || f.lon == null) continue;
        if (isWithinBounds(f.lon, f.lat, hotspot)) {
            matched.push(f);
        } else if (getDistance([f.lon, f.lat], hotspot.center) < NEARBY_RADIUS_M) {
            matched.push(f);
        }
    }
    // Deduplicate by id
    const seen = new Set<string>();
    return matched.filter(f => { if (seen.has(f.id)) return false; seen.add(f.id); return true; });
}

function periodCountsFrom(finds: Find[]): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const f of finds) {
        if (f.period) counts[f.period] = (counts[f.period] ?? 0) + 1;
    }
    return counts;
}

function sortedPeriods(counts: Record<string, number>): string[] {
    return Object.entries(counts)
        .sort((a, b) => b[1] - a[1])
        .map(([p]) => p);
}

function mergePeriodCounts(a: Record<string, number>, b: Record<string, number>): Record<string, number> {
    const result = { ...a };
    for (const [k, v] of Object.entries(b)) {
        result[k] = (result[k] ?? 0) + v;
    }
    return result;
}

function groupFindsByPermission(finds: Find[]): Map<string, Find[]> {
    const groups = new Map<string, Find[]>();
    for (const find of finds) {
        const key = find.permissionId;
        const group = groups.get(key);
        if (group) group.push(find);
        else groups.set(key, [find]);
    }
    return groups;
}

// ─── Part 1: recordFindHotspotSignals ────────────────────────────────────────

/** Called after each completed scan. Reads hotspots and projectFinds, computes
 *  overlaps, writes/updates FindHotspotSignal records to Dexie.
 *  Fire-and-forget — never throws to caller. */
export async function recordFindHotspotSignals(
    hotspots: Hotspot[],
    finds:    Find[],
): Promise<void> {
    try {
        const geoFinds = finds.filter(f => f.lat != null && f.lon != null);
        const now = Date.now();

        for (const hotspot of hotspots) {
            const matched = matchedFinds(hotspot, geoFinds);
            if (matched.length === 0) continue;

            // hotspot.center is [lon, lat] — encoder takes (lat, lon)
            const geohash6 = geohashEncode(hotspot.center[1], hotspot.center[0], 6);

            for (const [permissionId, permissionFinds] of groupFindsByPermission(matched)) {
                const signalKey = `${permissionId}:${geohash6}`;
                const newPeriodCounts = periodCountsFrom(permissionFinds);
                const latestFind = permissionFinds.reduce((a, b) =>
                    (a.createdAt > b.createdAt ? a : b)
                );

                const existing = await db.findHotspotSignals.get(signalKey);

                if (existing) {
                    const ageMs = now - existing.updatedAt;
                    if (ageMs < IDEMPOTENT_WINDOW_MS) {
                        // Within 24h window: overwrite counts idempotently
                        await db.findHotspotSignals.put({
                            signalKey,
                            geohash6,
                            permissionId,
                            lastFindAt:                latestFind.createdAt,
                            findCount:                 permissionFinds.length,
                            periodCounts:              newPeriodCounts,
                            lastHotspotClassification: hotspot.classification,
                            lastHotspotScore:          hotspot.score,
                            updatedAt:                 now,
                        });
                    } else {
                        // Older than 24h: add only finds newer than lastFindAt
                        const newFinds = permissionFinds.filter(f => f.createdAt > existing.lastFindAt);
                        const addedPeriodCounts = periodCountsFrom(newFinds);
                        await db.findHotspotSignals.put({
                            signalKey,
                            geohash6,
                            permissionId,
                            lastFindAt:                latestFind.createdAt > existing.lastFindAt
                                                         ? latestFind.createdAt
                                                         : existing.lastFindAt,
                            findCount:                 existing.findCount + newFinds.length,
                            periodCounts:              mergePeriodCounts(existing.periodCounts, addedPeriodCounts),
                            lastHotspotClassification: hotspot.classification,
                            lastHotspotScore:          hotspot.score,
                            updatedAt:                 now,
                        });
                    }
                } else {
                    await db.findHotspotSignals.put({
                        signalKey,
                        geohash6,
                        permissionId,
                        lastFindAt:                latestFind.createdAt,
                        findCount:                 permissionFinds.length,
                        periodCounts:              newPeriodCounts,
                        lastHotspotClassification: hotspot.classification,
                        lastHotspotScore:          hotspot.score,
                        updatedAt:                 now,
                    });
                }
            }
        }
    } catch {
        // Non-blocking — swallow all errors
    }
}

// ─── Part 2: buildHotspotFindFeedback ────────────────────────────────────────

/** Returns feedback copy for the hotspot card, or null if no finds match.
 *  Pure function — no DB access, no async. */
export function buildHotspotFindFeedback(
    hotspot: Hotspot,
    finds:   Find[],
): HotspotFindFeedback | null {
    const geoFinds = finds.filter(f => f.lat != null && f.lon != null);
    const matched  = matchedFinds(hotspot, geoFinds);
    if (matched.length === 0) return null;

    const counts  = periodCountsFrom(matched);
    const periods = sortedPeriods(counts);
    const count   = matched.length;

    // Determine whether all matched finds are outside bounds (nearby only)
    const allNearby = matched.every(f =>
        !isWithinBounds(f.lon!, f.lat!, hotspot)
    );

    // Determine status
    let status: HotspotFindFeedback['status'] = 'neutral';
    if (allNearby) {
        status = 'extends';
    } else {
        const impliedPeriods = CLASSIFICATION_PERIODS[hotspot.classification];
        if (impliedPeriods === null) {
            // Multi-Period Occupation Zone — any period validates
            status = 'validates';
        } else if (impliedPeriods) {
            if (periods.some(p => impliedPeriods.includes(p))) {
                status = 'validates';
            }
        }
        // All other classifications → neutral
    }

    // Build label
    const locationWord = allNearby ? 'nearby' : 'here';
    const label = `${count} find${count !== 1 ? 's' : ''} logged ${locationWord}`;

    // Build period list string
    let periodStr = '';
    if (periods.length === 1) {
        periodStr = periods[0];
    } else if (periods.length === 2) {
        periodStr = `${periods[0]} and ${periods[1]}`;
    } else if (periods.length >= 3) {
        periodStr = `${periods[0]} and other periods`;
    }

    const hotspotTitle = HOTSPOT_TITLES[hotspot.classification] ?? hotspot.classification;

    let note: string;
    if (status === 'validates' && periodStr) {
        note = `${periodStr} material corroborates this ${hotspotTitle} zone.`;
    } else if (status === 'extends') {
        note = 'Finds nearby — this zone may extend beyond the predicted boundary.';
    } else {
        note = `${count} find${count !== 1 ? 's' : ''} logged in or near this zone.`;
    }

    return { label, note, status, findCount: count, periods };
}

// ─── Part 3: buildFindHotspotAnnotation ──────────────────────────────────────

/** Returns an annotation for the find card when the find falls near a hotspot.
 *  Pure function — no DB access, no async. */
export function buildFindHotspotAnnotation(
    find:     Find,
    hotspots: Hotspot[],
): FindHotspotAnnotation | null {
    if (find.lat == null || find.lon == null) return null;

    let bestMatch: { hotspot: Hotspot; status: 'within' | 'nearby'; dist: number } | null = null;

    for (const hotspot of hotspots) {
        if (isWithinBounds(find.lon, find.lat, hotspot)) {
            if (!bestMatch || bestMatch.status === 'nearby' || hotspot.score > bestMatch.hotspot.score) {
                bestMatch = { hotspot, status: 'within', dist: 0 };
            }
        } else {
            const dist = getDistance([find.lon, find.lat], hotspot.center);
            if (dist < NEARBY_RADIUS_M) {
                if (!bestMatch || (bestMatch.status === 'nearby' && dist < bestMatch.dist)) {
                    bestMatch = { hotspot, status: 'nearby', dist };
                }
            }
        }
    }

    if (!bestMatch) return null;

    const hotspotTitle = HOTSPOT_TITLES[bestMatch.hotspot.classification] ?? bestMatch.hotspot.classification;

    const note = bestMatch.status === 'within'
        ? `Inside a predicted ${hotspotTitle} zone — this find may help confirm it.`
        : `${Math.round(bestMatch.dist)}m from a predicted ${hotspotTitle} zone.`;

    return {
        hotspotTitle,
        status:    bestMatch.status,
        distanceM: bestMatch.status === 'within' ? null : Math.round(bestMatch.dist),
        note,
    };
}
