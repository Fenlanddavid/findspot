import React, { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { circle as turfCircle } from '@turf/turf';
import type { SurfaceAbundance, SurfaceMaterial, SurfaceObservation } from '../../db';
import { SURFACE_MATERIAL_LABELS, SURFACE_PERIOD_LABELS } from '../../services/surfaceScatter';
import { applyBasemap, BASEMAP_LAYERS, BASEMAP_SOURCES } from '../permission/basemaps';

export const SURFACE_MATERIAL_STYLES: Record<SurfaceMaterial, { color: string; glyph: string }> = {
  pottery: { color: '#b45309', glyph: 'P' },
  ceramic_building_material: { color: '#dc2626', glyph: 'C' },
  field_drain: { color: '#64748b', glyph: 'D' },
  flint: { color: '#7c3aed', glyph: 'F' },
  glass: { color: '#0891b2', glyph: 'G' },
  slag: { color: '#334155', glyph: 'S' },
  stone: { color: '#78716c', glyph: 'St' },
  bone: { color: '#ca8a04', glyph: 'B' },
  shell: { color: '#db2777', glyph: 'Sh' },
  modern_material: { color: '#2563eb', glyph: 'M' },
  other: { color: '#475569', glyph: 'O' },
};

const MARKER_SIZE: Record<SurfaceAbundance, number> = {
  single: 18,
  few: 22,
  frequent: 27,
  dense: 32,
};

function accuracyFeature(observation: SurfaceObservation | null) {
  if (!observation || observation.gpsAccuracyM == null || observation.gpsAccuracyM <= 0) {
    return { type: 'FeatureCollection', features: [] } as import('geojson').FeatureCollection;
  }
  return turfCircle([observation.lon, observation.lat], observation.gpsAccuracyM, {
    units: 'meters',
    steps: 48,
    properties: { observationId: observation.id },
  });
}

export function SurfaceObservationsMap({
  observations,
  selectedId,
  onSelect,
}: {
  observations: SurfaceObservation[];
  selectedId: string | null;
  onSelect: (observationId: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const selected = observations.find(row => row.id === selectedId) ?? null;

  useEffect(() => {
    if (!containerRef.current || observations.length === 0) return;
    const first = observations[0]!;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: { version: 8, sources: { ...BASEMAP_SOURCES }, layers: [...BASEMAP_LAYERS] },
      center: [first.lon, first.lat],
      zoom: 17,
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    map.on('load', () => {
      applyBasemap(map, 'streets');
      map.addSource('surface-selected-accuracy', { type: 'geojson', data: accuracyFeature(null) });
      map.addLayer({
        id: 'surface-selected-accuracy-fill',
        type: 'fill',
        source: 'surface-selected-accuracy',
        paint: { 'fill-color': '#38bdf8', 'fill-opacity': 0.14 },
      });
      map.addLayer({
        id: 'surface-selected-accuracy-outline',
        type: 'line',
        source: 'surface-selected-accuracy',
        paint: { 'line-color': '#38bdf8', 'line-width': 1.5, 'line-opacity': 0.8 },
      });
      const bounds = new maplibregl.LngLatBounds();
      for (const observation of observations) bounds.extend([observation.lon, observation.lat]);
      if (!bounds.isEmpty()) map.fitBounds(bounds, { padding: 45, maxZoom: 18, duration: 0 });
    });
    mapRef.current = map;
    return () => {
      markersRef.current.forEach(marker => marker.remove());
      markersRef.current = [];
      map.remove();
      mapRef.current = null;
    };
  // The marker effect handles row changes without rebuilding the basemap.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    markersRef.current.forEach(marker => marker.remove());
    markersRef.current = observations.map(observation => {
      const style = SURFACE_MATERIAL_STYLES[observation.material];
      const size = MARKER_SIZE[observation.abundance];
      const materialLabel = SURFACE_MATERIAL_LABELS[observation.material];
      const periodLabel = observation.periodImpression === 'unknown'
        ? 'Period not sure'
        : SURFACE_PERIOD_LABELS[observation.periodImpression];
      const button = document.createElement('button');
      button.type = 'button';
      button.title = `${materialLabel} — ${periodLabel} — ${observation.abundance}`;
      button.setAttribute('aria-label', button.title);
      button.style.cssText = 'display:flex;align-items:center;gap:5px;border:0;background:transparent;padding:0;cursor:pointer;filter:drop-shadow(0 2px 4px rgba(0,0,0,.38));';
      const dot = document.createElement('span');
      dot.textContent = style.glyph;
      dot.style.cssText = `display:grid;place-items:center;flex:0 0 auto;width:${size}px;height:${size}px;border-radius:999px;border:2px solid white;background:${style.color};color:white;font:800 ${size < 22 ? 8 : 9}px system-ui;`;
      const tag = document.createElement('span');
      tag.style.cssText = 'display:grid;gap:1px;min-width:max-content;border:1px solid rgba(15,23,42,.18);border-radius:6px;background:rgba(255,255,255,.96);padding:3px 6px;text-align:left;color:#0f172a;font-family:system-ui;line-height:1.05;';
      const materialText = document.createElement('span');
      materialText.textContent = materialLabel;
      materialText.style.cssText = 'font-size:10px;font-weight:800;';
      const periodText = document.createElement('span');
      periodText.textContent = periodLabel;
      periodText.style.cssText = 'font-size:9px;font-weight:700;color:#475569;';
      tag.append(materialText, periodText);
      button.append(dot, tag);
      if (observation.id === selectedId) tag.style.outline = '3px solid rgba(56,189,248,.75)';
      button.addEventListener('click', event => { event.stopPropagation(); onSelect(observation.id); });
      const marker = new maplibregl.Marker({ element: button, anchor: 'left' })
        .setLngLat([observation.lon, observation.lat])
        .addTo(map);
      // MapLibre applies the generic "Map marker" label during construction;
      // restore the evidence-specific accessible name afterwards.
      button.setAttribute('aria-label', button.title);
      return marker;
    });
    return () => { markersRef.current.forEach(marker => marker.remove()); markersRef.current = []; };
  }, [observations, onSelect, selectedId]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || observations.length === 0) return;
    const fit = () => {
      const bounds = new maplibregl.LngLatBounds();
      observations.forEach(observation => bounds.extend([observation.lon, observation.lat]));
      if (!bounds.isEmpty()) map.fitBounds(bounds, { padding: 45, maxZoom: 18, duration: 0 });
    };
    if (map.loaded()) fit(); else map.once('load', fit);
  }, [observations]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const update = () => (map.getSource('surface-selected-accuracy') as maplibregl.GeoJSONSource | undefined)
      ?.setData(accuracyFeature(selected));
    if (map.isStyleLoaded()) update(); else map.once('load', update);
  }, [selected]);

  return (
    <div>
      <div ref={containerRef} className="h-72 w-full overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700" aria-label="Surface observations map" />
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
        {(Object.keys(SURFACE_MATERIAL_STYLES) as SurfaceMaterial[]).map(material => (
          <span key={material} className="inline-flex items-center gap-1 text-3xs font-bold text-gray-500 dark:text-gray-400"><span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: SURFACE_MATERIAL_STYLES[material].color }} />{SURFACE_MATERIAL_LABELS[material]}</span>
        ))}
      </div>
      <p className="mt-2 text-3xs font-bold text-gray-400">Marker size shows abundance only. Extent is stored separately; the blue circle shows selected-point GPS accuracy.</p>
    </div>
  );
}
