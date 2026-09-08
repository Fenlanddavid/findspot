// ─── ArcGIS World Imagery Wayback release resolver ───────────────────────────
// Fetches two distinct imagery versions. Wayback release identifiers describe
// publication/version order, not local acquisition season.
//
// Tile URL format (corrected):
//   https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/
//   WMTS/1.0.0/GoogleMapsCompatible/MapServer/tile/{releaseId}/{z}/{y}/{x}

const CATALOG_URL =
    'https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/MapServer?f=json';

// Fallback to verified 2025 M values if catalog is unreachable
// WB_2025_R05 (May 2025) = 25285,  WB_2025_R07 (July 2025) = 49999
const FALLBACK: WaybackIds = { versionA: 25285, versionB: 49999 };

export interface WaybackIds {
    versionA?: number;
    versionB?: number;
    /** Legacy offline-pack keys; treated only as version identities. */
    spring?: number;
    summer?: number;
}

export function waybackVersionA(ids: WaybackIds): number { return ids.versionA ?? ids.spring ?? FALLBACK.versionA!; }
export function waybackVersionB(ids: WaybackIds): number { return ids.versionB ?? ids.summer ?? FALLBACK.versionB!; }

// Session-level cache — stores the in-flight promise so concurrent callers
// (e.g. two satellite workers) share a single fetch rather than each firing one.
let _promise: Promise<WaybackIds> | null = null;

// Extract release number from identifier like "WB_2025_R07" → 7
function releaseMonth(id: string): number | null {
    const m = id.match(/WB_\d{4}_R(\d{2})/);
    return m ? parseInt(m[1], 10) : null;
}

async function _doResolve(): Promise<WaybackIds> {
    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 5000);

        let data: Record<string, unknown>;
        try {
            const resp = await fetch(CATALOG_URL, { signal: controller.signal });
            if (!resp.ok) throw new Error('catalog non-ok');
            data = await resp.json() as Record<string, unknown>;
        } finally {
            clearTimeout(timer);
        }

        // The MapServer?f=json response stores releases in either "records" or
        // "layers". Each entry has a string ID like "WB_2025_R07" and a numeric
        // M field which is the tile release identifier used in the WMTS URL.
        const entries = (data['records'] ?? data['layers'] ?? []) as Record<string, unknown>[];

        const releases: { rNum: number; tileId: number }[] = [];
        for (const entry of entries) {
            // The string identifier — try both "id" (string) and "name"
            const label = (typeof entry['id'] === 'string' ? entry['id'] : null)
                       ?? (typeof entry['name'] === 'string' ? entry['name'] : null)
                       ?? '';
            // Numeric tile ID — the "M" field in the Wayback catalog
            const tileId = typeof entry['M'] === 'number' ? entry['M']
                         : typeof entry['m'] === 'number' ? entry['m']
                         : null;
            const rNum = releaseMonth(label);
            if (rNum === null || tileId === null) continue;
            releases.push({ rNum, tileId });
        }

        if (releases.length === 0) throw new Error('empty catalog');

        // Records are newest-first. Select two distinct published versions;
        // acquisition date must be resolved separately before any season claim.
        const distinctIds = [...new Set(releases.map(release => release.tileId))];
        return {
            versionA: distinctIds[0] ?? FALLBACK.versionA,
            versionB: distinctIds[1] ?? distinctIds[0] ?? FALLBACK.versionB,
        };
    } catch {
        return FALLBACK;
    }
}

export function resolveWaybackIds(): Promise<WaybackIds> {
    if (!_promise) _promise = _doResolve();
    return _promise;
}

export function waybackTileUrl(releaseId: number, zoom: number, ty: number, tx: number): string {
    return `https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/WMTS/1.0.0/GoogleMapsCompatible/MapServer/tile/${releaseId}/${zoom}/${ty}/${tx}`;
}
