export type RasterOverlayKey = 'lidar' | 'lidar-wales' | 'lidar-scotland' | 'relief' | 'os1880' | 'os1930';
export type RasterOverlayOpacity = Record<RasterOverlayKey, number>;
export type OverlayOpacityKey = RasterOverlayKey | 'romanStandalone';
export type OverlayOpacity = Record<OverlayOpacityKey, number>;
export type RomanStandaloneLayerStatus = 'idle' | 'loading' | 'available' | 'unavailable' | 'zoom-in';

export const DEFAULT_RASTER_OVERLAY_OPACITY: RasterOverlayOpacity = {
  lidar: 1,
  'lidar-wales': 1,
  'lidar-scotland': 1,
  relief: 1,
  os1880: 1,
  os1930: 1,
};

export const RASTER_OVERLAY_STORAGE_KEY = 'fs_fg_overlay_opacity';

export const LIDAR_KEYS: readonly RasterOverlayKey[] = ['lidar', 'lidar-wales', 'lidar-scotland'] as const;

/** One user-facing overlay; each provider supplies its own geographic coverage. */
export function lidarOverlayState(enabled: boolean) {
  return { lidar: enabled, 'lidar-wales': enabled, 'lidar-scotland': enabled };
}
