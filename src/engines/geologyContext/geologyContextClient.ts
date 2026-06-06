// BGS OpenGeoscience WMS client for geology context lookup.
//
// Privacy: Geology context uses a read-only proxy to request public BGS map data
// for the selected scan tile. Finds, permissions and sessions are never sent.
// Only the tile centroid coordinates reach the proxy and are forwarded to BGS.
//
// Attribution: Contains British Geological Survey materials © UKRI 2025.

import type { RawGeologyData, ArtificialGroundType } from './geologyContextTypes';
import { GEOLOGY_REQUEST_TIMEOUT_MS } from './geologyContextTypes';

// ─── Service endpoints ────────────────────────────────────────────────────────
// BGS 625k is accessed via a read-only Cloudflare Worker proxy that adds CORS headers.
// Direct browser requests to BGS are blocked by missing Access-Control-Allow-Origin headers.
// Worker source: workers/bgs-proxy/index.js

const BGS_625K_PROXY_URL = 'https://findspot-bgs-proxy.trials-uk.workers.dev';

// ─── Layer names ──────────────────────────────────────────────────────────────
// Confirmed via GetCapabilities (BGS 625k, June 2026).
// GBR_BGS_625k_BLT — Bedrock Lithology:  LEX_D (formation), RCS_D (rock type), AGE_ONEGL (age)
// GBR_BGS_625k_SLT — Superficial Lithology: LEX_D (deposit name), ROCK_D (rock type)
// Both layers are allowlisted in workers/bgs-proxy/index.js.

const BGS_BEDROCK_LAYER     = 'GBR_BGS_625k_BLT';
const BGS_SUPERFICIAL_LAYER = 'GBR_BGS_625k_SLT';

// ─── WMS request builder ──────────────────────────────────────────────────────
// WMS 1.3.0 + EPSG:4326: BBOX axis order is (minLat, minLon, maxLat, maxLon).
// WIDTH/HEIGHT 101×101 — centre pixel I=50, J=50.

function buildGetFeatureInfoUrl(layer: string, lat: number, lon: number): string {
    const pad = 0.003; // ±~300m, appropriate for 1:625k scale
    const minLat = lat - pad;
    const maxLat = lat + pad;
    const minLon = lon - pad;
    const maxLon = lon + pad;

    // BBOX axis order for WMS 1.3.0 + EPSG:4326: minLat,minLon,maxLat,maxLon (y,x)
    const params = new URLSearchParams({
        SERVICE:      'WMS',
        VERSION:      '1.3.0',
        REQUEST:      'GetFeatureInfo',
        LAYERS:       layer,
        QUERY_LAYERS: layer,
        CRS:          'EPSG:4326',
        BBOX:         `${minLat},${minLon},${maxLat},${maxLon}`,
        WIDTH:        '101',
        HEIGHT:       '101',
        I:            '50',
        J:            '50',
        INFO_FORMAT:  'application/vnd.ogc.gml',
    });

    return `${BGS_625K_PROXY_URL}?${params.toString()}`;
}

// ─── XML parser — namespace agnostic ─────────────────────────────────────────
// Strips namespace prefixes from element local names before matching.
// This makes the parser resilient to BGS namespace changes across service versions.

function extractXmlAttributes(xmlText: string): Record<string, string> {
    const result: Record<string, string> = {};

    let doc: Document;
    try {
        doc = new DOMParser().parseFromString(xmlText, 'text/xml');
    } catch {
        return result;
    }

    // Walk all elements; strip namespace prefix from local name.
    // Use doc.createTreeWalker (not document.createTreeWalker) — Firefox throws
    // WRONG_DOCUMENT_ERR if the root node belongs to a different Document.
    const root = doc.documentElement;
    if (!root) return result;
    const walker = doc.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    let node: Node | null = walker.currentNode;

    while (node) {
        const el = node as Element;
        // Local name without namespace prefix
        const localName = el.localName ?? el.nodeName.split(':').pop() ?? '';

        // Collect element text content as a named attribute
        const text = el.textContent?.trim();
        if (text && !el.children.length) {
            // Only leaf elements — avoids duplicating nested content
            result[localName.toUpperCase()] = text;
        }

        // Also collect XML attributes on the element (e.g. <Attribute name="X" value="Y"/>)
        for (let i = 0; i < el.attributes.length; i++) {
            const attr = el.attributes[i];
            if (attr.localName.toUpperCase() === 'NAME' && el.attributes.getNamedItem('value')) {
                const attrName = attr.value.toUpperCase();
                const attrValue = el.attributes.getNamedItem('value')?.value ?? '';
                if (attrName && attrValue) result[attrName] = attrValue;
            }
        }

        node = walker.nextNode();
    }

    return result;
}

// ─── Artificial ground type resolution ───────────────────────────────────────
// GBR_BGS_625k_SLT field mapping: LEX_D = deposit name, ROCK_D = rock type

function resolveArtificialGroundType(attrs: Record<string, string>): ArtificialGroundType {
    const desc = (attrs['LEX_D'] ?? attrs['ROCK_D'] ?? '').toUpperCase();
    if (desc.includes('MADE GROUND'))      return 'made_ground';
    if (desc.includes('WORKED GROUND'))    return 'worked_ground';
    if (desc.includes('DISTURBED GROUND')) return 'disturbed_ground';
    return 'unknown';
}

