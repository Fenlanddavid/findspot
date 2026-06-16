/**
 * FindSpot Wales LiDAR COG Proxy
 *
 * Serves the reprojected Wales hillshade COG (EPSG:3857) from R2 with
 * correct HTTP range-request handling and CORS headers.
 *
 * Why range requests matter:
 *   maplibre-cog-protocol fetches 256x256 tile crops from the COG via
 *   HTTP range requests. Without explicit range forwarding, R2's .get()
 *   returns the full multi-GB object on every tile request, defeating the
 *   entire purpose of a Cloud Optimized GeoTIFF.
 *
 * Source: Natural Resources Wales / Welsh Government LiDAR
 * Licence: Open Government Licence v3.0 (OGL)
 * Reprojected for web display by FindSpot.
 */

const CORS_HEADERS = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Allow-Headers': 'Range, Content-Type',
    'Access-Control-Expose-Headers': 'Content-Range, Accept-Ranges, Content-Length',
};

export default {
    async fetch(request, env) {
        // Preflight
        if (request.method === 'OPTIONS') {
            return new Response(null, { status: 204, headers: CORS_HEADERS });
        }

        if (request.method !== 'GET' && request.method !== 'HEAD') {
            return new Response('Method not allowed', { status: 405, headers: CORS_HEADERS });
        }

        const url = new URL(request.url);
        const key = url.pathname.slice(1); // strip leading '/'

        // Only serve the single COG file — no directory listing or arbitrary keys
        if (key !== 'wales_hillshade_3857.tif') {
            return new Response('Not found', { status: 404, headers: CORS_HEADERS });
        }

        // ── Parse Range header ───────────────────────────────────────────────────
        // R2's .get() does NOT automatically honour Range headers from the
        // incoming request. We must parse and forward explicitly, otherwise
        // every tile fetch downloads the entire file.
        const rangeHeader = request.headers.get('Range');
        const r2Options = {};

        if (rangeHeader) {
            // Suffix range: bytes=-N (last N bytes)
            const suffixMatch = rangeHeader.match(/^bytes=-(\d+)$/);
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
                        return new Response('Range Not Satisfiable', { status: 416, headers: CORS_HEADERS });
                    }
                    r2Options.range = { offset, length: end - offset + 1 };
                } else {
                    r2Options.range = { offset };
                }
            } else {
                // Unsupported range format (multi-range, non-bytes units, etc.)
                return new Response('Range Not Satisfiable', { status: 416, headers: CORS_HEADERS });
            }
        }

        // ── Fetch from R2 ────────────────────────────────────────────────────────
        const object = await env.WALES_LIDAR_BUCKET.get(key, r2Options);

        if (!object) {
            return new Response('Not found', { status: 404, headers: CORS_HEADERS });
        }

        const responseHeaders = new Headers(CORS_HEADERS);
        object.writeHttpMetadata(responseHeaders);
        responseHeaders.set('Accept-Ranges', 'bytes');
        // Ensure content type is set correctly for GeoTIFF
        responseHeaders.set('Content-Type', 'image/tiff');

        // ── Build response with correct status ──────────────────────────────────
        // If R2 honoured a range request, object.range is populated.
        // We must return 206 Partial Content with a Content-Range header.
        if (object.range && rangeHeader) {
            const totalSize = object.size;
            const rangeOffset = 'offset' in object.range ? object.range.offset : 0;
            const rangeLength = object.range.length ?? (totalSize - rangeOffset);
            responseHeaders.set(
                'Content-Range',
                `bytes ${rangeOffset}-${rangeOffset + rangeLength - 1}/${totalSize}`
            );
            responseHeaders.set('Content-Length', String(rangeLength));
            return new Response(object.body, { status: 206, headers: responseHeaders });
        }

        // Full response (no range requested, or range not honoured)
        responseHeaders.set('Content-Length', String(object.size));
        return new Response(object.body, { status: 200, headers: responseHeaders });
    },
};
