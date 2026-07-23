import { describe, expect, it, vi } from 'vitest';
import type maplibregl from 'maplibre-gl';
import {
  createFieldGuideMapStyle,
  registerFieldGuideMapLayers,
} from '../../src/services/fieldguide/mapLayerRegistry';
import {
  bindFieldGuideMapInteractions,
  type FieldGuideMapCallbacks,
} from '../../src/services/fieldguide/mapInteractions';

const EXPECTED_SOURCE_IDS = [
  'monument-buffers',
  'monuments',
  'aim-monuments',
  'pas-density',
  'hotspots-overlay',
  'cluster-links',
  'trace-targets',
  'targets',
  'pas-finds',
  'historic-routes',
  'corridors',
  'landscape-context',
  'crossings',
  'permission-fields',
  'user-finds',
  'dev-annotations',
];

const EXPECTED_LAYER_IDS = [
  'monument-buffer-fill',
  'monument-buffer-outline',
  'monuments-fill',
  'monuments-outline',
  'aim-fill',
  'aim-outline',
  'pas-density-fill',
  'pas-density-outline',
  'hotspots-outline',
  'hotspots-fill',
  'cluster-links-casing',
  'cluster-links-line',
  'trace-targets-circle',
  'trace-targets-selected',
  'targets-halo',
  'targets-selected',
  'targets-circle',
  'pas-circles',
  'historic-routes-roman-casing',
  'historic-routes-roman',
  'historic-routes-trackway-casing',
  'historic-routes-trackway',
  'corridors-fill',
  'corridors-outline',
  'landscape-context-fill',
  'landscape-context-outline',
  'crossings-halo',
  'crossings-circle',
  'permission-fields-fill',
  'permission-fields-outline',
  'user-finds-circles',
  'user-finds-hitbox',
  'dev-annotations-halo',
  'dev-annotations-circle',
];

function callbacks(): FieldGuideMapCallbacks {
  return {
    onFeatureClick: vi.fn(),
    onHotspotClick: vi.fn(),
    onTraceTargetClick: vi.fn(),
    onDeselect: vi.fn(),
    onDragStart: vi.fn(),
    onZoomChange: vi.fn(),
    onSetClickLabel: vi.fn(),
    onPASFindLog: vi.fn(),
    onPASFindSelect: vi.fn(),
    onCrossingsLog: vi.fn(),
    onMonumentClick: vi.fn(),
    onUserFindClick: vi.fn(),
    onAnnotationDrop: vi.fn(),
    onSavedPointClick: vi.fn(),
  };
}

describe('FieldGuide map layer registry', () => {
  it('retains source IDs, layer order and trace-over-target moves', () => {
    const sourceIds: string[] = [];
    const layerIds: string[] = [];
    const moves: string[] = [];
    const map = {
      getSource: vi.fn(() => undefined),
      addSource: vi.fn((id: string) => sourceIds.push(id)),
      addLayer: vi.fn((layer: { id: string }) => layerIds.push(layer.id)),
      moveLayer: vi.fn((id: string) => moves.push(id)),
    } as unknown as maplibregl.Map;

    expect(registerFieldGuideMapLayers(map)).toBe(true);
    expect(sourceIds).toEqual(EXPECTED_SOURCE_IDS);
    expect(layerIds).toEqual(EXPECTED_LAYER_IDS);
    expect(moves).toEqual(['trace-targets-circle', 'trace-targets-selected']);
  });

  it('keeps the six basemap and raster overlay layers in their original order', () => {
    const style = createFieldGuideMapStyle();

    expect(Object.keys(style.sources)).toEqual([
      'osm',
      'satellite',
      'overlay-lidar',
      'overlay-lidar-wales',
      'overlay-os1930',
      'overlay-os1880',
    ]);
    expect(style.layers.map(layer => layer.id)).toEqual([
      'osm',
      'satellite',
      'overlay-lidar',
      'overlay-lidar-wales',
      'overlay-os1880',
      'overlay-os1930',
    ]);
  });
});

describe('FieldGuide map interaction router', () => {
  it('gives target-like features priority over hotspot clicks', () => {
    const handlers = new Map<string, (event: any) => void>();
    const queryRenderedFeatures = vi.fn(() => [{ properties: { id: 'target-1' } }]);
    const map = {
      on: vi.fn((event: string, layerOrHandler: string | ((event: any) => void), maybeHandler?: (event: any) => void) => {
        const layer = typeof layerOrHandler === 'string' ? layerOrHandler : '*';
        handlers.set(`${event}:${layer}`, maybeHandler ?? layerOrHandler as (event: any) => void);
      }),
      queryRenderedFeatures,
      getCanvas: () => ({ style: { cursor: '' } }),
      getZoom: () => 16,
    } as unknown as maplibregl.Map;
    const routed = callbacks();

    bindFieldGuideMapInteractions(map, {
      callbacks: () => routed,
      annotationMode: () => false,
      showLabel: vi.fn(),
    });

    const hotspot = handlers.get('click:hotspots-fill')!;
    hotspot({ point: {}, features: [{ properties: { id: 'hotspot-1' } }] });
    expect(routed.onHotspotClick).not.toHaveBeenCalled();

    queryRenderedFeatures.mockReturnValue([]);
    hotspot({ point: {}, features: [{ properties: { id: 'hotspot-1' } }] });
    expect(routed.onHotspotClick).toHaveBeenCalledWith('hotspot-1');
  });

  it('routes annotation, empty-map and crossing interactions without overlap', () => {
    const handlers = new Map<string, (event: any) => void>();
    const queryRenderedFeatures = vi.fn(() => []);
    const map = {
      on: vi.fn((event: string, layerOrHandler: string | ((event: any) => void), maybeHandler?: (event: any) => void) => {
        const layer = typeof layerOrHandler === 'string' ? layerOrHandler : '*';
        handlers.set(`${event}:${layer}`, maybeHandler ?? layerOrHandler as (event: any) => void);
      }),
      queryRenderedFeatures,
      getCanvas: () => ({ style: { cursor: '' } }),
      getZoom: () => 16,
    } as unknown as maplibregl.Map;
    const routed = callbacks();
    const showLabel = vi.fn();
    let annotationMode = true;

    bindFieldGuideMapInteractions(map, {
      callbacks: () => routed,
      annotationMode: () => annotationMode,
      showLabel,
    });

    handlers.get('click:*')!({ point: {}, lngLat: { lat: 52.7, lng: -0.3 } });
    expect(routed.onAnnotationDrop).toHaveBeenCalledWith(52.7, -0.3);
    expect(routed.onDeselect).not.toHaveBeenCalled();

    annotationMode = false;
    handlers.get('click:*')!({ point: {}, lngLat: { lat: 52.7, lng: -0.3 } });
    expect(routed.onMonumentClick).toHaveBeenCalledWith(null);
    expect(routed.onDeselect).toHaveBeenCalledOnce();

    handlers.get('click:crossings-circle')!({
      features: [{
        properties: {
          typeA: 'roman_road',
          nameA: 'Ermine Street',
          typeB: 'trackway',
          nameB: '',
        },
      }],
    });
    expect(showLabel).toHaveBeenCalledWith(
      'Route Crossing: Roman Road - Ermine Street × Trackway',
    );
  });
});