function isArtificialGround(attrs: Record<string, string>): boolean {
    const lexd = (attrs['LEX_D'] ?? '').toUpperCase();
    const rockd = (attrs['ROCK_D'] ?? '').toUpperCase();
    return (
        lexd.includes('ARTIFICIAL') ||
        lexd.includes('MADE GROUND') ||
        lexd.includes('WORKED GROUND') ||
        lexd.includes('DISTURBED GROUND') ||
        rockd.includes('MADE GROUND') ||
        rockd.includes('WORKED GROUND') ||
        rockd.includes('DISTURBED GROUND')
    );
}

function isMassMovement(attrs: Record<string, string>): boolean {
    const lexd = (attrs['LEX_D'] ?? '').toUpperCase();
    const rockd = (attrs['ROCK_D'] ?? '').toUpperCase();
    return (
        lexd.includes('MASS MOVEMENT') ||
        lexd.includes('LANDSLIP') ||
        lexd.includes('SLOPE DEPOSIT') ||
        rockd.includes('MASS MOVEMENT') ||
        rockd.includes('LANDSLIP')
    );
}

// ─── Single-layer fetch ───────────────────────────────────────────────────────

async function fetchLayer(
    url: string,
    signal: AbortSignal,
): Promise<Record<string, string> | null> {
    let response: Response;
    try {
        response = await fetch(url, { signal, mode: 'cors' });
    } catch (err: unknown) {
        // CORS failure or network error — return null, caller logs the reason
        if (err instanceof Error && err.name === 'AbortError') throw err;
        return null;
    }

    if (!response.ok) return null;

    let text: string;
    try {
        text = await response.text();
    } catch {
        return null;
    }

    if (!text.trim()) return null;

    try {
        const attrs = extractXmlAttributes(text);
        // BGS returns valid empty GML when no feature exists at a coordinate.
        // An empty attribute map means no data — treat as null so the caller's
        // !bedrockAttrs && !superficialAttrs guard correctly triggers empty_response.
        return Object.keys(attrs).length > 0 ? attrs : null;
    } catch {
        return null;
    }
}

// ─── Main fetch function ──────────────────────────────────────────────────────
// Fetches bedrock and superficial deposits in parallel from BGS 625k.
// Returns null on timeout, CORS failure or empty response.

export type FetchGeologyResult = {
    data: RawGeologyData | null;
    timedOut: boolean;
    corsError: boolean;
};

export async function fetchBgsGeology(
    centroid: { lat: number; lon: number },
): Promise<FetchGeologyResult> {
    const controller = new AbortController();
    const timeoutId  = globalThis.setTimeout(
        () => controller.abort(),
        GEOLOGY_REQUEST_TIMEOUT_MS,
    );

    const bedrockUrl     = buildGetFeatureInfoUrl(BGS_BEDROCK_LAYER,     centroid.lat, centroid.lon);
    const superficialUrl = buildGetFeatureInfoUrl(BGS_SUPERFICIAL_LAYER, centroid.lat, centroid.lon);

    let bedrockAttrs:     Record<string, string> | null = null;
    let superficialAttrs: Record<string, string> | null = null;
    let timedOut  = false;
    let corsError = false;

    try {
        [bedrockAttrs, superficialAttrs] = await Promise.all([
            fetchLayer(bedrockUrl, controller.signal),
            fetchLayer(superficialUrl, controller.signal),
        ]);
    } catch (err: unknown) {
        if (err instanceof Error && err.name === 'AbortError') {
            timedOut = true;
        } else {
            corsError = true;
        }
        return { data: null, timedOut, corsError };
    } finally {
        globalThis.clearTimeout(timeoutId);
    }

    if (!bedrockAttrs && !superficialAttrs) {
        return { data: null, timedOut: false, corsError: false };
    }

    // ── Build RawGeologyData from parsed attributes ──
    const raw: RawGeologyData = {};

    if (bedrockAttrs) {
        // GBR_BGS_625k_BLT field mapping (confirmed Jun 2026):
        //   LEX_D    — formation name  (e.g. "OXFORD CLAY FORMATION")
        //   RCS_D    — rock type desc  (e.g. "MUDSTONE, SILTSTONE AND SANDSTONE")
        //   AGE_ONEGL — simple age label (e.g. "JURASSIC")
        //   MAX_PERIOD — geological period fallback
        raw.bedrockName     = bedrockAttrs['LEX_D'];
        raw.bedrockLithology = bedrockAttrs['RCS_D'];
        raw.bedrockAge      = bedrockAttrs['AGE_ONEGL'] || bedrockAttrs['MAX_PERIOD'];
    }

    if (superficialAttrs) {
        // GBR_BGS_625k_SLT field mapping (confirmed Jun 2026):
        //   LEX_D  — deposit name  (e.g. "RIVER TERRACE DEPOSITS (UNDIFFERENTIATED)")
        //   ROCK_D — rock type     (e.g. "SAND AND GRAVEL")
        const isArt  = isArtificialGround(superficialAttrs);
        const isMass = isMassMovement(superficialAttrs);

        if (isArt) {
            raw.artificialGround = {
                present: true,
                type:    resolveArtificialGroundType(superficialAttrs),
            };
        } else if (isMass) {
            raw.massMovement  = true;
        } else {
            raw.superficialName     = superficialAttrs['LEX_D'];
            raw.superficialLithology = superficialAttrs['ROCK_D'];
        }
    }

    return { data: raw, timedOut: false, corsError: false };
}
