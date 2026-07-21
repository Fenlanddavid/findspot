/**
 * FindSpot Static Dataset Worker
 *
 * Serves static datasets from an R2 bucket (findspot-static) with CORS headers
 * and HTTP range-request support for PMTiles consumers.
 *
 * Datasets served:
 *   v{n}/sm-index/_meta.json        — SM index build metadata
 *   v{n}/sm-index/{geohash6}.json   — per-cell SM index shards
 *   v{n}/sm-index/bundles/*         — private range-bundle storage (not public)
 *   v{n}/aim-index/_meta.json       — AIM index build metadata
 *   v{n}/aim-index/{geohash6}.json  — per-cell AIM index shards
 *   v{n}/aim-index/bundles/*        — private prefix-bundle storage (not public)
 *   v{n}/pas-h3/{key}               — PAS H3 density tiles (future W4)
 *
 * Attribution:
 *   Scheduled Monuments data: NHLE © Historic England, CC BY 4.0
 *   AIM data: © Historic England
 */

import {
  SUPPORTED_STATIC_DATA_GENERATIONS,
  aimBundleKey,
  smBundleIndexKey,
  smBundleKey,
} from '../../src/shared/staticDatasetContract';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':   '*',
  'Access-Control-Allow-Methods':  'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers':  'Range, Content-Type',
  'Access-Control-Expose-Headers': 'Content-Range, Accept-Ranges, Content-Length',
};

// Regex patterns for allowed keys
const GENERATION_RE  = SUPPORTED_STATIC_DATA_GENERATIONS.join('|');
// The optional generation prefix preserves the pre-versioning URLs for one
// grace window. New clients always use the shared v2 contract.
const OPTIONAL_GENERATION_PREFIX = `(?:(?:${GENERATION_RE})/)?`;
const SM_META_RE     = new RegExp(`^${OPTIONAL_GENERATION_PREFIX}sm-index/_meta\\.json$`);
const AIM_META_RE    = new RegExp(`^${OPTIONAL_GENERATION_PREFIX}aim-index/_meta\\.json$`);
const SM_SHARD_RE    = new RegExp(`^${OPTIONAL_GENERATION_PREFIX}sm-index/[0-9bcdefghjkmnpqrstuvwxyz]{6}\\.json$`);
const AIM_SHARD_RE   = new RegExp(`^${OPTIONAL_GENERATION_PREFIX}aim-index/[0-9bcdefghjkmnpqrstuvwxyz]{6}\\.json$`);
const PAS_H3_RE      = new RegExp(`^${OPTIONAL_GENERATION_PREFIX}pas-h3/.+`);

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
    const isSmMeta   = SM_META_RE.test(key);
    const isAimMeta  = AIM_META_RE.test(key);
    const isSmShard  = SM_SHARD_RE.test(key);
    const isAimShard = AIM_SHARD_RE.test(key);
    const isPasH3    = PAS_H3_RE.test(key);

    if (!isSmMeta && !isAimMeta && !isSmShard && !isAimShard && !isPasH3) {
      return textError('Not found', 404);
    }

    // The public client contract remains one six-character cell per URL while
    // the generation is stored in upload-friendly prefix bundles.
    if (isSmShard) {
      return serveSmShard(key, request.method, env);
    }

    if (isAimShard) {
      return serveAimShard(key, request.method, env);
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

async function serveAimShard(key: string, method: string, env: Env): Promise<Response> {
  const parts = key.split('/');
  const versioned = SUPPORTED_STATIC_DATA_GENERATIONS.includes(parts[0] as typeof SUPPORTED_STATIC_DATA_GENERATIONS[number]);
  const generation = versioned ? parts[0] : undefined;
  const filename = parts.at(-1)!;
  const cell = filename.slice(0, -'.json'.length);
  const bundleKey = generation
    ? aimBundleKey(cell, generation)
    : `aim-index/bundles/${cell.slice(0, 4)}.json`;
  const bundle = await env.STATIC_BUCKET.get(bundleKey);

  // Older generations were uploaded as one R2 object per cell. Keep those
  // objects readable while v1 and the unversioned client contract age out.
  if (!bundle) {
    const direct = await env.STATIC_BUCKET.get(key);
    return direct ? jsonResponse(await direct.text(), method) : jsonResponse('[]', method);
  }

  try {
    const cells = await bundle.json<Record<string, unknown>>();
    const value = Array.isArray(cells[cell]) ? cells[cell] : [];
    return jsonResponse(JSON.stringify(value), method);
  } catch {
    return textError('AIM bundle unavailable', 503);
  }
}

async function serveSmShard(key: string, method: string, env: Env): Promise<Response> {
  const parts = key.split('/');
  const versioned = SUPPORTED_STATIC_DATA_GENERATIONS.includes(parts[0] as typeof SUPPORTED_STATIC_DATA_GENERATIONS[number]);
  const generation = versioned ? parts[0] : undefined;
  const filename = parts.at(-1)!;
  const cell = filename.slice(0, -'.json'.length);
  const indexKey = generation
    ? smBundleIndexKey(cell, generation)
    : `sm-index/bundles/${cell.slice(0, 4)}.index.json`;
  const indexObject = await env.STATIC_BUCKET.get(indexKey);

  // Older generations were uploaded as one object per cell.
  if (!indexObject) {
    const direct = await env.STATIC_BUCKET.get(key);
    return direct ? jsonResponse(await direct.text(), method) : jsonResponse('[]', method);
  }

  try {
    const index = await indexObject.json<Record<string, unknown>>();
    const location = index[cell];
    if (!Array.isArray(location)
      || location.length !== 2
      || !location.every(Number.isSafeInteger)
      || location.some(value => value < 0)) {
      return jsonResponse('[]', method);
    }
    const [offset, length] = location as [number, number];
    const bundleKey = generation
      ? smBundleKey(cell, generation)
      : `sm-index/bundles/${cell.slice(0, 4)}.bin`;
    const bundle = await env.STATIC_BUCKET.get(bundleKey, { range: { offset, length } });
    if (!bundle) return textError('SM bundle unavailable', 503);
    return jsonStreamResponse(bundle.body, method, length);
  } catch {
    return textError('SM bundle unavailable', 503);
  }
}

function jsonResponse(body: string, method: string): Response {
  const headers = new Headers(CORS_HEADERS);
  headers.set('Content-Type', 'application/json');
  headers.set('Cache-Control', 'public, max-age=86400');
  headers.set('Content-Length', String(new TextEncoder().encode(body).byteLength));
  return new Response(method === 'HEAD' ? null : body, { status: 200, headers });
}

function jsonStreamResponse(body: ReadableStream, method: string, length: number): Response {
  const headers = new Headers(CORS_HEADERS);
  headers.set('Content-Type', 'application/json');
  headers.set('Cache-Control', 'public, max-age=86400');
  headers.set('Content-Length', String(length));
  return new Response(method === 'HEAD' ? null : body, { status: 200, headers });
}
