import { readFile, readdir } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import type maplibregl from 'maplibre-gl';
import type { HistoricRoute } from '../../src/pages/fieldGuideTypes';
import * as diagLog from '../../src/services/diagLog';
import {
  registerFieldGuideMapLayers,
} from '../../src/services/fieldguide/mapLayerRegistry';
import { ROMAN_ROADS_ATTRIBUTION } from '../../src/services/fieldguide/romanRoadLayerConfig';
import {
  LAYER_VISIBILITY_CONFIG,
} from '../../src/hooks/useFieldGuideMap';
import {
  populateRomanStandaloneRoads,
} from '../../src/hooks/useFieldGuideHistoricLayers';
import { applyOverlayOpacity } from '../../src/components/fieldGuide/FieldGuideWorkspace';

const VIEWPORT = { west: -0.2, south: 52.0, east: 0.1, north: 52.2 };

function route(): HistoricRoute {
  return {
    id: 'rrra-road-1',
    type: 'roman_road',
    source: 'rrra',
    name: 'Research alignment',
    confidenceClass: 'B',
    certaintyScore: 65,
    geometry: [[-0.1, 52.05], [0, 52.15]],
    bbox: [[-0.1, 52.05], [0, 52.15]],
    period: 'roman',
  };
}

function mapWithSource(zoom = 12) {
  const setData = vi.fn();
  const map = {
    getZoom: () => zoom,
    getSource: (id: string) => id === 'roman-roads-standalone' ? { setData } : undefined,
  } as unknown as maplibregl.Map;
  return { map, setData };
}

async function sourceFiles(directory: URL): Promise<URL[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async entry => {
    const url = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, directory);
    if (entry.isDirectory()) return sourceFiles(url);
    return /\.(ts|tsx)$/.test(entry.name) ? [url] : [];
  }));
  return nested.flat();
}

describe('standalone Roman roads map layer', () => {
  it('populates its source without scan output', async () => {
    const { map, setData } = mapWithSource();
    const fetchRoads = vi.fn().mockResolvedValue([route()]);

    await expect(populateRomanStandaloneRoads(map, VIEWPORT, fetchRoads)).resolves.toBe('available');
    expect(fetchRoads).toHaveBeenCalledWith(-0.2, 52, 0.1, 52.2);
    expect(setData).toHaveBeenCalledWith(expect.objectContaining({
      type: 'FeatureCollection',
      features: [expect.objectContaining({
        geometry: { type: 'LineString', coordinates: route().geometry },
      })],
    }));
  });

  it('is visible outside historic mode while scan routes retain their gate', () => {
    const state = {
      historicMode: false,
      devMode: false,
      visibility: {
        romanStandalone: true,
        routes: true,
        corridors: true,
        crossings: true,
        monuments: true,
        aim: true,
        context: true,
        pasDensity: false,
      },
    };
    const standalone = LAYER_VISIBILITY_CONFIG.find(layer => layer.id === 'roman-standalone');
    const scanRoute = LAYER_VISIBILITY_CONFIG.find(layer => layer.id === 'historic-routes-roman');

    expect(standalone?.visibleWhen(state)).toBe(true);
    expect(scanRoute?.visibleWhen(state)).toBe(false);
  });

  it('keeps scan and browse data in separate sources', async () => {
    const scanSetData = vi.fn();
    const standaloneSetData = vi.fn();
    const map = {
      getZoom: () => 12,
      getSource: (id: string) => id === 'historic-routes'
        ? { setData: scanSetData }
        : id === 'roman-roads-standalone'
          ? { setData: standaloneSetData }
          : undefined,
    } as unknown as maplibregl.Map;

    await populateRomanStandaloneRoads(map, VIEWPORT, async () => [route()]);
    expect(standaloneSetData).toHaveBeenCalledOnce();
    expect(scanSetData).not.toHaveBeenCalled();

    scanSetData({ type: 'FeatureCollection', features: [] });
    expect(standaloneSetData).toHaveBeenCalledOnce();
  });

  it('routes vector and raster opacity to the correct paint properties', () => {
    const setPaintProperty = vi.fn();
    const map = {
      getLayer: () => ({}),
      setPaintProperty,
    } as unknown as maplibregl.Map;

    applyOverlayOpacity(map, 'romanStandalone', 0.4);
    expect(setPaintProperty).toHaveBeenNthCalledWith(1, 'roman-standalone', 'line-opacity', 0.388);
    expect(setPaintProperty).toHaveBeenNthCalledWith(
      2,
      'roman-standalone-casing',
      'line-opacity',
      expect.closeTo(0.14),
    );

    applyOverlayOpacity(map, 'os1880', 0.4);
    expect(setPaintProperty).toHaveBeenNthCalledWith(3, 'overlay-os1880', 'raster-opacity', 0.4);
  });

  it('reports a failed asset load and leaves an empty source', async () => {
    const report = vi.spyOn(diagLog, 'reportNonFatal').mockImplementation(() => undefined);
    const { map, setData } = mapWithSource();
    const error = new Error('offline and uncached');

    await expect(populateRomanStandaloneRoads(map, VIEWPORT, async () => { throw error; }))
      .resolves.toBe('unavailable');
    expect(report).toHaveBeenCalledWith('field-guide-map', 'Roman roads layer unavailable', error);
    expect(setData).toHaveBeenCalledWith({ type: 'FeatureCollection', features: [] });
    report.mockRestore();
  });

  it('does not fetch below the zoom floor', async () => {
    const { map, setData } = mapWithSource(10.9);
    const fetchRoads = vi.fn().mockResolvedValue([route()]);

    await expect(populateRomanStandaloneRoads(map, VIEWPORT, fetchRoads)).resolves.toBe('zoom-in');
    expect(fetchRoads).not.toHaveBeenCalled();
    expect(setData).not.toHaveBeenCalled();
  });

  it('keeps Roman Roads credit in Settings without expanding the map attribution control', async () => {
    const sources = new Map<string, unknown>();
    const map = {
      getSource: vi.fn(() => undefined),
      addSource: vi.fn((id: string, source: unknown) => sources.set(id, source)),
      addLayer: vi.fn(),
      moveLayer: vi.fn(),
    } as unknown as maplibregl.Map;
    registerFieldGuideMapLayers(map);

    const source = sources.get('roman-roads-standalone') as { attribution?: string };
    const licence = await readFile(
      new URL('../../docs/rrra-digital-britannia-licensing.md', import.meta.url),
      'utf8',
    );
    const settings = await readFile(
      new URL('../../src/pages/Settings.tsx', import.meta.url),
      'utf8',
    );
    const documented = licence.match(/Attribution: “([^”]+)\n\s+([^”]+)”/)?.slice(1).join(' ');
    expect(source.attribution).toBeUndefined();
    expect(ROMAN_ROADS_ATTRIBUTION).toBe(documented);
    expect(settings).toContain('{ROMAN_ROADS_ATTRIBUTION} Not for use in fee-charging applications');
  });

  it('declares each overlay key union only once in src', async () => {
    const files = await sourceFiles(new URL('../../src/', import.meta.url));
    const source = (await Promise.all(files.map(file => readFile(file, 'utf8')))).join('\n');

    expect(source.match(/export type RasterOverlayKey\s*=/g)).toHaveLength(1);
    expect(source.match(/export type OverlayOpacityKey\s*=/g)).toHaveLength(1);
    expect(source.match(/'lidar' \| 'lidar-wales' \| 'relief' \| 'os1880' \| 'os1930'/g)).toHaveLength(1);
  });
});
