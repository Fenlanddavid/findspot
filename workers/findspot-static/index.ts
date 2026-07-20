/**
 * FindSpot Static Dataset Worker
 *
 * Serves static datasets from an R2 bucket (findspot-static) with CORS headers
 * and HTTP range-request support for PMTiles consumers.
 *
 * Datasets served:
 *   sm-index/_meta.json        — SM index build metadata
 *   sm-index/{geohash6}.json   — per-cell SM index shards (sparse; empty cell → [])
 *   aim-index/_meta.json       — AIM index build metadata
 *   aim-index/{geohash6}.json  — per-cell AIM index shards (same pattern as SM)
 *   pas-h3/{key}               — PAS H3 density tiles (future W4)
 *
 * Attribution:
 *   Scheduled Monuments data: NHLE © Historic England, CC BY 4.0
 *   AIM data: © Historic England
 */

import { STATIC_DATASET_KEYS } from '../../src/shared/staticDatasetContract';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':   '*',
  'Access-Control-Allow-Methods':  'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers':  'Range, Content-Type',
  'Access-Control-Expose-Headers': 'Content-Range, Accept-Ranges, Content-Length',
};

// Regex patterns for allowed keys
const SM_SHARD_RE    = /^sm-index\/[0-9bcdefghjkmnpqrstuvwxyz]{6}\.json$/;
const AIM_SHARD_RE   = /^aim-index\/[0-9bcdefghjkmnpqrstuvwxyz]{6}\.json$/;
const PAS_H3_PREFIX  = 'pas-h3/';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return textError('Method not allowed', 405);
    }

    const url = new URL(request.url);
    // Strip leading '/' to get the R2 key
    const key = url.pathname.slice(1);

    // ── Key allow-list ────────────────────────────────────────────────────────
    const isSmMeta   = key === STATIC_DATASET_KEYS.smMeta;
    const isAimMeta  = key === STATIC_DATASET_KEYS.aimMeta;
    const isSmShard  = SM_SHARD_RE.test(key);
    const isAimShard = AIM_SHARD_RE.test(key);
    const isPasH3    = key.startsWith(PAS_H3_PREFIX) && key.length > PAS_H3_PREFIX.length;

    if (!isSmMeta && !isAimMeta && !isSmShard && !isAimShard && !isPasH3) {
      return textError('Not found', 404);
    }

    // ── Determine cache-control for this key ─────────────────────────────────
    let cacheControl;
    if (isPasH3) {
      cacheControl = 'public, max-age=604800'; // 7 days — PAS H3 tiles are stable
    } else {
      cacheControl = 'public, max-age=86400';  // 1 day — SM index + AIM
    }

    // ── Parse Range header ───────────────────────────────────────────────────
    // R2's .get() does NOT automatically honour Range headers from the incoming
    // request. We must parse and forward explicitly. Required for PMTiles
    // (aim.pmtiles) and usable on any key for resumable downloads.
    const rangeHeader = request.headers.get('Range');
    const r2Options: R2GetOptions = {};

    if (rangeHeader) {
      // Suffix range: bytes=-N (last N bytes)
      const suffixMatch   = rangeHeader.match(/^bytes=-(\d+)$/);
      // Standard range: bytes=START- or bytes=START-END
      const standardMatch = rangeHeader.match(/^bytes=(\d+)-(\d*)$/);

      if (suffixMatch) {
        const length = parseInt(suffixMatch[1], 10);
        r2Options.range = { suffix: length };
      } else if (standardMatch) {
        const offset = parseInt(standardMatch[1], 10);
        const endStr = standardMatch[2];
        if (endStr) {
          const end = parseInt(endStr, 10);
          if (end < offset) {
            return textError('Range Not Satisfiable', 416);
          }
          r2Options.range = { offset, length: end - offset + 1 };
        } else {
          r2Options.range = { offset };
        }
      } else {
        // Unsupported range format (multi-range, non-bytes units, etc.)
        return textError('Range Not Satisfiable', 416);
      }
    }

    // ── Fetch from R2 ────────────────────────────────────────────────────────
    const object = await env.STATIC_BUCKET.get(key, r2Options);

    // ── Missing-object handling ───────────────────────────────────────────────
    if (!object) {
      // Empty SM or AIM geohash6 cell is a valid state (no features in that cell).
      // Return [] rather than a 404 so callers treat it identically to a populated shard.
      if (isSmShard || isAimShard) {
        const headers = new Headers(CORS_HEADERS);
        headers.set('Content-Type',  'application/json');
        headers.set('Cache-Control', cacheControl);
        headers.set('Content-Length', '2');
        return new Response('[]', { status: 200, headers });
      }

      return textError('Not found', 404);
    }

    // ── Build response headers ───────────────────────────────────────────────
    const responseHeaders = new Headers(CORS_HEADERS);
    object.writeHttpMetadata(responseHeaders);
    responseHeaders.set('Accept-Ranges', 'bytes');
    responseHeaders.set('Cache-Control', cacheControl);

    // Enforce content types
    if (isSmMeta || isAimMeta || isSmShard || isAimShard) {
      responseHeaders.set('Content-Type', 'application/json');
    }

    // ── Partial-content response (range request honoured by R2) ─────────────
    if (object.range && rangeHeader) {
      const totalSize = object.size;
      let rangeOffset: number;
      let rangeLength: number;

      if ('suffix' in object.range) {
        rangeLength = object.range.suffix;
        rangeOffset = Math.max(0, totalSize - rangeLength);
      } else {
        rangeOffset = object.range.offset ?? 0;
        rangeLength = object.range.length ?? (totalSize - rangeOffset);
      }
      responseHeaders.set(
        'Content-Range',
        `bytes ${rangeOffset}-${rangeOffset + rangeLength - 1}/${totalSize}`,
      );
      responseHeaders.set('Content-Length', String(rangeLength));
      return new Response(object.body, { status: 206, headers: responseHeaders });
    }

    // ── Full response ────────────────────────────────────────────────────────
    responseHeaders.set('Content-Length', String(object.size));
    return new Response(object.body, { status: 200, headers: responseHeaders });
  },
} satisfies ExportedHandler<Env>;

// ── Helpers ───────────────────────────────────────────────────────────────────

function textError(message: string, status: number): Response {
  return new Response(message, {
    status,
    headers: { 'Content-Type': 'text/plain', ...CORS_HEADERS },
  });
}
