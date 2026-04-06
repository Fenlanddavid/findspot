// Central configuration for the Field Guide scan engine.
// All tunable constants live here — do not inline in scan logic.

export const SCAN_CONFIG = {
    TERRAIN_ZOOM: 16,
    MIN_HISTORIC_ZOOM: 10,

    // Historic scan bounding box limits (degrees)
    MAX_BBOX_DELTA: 0.045,
    LAT_BUFFER:    0.009,
    LON_BUFFER:    0.015,

    // Skip historic hotspot enhancement if map drifted further than this (metres)
    DRIFT_THRESHOLD_M: 1000,

    // Abort route fetch during terrain scan after this long (ms)
    ROUTE_FETCH_TIMEOUT_MS: 3000,

    // Zoom warning threshold (terrain scan is locked at Z16, but warn if user zooms in beyond this)
    ZOOM_WARNING: 16.5,
} as const;
